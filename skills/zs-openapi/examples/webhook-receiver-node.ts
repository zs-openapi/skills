/**
 * 紫薯通告主动推 webhook 接收端（Node.js 18+ + Express 5 + TypeScript）
 *
 * 配套文档：
 *   - 签名算法：../references/signature-algorithm.md
 *   - 错误码：../references/error-codes.md
 *
 * 启动：
 *   1. cp .env.example .env  # 把 WEBHOOK_SECRET 填进去（端点级，管理端「数据同步」新建端点时一次性返回）
 *   2. pnpm i
 *   3. pnpm dev
 *
 * package.json 片段：
 *   {
 *     "type": "module",
 *     "scripts": { "dev": "tsx watch src/server.ts", "start": "tsx src/server.ts" },
 *     "dependencies": {
 *       "express": "^5.0.0",
 *       "dotenv": "^16.4.5"
 *     },
 *     "devDependencies": {
 *       "@types/express": "^5.0.0",
 *       "@types/node": "^20.0.0",
 *       "tsx": "^4.0.0",
 *       "typescript": "^5.0.0"
 *     }
 *   }
 *
 * .env.example：
 *   WEBHOOK_SECRET=zswh_请替换为管理端弹层里的明文
 *   PORT=3000
 */

import crypto from 'node:crypto';
import process from 'node:process';
import express, { type Request, type Response } from 'express';
import 'dotenv/config';

interface Blogger {
  id: string;
  organizationId: string;
  platform:
    | 'STARMAP'           // 抖音星图
    | 'PGY'               // 小红书蒲公英
    | 'VIDEO_HUXUAN'      // 视频号互选
    | 'MP_HUXUAN'         // 公众号互选
    | 'BILIBILI_HUAHUO'   // B 站花火
    | 'KUAISHOU_JLJX';    // 快手磁力聚星
  platformBloggerId: string;
  nickname: string;
  avatar: string | null;
  url: string | null;
  fansCount: number;
  interactRate: number;
  location: string | null;
  gender: 'MALE' | 'FEMALE' | 'UNKNOWN' | null;
  category: string | null;
  priceJson: Record<string, number> | null;
  contactWechat: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  tags: string[];
  remark: string | null;
  lastSyncedAt: string;
  source: 'SCRAPE' | 'IMPORT' | 'MANUAL';
  rawData: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

interface WebhookPayload {
  bloggers: Blogger[];
  endpointId: string;
  runId: string;
  attempt: number;
}

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
if (!WEBHOOK_SECRET) {
  throw new Error('Missing WEBHOOK_SECRET env');
}

const PORT = Number(process.env.PORT ?? 3000);
const TIMESTAMP_SKEW_SECONDS = 300;

const app = express();

// 必须用 raw body 中间件，不能用 express.json()
// 原因：HMAC 签名内容 = raw bytes，重新序列化会让 byte 不一致
app.use('/zs-webhook', express.raw({ type: 'application/json', limit: '5mb' }));

/**
 * 幂等去重：按 (endpointId, runId, blogger.id) 三元组
 *
 * 占位实现：进程内 Map（仅 demo / 单实例）
 * 生产建议：
 *   - Redis SET dedupKey EX 86400 NX
 *   - DB 表 webhook_processed(endpoint_id, run_id, blogger_id) 加唯一索引
 */
const processedKeys = new Set<string>();

function alreadyProcessed(endpointId: string, runId: string, bloggerId: string): boolean {
  const key = `${endpointId}:${runId}:${bloggerId}`;
  if (processedKeys.has(key)) return true;
  processedKeys.add(key);
  return false;
}

/**
 * 常量时间比较签名（防 timing attack）
 */
function verifySignature(rawBody: Buffer, signatureHeader: string, timestamp: string): boolean {
  const expected = crypto
    .createHmac('sha256', WEBHOOK_SECRET!)
    .update(Buffer.concat([rawBody, Buffer.from('\n' + timestamp)]))
    .digest('hex');
  const expectedFull = `sha256=${expected}`;
  if (signatureHeader.length !== expectedFull.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expectedFull));
}

/**
 * 业务桩：把达人数据落到你的库
 * 替换为真实实现（写 MySQL / Postgres / 推 MQ / 调内部服务）
 */
async function handleBlogger(blogger: Blogger): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(
    `[handleBlogger] id=${blogger.id} platform=${blogger.platform} fans=${blogger.fansCount}`,
  );
}

app.post('/zs-webhook', async (req: Request, res: Response) => {
  const rawBody = req.body as Buffer;
  const signature = req.header('X-ZS-Signature') ?? '';
  const timestamp = req.header('X-ZS-Timestamp') ?? '';

  // 1. 验签
  if (!signature || !timestamp || !verifySignature(rawBody, signature, timestamp)) {
    return res.status(401).json({ code: 401, message: 'Signature verification failed' });
  }

  // 2. 时间戳防重放（±5 分钟）
  const skew = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (Number.isNaN(skew) || skew > TIMESTAMP_SKEW_SECONDS) {
    return res.status(401).json({ code: 401, message: 'Timestamp skew exceeded' });
  }

  // 3. 解析 payload
  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody.toString('utf-8')) as WebhookPayload;
  } catch {
    return res.status(400).json({ code: 400, message: 'Invalid JSON' });
  }

  // 4. 幂等 + 业务处理
  let processed = 0;
  let skipped = 0;
  for (const blogger of payload.bloggers) {
    if (alreadyProcessed(payload.endpointId, payload.runId, blogger.id)) {
      skipped += 1;
      continue;
    }
    try {
      await handleBlogger(blogger);
      processed += 1;
    } catch (err) {
      // 单条失败不整批 fail：返 200 让紫薯通告认为整批已接收
      // 失败明细自己写日志 / 告警 / 入死信队列
      // eslint-disable-next-line no-console
      console.error(`[handleBlogger] failed: ${blogger.id}`, err);
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    `[webhook] endpoint=${payload.endpointId} run=${payload.runId} ` +
      `attempt=${payload.attempt} processed=${processed} skipped=${skipped}`,
  );

  return res.status(200).json({ code: 200, message: 'ok' });
});

app.get('/healthz', (_req, res) => {
  res.status(200).json({ ok: true });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`zs-webhook listening on :${PORT}`);
});
