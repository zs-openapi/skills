# HMAC-SHA256 签名验签算法

主动推 webhook 的请求体由紫薯通告签名，客户端必须验签后才落库。

## 请求头

```
POST <your-url>
Content-Type: application/json
X-ZS-Signature: sha256=<hex>
X-ZS-Timestamp: 1715587200
```

- `X-ZS-Signature`：`sha256=` 前缀 + 64 个十六进制小写字符
- `X-ZS-Timestamp`：Unix 秒（10 位数字字符串）

## 签名内容

```
<raw request body bytes> + "\n" + <X-ZS-Timestamp>
```

注意三点：

1. **raw bytes**，不是反序列化后的 JSON 重新拼。任何空白差异都会让签名对不上。
2. 中间是单字符 LF（`0x0A`），不是 `\r\n`。
3. `X-ZS-Timestamp` 直接以字符串形式拼，不要重新格式化。

## 算法

- 函数：HMAC-SHA256
- 密钥：端点级 `WEBHOOK_SECRET`（管理端「数据同步」→ 新建端点时一次性返回）
- 输出：hex 小写（64 字符）

伪代码：

```
expected = "sha256=" + hex_lower(HMAC_SHA256(WEBHOOK_SECRET, body_bytes + "\n" + timestamp_str))
assert constant_time_equal(expected, X-ZS-Signature)
```

## Node.js 验签（5 行）

```ts
import crypto from 'node:crypto';

const expected = crypto
  .createHmac('sha256', process.env.WEBHOOK_SECRET!)
  .update(Buffer.concat([rawBody, Buffer.from('\n' + timestamp)]))
  .digest('hex');
const ok = `sha256=${expected}` === signatureHeader;
```

完整示例：[`../examples/webhook-receiver-node.ts`](../examples/webhook-receiver-node.ts)。

注意拿 `rawBody` 必须用 `express.raw({ type: 'application/json' })`，不要先 `express.json()`——后者会重新序列化导致 byte 不一致。

## Python 验签（5 行）

```python
import hmac, hashlib
expected = hmac.new(
    WEBHOOK_SECRET.encode(),
    raw_body + b"\n" + timestamp.encode(),
    hashlib.sha256,
).hexdigest()
ok = hmac.compare_digest(f"sha256={expected}", signature_header)
```

完整示例：[`../examples/webhook-receiver-py.py`](../examples/webhook-receiver-py.py)。

FastAPI 拿原始字节用 `await request.body()`，不要走 `request.json()`。

## Java 验签（Spring Boot）

```java
Mac mac = Mac.getInstance("HmacSHA256");
mac.init(new SecretKeySpec(WEBHOOK_SECRET.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
mac.update(rawBody);
mac.update((byte) '\n');
String expected = "sha256=" + HexFormat.of().formatHex(
    mac.doFinal(timestamp.getBytes(StandardCharsets.UTF_8))
);
boolean ok = MessageDigest.isEqual(
    expected.getBytes(StandardCharsets.UTF_8),
    signatureHeader.getBytes(StandardCharsets.UTF_8)
);
```

完整示例：[`../examples/webhook-receiver-java.java`](../examples/webhook-receiver-java.java)。

Spring Boot 接收原始字节建议使用 `@RequestBody byte[] rawBody`，不要先把 body 反序列化成对象再重新序列化。

## 防重放：时间戳 ±5 分钟

签名校验通过后，再校验 `X-ZS-Timestamp` 与当前服务器时间差不超过 ±300 秒，超出拒绝（401）。

```ts
const skewSec = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
if (skewSec > 300) return res.status(401).end();
```

```python
import time
if abs(int(time.time()) - int(timestamp)) > 300:
    raise HTTPException(401)
```

## 常量时间比较

签名比较用常量时间 API 防 timing attack：

- Node：`crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))`（先确保两 Buffer 长度一致）
- Python：`hmac.compare_digest(a, b)`
- Java：`MessageDigest.isEqual(aBytes, bBytes)`（先确保两 byte array 长度一致）

直接 `===` 在生产是隐患，模板代码已替换为常量时间版本。

## 验签失败应做什么

- 返 `401`，不要返 200。紫薯通告会按 3s / 10s / 30s 退避重试 3 次，3 次失败标记 endpoint run `FAILED`，企业管理员可在 UI 点「立即重推」生成 `attempt = N+1` 的新 run。
- 不要把签名 / timestamp / body 写日志（密钥泄漏风险）。失败只记 endpointId 和粗略原因（如 "sig_mismatch" / "ts_skew"）。

## 故障排查

| 现象 | 排查 |
|------|------|
| 所有请求都验签失败 | `WEBHOOK_SECRET` 是不是另一个 endpoint 的？每个 endpoint 一份独立密钥 |
| 部分失败 | 检查中间件顺序：必须 `express.raw` 早于路由 handler；FastAPI 不要在前置中间件做 `body()` 二次读取 |
| Node 工作 Python 不工作 | 检查换行符：必须 `\n`（LF），不要 `\r\n` |
| 偶发失败 | 服务器时钟漂了，开 NTP |
