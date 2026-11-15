// ============================================================================
// tests/load/k6-read.js — API o'qish yuk sinovi (anonim foydalanuvchi)
// ============================================================================
// Maqsad: kesh + sessiya qulfi + rate limit qatlami qanday ushlashini o'lchash.
//
//   k6 run tests/load/k6-read.js -e BASE=https://cinema.example.com
//   k6 run tests/load/k6-read.js -e BASE=... -e MAXVUS=2000
//
// Bosqichlar: 50 -> 500 -> 1000 -> 2000 VU. Har bosqichda:
//   * http_req_failed  (xato ulushi)
//   * p95 kechikish
//   * 429 (rate limit) soni — `rl_hits` metriKasi
//
// MUHIM: natijadagi birinchi "sinish" ni NOT ETHISH KERAK:
//   - 429 ko'paysa      -> RL_READ_PER_MIN juda past
//   - p95 > 1.2 s       -> kesh MISS (X-WC-Cache sarlavhasini tekshiring)
//   - connection refused-> Apache/PHP-FPM worker tugadi
// ============================================================================
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const BASE = (__ENV.BASE || 'http://localhost/tele_uzdub').replace(/\/+$/, '');
const MAXVUS = Number(__ENV.MAXVUS || 2000);
const STAGE = Number(__ENV.STAGE_SECONDS || 60);

const rlHits = new Counter('rl_hits');
const cacheHit = new Counter('cache_hit');
const cacheMiss = new Counter('cache_miss');
const hotTrend = new Trend('hot_ms');
const homeTrend = new Trend('home_ms');
const catalogTrend = new Trend('catalog_ms');

export const options = {
  scenarios: {
    read: {
      executor: 'ramping-vus',
      startVUs: 50,
      stages: [
        { duration: `${STAGE}s`, target: 500 },
        { duration: `${STAGE}s`, target: 1000 },
        { duration: `${STAGE}s`, target: MAXVUS },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '15s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    'http_req_duration{name:hot}': ['p(95)<800'],
    'http_req_duration{name:home}': ['p(95)<1200'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

// Anonim sessiya: cookie yubormaymiz (kesh shu holatda ishlaydi).
const PARAMS = {
  headers: { 'Accept': 'application/json' },
  tags: { kind: 'read' },
};

function get(name, path, trend) {
  const res = http.get(`${BASE}${path}`, { ...PARAMS, tags: { ...PARAMS.tags, name } });
  if (trend) trend.add(res.timings.duration);
  if (res.status === 429) rlHits.add(1);
  const cc = res.headers['X-Wc-Cache'] || res.headers['X-WC-Cache'] || '';
  if (cc === 'HIT' || cc === 'STALE') cacheHit.add(1);
  if (cc === 'MISS') cacheMiss.add(1);
  check(res, {
    'status 200/304': (r) => r.status === 200 || r.status === 304,
  });
  return res;
}

export default function () {
  get('hot', '/api/hot.php?n=30', hotTrend);
  get('home', '/api/home.php?offset=0&limit=12', homeTrend);
  get('catalog', '/api/catalog.php?sort=new&page=1', catalogTrend);
  get('related', '/api/related.php?id=1&offset=0&limit=5');
  get('genres', '/api/genres.php');
  // Real foydalanuvchi "o'ylab" turadi — aks holda bu sof sintetik DDOS bo'ladi.
  sleep(Math.random() * 2 + 0.5);
}

export function handleSummary(data) {
  const rl = (data.metrics.rl_hits && data.metrics.rl_hits.values.count) || 0;
  const hit = (data.metrics.cache_hit && data.metrics.cache_hit.values.count) || 0;
  const miss = (data.metrics.cache_miss && data.metrics.cache_miss.values.count) || 0;
  const total = hit + miss;
  console.log(`\nKesh: HIT/STALE=${hit}  MISS=${miss}  (${total ? Math.round((hit / total) * 100) : 0}%)`);
  console.log(`Rate limit (429): ${rl}`);
  return { stdout: '' };
}
