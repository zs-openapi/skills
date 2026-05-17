/**
 * 紫薯通告达人增量同步脚本（Node.js 18+ + TypeScript）
 *
 * 流程：
 *   每 5 分钟（可配）调一次 GET /open-api/bloggers/changes?since=<last>&cursor=<...>
 *   把变更的达人批量落业务库（upsertToYourDb 桩函数）
 *   持久化 (since, cursor) 双游标，本次失败下次从同一点续跑
 *
 * 配套文档：
 *   - 接口 4：../references/api-reference.md（GET /open-api/bloggers/changes）
 *   - 错误码：../references/error-codes.md
 *   - LOCAL 守卫：../references/data-mode.md
 *
 * 启动：
 *   1. cp .env.example .env  # 填 ZSK_API_KEY
 *   2. pnpm i
 *   3. pnpm start   # node --import tsx incremental-sync.ts
 *
 * package.json 片段：
 *   {
 *     "type": "module",
 *     "scripts": { "start": "tsx examples/incremental-sync.ts" },
 *     "dependencies": {
 *       "dotenv": "^16.4.5",
 *       "node-cron": "^3.0.3"
 *     },
 *     "devDependencies": {
 *       "@types/node-cron": "^3.0.11",
 *       "tsx": "^4.0.0",
 *       "typescript": "^5.0.0"
 *     }
 *   }
 *
 * .env.example：
 *   ZSK_API_KEY=zsk_请替换为管理端「API 凭证」生成的明文
 *   ZS_API_BASE_URL=https://api.zishutonggao.com
 *   SYNC_CRON=* /5 * * * *
 *   SYNC_CURSOR_FILE=./.sync-cursor.json
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import cron from 'node-cron';
import 'dotenv/config';
import { ZsClient, type Blogger, ZsApiError } from './rest-client-node.js';

interface SyncCursorState {
  /** 上次本批次取到的最大 updatedAt，下次作为 since 起点 */
  lastUpdatedAt: string | null;
  /** 上次未跑完的 cursor，恢复时优先用它 */
  pendingCursor: string | null;
  /** 上次成功跑完的时间戳 */
  lastRunFinishedAt: string | null;
}

const ZSK_API_KEY = process.env.ZSK_API_KEY;
if (!ZSK_API_KEY) {
  throw new Error('Missing ZSK_API_KEY env');
}

const CURSOR_FILE = path.resolve(process.env.SYNC_CURSOR_FILE ?? './.sync-cursor.json');
const CRON_EXPR = process.env.SYNC_CRON ?? '*/5 * * * *';
const PAGE_LIMIT = 500;

const client = new ZsClient({
  apiKey: ZSK_API_KEY,
  baseUrl: process.env.ZS_API_BASE_URL,
});

/**
 * 游标持久化
 * 占位实现：本地 JSON 文件（单实例够用）
 * 生产建议：换成 Redis / MySQL 表，并加分布式锁防多实例并发跑
 */
async function loadCursor(): Promise<SyncCursorState> {
  try {
    const text = await fs.readFile(CURSOR_FILE, 'utf-8');
    return JSON.parse(text) as SyncCursorState;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { lastUpdatedAt: null, pendingCursor: null, lastRunFinishedAt: null };
    }
    throw err;
  }
}

async function saveCursor(state: SyncCursorState): Promise<void> {
  const tmp = `${CURSOR_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), 'utf-8');
  await fs.rename(tmp, CURSOR_FILE); // 原子替换
}

/**
 * 业务桩：把达人 upsert 到你的库
 * 替换为真实实现（写 MySQL / Postgres / 推 MQ）
 */
async function upsertToYourDb(blogger: Blogger): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(
    `[upsert] id=${blogger.id} platform=${blogger.platform} fans=${blogger.fansCount}`,
  );
}

let isRunning = false;

async function runOnce(): Promise<void> {
  if (isRunning) {
    // eslint-disable-next-line no-console
    console.warn('[sync] previous run still in progress, skip this tick');
    return;
  }
  isRunning = true;
  const startedAt = Date.now();

  try {
    const state = await loadCursor();
    const since = state.lastUpdatedAt ?? undefined;
    let cursor: string | undefined = state.pendingCursor ?? undefined;

    let pulled = 0;
    let maxUpdatedAt = state.lastUpdatedAt;

    do {
      const page = await client.listBloggerChanges({
        since,
        cursor,
        limit: PAGE_LIMIT,
      });

      for (const blogger of page.items) {
        await upsertToYourDb(blogger);
        pulled += 1;
        if (!maxUpdatedAt || blogger.updatedAt > maxUpdatedAt) {
          maxUpdatedAt = blogger.updatedAt;
        }
      }

      cursor = page.nextCursor ?? undefined;

      // 每页结束都持久化游标——本次中断下次能从这继续
      await saveCursor({
        lastUpdatedAt: state.lastUpdatedAt,
        pendingCursor: cursor ?? null,
        lastRunFinishedAt: state.lastRunFinishedAt,
      });

      if (!page.hasMore) break;
    } while (cursor);

    // 全部翻完，把 since 推到本次拉到的最大 updatedAt，清 pendingCursor
    await saveCursor({
      lastUpdatedAt: maxUpdatedAt,
      pendingCursor: null,
      lastRunFinishedAt: new Date().toISOString(),
    });

    // eslint-disable-next-line no-console
    console.log(
      `[sync] ok pulled=${pulled} elapsed=${Date.now() - startedAt}ms ` +
        `nextSince=${maxUpdatedAt}`,
    );
  } catch (err) {
    // 关键：失败时不更新 since。下次 cron 触发会从同一 (since, pendingCursor) 重试
    if (err instanceof ZsApiError && err.isLocalMode) {
      // eslint-disable-next-line no-console
      console.error(
        '[sync] 企业是 LOCAL 模式，所有 /open-api/* 返 403。请管理员切 CLOUD 后再启动同步。',
      );
    } else {
      // eslint-disable-next-line no-console
      console.error('[sync] failed:', err);
    }
  } finally {
    isRunning = false;
  }
}

async function main(): Promise<void> {
  // 启动时先跑一次（不等下个 cron tick）
  await runOnce();

  cron.schedule(CRON_EXPR, () => {
    void runOnce();
  });

  // eslint-disable-next-line no-console
  console.log(`[sync] scheduler started, cron="${CRON_EXPR}" cursor_file=${CURSOR_FILE}`);
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('[sync] fatal:', err);
  process.exit(1);
});
