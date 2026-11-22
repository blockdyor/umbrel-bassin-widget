import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  abbreviateNumber,
  formatHashrate,
  isPoolStale,
  parseHashrateHps,
  parsePoolStatus,
  parseUserList,
  parseWorkers,
  rankWorkersByBestEver,
  shortWorkerName,
} from '../src/format.ts';
import {
  buildHashrateWidget,
  buildPoolWidget,
  buildWorkersLeaderboardWidget,
  createWidgetHandler,
  deriveUsersUrl,
  type FetchLike,
} from '../src/widgets.ts';

const NOW_MS = 1761470000_000;
const NOW_SEC = NOW_MS / 1000;

const SAMPLE_POOL_STATUS = [
  JSON.stringify({ runtime: 3600, lastupdate: NOW_SEC - 10, Users: 1, Workers: 2, Idle: 0, Disconnected: 0 }),
  JSON.stringify({
    hashrate1m: '1.61T',
    hashrate5m: '1e+03G',
    hashrate15m: '1.2T',
    hashrate1hr: '950G',
    hashrate6hr: '900G',
    hashrate1d: '1.10T',
    hashrate7d: '410G',
  }),
  JSON.stringify({ diff: 42, accepted: 66872638, rejected: 10, bestshare: 146605934.08, SPS1m: 1.5 }),
  JSON.stringify({ clients: 2, channels: 2, jdclients: 0 }),
].join('\n');

const SAMPLE_USER_1 = {
  worker: [
    {
      workername: 'bc1qfirstaddress1234567890.ultra',
      hashrate5m: '555G',
      lastshare: NOW_SEC - 5,
      shares: 1000,
      bestshare: 17426432,
      bestever: 17426432,
    },
    {
      workername: 'bc1qfirstaddress1234567890.gamma',
      hashrate5m: '1e+03G',
      lastshare: NOW_SEC - 3,
      shares: 5000,
      bestshare: 146605934.08,
      bestever: 146605934,
    },
  ],
};

const SAMPLE_USER_2 = {
  worker: [
    {
      workername: 'bc1qsecondaddress987654321.nerdqaxe',
      hashrate5m: '4.80T',
      lastshare: NOW_SEC - 2,
      shares: 9000,
      bestshare: 500000,
      bestever: 2_500_000_000_000,
    },
    {
      workername: 'bc1qbareaddresswithnosuffix',
      hashrate5m: '0',
      lastshare: NOW_SEC - 9999,
      shares: 100,
      bestshare: 0,
      bestever: 850_000_000,
    },
  ],
};

test('formatHashrate handles CKPool scientific notation, zero, and unit scaling', () => {
  assert.equal(parseHashrateHps('1e+03G'), 1e12);
  assert.deepEqual(formatHashrate('1e+03G'), { value: '1.00', unit: 'Th/s' });
  assert.deepEqual(formatHashrate('947G'), { value: '947', unit: 'Gh/s' });
  assert.deepEqual(formatHashrate('0'), { value: '0', unit: 'H/s' });
  assert.deepEqual(formatHashrate('bad'), { value: '-', unit: '' });
});

test('abbreviateNumber handles integers, decimals, and P/E scale cleanly', () => {
  assert.deepEqual(abbreviateNumber(0), { value: '0', unit: '' });
  assert.deepEqual(abbreviateNumber(42), { value: '42', unit: '' });
  assert.deepEqual(abbreviateNumber(146605934.08), { value: '147', unit: 'M' });
  assert.deepEqual(abbreviateNumber(2.5e12), { value: '2.5', unit: 'T' });
  assert.deepEqual(abbreviateNumber(1.25e15), { value: '1.25', unit: 'P' });
  assert.deepEqual(abbreviateNumber(3.4e18), { value: '3.4', unit: 'E' });
  assert.deepEqual(abbreviateNumber(Number.NaN), { value: '-', unit: '' });
});

test('parsePoolStatus parses 4-line SV2 pool.status and detects staleness', () => {
  const pool = parsePoolStatus(SAMPLE_POOL_STATUS);
  assert.equal(pool.Workers, 2);
  assert.deepEqual(pool.sv2, { clients: 2, channels: 2, jdclients: 0 });
  assert.equal(isPoolStale(pool.lastupdate, NOW_SEC, 300), false);
  assert.equal(isPoolStale(NOW_SEC - 600, NOW_SEC, 300), true);
});

test('parseUserList filters traversal and unsafe links', () => {
  const html = `
    <a href="../secret">../secret</a>
    <a href="http://evil.example/x">evil</a>
    <a href="user1">user1</a>
    <a href="user2?x=1">user2</a>
    <a href="user2">user2</a>
  `;
  assert.deepEqual(parseUserList(html), ['user1', 'user2']);
});

test('shortWorkerName and rankWorkersByBestEver rank workers by all-time best diff', () => {
  assert.equal(shortWorkerName('bc1qabc123.bitaxe-gamma'), 'bitaxe-gamma');
  assert.equal(shortWorkerName('bc1qbareaddresswithnosuffix'), 'bc1qba…ffix');

  const allWorkers = [...parseWorkers(SAMPLE_USER_1), ...parseWorkers(SAMPLE_USER_2)];
  const ranked = rankWorkersByBestEver(allWorkers, 5);
  assert.deepEqual(
    ranked.map((w) => w.displayName),
    ['nerdqaxe', 'bc1qba…ffix', 'gamma', 'ultra'],
  );

  const widget = buildWorkersLeaderboardWidget(allWorkers);
  assert.equal(widget.type, 'list');
  assert.equal(widget.items[0].text, '#1 nerdqaxe');
  assert.equal(widget.items[0].subtext, 'Best ever: 2.5T · 4.80 Th/s');
  assert.equal(widget.items[1].text, '#2 bc1qba…ffix');
  assert.equal(widget.items[1].subtext, 'Best ever: 850M · Idle');
  assert.equal(widget.items[2].text, '#3 gamma');
  assert.equal(widget.items[2].subtext, 'Best ever: 147M · 1.00 Th/s');
});

test('HTTP widget handler serves /health, /widgets/pool, /widgets/hashrate, and /widgets/workers', async () => {
  assert.equal(deriveUsersUrl('http://bassin_ui_1:8080/pool/pool.status'), 'http://bassin_ui_1:8080/users/');

  const fakeFetch: FetchLike = async (input) => {
    const url = String(input);
    if (url.endsWith('/pool/pool.status')) return new Response(SAMPLE_POOL_STATUS);
    if (url.endsWith('/users/')) {
      return new Response('<pre><a href="user1">user1</a><a href="user2">user2</a><a href="vanished">vanished</a></pre>');
    }
    if (url.endsWith('/users/user1')) return new Response(JSON.stringify(SAMPLE_USER_1));
    if (url.endsWith('/users/user2')) return new Response(JSON.stringify(SAMPLE_USER_2));
    return new Response('Not found', { status: 404 });
  };

  const handler = createWidgetHandler({
    poolUrl: 'http://bassin_ui_1:8080/pool/pool.status',
    fetchImpl: fakeFetch,
    now: () => NOW_MS,
  });

  const health = await handler(new Request('http://widget-server:3000/health'));
  assert.equal(health.status, 200);
  assert.equal(health.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.deepEqual(await health.json(), { status: 'ok' });

  const poolRes = await handler(new Request('http://widget-server:3000/widgets/pool'));
  assert.equal(poolRes.status, 200);
  const poolJson = (await poolRes.json()) as ReturnType<typeof buildPoolWidget>;
  assert.equal(poolJson.items[0].text, '1.00');
  assert.equal(poolJson.items[0].subtext, 'Th/s');
  assert.equal(poolJson.items[1].title, 'Workers');
  assert.equal(poolJson.items[1].text, '2');

  const hashRes = await handler(new Request('http://widget-server:3000/widgets/hashrate'));
  const hashJson = (await hashRes.json()) as ReturnType<typeof buildHashrateWidget>;
  assert.equal(hashJson.items[0].title, '1m Avg');
  assert.equal(hashJson.items[1].text, '1.00');
  assert.equal(hashJson.items[1].subtext, 'Th/s');

  // Tolerates vanished user file and still ranks remaining workers.
  const workersRes = await handler(new Request('http://widget-server:3000/widgets/workers'));
  const workersJson = (await workersRes.json()) as ReturnType<typeof buildWorkersLeaderboardWidget>;
  assert.equal(workersJson.type, 'list');
  assert.equal(workersJson.items.length, 4);
  assert.equal(workersJson.items[0].text, '#1 nerdqaxe');

  // Stale pool returns fallback dashes instead of stale values.
  const staleHandler = createWidgetHandler({
    poolUrl: 'http://bassin_ui_1:8080/pool/pool.status',
    fetchImpl: fakeFetch,
    now: () => NOW_MS + 600_000,
  });
  const staleRes = await staleHandler(new Request('http://widget-server:3000/widgets/pool'));
  const staleJson = (await staleRes.json()) as ReturnType<typeof buildPoolWidget>;
  assert.equal(staleJson.items[0].text, '-');
});
