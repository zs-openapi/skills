"""紫薯通告主动推 webhook 接收端（Python 3.11 + FastAPI）

配套文档：
  - 签名算法：../references/signature-algorithm.md
  - 错误码：../references/error-codes.md

启动：
  1. cp .env.example .env  # 填 WEBHOOK_SECRET
  2. pip install -r requirements.txt
  3. uvicorn webhook_receiver_py:app --host 0.0.0.0 --port 3000

requirements.txt 片段：
  fastapi==0.115.0
  uvicorn[standard]==0.32.0
  python-dotenv==1.0.1

.env.example：
  WEBHOOK_SECRET=zswh_请替换为管理端弹层里的明文
  PORT=3000
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import os
import time
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request

load_dotenv()

WEBHOOK_SECRET = os.environ.get("WEBHOOK_SECRET")
if not WEBHOOK_SECRET:
    raise RuntimeError("Missing WEBHOOK_SECRET env")

TIMESTAMP_SKEW_SECONDS = 300

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("zs-webhook")

app = FastAPI(title="zs-webhook")

# 幂等去重：按 (endpoint_id, run_id, blogger.id) 三元组
# 占位实现：进程内 set（仅 demo / 单实例）
# 生产建议：Redis SET ... EX 86400 NX，或 DB 表加唯一索引
_processed_keys: set[str] = set()


def already_processed(endpoint_id: str, run_id: str, blogger_id: str) -> bool:
    key = f"{endpoint_id}:{run_id}:{blogger_id}"
    if key in _processed_keys:
        return True
    _processed_keys.add(key)
    return False


def verify_signature(raw_body: bytes, signature_header: str, timestamp: str) -> bool:
    """常量时间比较签名（防 timing attack）"""
    expected = hmac.new(
        WEBHOOK_SECRET.encode(),
        raw_body + b"\n" + timestamp.encode(),
        hashlib.sha256,
    ).hexdigest()
    expected_full = f"sha256={expected}"
    return hmac.compare_digest(expected_full, signature_header)


async def handle_blogger(blogger: dict[str, Any]) -> None:
    """业务桩：把达人数据落到你的库

    替换为真实实现（写 MySQL / Postgres / 推 MQ / 调内部服务）。
    """
    logger.info(
        "[handle_blogger] id=%s platform=%s fans=%s",
        blogger.get("id"),
        blogger.get("platform"),
        blogger.get("fansCount"),
    )


@app.post("/zs-webhook")
async def zs_webhook(request: Request) -> dict[str, Any]:
    # 必须用 request.body() 拿原始字节，不要走 request.json()
    raw_body = await request.body()
    signature = request.headers.get("X-ZS-Signature", "")
    timestamp = request.headers.get("X-ZS-Timestamp", "")

    # 1. 验签
    if not signature or not timestamp or not verify_signature(raw_body, signature, timestamp):
        raise HTTPException(status_code=401, detail="Signature verification failed")

    # 2. 时间戳防重放（±5 分钟）
    try:
        skew = abs(int(time.time()) - int(timestamp))
    except ValueError as exc:
        raise HTTPException(status_code=401, detail="Bad timestamp") from exc
    if skew > TIMESTAMP_SKEW_SECONDS:
        raise HTTPException(status_code=401, detail="Timestamp skew exceeded")

    # 3. 解析 payload
    import json

    try:
        payload = json.loads(raw_body.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON") from exc

    bloggers: list[dict[str, Any]] = payload.get("bloggers", [])
    endpoint_id: str = payload.get("endpointId", "")
    run_id: str = payload.get("runId", "")
    attempt: int = int(payload.get("attempt", 1))

    # 4. 幂等 + 业务处理
    processed = 0
    skipped = 0
    for blogger in bloggers:
        if already_processed(endpoint_id, run_id, blogger["id"]):
            skipped += 1
            continue
        try:
            await handle_blogger(blogger)
            processed += 1
        except Exception:  # 单条失败不整批 fail
            logger.exception("[handle_blogger] failed: %s", blogger.get("id"))

    logger.info(
        "[webhook] endpoint=%s run=%s attempt=%s processed=%s skipped=%s",
        endpoint_id,
        run_id,
        attempt,
        processed,
        skipped,
    )

    return {"code": 200, "message": "ok"}


@app.get("/healthz")
async def healthz() -> dict[str, bool]:
    return {"ok": True}
