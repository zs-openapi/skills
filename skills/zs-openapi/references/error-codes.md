# 错误码与重试策略

`/open-api/*` 全部走统一响应包装 `{ code, message?, data? }`，`code` 与 HTTP status 一致。

| HTTP / code | 含义 | 处理建议 |
|------|------|---------|
| 200 | 成功 | 正常解析 `data` |
| 400 | 参数错误（`since` 格式非法、`limit` 越界、`cursor` 不合法等） | 修正请求；不要重试 |
| 401 | ApiKey 缺失 / 错误 / 已禁用 | 检查 `X-API-Key`；如已撤销，让企业管理员重新生成 |
| 403 | `dataMode = LOCAL` | 让企业管理员去管理端「企业管理」→「数据模式」切到 CLOUD（不可逆，看 [`data-mode.md`](./data-mode.md)） |
| 404 | 资源不存在（Blogger / Task / SyncRun id 错或被删） | 检查 ID；不要重试 |
| 429 | 单 ApiKey 60 req/min 限流 | 按 `Retry-After` 退避后重试 |
| 500 | 服务端错误 | 指数退避 + 抖动重试；3 次仍失败联系 zoho.allen@gmail.com |

## 400 示例

```bash
curl -sS https://api.zishutonggao.com/open-api/bloggers/changes?since=not-a-date \
  -H "X-API-Key: $ZSK_API_KEY"
```

```json
{
  "code": 400,
  "message": "Invalid query parameter: since must be ISO-8601",
  "data": null
}
```

## 401 示例

```bash
curl -sS https://api.zishutonggao.com/open-api/organizations/self
# 未带 header
```

```json
{
  "code": 401,
  "message": "Missing or invalid X-API-Key",
  "data": null
}
```

## 403 示例（LOCAL 模式）

```bash
curl -sS https://api.zishutonggao.com/open-api/bloggers \
  -H "X-API-Key: $ZSK_API_KEY"
```

```json
{
  "code": 403,
  "message": "开启云端共享数据模式后可用",
  "data": null
}
```

固定文案，原文匹配可作为 LOCAL 守卫的检测信号。

## 404 示例

```bash
curl -sS https://api.zishutonggao.com/open-api/bloggers/blg_nope \
  -H "X-API-Key: $ZSK_API_KEY"
```

```json
{
  "code": 404,
  "message": "Blogger not found",
  "data": null
}
```

## 429 示例

```bash
curl -sS -D - https://api.zishutonggao.com/open-api/bloggers \
  -H "X-API-Key: $ZSK_API_KEY"
```

```
HTTP/1.1 429 Too Many Requests
Retry-After: 38
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1715587260

{"code":429,"message":"Rate limit exceeded","data":null}
```

`Retry-After` 单位是秒。

## 推荐退避策略

```
retry_count = 0
while retry_count < 5:
    res = call_api()
    if res.status == 200:
        return res.data

    if res.status == 429:
        sleep(int(res.headers["Retry-After"]) + jitter(0, 1))
        continue

    if res.status >= 500:
        backoff = min(2 ** retry_count, 30) + jitter(0, 1)
        sleep(backoff)
        retry_count += 1
        continue

    # 400 / 401 / 403 / 404：不重试，按业务逻辑处理
    raise Error(res)

raise Error("max retries exceeded")
```

要点：

- **429** 严格按 `Retry-After`，不要自己估
- **5xx** 指数退避（1s / 2s / 4s / 8s / 16s，封顶 30s），加 0~1s 抖动避免雷鸣
- **4xx**（除 429）一律不重试——重试也是同样错
- 限重试次数（建议 5），超过转人工告警

`examples/rest-client-node.ts` 与 `examples/rest-client-py.py` 内置了这套退避，开箱可用。

## 限流响应头

每次响应都带：

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 42
X-RateLimit-Reset: 1715587260
```

`Reset` 是下一个窗口起点的 Unix 秒。客户端可主动监控 `Remaining` 低于阈值时主动减速。

## 不要做的事

- 同 ApiKey 起多进程并发轮询：60 req/min 是 ApiKey 维度，不是 IP 维度。多进程算同一个池。
- 把限流当业务错误抛给上游：限流是临时态，必须吃掉自己退避。
- 401 后用同一 key 立即重试：肯定还是 401。
