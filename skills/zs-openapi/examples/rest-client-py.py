"""紫薯通告 /open-api/* REST 客户端（Python 3.11 + httpx）

覆盖 10 个接口（self / bloggers / bloggers/:id / bloggers/changes / bloggers/:id/stats /
  scraping-tasks / scraping-tasks/:id / scraping-tasks/:id/runs / sync-runs / sync-runs/:id）

配套文档：
  - 接口字段表：../references/api-reference.md
  - 错误码：../references/error-codes.md
  - LOCAL 守卫：../references/data-mode.md

用法：
  client = ZsClient(api_key=os.environ["ZSK_API_KEY"])
  self = client.get_self()
  for blogger in client.iterate_bloggers(platform="PGY", fans_count_min=10000):
      print(blogger["id"], blogger["fansCount"])

requirements.txt 片段：
  httpx==0.27.2
  python-dotenv==1.0.1

.env.example：
  ZSK_API_KEY=zsk_请替换为管理端「API 凭证」生成的明文
  ZS_API_BASE_URL=https://api.zishutonggao.com
"""

from __future__ import annotations

import random
import time
from collections.abc import Iterator
from typing import Any, Literal

import httpx

DEFAULT_BASE_URL = "https://api.zishutonggao.com"

Platform = Literal[
    "STARMAP",          # 抖音星图
    "PGY",              # 小红书蒲公英
    "VIDEO_HUXUAN",     # 视频号互选
    "MP_HUXUAN",        # 公众号互选
    "BILIBILI_HUAHUO",  # B 站花火
    "KUAISHOU_JLJX",    # 快手磁力聚星
]
TaskStatus = Literal["ACTIVE", "PAUSED", "ARCHIVED"]
TaskRunStatus = Literal["RUNNING", "SUCCESS", "FAILED"]
SyncRunStatus = Literal["PENDING", "RUNNING", "SUCCESS", "FAILED"]


class ZsApiError(Exception):
    """主动拉接口错误（包装 4xx / 5xx + 业务 code）"""

    def __init__(
        self,
        status: int,
        code: int,
        message: str,
        retry_after_seconds: int | None = None,
    ) -> None:
        super().__init__(f"[ZsApi {status}/{code}] {message}")
        self.status = status
        self.code = code
        self.api_message = message
        self.retry_after_seconds = retry_after_seconds

    @property
    def is_local_mode(self) -> bool:
        return self.status == 403 and "开启云端共享数据模式后可用" in self.api_message


class ZsClient:
    def __init__(
        self,
        api_key: str,
        base_url: str = DEFAULT_BASE_URL,
        max_retries: int = 5,
        timeout_seconds: float = 30.0,
    ) -> None:
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._max_retries = max_retries
        self._client = httpx.Client(
            timeout=timeout_seconds,
            headers={
                "X-API-Key": api_key,
                "Accept": "application/json",
            },
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "ZsClient":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    # ---------- 10 接口 ----------

    def get_self(self) -> dict[str, Any]:
        """接口 1：自查企业信息"""
        return self._request("GET", "/open-api/organizations/self")

    def list_bloggers(
        self,
        *,
        platform: Platform | None = None,
        fans_count_min: int | None = None,
        fans_count_max: int | None = None,
        tags: list[str] | None = None,
        category: str | None = None,
        updated_since: str | None = None,
        cursor: str | None = None,
        limit: int | None = None,
    ) -> dict[str, Any]:
        """接口 2：达人列表（单页；自动翻页用 iterate_bloggers）"""
        return self._request(
            "GET",
            "/open-api/bloggers",
            params={
                "platform": platform,
                "fansCountMin": fans_count_min,
                "fansCountMax": fans_count_max,
                "tags": ",".join(tags) if tags else None,
                "category": category,
                "updatedSince": updated_since,
                "cursor": cursor,
                "limit": limit,
            },
        )

    def iterate_bloggers(
        self,
        **filter_kwargs: Any,
    ) -> Iterator[dict[str, Any]]:
        """接口 2 自动翻页"""
        cursor: str | None = filter_kwargs.pop("cursor", None)
        while True:
            page = self.list_bloggers(cursor=cursor, **filter_kwargs)
            for item in page["items"]:
                yield item
            cursor = page.get("nextCursor")
            if not page.get("hasMore"):
                break
            if cursor is None:
                break

    def get_blogger(self, blogger_id: str) -> dict[str, Any]:
        """接口 3：达人详情（含 rawData）"""
        return self._request("GET", f"/open-api/bloggers/{blogger_id}")

    def list_blogger_changes(
        self,
        *,
        since: str | None = None,
        cursor: str | None = None,
        limit: int | None = None,
    ) -> dict[str, Any]:
        """接口 4：增量变更流"""
        return self._request(
            "GET",
            "/open-api/bloggers/changes",
            params={"since": since, "cursor": cursor, "limit": limit},
        )

    def iterate_blogger_changes(
        self,
        *,
        since: str | None = None,
        limit: int | None = None,
    ) -> Iterator[dict[str, Any]]:
        """接口 4 自动翻页"""
        cursor: str | None = None
        while True:
            page = self.list_blogger_changes(since=since, cursor=cursor, limit=limit)
            for item in page["items"]:
                yield item
            cursor = page.get("nextCursor")
            if not page.get("hasMore"):
                break
            if cursor is None:
                break

    def get_blogger_stats(
        self,
        blogger_id: str,
        *,
        from_: str | None = None,
        to: str | None = None,
    ) -> dict[str, Any]:
        """接口 5：达人统计快照"""
        return self._request(
            "GET",
            f"/open-api/bloggers/{blogger_id}/stats",
            params={"from": from_, "to": to},
        )

    def list_scraping_tasks(
        self,
        *,
        platform: Platform | None = None,
        status: TaskStatus | None = None,
        cursor: str | None = None,
        limit: int | None = None,
    ) -> dict[str, Any]:
        """接口 6：采集任务列表"""
        return self._request(
            "GET",
            "/open-api/scraping-tasks",
            params={
                "platform": platform,
                "status": status,
                "cursor": cursor,
                "limit": limit,
            },
        )

    def get_scraping_task(self, task_id: str) -> dict[str, Any]:
        """接口 7：采集任务详情"""
        return self._request("GET", f"/open-api/scraping-tasks/{task_id}")

    def list_scraping_task_runs(
        self,
        task_id: str,
        *,
        status: TaskRunStatus | None = None,
        cursor: str | None = None,
        limit: int | None = None,
    ) -> dict[str, Any]:
        """接口 8：采集任务运行历史"""
        return self._request(
            "GET",
            f"/open-api/scraping-tasks/{task_id}/runs",
            params={"status": status, "cursor": cursor, "limit": limit},
        )

    def list_sync_runs(
        self,
        *,
        endpoint_id: str | None = None,
        status: SyncRunStatus | None = None,
        cursor: str | None = None,
        limit: int | None = None,
    ) -> dict[str, Any]:
        """接口 9：主动推运行记录（反向审计）"""
        return self._request(
            "GET",
            "/open-api/sync-runs",
            params={
                "endpointId": endpoint_id,
                "status": status,
                "cursor": cursor,
                "limit": limit,
            },
        )

    def get_sync_run(self, run_id: str) -> dict[str, Any]:
        """接口 10：主动推单次详情（含 failedBloggerIds）"""
        return self._request("GET", f"/open-api/sync-runs/{run_id}")

    # ---------- 内部 ----------

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
    ) -> Any:
        # 过滤空值
        if params:
            params = {k: v for k, v in params.items() if v is not None}

        url = f"{self._base_url}{path}"
        retry = 0

        while True:
            res = self._client.request(method, url, params=params)

            # 429：严格按 Retry-After 退避
            if res.status_code == 429:
                retry_after = int(res.headers.get("Retry-After", "30"))
                time.sleep(retry_after + random.random())
                continue  # 不计入 max_retries

            # 5xx：指数退避 + 抖动
            if res.status_code >= 500 and retry < self._max_retries:
                backoff = min(2**retry, 30) + random.random()
                time.sleep(backoff)
                retry += 1
                continue

            # 解析响应
            try:
                envelope = res.json()
            except ValueError as exc:
                raise ZsApiError(
                    res.status_code,
                    res.status_code,
                    f"Non-JSON response: {res.text[:200]}",
                ) from exc

            if res.status_code == 200 and envelope.get("code") == 200:
                return envelope.get("data")

            # 401 / 403 / 404 / 400：不重试，抛错
            raise ZsApiError(
                res.status_code,
                int(envelope.get("code", res.status_code)),
                str(envelope.get("message", f"HTTP {res.status_code}")),
            )


# 端到端使用示例（取消注释跑）
# if __name__ == "__main__":
#     import os
#     from dotenv import load_dotenv
#     load_dotenv()
#
#     with ZsClient(api_key=os.environ["ZSK_API_KEY"]) as client:
#         self_info = client.get_self()
#         if self_info["dataMode"] == "LOCAL":
#             print("企业是 LOCAL 模式，所有 /open-api/* 都会 403。请管理员切 CLOUD")
#             raise SystemExit(1)
#
#         for blogger in client.iterate_bloggers(platform="PGY", fans_count_min=10000):
#             print(blogger["id"], blogger["nickname"], blogger["fansCount"])
#
#         for change in client.iterate_blogger_changes(since="2026-05-01T00:00:00Z"):
#             print("changed:", change["id"])
