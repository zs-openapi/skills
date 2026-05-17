---
name: zs-openapi
description: 紫薯通告 Zishu Tonggao OpenAPI 一键接入。让 AI 自动生成主动推 webhook 接收端 + 主动拉 REST API client + 增量同步脚本，覆盖 HMAC 签名校验、cursor 分页、错误重试、CLOUD/LOCAL 模式守卫。适用于 zishutonggao、zsblogger、达人数据同步、紫薯通告主动推、紫薯通告主动拉。
api-version: "2026.05"
triggers:
  - 接入紫薯通告
  - 对接紫薯通告 API
  - 紫薯通告主动推
  - 紫薯通告主动拉
  - zishutonggao
  - zsblogger
  - 紫薯通告 webhook
future_integrations:
  - 报价检索（按粉丝量 / 类目筛选并拉报价）
  - 任务管理（远程触发刷新任务 / 查任务进度）
  - 成员管理（开通子账号 / 配额查询）
  - 薯苗 / 订阅查询
allowed-tools: Read, Write, Edit, Bash
---

# 紫薯通告 API Skill

你（AI 助手）激活了紫薯通告官方 SKILL。下面是给你的执行指令——按节读、按场景挑文件，不要全量倾倒文档。

---

## 1. 何时触发

用户对话出现下列任一关键词或语义时，本 Skill 已激活：

- 自然语言：`接入紫薯通告` / `对接紫薯通告 API` / `紫薯通告主动推` / `紫薯通告主动拉` / `紫薯通告 webhook`
- 平台短词：`zishutonggao` / `zsblogger`
- 业务语义：用户提到"达人数据同步到自家系统"、"接收紫薯通告推送"、"调紫薯通告接口拉达人"

激活后先识别用户场景（主动推 / 主动拉 / 增量同步），再按第 2 节走对话流程。不要一开始就生成代码——先用第 2 节的问句拿到关键信息。

---

## 2. 对话流程

按用户场景分三条路径。每条路径的「询问步骤」先做完再写代码。

### 场景 A：主动推 webhook 接收端

用户说「接收紫薯通告 webhook」/「主动推」/「推送达人数据到我们系统」时走这条。

询问清单（一次性问完，不要拆 3 轮）：

1. 技术栈：Node.js + Express、Python + FastAPI，还是 Java + Spring Boot？（其他栈按这三份模板改写）
2. webhook 路径：默认 `/zs-webhook`，要不要换？
3. 凭证：`WEBHOOK_SECRET` 拿到了吗？（端点级，管理端「数据同步」→ 新建端点保存时一次性弹出，明文）
4. 落库目标：MySQL / Postgres / 消息队列 / 自定义业务函数？
5. 幂等存储：进程内 Map（仅 demo）/ Redis / DB 唯一索引？

读哪些文件：

- `references/signature-algorithm.md`（HMAC-SHA256 验签算法）
- `references/error-codes.md`（错误码与退避）
- Node 选 `examples/webhook-receiver-node.ts`；Python 选 `examples/webhook-receiver-py.py`；Java 选 `examples/webhook-receiver-java.java`

生成内容：

- webhook 接收端文件（route + 验签中间件）
- `.env.example`（含 `WEBHOOK_SECRET` / `PORT`）
- `package.json` 或 `requirements.txt` 片段
- 幂等去重伪代码（按 `(endpointId, runId, blogger.id)` 三元组）
- 业务函数 `handleBlogger(blogger)` 桩

### 场景 B：主动拉 REST 客户端

用户说「调紫薯通告接口」/「主动拉」/「用 API 查达人」时走这条。

前置守卫（必须先确认，否则用户会卡在 403）：

> 主动拉接口要求企业 `dataMode = CLOUD`。如果当前是 LOCAL，所有 `/open-api/*` 都会返 `403 + "开启云端共享数据模式后可用"`。请确认你的企业 dataMode；若是 LOCAL，去管理端「企业管理」→「数据模式」切到 CLOUD（不可逆，达人数据合并为企业共享池，成员私有标记被清空）。

询问清单：

1. 技术栈：Node.js + fetch 还是 Python + httpx？
2. `ZSK_API_KEY` 拿到了吗？（企业级，管理端「企业管理」→「API 凭证」生成时明文一次性返回，hash 存后端）
3. 用哪些接口？（列 `references/api-reference.md` 的 10 个让用户挑，不要默认全部生成）
4. dataMode 是 CLOUD 吗？（LOCAL 直接停下让用户先切）

读哪些文件：

- `references/api-reference.md`（10 接口完整字段表）
- `references/platforms.md`（platform enum 6 个值 + 中文 + URL host 归类规则；用户说"小红书 / 抖音 / 快手"等口语时按此映射到正确 enum）
- `references/data-mode.md`（CLOUD vs LOCAL 影响矩阵）
- `references/error-codes.md`（401/403/404/429/500 + 限流退避）
- Node 选 `examples/rest-client-node.ts`；Python 选 `examples/rest-client-py.py`

生成内容：

- `ZsClient` 类（含 `X-API-Key` 注入 + 429 按 `Retry-After` 退避重试）
- 用户挑的接口对应方法
- `.env.example`（含 `ZSK_API_KEY` / `ZS_API_BASE_URL`）
- 错误处理（401 / 403 / 404 / 429 / 500 分别给建议日志或重试逻辑）

### 场景 C：增量同步脚本

用户说「每 X 分钟同步达人」/「增量拉」/「把变更的达人落到我们库」时走这条。

前置守卫：同场景 B（必须 CLOUD）。

询问清单：

1. 轮询间隔：默认 5 分钟，要不要换？（最小不建议低于 1 分钟，受 60 req/min 限流）
2. 游标持久化：JSON 文件 / Redis / MySQL 表？
3. 起点 `since`：首次拉的起始时间戳？（默认空 = 从最早开始；建议给一个明确的 ISO-8601）
4. 落库表结构：让用户给字段映射，否则生成 `upsertToYourDb(blogger)` 桩函数

读哪些文件：

- `references/api-reference.md`（接口 4：`GET /open-api/bloggers/changes`）
- `examples/incremental-sync.ts`

生成内容：

- 同步主循环（`since` + `cursor` 双游标，按 `nextCursor` 翻页，`hasMore=false` 停）
- 游标持久化模块（按用户选的存储）
- cron 配置（macOS launchd / Linux crontab / Node `node-cron`，按用户环境给一种）
- 异常恢复：本次失败不更新 `since`，下次从同一游标继续
- 日志打点（每批拉了多少条、当前游标、本次耗时）

---

## 3. 凭证准备

两套独立凭证，互不替代。生成代码前必须确认用户拿到了对应那一份。

| 凭证 | 用于 | 拿凭证流程 | 存哪 |
|------|------|-----------|------|
| `WEBHOOK_SECRET` | 主动推 HMAC 验签 | 管理端「数据同步」→ 新建端点 → 保存时弹层显示明文（一次性） | 端点级，每端点一份；后端只存哈希 |
| `ZSK_API_KEY` | 主动拉 `X-API-Key` | 管理端「企业管理」→「API 凭证」→ 生成 → 弹层显示明文（一次性） | 企业级，所有 `/open-api/*` 共用；后端只存哈希 |

引导用户拿凭证时：

- 主动推：让用户先把接收端部署到公网可访问的 HTTP/HTTPS 地址，再到管理端新建端点（端点要填 URL）；保存后立即把弹层里的 `WEBHOOK_SECRET` 复制到本地 `.env`，关掉弹层就再也看不到了。
- 主动拉：让用户先确认企业 `dataMode = CLOUD`；再到「API 凭证」生成，明文同样只弹一次。

如果用户告诉你「密钥丢了」，让 ta 删旧端点 / 旧 ApiKey 重新生成——后端没存明文，找回不了。

---

## 4. 本期集成

数据同步全量覆盖。本期必交付的所有能力如下，按用户需要挑文件生成：

| 集成项 | references | examples | 备注 |
|--------|-----------|----------|------|
| 主动推接收端（Node） | `signature-algorithm.md` | `webhook-receiver-node.ts` | Express 5 + raw body |
| 主动推接收端（Python） | `signature-algorithm.md` | `webhook-receiver-py.py` | FastAPI |
| 主动推接收端（Java） | `signature-algorithm.md` | `webhook-receiver-java.java` | Spring Boot 3 + raw body bytes |
| 主动拉客户端（Node） | `api-reference.md` + `error-codes.md` | `rest-client-node.ts` | 原生 fetch + 429 退避 |
| 主动拉客户端（Python） | `api-reference.md` + `error-codes.md` | `rest-client-py.py` | httpx |
| 10 个 `/open-api/*` 接口 | `api-reference.md` | 两份 rest-client 都已覆盖 | self / bloggers / changes / stats / scraping-tasks / sync-runs |
| 增量同步脚本 | `api-reference.md`（接口 4） | `incremental-sync.ts` | cursor + since 双游标 |
| LOCAL 模式守卫 | `data-mode.md` | — | 在生成主动拉代码之前主动告知用户 |
| 错误处理（401/403/404/429/500） | `error-codes.md` | rest-client 已示范 | 429 按 `Retry-After` 退避 |
| 幂等去重 | — | webhook-receiver 已示范 | `(endpointId, runId, blogger.id)` 三元组 |

生成代码后要做的事：

- 把 references 里相关条目的链接放代码注释里（用户排查时能跳）
- `.env.example` 同步写出来，别让用户回头找变量名
- 强调「密钥明文只能拿一次」——如果用户没存，提示重新生成

---

## 5. 未来集成路线图

下列场景不在本期范围。用户问到时如实告知「暂未在 SKILL 集成清单内，后续平台扩展会同步进 references / examples」，不要假装能生成：

- 报价检索：按粉丝量 / 类目筛选并拉报价
- 任务管理：远程触发刷新任务 / 查任务进度
- 成员管理：开通子账号 / 配额查询
- 薯苗 / 订阅查询：余额、消费、订阅状态

平台 API 扩展后，SKILL frontmatter `api-version` 升号，`references/` + `examples/` 同步更新。

---

## 版本与字段策略

- frontmatter `api-version` 对应后端 `/open-api/openapi.json` 的 spec 版本
- 主动推 Blogger JSON 字段只增不删：新字段追加到末尾，老字段不删不改语义
- 用户反馈：zoho.allen@gmail.com
