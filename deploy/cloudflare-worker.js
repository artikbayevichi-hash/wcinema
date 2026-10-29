// ============================================================================
// W CINEMA — Cloudflare Worker: Telegram CDN oqim proxy'si (edge streaming)
// ============================================================================
//
// Vazifasi: Telegram CDN video URL'larini saytingizdagi <video> playeri
// uchun barqaror oqimga aylantiradi:
//   - Telegram CDN ning referer/hotlink talablarini yumshatadi
//   - Range (206) so'rovlarini o'tkazadi  ->  izlash (seek) ishlaydi
//   - CORS sarlavhalarini qo'shadi
//   - Trafik sizning hostgingizga EMAS, Cloudflare CDN orqali o'tadi
//
// NIMA UCHUN ISHLASHI MUMKIN EMAS (muhim!):
//   Bu proxy FAQAT haqiqiy Telegram CDN fayl URL'si mavjud bo'lsa ishlaydi.
//   @Kinolark kabi ommaviy ko'rsatilmaydigan (yopiq) kanallarda telegram
//   umuman video fayl havolasini anonimga bermaydi — u holda bu worker'da
//   yo'naltirish uchun HECh narsa yo'q. Bunday postlar uchun yagona yo'l:
//   faylni admin panelda serverga yuklash (yoki kanalni ochiq qilish).
//
// O'RNATISH:
//   1) dash.cloudflare.com -> Workers & Pages -> Create Worker -> Deploy
//   2) Ushbu fayl tarkibini editor'ga joylashtiring -> Save & Deploy
//   3) Worker manzilini .env ga yozing (bo'sh bo'lsa funksiya o'chiq):
//        CLOUDFLARE_WORKER_URL=https://<domen>.workers.dev
//   4) Apache'ni qayta ishga tushirish shart emas — .env har so'rovda o'qiladi.
//
// XAVFSIZLIK: faqat Telegram CDN domsenlariga so'rov yuboriladi (SSRF himoya),
// boshqa domenlar 403 bilan rad etiladi.
// ============================================================================

// Faqat shu Telegram CDN domenlariga ruxsat beriladi.
// Faqat shu Telegram CDN domenlariga ruxsat beriladi.
const ALLOWED = /^(?:[a-z0-9-]+\.)*(?:telesco\.pe|cdn-telegram\.org)$/i;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, Content-Type, Origin',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type',
};

// Edge kesh sozlamalari.
//
// DIQQAT: Telegram CDN imzolangan (signed) URL'lar beradi. Imzo vaqtida
// muddati bor, shuning uchun kesh muddati QISQA (default 60 s) bo'lishi
// kerak - imzo o'tib ketgandan keyin eskirgan URL ishlamaydi.
//
// Range so'rovlari (206) KESHGA SOLINMAYDI: ular qisman javoblar va
// turli offset'larga mos keladi. Faqat to'liq (200) javoblar keshlanadi.
const EDGE_TTL = 60;              // soniya
const MAX_EDGE_BYTES = 32 * 1024 * 1024;   // 32 MB dan kattasini keshlamaymiz

// Bir xil manzilga parallel so'rovlarni birlashtirish (dedup).
//
// Masalan: brauzer `<video>` uchun bir necha Range so'rovi yuboradi, hamda
// boshqa tab ham o'sha faylni so'raydi. Barchasi edge'da bitta Telegram
// so'roviga birlashadi - Telegram'ga yuk kamayadi.
const INFLIGHT = new Map();

async function edgeFetch(t, request, headers, ctx) {
  const key = request.method + ' ' + t.toString();
  const running = INFLIGHT.get(key);
  if (running) return running;

  const p = (async () => {
    let resp;
    try {
      resp = await fetch(t.toString(), { method: request.method, headers });
    } catch (e) {
      return new Response('Telegram CDN yetib bo\'lmadi', { status: 502 });
    }
    return resp;
  })();

  INFLIGHT.set(key, p);
  try {
    return await p;
  } finally {
    INFLIGHT.delete(key);
  }
}

export default {
  async fetch(request, env, ctx) {
    // CORS preflight (fetch/XHR orqali Range so'rovlari uchun)
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Faqat GET/HEAD ruxsat', { status: 405 });
    }

    const url = new URL(request.url);
    const target = url.searchParams.get('url');
    if (!target) {
      return new Response('`url` parametri kerak', { status: 400 });
    }

    let t;
    try {
      t = new URL(target);
    } catch (e) {
      return new Response("Noto'g'ri URL", { status: 400 });
    }

    // SSRF himoya — faqat Telegram CDN
    if (!ALLOWED.test(t.hostname)) {
      return new Response('Ruxsat etilmagan domen: ' + t.hostname, { status: 403 });
    }
    if (t.protocol !== 'https:' && t.protocol !== 'http:') {
      return new Response('http/https kerak', { status: 400 });
    }

    // Telegram CDN ga so'rov: client Range sarlavhasini o'tkazamiz
    // (seek uchun), referer/origin talablarini yumshatamiz.
    const headers = new Headers(request.headers);
    headers.delete('referer');
    headers.delete('origin');
    headers.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36');

    const hasRange = !!request.headers.get('Range');

    // --- EDGE KESH ------------------------------------------------------
    //
    // Faqat to'liq (200) javoblar keshlanadi. Range so'rovlari (206)
    // qisman javoblar - ularni keshlash noto'g'ri bo'lardi (offset
    // mos kelmaydi).
    //
    // Kalit: HAQIQIY Telegram CDN manzili (imzo bilan). So'rov manzili
    // (`?url=...`) ham bo'lishi mumkin, lekin u barcha kalitlarni
    // bir xilga bog'laydi - esa haqiqiy manzil to'g'ri ajratadi.
    const cache = caches.default;
    const cacheKey = new Request(t.toString(), { method: 'GET' });
    let cacheable = request.method === 'GET' && !hasRange;

    if (cacheable) {
      try {
        const hit = await cache.match(cacheKey);
        if (hit) {
          const hh = new Headers(hit.headers);
          hh.set('Access-Control-Allow-Origin', '*');
          hh.set('X-WC-Cache', 'HIT');
          return new Response(hit.body, { status: hit.status, headers: hh });
        }
      } catch (e) { /* kesh ishlamasa - oddiy yo'l */ }
    }

    const resp = await edgeFetch(t, request, headers, ctx);
    if (resp.status >= 400) {
      // Eski imzo (URL muddati tugagan) bo'lsa foydalanuvchi aniq xato ko'radi
      return new Response('Telegram CDN xato: ' + resp.status, { status: resp.status });
    }

    const out = new Headers(resp.headers);
    out.set('Access-Control-Allow-Origin', '*');
    out.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Type');
    if (!out.has('Accept-Ranges')) out.set('Accept-Ranges', 'bytes');
    out.delete('Set-Cookie');
    out.set('X-WC-Cache', 'MISS');

    // Keshga yozish: faqat to'liq javob va kichik fayllar uchun.
    const len = Number(out.get('Content-Length') || 0);
    if (cacheable && resp.status === 200 && len > 0 && len <= MAX_EDGE_BYTES) {
      try {
        const copy = new Response(resp.body, { status: 200, headers: out });
        out.set('Cache-Control', 'public, max-age=' + EDGE_TTL);
        await cache.put(cacheKey, copy);
      } catch (e) { /* keshga yozilmasa - muammo yo'q */ }
    }

    // resp.body ni to'g'ridan-to'g'ri oqitamiz (bufer qilmaymiz) —
    // free planda CPU limitiga ta'sir qilmaydi, trafik CDN orqali o'tadi.
    return new Response(resp.body, { status: resp.status, headers: out });
  },
};