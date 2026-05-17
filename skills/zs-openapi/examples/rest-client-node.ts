/**
 * 紫薯通告 /open-api/* REST 客户端（Node.js 18+ 原生 fetch + TypeScript）
 *
 * 覆盖 10 个接口（self / bloggers / bloggers/:id / bloggers/changes / bloggers/:id/stats /
 *   scraping-tasks / scraping-tasks/:id / scraping-tasks/:id/runs / sync-runs / sync-runs/:id）
 *
 * 配套文档：
 *   - 接口字段表：../references/api-reference.md
 *   - 错误码：../references/error-codes.md
 *   - LOCAL 守卫：../references/data-mode.md
 *
 * 用法：
 *   const client = new ZsClient({ apiKey: process.env.ZSK_API_KEY!, baseUrl: 'https://api.zishutonggao.com' });
 *   const self = await client.getSelf();
 *   for await (const blogger of client.iterateBloggers({ platform: 'PGY', fansCountMin: 10000 })) {
 *     console.log(blogger.id, blogger.fansCount);
 *   }
 *
 * .env.example：
 *   ZSK_API_KEY=zsk_请替换为管理端「API 凭证」生成的明文
 *   ZS_API_BASE_URL=https://api.zishutonggao.com
 */

export type Platform =
  | 'STARMAP'           // 抖音星图
  | 'PGY'               // 小红书蒲公英
  | 'VIDEO_HUXUAN'      // 视频号互选
  | 'MP_HUXUAN'         // 公众号互选
  | 'BILIBILI_HUAHUO'   // B 站花火
  | 'KUAISHOU_JLJX';    // 快手磁力聚星
export type Gender = 'MALE' | 'FEMALE' | 'UNKNOWN';
export type TaskStatus = 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
export type TaskRunStatus = 'RUNNING' | 'SUCCESS' | 'FAILED';
export type SyncRunStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';

export interface ApiEnvelope<T> {
  code: number;
  message?: string;
  data: T;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface OrganizationSelf {
  id: string;
  name: string;
  dataMode: 'CLOUD' | 'LOCAL';
  memberCount: number;
  bloggerCount: number;
  rateLimitPerMinute: number;
  apiKeyLastUsedAt: string | null;
  apiKeyLastUsedIp: string | null;
}

export interface Blogger {
  id: string;
  organizationId: string;
  platform: Platform;
  platformBloggerId: string;
  nickname: string;
  avatar: string | null;
  url: string | null;
  fansCount: number;
  interactRate: number;
  location: string | null;
  gender: Gender | null;
  category: string | null;
  priceJson: Record<string, number> | null;
  contactWechat: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  tags: string[];
  remark: string | null;
  lastSyncedAt: string;
  source: 'SCRAPE' | 'IMPORT' | 'MANUAL';
  rawData?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface BloggerStatSnapshot {
  snapshotAt: string;
  fansCount: number;
  interactRate: number;
  noteCount: number;
  likeCount: number;
}

export interface ScrapingTask {
  id: string;
  organizationId: string;
  name: string;
  platform: Platform;
  status: TaskStatus;
  pacePreset: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt?: string;
  platformPolicyVersion?: string;
  accountConcurrencyPerTask?: number;
  bloggerCount?: number;
}

export interface ScrapingTaskRun {
  id: string;
  taskId: string;
  status: TaskRunStatus;
  startedAt: string;
  finishedAt: string | null;
  totalBloggers: number;
  succeededBloggers: number;
  failedBloggers: number;
  errorSummary: string | null;
}

export interface SyncRun {
  id: string;
  endpointId: string;
  status: SyncRunStatus;
  attempt: number;
  totalBloggers: number;
  succeededBloggers: number;
  failedBloggers: number;
  failedBloggerIds?: string[];
  lastError?: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface BloggerListFilter {
  platform?: Platform;
  fansCountMin?: number;
  fansCountMax?: number;
  tags?: string[];
  category?: string;
  updatedSince?: string;
  cursor?: string;
  limit?: number;
}

export interface BloggerChangesFilter {
  since?: string;
  cursor?: string;
  limit?: number;
}

export interface ScrapingTaskListFilter {
  platform?: Platform;
  status?: TaskStatus;
  cursor?: string;
  limit?: number;
}

export interface ScrapingTaskRunListFilter {
  status?: TaskRunStatus;
  cursor?: string;
  limit?: number;
}

export interface SyncRunListFilter {
  endpointId?: string;
  status?: SyncRunStatus;
  cursor?: string;
  limit?: number;
}

export interface ZsClientOptions {
  apiKey: string;
  baseUrl?: string;
  /** 5xx / 网络错误最大重试次数（429 单独按 Retry-After 走，不计入此次数） */
  maxRetries?: number;
  /** 自定义 fetch（注入测试 / Mock） */
  fetchImpl?: typeof fetch;
}

export class ZsApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: number,
    public readonly apiMessage: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(`[ZsApi ${status}/${code}] ${apiMessage}`);
    this.name = 'ZsApiError';
  }

  get isLocalMode(): boolean {
    return this.status === 403 && this.apiMessage.includes('开启云端共享数据模式后可用');
  }
}

const DEFAULT_BASE_URL = 'https://api.zishutonggao.com';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitterMs(maxMs: number): number {
  return Math.floor(Math.random() * maxMs);
}

export class ZsClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: ZsClientOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.maxRetries = opts.maxRetries ?? 5;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** 接口 1：自查企业信息 */
  getSelf(): Promise<OrganizationSelf> {
    return this.request<OrganizationSelf>('/open-api/organizations/self');
  }

  /** 接口 2：列表 + 过滤（手动翻页用 cursor；自动翻页用 iterateBloggers） */
  listBloggers(filter: BloggerListFilter = {}): Promise<CursorPage<Blogger>> {
    return this.request<CursorPage<Blogger>>('/open-api/bloggers', this.buildQuery(filter));
  }

  /** 接口 2 的 async iterator 封装：自动翻页直到 hasMore=false */
  async *iterateBloggers(filter: BloggerListFilter = {}): AsyncGenerator<Blogger> {
    let cursor: string | undefined = filter.cursor;
    do {
      const page = await this.listBloggers({ ...filter, cursor });
      for (const item of page.items) {
        yield item;
      }
      cursor = page.nextCursor ?? undefined;
      if (!page.hasMore) break;
    } while (cursor);
  }

  /** 接口 3：达人详情（含 rawData） */
  getBlogger(id: string): Promise<Blogger> {
    return this.request<Blogger>(`/open-api/bloggers/${encodeURIComponent(id)}`);
  }

  /** 接口 4：增量变更流；返回单页 */
  listBloggerChanges(filter: BloggerChangesFilter = {}): Promise<CursorPage<Blogger>> {
    return this.request<CursorPage<Blogger>>(
      '/open-api/bloggers/changes',
      this.buildQuery(filter),
    );
  }

  /** 接口 4 的 async iterator 封装 */
  async *iterateBloggerChanges(filter: BloggerChangesFilter = {}): AsyncGenerator<Blogger> {
    let cursor: string | undefined = filter.cursor;
    do {
      const page = await this.listBloggerChanges({ ...filter, cursor });
      for (const item of page.items) {
        yield item;
      }
      cursor = page.nextCursor ?? undefined;
      if (!page.hasMore) break;
    } while (cursor);
  }

  /** 接口 5：达人统计快照历史 */
  getBloggerStats(
    id: string,
    range: { from?: string; to?: string } = {},
  ): Promise<{ bloggerId: string; snapshots: BloggerStatSnapshot[] }> {
    return this.request<{ bloggerId: string; snapshots: BloggerStatSnapshot[] }>(
      `/open-api/bloggers/${encodeURIComponent(id)}/stats`,
      this.buildQuery(range),
    );
  }

  /** 接口 6：采集任务列表 */
  listScrapingTasks(filter: ScrapingTaskListFilter = {}): Promise<CursorPage<ScrapingTask>> {
    return this.request<CursorPage<ScrapingTask>>(
      '/open-api/scraping-tasks',
      this.buildQuery(filter),
    );
  }

  /** 接口 7：采集任务详情 */
  getScrapingTask(id: string): Promise<ScrapingTask> {
    return this.request<ScrapingTask>(`/open-api/scraping-tasks/${encodeURIComponent(id)}`);
  }

  /** 接口 8：采集任务运行历史 */
  listScrapingTaskRuns(
    taskId: string,
    filter: ScrapingTaskRunListFilter = {},
  ): Promise<CursorPage<ScrapingTaskRun>> {
    return this.request<CursorPage<ScrapingTaskRun>>(
      `/open-api/scraping-tasks/${encodeURIComponent(taskId)}/runs`,
      this.buildQuery(filter),
    );
  }

  /** 接口 9：主动推运行记录（反向审计） */
  listSyncRuns(filter: SyncRunListFilter = {}): Promise<CursorPage<SyncRun>> {
    return this.request<CursorPage<SyncRun>>('/open-api/sync-runs', this.buildQuery(filter));
  }

  /** 接口 10：主动推单次详情（含 failedBloggerIds） */
  getSyncRun(id: string): Promise<SyncRun> {
    return this.request<SyncRun>(`/open-api/sync-runs/${encodeURIComponent(id)}`);
  }

  // ---- 内部 ----

  private buildQuery(params: Record<string, unknown>): URLSearchParams {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) {
        if (v.length > 0) usp.set(k, v.join(','));
      } else {
        usp.set(k, String(v));
      }
    }
    return usp;
  }

  private async request<T>(path: string, query?: URLSearchParams): Promise<T> {
    const url = `${this.baseUrl}${path}${query && query.toString() ? `?${query.toString()}` : ''}`;
    let retry = 0;

    while (true) {
      const res = await this.fetchImpl(url, {
        method: 'GET',
        headers: {
          'X-API-Key': this.apiKey,
          Accept: 'application/json',
        },
      });

      // 429：严格按 Retry-After 退避
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('Retry-After') ?? 30);
        const waitMs = retryAfter * 1000 + jitterMs(1000);
        await sleep(waitMs);
        continue; // 不计入 maxRetries
      }

      // 5xx：指数退避 + 抖动
      if (res.status >= 500 && retry < this.maxRetries) {
        const backoffMs = Math.min(2 ** retry * 1000, 30_000) + jitterMs(1000);
        await sleep(backoffMs);
        retry += 1;
        continue;
      }

      // 解析响应
      const text = await res.text();
      let envelope: ApiEnvelope<T>;
      try {
        envelope = JSON.parse(text) as ApiEnvelope<T>;
      } catch {
        throw new ZsApiError(res.status, res.status, `Non-JSON response: ${text.slice(0, 200)}`);
      }

      if (res.status === 200 && envelope.code === 200) {
        return envelope.data;
      }

      // 401 / 403 / 404 / 400：不重试，抛错
      throw new ZsApiError(
        res.status,
        envelope.code,
        envelope.message ?? `HTTP ${res.status}`,
      );
    }
  }
}

/**
 * 端到端使用示例（取消注释跑）
 */
// async function main() {
//   const client = new ZsClient({
//     apiKey: process.env.ZSK_API_KEY!,
//     baseUrl: process.env.ZS_API_BASE_URL,
//   });
//
//   // 接口 1
//   const self = await client.getSelf();
//   if (self.dataMode === 'LOCAL') {
//     console.error('企业是 LOCAL 模式，所有 /open-api/* 都会 403。请管理员切 CLOUD');
//     return;
//   }
//
//   // 接口 2 自动翻页
//   for await (const blogger of client.iterateBloggers({ platform: 'PGY', fansCountMin: 10000 })) {
//     console.log(blogger.id, blogger.nickname, blogger.fansCount);
//   }
//
//   // 接口 4 增量
//   for await (const change of client.iterateBloggerChanges({ since: '2026-05-01T00:00:00Z' })) {
//     console.log('changed:', change.id);
//   }
// }
// main().catch(console.error);
