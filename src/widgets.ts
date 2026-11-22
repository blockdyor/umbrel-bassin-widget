import {
  abbreviateNumber,
  formatHashrate,
  isPoolStale,
  parsePoolStatus,
  parseUserList,
  parseWorkers,
  rankWorkersByBestEver,
  type PoolStatus,
  type WorkerRecord,
} from './format.ts';

export const DEFAULT_REFRESH = '30s';
const DEFAULT_FETCH_TIMEOUT_MS = 5000;
const DEFAULT_STALE_SECONDS = 300;
const DEFAULT_MAX_WORKERS = 5;

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

const TEXT_HEADERS = {
  'Content-Type': 'text/plain; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface StatItem {
  title: string;
  text: string;
  subtext?: string;
}

export interface FourStatsWidget {
  type: 'four-stats';
  refresh: string;
  link: string;
  items: StatItem[];
}

export interface ListItem {
  text: string;
  subtext?: string;
}

export interface ListWidget {
  type: 'list';
  refresh: string;
  link: string;
  items: ListItem[];
}

export interface WidgetConfig {
  poolUrl?: string;
  usersUrl?: string;
  refresh?: string;
  staleSeconds?: number;
  maxWorkers?: number;
  fetchTimeoutMs?: number;
  fetchImpl?: FetchLike;
  now?: () => number;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS });
}

export function deriveUsersUrl(poolUrl: string, override?: string): string {
  if (override && override.trim()) {
    return override.endsWith('/') ? override : `${override}/`;
  }
  const parsed = new URL(poolUrl);
  parsed.pathname = '/users/';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

export function buildPoolWidget(pool: PoolStatus | null, refresh = DEFAULT_REFRESH): FourStatsWidget {
  if (!pool) {
    return {
      type: 'four-stats',
      refresh,
      link: '',
      items: [
        { title: 'Hashrate', text: '-' },
        { title: 'Workers', text: '-' },
        { title: 'Best Share', text: '-' },
        { title: 'Total Shares', text: '-' },
      ],
    };
  }
  const hashrate5m = formatHashrate(pool.hashrate5m);
  const workers = String(pool.Workers);
  const bestshare = abbreviateNumber(pool.bestshare);
  const accepted = abbreviateNumber(pool.accepted);

  return {
    type: 'four-stats',
    refresh,
    link: '',
    items: [
      { title: 'Hashrate', text: hashrate5m.value, subtext: hashrate5m.unit },
      { title: `Worker${pool.Workers === 1 ? '' : 's'}`, text: workers },
      { title: 'Best Share', text: bestshare.value, subtext: bestshare.unit },
      { title: 'Total Shares', text: accepted.value, subtext: accepted.unit },
    ],
  };
}

export function buildHashrateWidget(pool: PoolStatus | null, refresh = DEFAULT_REFRESH): FourStatsWidget {
  if (!pool) {
    return {
      type: 'four-stats',
      refresh,
      link: '',
      items: [
        { title: '1m Avg', text: '-' },
        { title: '5m Avg', text: '-' },
        { title: '1h Avg', text: '-' },
        { title: '24h Avg', text: '-' },
      ],
    };
  }
  const h1m = formatHashrate(pool.hashrate1m);
  const h5m = formatHashrate(pool.hashrate5m);
  const h1h = formatHashrate(pool.hashrate1hr);
  const h1d = formatHashrate(pool.hashrate1d);

  return {
    type: 'four-stats',
    refresh,
    link: '',
    items: [
      { title: '1m Avg', text: h1m.value, subtext: h1m.unit },
      { title: '5m Avg', text: h5m.value, subtext: h5m.unit },
      { title: '1h Avg', text: h1h.value, subtext: h1h.unit },
      { title: '24h Avg', text: h1d.value, subtext: h1d.unit },
    ],
  };
}

export function buildWorkersLeaderboardWidget(
  workers: WorkerRecord[],
  refresh = DEFAULT_REFRESH,
  limit = DEFAULT_MAX_WORKERS,
): ListWidget {
  const ranked = rankWorkersByBestEver(workers, limit);
  if (ranked.length === 0) {
    return {
      type: 'list',
      refresh,
      link: '',
      items: [{ text: 'No workers yet', subtext: 'Connect a miner to start ranking' }],
    };
  }

  // Disambiguate identical worker suffixes across different payout addresses.
  const nameCounts = new Map<string, number>();
  for (const w of ranked) {
    nameCounts.set(w.displayName, (nameCounts.get(w.displayName) ?? 0) + 1);
  }

  return {
    type: 'list',
    refresh,
    link: '',
    items: ranked.map((worker, index) => {
      const best = abbreviateNumber(worker.bestDiffEver);
      const bestStr = best.unit ? `${best.value}${best.unit}` : best.value;
      const rate = formatHashrate(worker.hashrate5m);
      const rateStr = worker.hashrate5mHps > 0 ? `${rate.value} ${rate.unit}` : 'Idle';
      let label = worker.displayName;
      if ((nameCounts.get(label) ?? 0) > 1) {
        const prefix = worker.workername.slice(0, 6);
        label = `${label} (${prefix}…)`;
      }
      return {
        text: `#${index + 1} ${label}`,
        subtext: `Best ever: ${bestStr} · ${rateStr}`,
      };
    }),
  };
}

async function fetchTextWithTimeout(
  url: string,
  timeoutMs: number,
  fetchImpl: FetchLike,
): Promise<string> {
  const res = await fetchImpl(url, {
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP error: ${res.status}`);
  return res.text();
}

export function createWidgetHandler(config: WidgetConfig) {
  const refresh = config.refresh ?? DEFAULT_REFRESH;
  const staleSeconds = config.staleSeconds ?? DEFAULT_STALE_SECONDS;
  const maxWorkers = config.maxWorkers ?? DEFAULT_MAX_WORKERS;
  const timeoutMs = config.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const fetchImpl = config.fetchImpl ?? fetch;
  const now = config.now ?? (() => Date.now());

  async function loadPool(poolUrl: string): Promise<PoolStatus | null> {
    const text = await fetchTextWithTimeout(poolUrl, timeoutMs, fetchImpl);
    const pool = parsePoolStatus(text);
    if (isPoolStale(pool.lastupdate, now() / 1000, staleSeconds)) {
      return null;
    }
    return pool;
  }

  async function loadWorkers(poolUrl: string): Promise<WorkerRecord[]> {
    const usersBase = deriveUsersUrl(poolUrl, config.usersUrl);
    const indexHtml = await fetchTextWithTimeout(usersBase, timeoutMs, fetchImpl);
    const usernames = parseUserList(indexHtml);
    if (usernames.length === 0) return [];

    const results = await Promise.allSettled(
      usernames.map(async (username) => {
        const userUrl = new URL(encodeURIComponent(username), usersBase).toString();
        const body = await fetchTextWithTimeout(userUrl, timeoutMs, fetchImpl);
        return parseWorkers(JSON.parse(body));
      }),
    );

    const workers: WorkerRecord[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        workers.push(...result.value);
      }
    }
    return workers;
  }

  return async function handleRequest(req: Request): Promise<Response> {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: TEXT_HEADERS });
    }

    const url = new URL(req.url);
    if (url.pathname === '/health') {
      return jsonResponse({ status: 'ok' });
    }

    if (
      url.pathname !== '/widgets/pool' &&
      url.pathname !== '/widgets/workers' &&
      url.pathname !== '/widgets/hashrate'
    ) {
      return new Response('Path not found', { status: 404, headers: TEXT_HEADERS });
    }

    const poolUrl = config.poolUrl?.trim();
    if (!poolUrl) {
      return new Response('No API url provided', { status: 503, headers: TEXT_HEADERS });
    }

    try {
      if (url.pathname === '/widgets/pool') {
        const pool = await loadPool(poolUrl);
        return jsonResponse(buildPoolWidget(pool, refresh));
      }
      if (url.pathname === '/widgets/hashrate') {
        const pool = await loadPool(poolUrl);
        return jsonResponse(buildHashrateWidget(pool, refresh));
      }
      const workers = await loadWorkers(poolUrl);
      return jsonResponse(buildWorkersLeaderboardWidget(workers, refresh, maxWorkers));
    } catch (error) {
      console.error(`Error serving ${url.pathname}:`, error);
      if (url.pathname === '/widgets/hashrate') {
        return jsonResponse(buildHashrateWidget(null, refresh));
      }
      if (url.pathname === '/widgets/workers') {
        return jsonResponse({
          type: 'list',
          refresh,
          link: '',
          items: [{ text: 'Pool unavailable', subtext: 'Waiting for worker statistics' }],
        });
      }
      return jsonResponse(buildPoolWidget(null, refresh));
    }
  };
}
