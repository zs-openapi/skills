# 紫薯通告 `/open-api/*` 接口参考

本期接口完整字段表。所有接口共用：

- **Base URL（生产）**：`https://api.zishutonggao.com`
- **鉴权 header**：`X-API-Key: <ZSK_API_KEY>`（企业级）
- **响应包装**：`{ code: number, message?: string, data: T }`，`code === 200` 成功，其余看 [`error-codes.md`](./error-codes.md)
- **LOCAL 模式守卫**：企业 `dataMode = LOCAL` 时，下列所有接口一律返 `403 + "开启云端共享数据模式后可用"`，看 [`data-mode.md`](./data-mode.md)
- **限流**：单 ApiKey 60 req/min，响应头 `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset`，超额 `429 + Retry-After`
- **OpenAPI spec**：`GET https://api.zishutonggao.com/open-api/openapi.json`
- **平台 enum 6 个值**（`STARMAP` / `PGY` / `VIDEO_HUXUAN` / `MP_HUXUAN` / `BILIBILI_HUAHUO` / `KUAISHOU_JLJX`）与中文 / URL host 对照表见 [`platforms.md`](./platforms.md)

---

## 达人列表导入：`POST /open-api/bloggers/batch`

企业自有系统把达人名单写入紫薯通告企业达人库。导入后可参与后续采集，缺失字段会在首次采集后回填。

**Header**

| Header | 必填 | 说明 |
|--------|------|------|
| `X-API-Key` | 是 | 企业 API Key，需要 `blogger:write` 权限 |
| `Idempotency-Key` | 否 | 建议填写稳定批次键；相同 key + 相同请求体会返回同一 run |

**请求示例**

```json
{
  "sourceSystem": "brand-crm",
  "items": [
    {
      "platform": "PGY",
      "url": "https://www.xiaohongshu.com/user/profile/5fa1...",
      "externalId": "crm_123",
      "tags": ["美妆", "护肤"],
      "priceJson": {
        "imageText": 5000,
        "video": 12000
      },
      "rawData": {
        "source": "crm"
      }
    }
  ]
}
```

规则：

- 单批最多 500 条。
- 最小 item 只要求 `platform + url`；`platformBloggerId` 可选。
- `PGY` 支持蒲公英链接、小红书主页链接和 `xhslink.com` 短链。
- 短链会先展开再解析；展开失败且未传 `platformBloggerId` 时返回行级错误。
- `priceJson` / `rawData` 必须保持结构化对象，不合并成大字符串。

**响应示例**

```json
{
  "code": 200,
  "data": {
    "runId": "oir_xxx",
    "total": 100,
    "created": 20,
    "updated": 75,
    "failed": 5,
    "discardedFieldsByPlatform": {
      "PGY": ["unsupportedField"]
    },
    "errors": [
      {
        "index": 3,
        "platform": "PGY",
        "code": "SHORT_URL_EXPAND_FAILED",
        "message": "短链展开失败，请提供 platformBloggerId 或改传达人主页长链接"
      }
    ]
  }
}
```

相关接口：

- `POST /open-api/bloggers`：单条导入，body 即单个 item。
- `POST /open-api/bloggers/deactivate`：停用/归档达人，不物理删除。
- `GET /open-api/import-runs`：导入批次列表。
- `GET /open-api/import-runs/:id`：导入批次详情。

---

## 接口 1：`GET /open-api/organizations/self`

自查：当前 ApiKey 对应企业的基本信息 / `dataMode` / 配额。

**参数**：无

**响应示例**

```json
{
  "code": 200,
  "data": {
    "id": "org_abc123",
    "name": "某品牌方有限公司",
    "dataMode": "CLOUD",
    "memberCount": 8,
    "bloggerCount": 12450,
    "rateLimitPerMinute": 60,
    "apiKeyLastUsedAt": "2026-05-13T08:12:34Z",
    "apiKeyLastUsedIp": "203.0.113.42"
  }
}
```

LOCAL 模式守卫：本接口与下面 9 个一致，LOCAL → `403 { code: 403, message: "开启云端共享数据模式后可用" }`。

---

## 接口 2：`GET /open-api/bloggers`

列表 + 过滤，cursor 分页。

**Query 参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `platform` | `STARMAP` \| `PGY` \| `VIDEO_HUXUAN` \| `MP_HUXUAN` \| `BILIBILI_HUAHUO` \| `KUAISHOU_JLJX` | 否 | 官方达人广告平台过滤（中文对照：抖音星图 / 小红书蒲公英 / 视频号互选 / 公众号互选 / B 站花火 / 快手磁力聚星） |
| `fansCountMin` | number | 否 | 粉丝下限 |
| `fansCountMax` | number | 否 | 粉丝上限 |
| `tags` | string（英文逗号分隔） | 否 | 标签 OR 过滤 |
| `category` | string | 否 | 类目精确匹配 |
| `updatedSince` | ISO-8601 | 否 | 仅返该时间后更新的 |
| `cursor` | string | 否 | 翻页游标，从上一页 `nextCursor` 取 |
| `limit` | number | 否 | 默认 100，上限 500 |

**响应示例**

```json
{
  "code": 200,
  "data": {
    "items": [
      {
        "id": "blg_xxx",
        "organizationId": "org_abc123",
        "platform": "PGY",
        "platformBloggerId": "5fa1...",
        "nickname": "...",
        "avatar": "...",
        "url": "...",
        "fansCount": 12345,
        "interactRate": 0.034,
        "location": "上海",
        "gender": "FEMALE",
        "category": "美妆",
        "priceJson": { "imageText": 5000, "shortVideo": 12000 },
        "contactWechat": null,
        "contactPhone": null,
        "contactEmail": null,
        "tags": ["美妆", "护肤"],
        "remark": "...",
        "lastSyncedAt": "2026-05-12T08:30:00Z",
        "source": "SCRAPE",
        "createdAt": "2026-05-01T10:00:00Z",
        "updatedAt": "2026-05-12T08:30:00Z"
      }
    ],
    "nextCursor": "eyJ1cGRhdGVkQXQiOiIyMDI2LTA1LTEyVDA4OjMwOjAwWiIsImlkIjoiYmxnX3h4eCJ9",
    "hasMore": true
  }
}
```

翻页：把 `nextCursor` 原样放到下次请求的 `cursor`。`hasMore = false` 时终止。

LOCAL 模式守卫：→ `403 { code: 403, message: "开启云端共享数据模式后可用" }`。

---

## 接口 3：`GET /open-api/bloggers/:id`

详情，含 `rawData`（平台原始响应）。

**Path 参数**：`id`（如 `blg_xxx`）

**响应示例**

```json
{
  "code": 200,
  "data": {
    "id": "blg_xxx",
    "organizationId": "org_abc123",
    "platform": "PGY",
    "platformBloggerId": "5fa1...",
    "nickname": "...",
    "fansCount": 12345,
    "priceJson": { "imageText": 5000, "shortVideo": 12000 },
    "tags": ["美妆", "护肤"],
    "lastSyncedAt": "2026-05-12T08:30:00Z",
    "rawData": {
      "rawFollowers": 12345,
      "rawLikes": 98765,
      "rawExtra": { "...": "..." }
    },
    "createdAt": "2026-05-01T10:00:00Z",
    "updatedAt": "2026-05-12T08:30:00Z"
  }
}
```

LOCAL 模式守卫：→ `403 { code: 403, message: "开启云端共享数据模式后可用" }`。

---

## 接口 4：`GET /open-api/bloggers/changes`

增量变更流，基于 `(updatedAt, id)` 复合游标。**这是增量同步脚本的主接口**。

**Query 参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `since` | ISO-8601 | 否 | 起点时间；空 = 从最早开始 |
| `cursor` | string | 否 | 上一页 `nextCursor` |
| `limit` | number | 否 | 默认 100，上限 500 |

**响应示例**

```json
{
  "code": 200,
  "data": {
    "items": [ /* Blogger[] - 字段同接口 2 */ ],
    "nextCursor": "eyJ1cGRhdGVkQXQiOiIyMDI2LTA1LTEyVDA4OjMwOjAwWiIsImlkIjoiYmxnX3l5eSJ9",
    "hasMore": true
  }
}
```

游标语义：服务端按 `(updatedAt ASC, id ASC)` 排序。客户端循环：

```
do {
  res = GET /open-api/bloggers/changes?since=<lastSince>&cursor=<cursor>
  落库 res.data.items
  cursor = res.data.nextCursor
} while (res.data.hasMore)
本次同步结束后：lastSince = max(items.updatedAt)
```

LOCAL 模式守卫：→ `403 { code: 403, message: "开启云端共享数据模式后可用" }`。

---

## 接口 5：`GET /open-api/bloggers/:id/stats`

`BloggerStatSnapshot` 历史快照。

**Path 参数**：`id`
**Query 参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `from` | ISO-8601 | 否 | 起始日期 |
| `to` | ISO-8601 | 否 | 结束日期 |

**响应示例**

```json
{
  "code": 200,
  "data": {
    "bloggerId": "blg_xxx",
    "snapshots": [
      {
        "snapshotAt": "2026-05-10T00:00:00Z",
        "fansCount": 12300,
        "interactRate": 0.033,
        "noteCount": 142,
        "likeCount": 98000
      },
      {
        "snapshotAt": "2026-05-12T00:00:00Z",
        "fansCount": 12345,
        "interactRate": 0.034,
        "noteCount": 145,
        "likeCount": 99500
      }
    ]
  }
}
```

LOCAL 模式守卫：→ `403 { code: 403, message: "开启云端共享数据模式后可用" }`。

---

## 接口 6：`GET /open-api/scraping-tasks`

采集任务列表。

**Query 参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `platform` | enum | 否 | 同接口 2 |
| `status` | `ACTIVE` \| `PAUSED` \| `ARCHIVED` | 否 | 任务状态 |
| `cursor` | string | 否 | |
| `limit` | number | 否 | 默认 50，上限 200 |

**响应示例**

```json
{
  "code": 200,
  "data": {
    "items": [
      {
        "id": "tsk_abc",
        "organizationId": "org_abc123",
        "name": "美妆类 PGY 每日刷新",
        "platform": "PGY",
        "status": "ACTIVE",
        "pacePreset": "STEADY",
        "lastRunAt": "2026-05-13T02:00:00Z",
        "nextRunAt": "2026-05-14T02:00:00Z",
        "createdAt": "2026-05-01T10:00:00Z"
      }
    ],
    "nextCursor": null,
    "hasMore": false
  }
}
```

LOCAL 模式守卫：→ `403 { code: 403, message: "开启云端共享数据模式后可用" }`。

---

## 接口 7：`GET /open-api/scraping-tasks/:id`

任务详情。

**Path 参数**：`id`

**响应示例**

```json
{
  "code": 200,
  "data": {
    "id": "tsk_abc",
    "organizationId": "org_abc123",
    "name": "美妆类 PGY 每日刷新",
    "platform": "PGY",
    "status": "ACTIVE",
    "pacePreset": "STEADY",
    "platformPolicyVersion": "v3",
    "accountConcurrencyPerTask": 4,
    "bloggerCount": 5200,
    "lastRunAt": "2026-05-13T02:00:00Z",
    "nextRunAt": "2026-05-14T02:00:00Z",
    "createdAt": "2026-05-01T10:00:00Z",
    "updatedAt": "2026-05-13T02:00:00Z"
  }
}
```

LOCAL 模式守卫：→ `403 { code: 403, message: "开启云端共享数据模式后可用" }`。

---

## 接口 8：`GET /open-api/scraping-tasks/:id/runs`

任务运行历史。

**Path 参数**：`id`
**Query 参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `status` | `RUNNING` \| `SUCCESS` \| `FAILED` | 否 | |
| `cursor` | string | 否 | |
| `limit` | number | 否 | 默认 50，上限 200 |

**响应示例**

```json
{
  "code": 200,
  "data": {
    "items": [
      {
        "id": "tskrun_xxx",
        "taskId": "tsk_abc",
        "status": "SUCCESS",
        "startedAt": "2026-05-13T02:00:00Z",
        "finishedAt": "2026-05-13T02:35:12Z",
        "totalBloggers": 5200,
        "succeededBloggers": 5180,
        "failedBloggers": 20,
        "errorSummary": "20 个达人因平台风控暂停"
      }
    ],
    "nextCursor": null,
    "hasMore": false
  }
}
```

LOCAL 模式守卫：→ `403 { code: 403, message: "开启云端共享数据模式后可用" }`。

---

## 接口 9：`GET /open-api/sync-runs`

主动推运行记录（反向审计：查紫薯通告推了哪些批次到你的 endpoint）。

**Query 参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `endpointId` | string | 否 | 端点过滤 |
| `status` | `PENDING` \| `RUNNING` \| `SUCCESS` \| `FAILED` | 否 | |
| `cursor` | string | 否 | |
| `limit` | number | 否 | 默认 50，上限 200 |

**响应示例**

```json
{
  "code": 200,
  "data": {
    "items": [
      {
        "id": "ser_yyy",
        "endpointId": "se_xxx",
        "status": "SUCCESS",
        "attempt": 1,
        "totalBloggers": 50,
        "succeededBloggers": 50,
        "failedBloggers": 0,
        "startedAt": "2026-05-13T08:00:00Z",
        "finishedAt": "2026-05-13T08:00:02Z"
      }
    ],
    "nextCursor": null,
    "hasMore": false
  }
}
```

LOCAL 模式守卫：→ `403 { code: 403, message: "开启云端共享数据模式后可用" }`。

---

## 接口 10：`GET /open-api/sync-runs/:id`

单次推送详情，含 `failedBloggerIds` 数组（便于客户端反向查哪批没推成功）。

**Path 参数**：`id`（如 `ser_yyy`）

**响应示例**

```json
{
  "code": 200,
  "data": {
    "id": "ser_yyy",
    "endpointId": "se_xxx",
    "status": "FAILED",
    "attempt": 2,
    "totalBloggers": 50,
    "succeededBloggers": 47,
    "failedBloggers": 3,
    "failedBloggerIds": ["blg_a", "blg_b", "blg_c"],
    "lastError": "客户接口 504 Gateway Timeout",
    "startedAt": "2026-05-13T08:00:00Z",
    "finishedAt": "2026-05-13T08:00:31Z"
  }
}
```

LOCAL 模式守卫：→ `403 { code: 403, message: "开启云端共享数据模式后可用" }`。

---

## 字段策略

- Blogger / SyncEndpointRun JSON 字段只增不删：新字段追加到末尾，老字段不删不改语义。客户端解析应允许未知字段。
- JSON 对象 key 统一使用英文 camelCase，不使用中文 key。中文只可作为展示值或业务内容。
- 时间统一 ISO-8601 UTC。
- 金额单位：`priceJson` 内为分（整数），报价项 key 例如 `imageText`、`shortVideo`。
- ID 前缀：`org_` 企业 / `blg_` 达人 / `tsk_` 任务 / `tskrun_` 任务运行 / `se_` 同步端点 / `ser_` 同步端点运行。
