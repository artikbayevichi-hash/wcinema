// ============================================================================
// W CINEMA — R2 PREFIKS OMBORI (Cloudflare Worker)
// ============================================================================
//
// VAZIFASI
//   Har bir videoning faqat BOSHIDAGI ~5 MB baytini (prefiksini) R2 da
//   saqlaydi va tez beradi. Video to'liq emas — faqat "birinchi kadr"
//   uchun kerak bo'lgan qism. Qolgan baytlar avvalgidek Telegram'dan
//   (MTProto) oqadi.
//
// NIMA UCHUN AYNAN PREFIKS?
//   - Butun faylni saqlash qimmat (300 MB–2 GB × 500 film).
//   - 5 MB × 500 = 2.5 GB -> R2 bepul 10 GB ichida bemalol.
//   - Brauzer `<video>` manbani ALMASHTIRMAYDI: baytlar aynan bir xil
//     faylning boshi, `Range`/`206` ham buzilmaydi.
//   - Foydalanuvchi video ochganda birinchi bayt R2 dan ~20–60 ms da
//     keladi (Telegram DC gacha 200–600 ms o'rniga).
//
// SOZLASH (qisqa)
//   1) dash.cloudflare.com -> R2 -> Create bucket  (masalan: wc-prefix)
//   2) Workers & Pages -> Create Worker -> shu faylni joylashtiring
//   3) Worker -> Settings -> Variables:
//        SIGN_SECRET  = uzun tasodifiy satr (php -r "echo bin2hex(random_bytes(32));")
//        MAX_BYTES    = 8388608        (ixtiyoriy, standart 8 MB)
//        ALLOW_ORIGIN = https://saytingiz.uz   (ixtiyoriy, standart *)
//      Worker -> Settings -> Bindings -> R2 bucket:
//        Variable name: R2   ->  wc-prefix
//   4) (Tavsiya) R2 bucket -> Settings -> Custom Domain: cdn-r2.saytingiz.uz
//      Shunda GET so'rovlari Worker'ni chetlab o'tadi (Workers limiti tejaladi).
//      PHP `.env` da R2_PUBLIC_BASE shu domenni ko'rsatadi.
//
// API
//   GET  /p/<doc>              — prefiksni beradi (Range: bytes=... ham)
//   HEAD /p/<doc>
//   PUT  /p/<doc>?exp=&sig=    — prefiksni yozadi (HMAC bilan)
//   OPTIONS /p/<doc>           — CORS preflight
//   GET  /health               — holat
//
// XAVFSIZLIK
//   - PUT faqat `api/r2-sign.php` bergan imzo bilan (15 daqiqa amal qiladi).
//   - Imzo: HMAC-SHA256(SIGN_SECRET, "PUT\n/p/<doc>\n<exp>")
//   - Bitta obyekt hajmi MAX_BYTES dan oshmaydi.
//   - Imzo taqqoslash vaqt-bardosh (constant-time).
//   - GET ochiq: bu faqat video BOSHI, sir emas. Baribir hamma ko'ra oladi.
// ============================================================================

const MAX_BYTES_DEFAULT = 8 * 1024 * 1024;
const MIN_BYTES = 4096;                    // Telegram blok tekisligi

function cors(env) {
  const origin = (env && env.ALLOW_ORIGIN) || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, HEAD, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Range, If-None-Match',
    'Access-Control-Expose-Headers': 'Content-Range, Content-Length, ETag, X-WC-R2, Accept-Ranges',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(obj, status, env) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors(env) },
  });
}

// `bytes=0-499` / `bytes=100-` / `bytes=-500` -> { start, end } yoki null
function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m) return null;
  let start;
  let end;
  if (m[1] === '' && m[2] === '') return null;
  if (m[1] === '') {
    // oxiridan N bayt
    const n = Number(m[2]);
    if (!Number.isFinite(n) || n <= 0) return null;
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Number(m[2]);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0) start = 0;
  if (end >= size) end = size - 1;
  if (end < start) return null;
  return { start, end, length: end - start + 1 };
}

async function hmacHex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  let out = '';
  const u8 = new Uint8Array(sig);
  for (let i = 0; i < u8.length; i++) out += u8[i].toString(16).padStart(2, '0');
  return out;
}

// Vaqt-bardosh taqqoslash (imzo uzunligi ham oshkor bo'lmasin).
function safeEqual(a, b) {
  const x = String(a || '');
  const y = String(b || '');
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

function baseHeaders(env) {
  return {
    'Content-Type': 'video/mp4',
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Accept-Ranges': 'bytes',
    ...cors(env),
  };
}

async function handleGet(request, env, ctx, url, key) {
  const isHead = request.method === 'HEAD';
  const rangeHdr = request.headers.get('Range');
  const bucket = env.R2 || env.BUCKET || env.PREFIX;

  // ---- Range so'rovi ------------------------------------------------------
  if (rangeHdr) {
    // Avval edge keshdan to'liq obyektni izlaymiz (bo'lsa — R2 ga bormaymiz).
    const cached = await edgeGet(url, env);
    if (cached) {
      const full = new Uint8Array(await cached.arrayBuffer());
      const r = parseRange(rangeHdr, full.length);
      if (!r) {
        return new Response(null, {
          status: 416,
          headers: { ...baseHeaders(env), 'Content-Range': 'bytes */' + full.length },
        });
      }
      const body = isHead ? null : full.slice(r.start, r.end + 1);
      return new Response(body, {
        status: 206,
        headers: {
          ...baseHeaders(env),
          'Content-Range': 'bytes ' + r.start + '-' + r.end + '/' + full.length,
          'Content-Length': String(r.length),
          'X-WC-R2': 'edge-range',
        },
      });
    }

    // Keshda yo'q — R2 dan to'g'ridan-to'g'ri oraliq o'qiymiz.
    const head = await bucket.head(key);
    if (!head) return miss(url, env);
    const r = parseRange(rangeHdr, head.size);
    if (!r) {
      return new Response(null, {
        status: 416,
        headers: { ...baseHeaders(env), 'Content-Range': 'bytes */' + head.size },
      });
    }
    const obj = await bucket.get(key, { range: { offset: r.start, length: r.length } });
    if (!obj) return miss(url, env);
    return new Response(isHead ? null : obj.body, {
      status: 206,
      headers: {
        ...baseHeaders(env),
        'Content-Range': 'bytes ' + r.start + '-' + r.end + '/' + head.size,
        'Content-Length': String(r.length),
        'X-WC-R2': 'r2-range',
      },
    });
  }

  // ---- To'liq GET ---------------------------------------------------------
  const cached = await edgeGet(url, env);
  if (cached) {
    return new Response(isHead ? null : cached.body, {
      status: 200,
      headers: {
        ...baseHeaders(env),
        'Content-Length': String(cached.headers.get('Content-Length') || ''),
        'X-WC-R2': 'edge',
      },
    });
  }

  const obj = await bucket.get(key);
  if (!obj) return miss(url, env);

  const headers = {
    ...baseHeaders(env),
    'Content-Length': String(obj.size),
    'ETag': obj.httpEtag || obj.etag || '',
    'X-WC-R2': 'r2',
  };

  const res = new Response(isHead ? null : obj.body, { status: 200, headers });

  // Edge keshga qo'yamiz — keyingi foydalanuvchilar R2 ga umuman bormaydi.
  if (!isHead) {
    try {
      await edgePut(url, res.clone(), ctx);
    } catch (e) { /* muhim emas */ }
  }
  return res;
}

// `caches.default` mavjud bo'lmasa (ba'zi muhitlarda) — jim o'tamiz.
function edgeRequest(url) {
  return new Request(url.origin + url.pathname, { method: 'GET' });
}

async function edgeGet(url, env) {
  try {
    if (typeof caches === 'undefined' || !caches.default) return null;
    const hit = await caches.default.match(edgeRequest(url));
    return hit || null;
  } catch (e) {
    return null;
  }
}

async function edgePut(url, response, ctx) {
  if (typeof caches === 'undefined' || !caches.default) return;
  const task = caches.default.put(edgeRequest(url), response);
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(task);
  else await task;
}

function miss(url, env) {
  return new Response('prefiks topilmadi', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-WC-R2': 'miss', ...cors(env) },
  });
}

async function handlePut(request, env, url, key, doc) {
  const secret = String(env.SIGN_SECRET || '');
  if (!secret) return json({ ok: false, error: 'SIGN_SECRET sozlanmagan' }, 503, env);

  const exp = Number(url.searchParams.get('exp') || 0);
  const sig = String(url.searchParams.get('sig') || '');
  if (!Number.isFinite(exp) || exp <= 0) return json({ ok: false, error: 'exp kerak' }, 400, env);

  const nowS = Math.floor(Date.now() / 1000);
  if (exp < nowS) return json({ ok: false, error: 'imzo muddati tugagan' }, 403, env);
  if (exp > nowS + 86400) return json({ ok: false, error: 'imzo juda uzoq' }, 400, env);

  const expect = await hmacHex(secret, 'PUT\n/p/' + doc + '\n' + exp);
  if (!safeEqual(sig, expect)) return json({ ok: false, error: 'imzo noto\'g\'ri' }, 403, env);

  const maxBytes = Number(env.MAX_BYTES || MAX_BYTES_DEFAULT) || MAX_BYTES_DEFAULT;
  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared > maxBytes) return json({ ok: false, error: 'juda katta', max: maxBytes }, 413, env);

  let buf;
  try {
    buf = await request.arrayBuffer();
  } catch (e) {
    return json({ ok: false, error: 'tanani o\'qib bo\'lmadi' }, 400, env);
  }

  if (!buf || buf.byteLength < MIN_BYTES) {
    return json({ ok: false, error: 'juda kichik', min: MIN_BYTES }, 400, env);
  }
  if (buf.byteLength > maxBytes) {
    return json({ ok: false, error: 'juda katta', max: maxBytes }, 413, env);
  }

  // Uzunlik 4096 ga karrali bo'lishi kerak — SW Telegram'dan aynan shu
  // chegaradan davom ettiradi (aks holda `LIMIT_INVALID`).
  const aligned = buf.byteLength - (buf.byteLength % MIN_BYTES);
  const body = aligned === buf.byteLength ? buf : buf.slice(0, aligned);

  const bucket = env.R2 || env.BUCKET || env.PREFIX;
  await bucket.put(key, body, {
    httpMetadata: {
      contentType: 'video/mp4',
      cacheControl: 'public, max-age=31536000, immutable',
    },
    customMetadata: { at: String(nowS), doc: String(doc) },
  });

  // Yangi prefiks darhol edge keshga tushsin.
  try {
    if (typeof caches !== 'undefined' && caches.default) {
      await caches.default.delete(edgeRequest(url));
    }
  } catch (e) { /* muhim emas */ }

  return json({ ok: true, doc: String(doc), bytes: body.byteLength }, 201, env);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(env) });
    }

    if (url.pathname === '/health') {
      return json({
        ok: true,
        r2: !!(env.R2 || env.BUCKET || env.PREFIX),
        max: Number(env.MAX_BYTES || MAX_BYTES_DEFAULT) || MAX_BYTES_DEFAULT,
        ts: Math.floor(Date.now() / 1000),
      }, 200, env);
    }

    const m = /^\/p\/([A-Za-z0-9_-]{1,64})$/.exec(url.pathname);
    if (!m) return json({ ok: false, error: 'not_found' }, 404, env);

    const doc = m[1];
    const key = 'p/' + doc;
    const bucket = env.R2 || env.BUCKET || env.PREFIX;
    if (!bucket) return json({ ok: false, error: 'R2 binding yo\'q (Variable name: R2)' }, 503, env);

    if (request.method === 'GET' || request.method === 'HEAD') {
      return handleGet(request, env, ctx, url, key);
    }
    if (request.method === 'PUT') {
      return handlePut(request, env, url, key, doc);
    }
    return json({ ok: false, error: 'method_not_allowed' }, 405, env);
  },
};
