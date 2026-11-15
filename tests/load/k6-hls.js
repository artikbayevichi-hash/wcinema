// ============================================================================
// tests/load/k6-hls.js — HLS zaxira yo'lining yuk sinovi
// ============================================================================
// HLS masshtablanmaydigan yo'l: bu test uning HAQIQIY chegarasini o'lchaydi.
// Segmentlar R2/B2 ga chiqarilgan bo'lsa, 302 manzillar remote'dan keladi —
// ya'ni origin (uy serveri) yuklanmaydi.
//
//   k6 run tests/load/k6-hls.js -e BASE=https://cinema.example.com -e KEY=<sha1>
//   k6 run tests/load/k6-hls.js -e BASE=... -e URL='https://t.me/kanal/123'
//   k6 run tests/load/k6-hls.js -e ... -e SEG=seg_00005.ts -e VUS=500
//
// KEY topish: `storage/hls_cache/<key>/` papka nomi (sha1('hls:'+url)).
// ============================================================================
import http from 'k6/http';
import { check } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const BASE = (__ENV.BASE || 'http://localhost/tele_uzdub').replace(/\/+$/, '');
const KEY = __ENV.KEY || '';
const URL_ = __ENV.URL || '';
const SEG = __ENV.SEG || 'seg_00001.ts';
const VUS = Number(__ENV.VUS || 200);

const redirects = new Counter('hls_redirects');
const redirectMs = new Trend('hls_redirect_ms');

export const options = {
  scenarios: {
    hls: {
      executor: 'constant-vus',
      vus: VUS,
      duration: __ENV.DURATION || '60s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

/** Segmentni so'raydi: 302 (remote) yoki 200 (origin) bo'lishi mumkin. */
function fetchSegment(url) {
  const seg = http.get(url, { tags: { name: 'segment' }, redirects: 0 });
  if (seg.status >= 300 && seg.status < 400) {
    redirects.add(1);
    redirectMs.add(seg.timings.duration);
    check(seg, { '302 -> remote': (r) => !!r.headers['Location'] });
  } else {
    check(seg, { 'segment 200': (r) => r.status === 200 });
  }
}

export default function () {
  if (!KEY && !URL_) {
    throw new Error('KEY yoki URL bering: -e KEY=<key> | -e URL=<t.me post>');
  }

  // KEY berilgan bo'lsa — to'g'ridan-to'g'ri segment (playlist kerak emas).
  if (KEY) {
    fetchSegment(`${BASE}/api/hls.php?key=${encodeURIComponent(KEY)}&seg=${encodeURIComponent(SEG)}`);
    return;
  }

  // URL berilgan bo'lsa — playlist, keyin undagi birinchi segment.
  const pl = http.get(`${BASE}/api/hls.php?url=${encodeURIComponent(URL_)}`, {
    tags: { name: 'playlist' },
    redirects: 0,
  });
  check(pl, {
    'playlist 200 va m3u8': (r) => r.status === 200 && String(r.body).indexOf('#EXTM3U') === 0,
  });

  const m = String(pl.body || '').match(/^(https?:\/\/\S+|\/api\/hls\.php\?\S+)$/m);
  if (!m) return;
  fetchSegment(/^https?:/.test(m[0]) ? m[0] : `${BASE}${m[0]}`);
}
