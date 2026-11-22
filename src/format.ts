const HASHRATE_UNITS = ['', 'K', 'M', 'G', 'T', 'P', 'E', 'Z', 'Y'] as const;
const HASHRATE_RE = /^(\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*([KMGTPEZY])?H?(?:\/s)?$/i;
const ABBR_UNITS = [
  { threshold: 1e24, unit: 'Y' },
  { threshold: 1e21, unit: 'Z' },
  { threshold: 1e18, unit: 'E' },
  { threshold: 1e15, unit: 'P' },
  { threshold: 1e12, unit: 'T' },
  { threshold: 1e9, unit: 'G' },
  { threshold: 1e6, unit: 'M' },
  { threshold: 1e3, unit: 'K' },
] as const;

export interface FormattedValue {
  value: string;
  unit: string;
}

export interface PoolStatus {
  runtime: number;
  lastupdate: number;
  Users: number;
  Workers: number;
  Idle?: number;
  Disconnected?: number;
  hashrate1m: string;
  hashrate5m: string;
  hashrate15m?: string;
  hashrate1hr: string;
  hashrate6hr?: string;
  hashrate1d: string;
  hashrate7d: string;
  accepted: number;
  rejected: number;
  bestshare: number;
  SPS1m?: number;
  sv2?: {
    clients: number;
    channels: number;
    jdclients: number;
  };
}

export interface WorkerRecord {
  workername: string;
  displayName: string;
  hashrate5m: string;
  hashrate5mHps: number;
  bestshare: number;
  bestever: number;
  bestDiffEver: number;
  lastshare: number;
  shares: number;
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function formatCompact(num: number): string {
  if (!Number.isFinite(num) || num < 0) return '-';
  if (num === 0) return '0';
  if (num >= 100) return num.toFixed(0);
  if (num >= 10) return String(Number(num.toFixed(1)));
  return String(Number(num.toFixed(2)));
}

export function parseHashrateHps(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const match = HASHRATE_RE.exec(raw.trim());
  if (!match) return null;
  const num = Number(match[1]);
  if (!Number.isFinite(num) || num < 0) return null;
  const prefix = (match[2] ?? '').toUpperCase();
  const unitIdx = HASHRATE_UNITS.indexOf(prefix as (typeof HASHRATE_UNITS)[number]);
  if (unitIdx < 0) return null;
  const hps = num * 1000 ** unitIdx;
  return Number.isFinite(hps) ? hps : null;
}

export function formatHashrate(raw: unknown): FormattedValue {
  const hps = parseHashrateHps(raw);
  if (hps === null) return { value: '-', unit: '' };
  if (hps === 0) return { value: '0', unit: 'H/s' };

  let scaled = hps;
  let idx = 0;
  while (scaled >= 1000 && idx < HASHRATE_UNITS.length - 1) {
    scaled /= 1000;
    idx++;
  }
  const prefix = HASHRATE_UNITS[idx];
  const unit = prefix ? `${prefix}h/s` : 'H/s';
  const value = scaled >= 100 ? scaled.toFixed(0) : scaled.toFixed(2);
  return { value, unit };
}

export function abbreviateNumber(value: unknown): FormattedValue {
  if (!isNonNegativeFinite(value)) return { value: '-', unit: '' };
  for (const { threshold, unit } of ABBR_UNITS) {
    if (value >= threshold) {
      return { value: formatCompact(value / threshold), unit };
    }
  }
  if (Number.isInteger(value)) return { value: String(value), unit: '' };
  return { value: formatCompact(value), unit: '' };
}

export function parsePoolStatus(text: string): PoolStatus {
  const lines = text
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 3) throw new Error('Incomplete CKPool status');

  const parts = lines.map((line) => JSON.parse(line) as unknown);
  if (parts.some((part) => !part || typeof part !== 'object' || Array.isArray(part))) {
    throw new Error('Invalid CKPool status');
  }

  const merged = Object.assign({}, ...(parts.slice(0, 3) as Record<string, unknown>[]));
  for (const key of ['runtime', 'lastupdate', 'Users', 'Workers', 'accepted', 'rejected', 'bestshare']) {
    if (!isNonNegativeFinite(merged[key])) {
      throw new Error(`Invalid pool field: ${key}`);
    }
  }
  for (const key of ['hashrate1m', 'hashrate5m', 'hashrate1hr', 'hashrate1d', 'hashrate7d']) {
    if (parseHashrateHps(merged[key]) === null) {
      throw new Error(`Invalid pool field: ${key}`);
    }
  }

  for (const extra of parts.slice(3) as Record<string, unknown>[]) {
    if (
      isNonNegativeFinite(extra.clients) &&
      isNonNegativeFinite(extra.channels) &&
      isNonNegativeFinite(extra.jdclients)
    ) {
      merged.sv2 = {
        clients: extra.clients,
        channels: extra.channels,
        jdclients: extra.jdclients,
      };
    }
  }

  return merged as unknown as PoolStatus;
}

export function isPoolStale(lastupdate: number, nowSec = Date.now() / 1000, maxAgeSec = 300): boolean {
  if (!isNonNegativeFinite(lastupdate)) return true;
  return nowSec - lastupdate > maxAgeSec;
}

export function parseUserList(html: string): string[] {
  const names = new Set<string>();
  for (const match of html.matchAll(/href=["']([^"']+)["']/g)) {
    const cleaned = match[1].replace(/\/$/, '');
    if (cleaned !== '.' && cleaned !== '..' && /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(cleaned)) {
      names.add(cleaned);
    }
  }
  return [...names];
}

export function shortWorkerName(fullName: string): string {
  const trimmed = fullName.trim();
  if (!trimmed) return 'unnamed';
  const sepIdx = trimmed.search(/[._]/);
  if (sepIdx > 0 && sepIdx < trimmed.length - 1) {
    return trimmed.slice(sepIdx + 1);
  }
  if (trimmed.length > 14) {
    return `${trimmed.slice(0, 6)}…${trimmed.slice(-4)}`;
  }
  return trimmed;
}

export function parseWorkers(userData: unknown): WorkerRecord[] {
  if (!userData || typeof userData !== 'object' || Array.isArray(userData)) return [];
  const rawWorkers = (userData as Record<string, unknown>).worker;
  if (!Array.isArray(rawWorkers)) return [];

  const workers: WorkerRecord[] = [];
  for (const item of rawWorkers) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const w = item as Record<string, unknown>;
    if (typeof w.workername !== 'string' || !w.workername.trim()) continue;
    const hps = parseHashrateHps(w.hashrate5m);
    if (hps === null) continue;
    const bestshare = isNonNegativeFinite(w.bestshare) ? w.bestshare : 0;
    const bestever = isNonNegativeFinite(w.bestever) ? w.bestever : 0;
    const lastshare = isNonNegativeFinite(w.lastshare) ? w.lastshare : 0;
    const shares = isNonNegativeFinite(w.shares) ? w.shares : 0;
    workers.push({
      workername: w.workername,
      displayName: shortWorkerName(w.workername),
      hashrate5m: String(w.hashrate5m),
      hashrate5mHps: hps,
      bestshare,
      bestever,
      bestDiffEver: Math.max(bestever, bestshare),
      lastshare,
      shares,
    });
  }
  return workers;
}

export function rankWorkersByBestEver(workers: WorkerRecord[], limit = 5): WorkerRecord[] {
  const sorted = [...workers].sort((a, b) => {
    if (b.bestDiffEver !== a.bestDiffEver) return b.bestDiffEver - a.bestDiffEver;
    if (b.hashrate5mHps !== a.hashrate5mHps) return b.hashrate5mHps - a.hashrate5mHps;
    return a.displayName.localeCompare(b.displayName);
  });
  return sorted.slice(0, Math.max(1, limit));
}
