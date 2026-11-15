#!/usr/bin/env node
// ============================================================================
// tests/load/smoke.js — k6 o'rnatilmagan muhit uchun yuk sinovi (0 dependency)
// ============================================================================
// Ishlatish:
//   node tests/load/smoke.js [base] [requests] [concurrency] [path[,path2,...]]
//
//   node tests/load/smoke.js                                  # localhost, 200 so'rov, 20 parallel
//   node tests/load/smoke.js https://x.uz 2000 200            # 2000 so'rov, 200 parallel
//   node tests/load/smoke.js http://localhost/tele_uzdub 100 10 /api/hot.php
//   node tests/load/smoke.js ... 1000 50 '/api/home.php,/api/catalog.php'   # aralash
//
// Chiqaradi: muvaffaqiyat %, statuslar, p50/p90/p99, RPS, kesh HIT ulushi.
// Node 18+ (global fetch). Cookie yuborilmaydi — ya'ni ANONIM yo'l o'lchanadi.
// ============================================================================
'use strict';

const http = require('http');
const https = require('https');

const base = (process.argv[2] || 'http://localhost/tele_uzdub').replace(/\/+$/, '');
const total = Math.max(1, Number(process.argv[3] || 200));
const conc = Math.max(1, Number(process.argv[4] || 20));
const paths = (process.argv[5] || '/api/hot.php?n=30')
  .split(',').map((s) => s.trim()).filter(Boolean);

const url = new URL(base + paths[0]);
const lib = url.protocol === 'https:' ? https : http;
const agent = new lib.Agent({ keepAlive: true, maxSockets: conc });
// `base` ichida papka bo'lishi mumkin (masalan /tele_uzdub) — so'rov yo'liga
// shu prefiksni qayta qo'shamiz, aks holda hamma so'rov 404 bo'ladi.
const basePath = new URL(base).pathname.replace(/\/+$/, '');

const stats = {
  ok: 0, bad: 0, hit: 0, miss: 0, bytes: 0,
  codes: Object.create(null), times: [], perPath: Object.create(null),
};

function pickPath() {
  return paths.length === 1 ? paths[0] : paths[Math.floor(Math.random() * paths.length)];
}

function one() {
  return new Promise((resolve) => {
    const p = pickPath();
    const t0 = process.hrtime.bigint();
    const req = lib.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: basePath + p,
      method: 'GET',
      agent,
      headers: { 'Accept': 'application/json', 'Connection': 'keep-alive' },
      timeout: 30000,
    }, (res) => {
      let n = 0;
      res.on('data', (c) => { n += c.length; });
      res.on('end', () => {
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        stats.times.push(ms);
        stats.bytes += n;
        stats.codes[res.statusCode] = (stats.codes[res.statusCode] || 0) + 1;
        if (res.statusCode >= 200 && res.statusCode < 400) stats.ok++; else stats.bad++;
        const pp = stats.perPath[p] || (stats.perPath[p] = { n: 0, hit: 0, miss: 0, t: [] });
        pp.n++;
        pp.t.push(ms);
        const cc = String(res.headers['x-wc-cache'] || '').toUpperCase();
        if (cc === 'HIT' || cc === 'STALE') { stats.hit++; pp.hit++; }
        else if (cc === 'MISS') { stats.miss++; pp.miss++; }
        resolve();
      });
    });
    req.on('error', () => { stats.bad++; resolve(); });
    req.on('timeout', () => { req.destroy(); stats.bad++; resolve(); });
    req.end();
  });
}

function pct(arr, p) {
  if (!arr.length) return 0;
  const i = Math.min(arr.length - 1, Math.floor((p / 100) * arr.length));
  return arr[i];
}

(async () => {
  console.log(`URL: ${base}`);
  console.log(`Yo'llar (${paths.length}): ${paths.join(', ')}`);
  console.log(`So'rovlar: ${total}, parallel: ${conc}\n`);

  const t0 = Date.now();
  let started = 0;
  async function worker() {
    while (started < total) {
      started++;
      await one();
    }
  }
  await Promise.all(Array.from({ length: Math.min(conc, total) }, worker));
  const secs = (Date.now() - t0) / 1000;

  stats.times.sort((a, b) => a - b);
  const p = (v) => v.toFixed(0) + ' ms';
  const cacheTotal = stats.hit + stats.miss;

  console.log('Statuslar:  ' + Object.keys(stats.codes).sort()
    .map((c) => `${c}=${stats.codes[c]}`).join('  '));
  console.log('Muvaffaqiyat: ' + ((stats.ok / total) * 100).toFixed(1) + '%');
  console.log('Kechikish:  p50=' + p(pct(stats.times, 50))
    + '  p90=' + p(pct(stats.times, 90))
    + '  p99=' + p(pct(stats.times, 99))
    + '  max=' + p(stats.times[stats.times.length - 1] || 0));
  console.log('Tezlik:     ' + (total / secs).toFixed(1) + ' RPS, '
    + (stats.bytes / 1048576).toFixed(1) + ' MB javob');
  console.log('Kesh:       HIT=' + stats.hit + '  MISS=' + stats.miss
    + (cacheTotal ? '  (' + Math.round((stats.hit / cacheTotal) * 100) + '%)' : ''));

  // Yo'l bo'yicha alohida ko'rsatkichlar (aralash sinovda qaysi biri sekin?).
  const pkeys = Object.keys(stats.perPath);
  if (pkeys.length > 1) {
    console.log('\nYo\'l bo\'yicha:');
    for (const k of pkeys) {
      const pp = stats.perPath[k];
      pp.t.sort((a, b) => a - b);
      console.log('  ' + k.padEnd(42)
        + ' n=' + String(pp.n).padStart(4)
        + '  p50=' + p(pct(pp.t, 50))
        + '  p99=' + p(pct(pp.t, 99))
        + '  HIT=' + pp.hit + '/' + (pp.hit + pp.miss));
    }
  }

  // Birinchi "sinish" ni aytib beramiz — bu eng muhim xulosa.
  const rl = stats.codes['429'] || 0;
  const e5 = (stats.codes['500'] || 0) + (stats.codes['502'] || 0) + (stats.codes['503'] || 0);
  console.log('\nXulosa:');
  if (stats.bad === 0) console.log('  - xato yo\'q.');
  if (rl > 0) console.log(`  - ${rl} ta 429: rate limit. RL_READ_PER_MIN ni oshiring yoki kesh TTL ni uzaytiring.`);
  if (e5 > 0) console.log(`  - ${e5} ta 5xx: PHP/MySQL yetishmayapti (worker soni, MySQL ulanish).`);
  if (cacheTotal && stats.hit === 0) console.log('  - kesh HIT=0: HttpCache ishlamayapti (yozish ruxsati/TTL).');
  if (pct(stats.times, 95) > 1200) console.log('  - p95 > 1.2 s: kesh yoki DB indekslarini tekshiring.');
  agent.destroy();
})();
