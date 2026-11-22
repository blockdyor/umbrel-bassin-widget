import { createWidgetHandler } from './src/widgets.ts';

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const port = parsePositiveInt(process.env.PORT, 3000);
const handler = createWidgetHandler({
  poolUrl: process.env.BASSIN_API_POOL_URL,
  usersUrl: process.env.BASSIN_API_USERS_URL,
  staleSeconds: parsePositiveInt(process.env.BASSIN_STALE_SECONDS, 300),
  maxWorkers: parsePositiveInt(process.env.BASSIN_WIDGET_MAX_WORKERS, 5),
});

// Internal Docker network HTTP server consumed by umbrelOS dashboard widgets.
const server = Bun.serve({ // NOSONAR
  port,
  fetch: handler,
});

function shutdown() {
  void server.stop(true);
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
