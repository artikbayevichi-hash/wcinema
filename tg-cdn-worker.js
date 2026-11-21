// ============================================================================
// TELEGRAM CDN SERVICE WORKER
// ============================================================================
//
// VAZIFA
//   Brauzerdagi <video> odaticha ishlaydi: `src` bilan, `preload` bilan,
//   seek bilan, to'xtatish/payqatish bilan. Farq shundaki, manba URL'i
//   "soxta" — /tele_uzdub/tgfile/...
//   Bu Service Worker so'rovni ushlab, Telegram CDN dan aynan so'ralgan
//   baytlarni MTProto orqali oladi va 206 Partial Content qaytaradi.
//
// NIMA UCHUN SHUNDAY?
//   1) MSE (MediaSource) ISHLAMAYDI.
//      Chrome'ning MSE qatlami faqat FRAGMENTLANGAN MP4 (moof+mdat) qabul
//      qiladi. Telegram videolari mo's (fragmentlanmagan) MP4 bo'lgani uchun
//      MSE ularni rad etadi: video.error = 4 (SRC_NOT_SUPPORTED).
//      Bu brauzerda tekshirilgan (mp4 atom tahlili + MSE sinovi).
//
//   2) Oddiy <video> esa ISHLAYDI — hatto indeks (moov) fayl oxirida
//      bo'lsa ham. Chunki brauzer o'zi kerakli joylarni Range so'rovi bilan
//      so'raydi: avval boshidan boshlaydi, so'ng oxiridan mo'ov'ni oladi.
//      Bizning vazifamiz — shu so'rovlarni Telegram ga yetkazib berish.
//
//   3) Shundagina SERVER GA UMUMAN VIDEO YUQMAYDI.
//      Sayt serveri faqat HTML/JS beradi. Butun video trafik —
//      brauzer <-> Telegram CDN orasida. Foydalanuvchining auth_key esa
//      faqat shu brauzerda (localStorage) saqlanadi.
//
// NIMA UCHUN MTPROTO SW ICHIDA EMAS?
//   GramJS paketi 5 MB va Node.js ekvivalentlariga (fs, net, os) tayanadi —
//   Service Worker muhitida ishlashi ishonchsiz. Shu sababli MTProto
//   SAHIFADA qoladi, SW esa faqat "HTTP server" rolini o'ynaydi va
//   kerakli baytlarni sahifadan so'rab oladi (MessageChannel orqali).
//
// UMR BOYI (bu MUHim)
//   Service Worker xotirasi (Map, Array) ISHONCHSIZ — brauzer uni
//   ixtiyoriy paytda o'chirib tashlaydi. Shuning uchun bu faylda saqlanadigan
//   narsa YO'Q. Har bir so'rovda ma'lumot sahifadan so'raladi. Kelganda
//   sahifa darhol qayta ulanadi (`postMessage({type:'provide'})`).
//
//   Sahifada `provider` yo'q bo'lsa, SW sabr qilib turadi (2.5 s) va o'zi
//   sahifaga `needProvider` deb murojaat qiladi. Sahifa javobgar bo'lib,
//   `provide` yuboradi — so'rov davom etadi.
//
//   ESKI OBYEKT HAQIDA (jimgina xato — bu yerda yozib qo'ydim):
//     `navigator.serviceWorker.controller` ni bir marta olib saqlab qo'yish
//     XATO. SW yangilanganda yoki sahifa qayta yuklanganda controller obyekti
//     ALMASHADI. Eski obyektga yuborilgan `postMessage` JIMGINA yo'qoladi —
//     na xato, na log. Sahifada har doim `navigator.serviceWorker.controller`
//     ni HOZIROQ olishi kerak, va `controllerchange` hodisasida qayta ulanish.
//
//   `provide` kelganda KUTAYOTGAN so'rovlarni rad etish XATO — bu xabar
//   tez-tez keladi (har bir SW yangilanishi, qayta ulanishda) va u har
//   kelganida <video> ning joyida turgan so'rovlarni ham xotim buzardi.
//   Faqat eski port yopiladi.
//
// TEZLIK QATLAMLARI (WebK klientidan olingan, amalda tekshirilgan)
//   0) `Range: bytes=0-1` "probe" iga DARHOL 2 bayt javob — pleer Telegram
//      javobini kutmasdan davom etadi (birinchi taassurot: 0 soniya).
//   1) Disk bo'lak keshi (Cache Storage, 24 soat, 400 MB) — qayta ochish,
//      orqaga qaytish va sahifa yangilash 0 tarmoq bilan ishlaydi.
//   2) 20 MB read-ahead — pleer turgan joydan oldinga bo'laklar fonda
//      yuklanadi, seek deyarli darhol bo'ladi.
//   3) `esds` tuzatish — Chromium ba'zi Telegram MP4'larini rad etmaydi.
//   4) R2 prefiksi (ixtiyoriy) — birinchi ~5 MB Cloudflare edge'dan.
//
//   Bu qatlamlarning hammasi `?doc=` berilmasa yoki `Save-Data: on` bo'lsa
//   o'chadi — ya'ni eski xatti-harakat buzilmaydi.
//
// ISHLATISH (tg-proof.php ichida):
//   1. navigator.serviceWorker.register('tg-cdn-worker.js', { scope: './' })
//   2. navigator.serviceWorker.controller mavjudligini tekshirish
//   3. controller.postMessage({ type: 'provide', size }, [port2])
//   4. video.src = 'tgfile/?size=...'   → brauzer Range so'raydi
// ============================================================================

// --------------------------------------------------------------- holat (vaqtincha)
// Faqat "qaysi port javobgar" degan minimal ma'lumot. SW o'chsa ham
// sahifa darhal qayta ulanadi (postMessage orqali).
let provider = null;                 // MessagePort — sahifaga so'rov yuborish uchun
const waiting = [];                  // javob kutayotgan so'rovlar

// Bitta Telegram so'rovida so'raydigan bayt miqdori.
//
// DIQQAT: Telegram 4 MB so'rovni RAD ETADI ("LIMIT_INVALID") — buni amalda
// ko'rdik. Rasmiy mijozlar va GramJS standartida 512 KB ishlatiladi, ana shu
// ishonchli qiymat. (Telegramning hujjatida aytilgan maksimum 1 MB.)
let CHUNK = 512 * 1024;
const MIN_CHUNK = 64 * 1024;   // shundan kichikga tushmaymiz
const MAX_CHUNK = 1024 * 1024; // Telegram ruxsat etadigan yuqori chegara
const CHUNK_SLOW = 256 * 1024; // 2G/3G/saveData — birinchi bayt tezroq

// Tarmoq haqidagi maslahat (sahifadan `provide` xabarida keladi).
// SW `navigator.connection` ni ko'rmaydi, shuning uchun qarorni sahifa
// qabul qiladi, SW esa faqat qo'llaydi. Bu — MASLAHAT: noto'g'ri qiymat
// kelsa ham Telegram chegarasidan oshmaymiz.
let NET_HINT = { saveData: false, effectiveType: '', downlink: 0, rtt: 0 };

/**
 * Tarmoq sharoitiga mos bo'lak hajmi.
 *
 * Nima uchun kerak:
 *   • 2G/3G da 512 KB so'rov bir necha sekund kutadi — 256 KB bilan
 *     birinchi bayt tezroq keladi;
 *   • tez 4G/Wi-Fi da 1 MB so'rov RTT sonini ikki barobar kamaytiradi
 *     (Telegram 1 MB gacha ruxsat beradi; 4 MB rad etilgan).
 *
 * 1 MB dan oshmaymiz: `upload.getFile` 1 MB blok chegarasidan oshsa
 * `LIMIT_INVALID` qaytaradi. 256 KB dan kichikga ham tushmaymiz — bu
 * bo'lak keshi va parallel o'qish uchun eng kichik foydali birlik.
 */
function chooseChunkForHint(h) {
  h = h || {};
  const et = String(h.effectiveType || '').toLowerCase();
  const dl = Number(h.downlink) || 0;
  const rtt = Number(h.rtt) || 0;
  if (h.saveData) return CHUNK_SLOW;
  if (et === 'slow-2g' || et === '2g' || et === '3g') return CHUNK_SLOW;
  if (dl > 0 && dl < 1.5) return CHUNK_SLOW;
  if (rtt > 400) return CHUNK_SLOW;
  // Faqat aniq "tez" signalda 1 MB. `downlink` ba'zi brauzerlarda
  // 10 Mbps dan pastda ham "4g" deb keladi — shuning uchun 20 Mbps.
  if (et === '4g' && dl >= 20) return MAX_CHUNK;
  return 512 * 1024;
}

function applyNetHint(h) {
  if (!h || typeof h !== 'object') return;
  NET_HINT = {
    saveData: !!h.saveData,
    effectiveType: String(h.effectiveType || '').toLowerCase(),
    downlink: Number(h.downlink) || 0,
    rtt: Number(h.rtt) || 0
  };
  const next = chooseChunkForHint(NET_HINT);
  if (next !== CHUNK) {
    CHUNK = next;
    say('📶 bo‘lak hajmi: ' + (CHUNK / 1024) + ' KB'
      + ' · ' + (NET_HINT.effectiveType || 'noma’lum')
      + (NET_HINT.downlink ? ' · ~' + NET_HINT.downlink + ' Mbps' : ''));
  }
}

// Bitta HTTP javobida qancha bayt qaytaramiz?
//
// Faqat bitta bo'lak: 512 KB (75 MB dan katta faylda 1 MB). Katta javob
// (ilgari 8 MB "dum") brauzerni butun yuklanish tugashini kutishga majbur
// qilardi; endi brauzer kerakli oynani o'zi so'raydi, har javob ~1 RTT da
// tayyor (tweb: `STREAM_CHUNK_MIDDLE_LIMIT = 512 KB`). Aniq chegara
// `fetch` ishlovchisidagi `RANGE_LIMIT`.

// --- MP4 indeksi (moov) oldindan yuklash ------------------------------------
//
// NIMA UCHUN:
//   MP4 faylda indeks (moov qutisi) ko'pincha faylning OXIRIDA turadi.
//   Brauzer boshidagi oqimni oladi, `moov` ni topa olmaydi va alohida
//   Range so'rovi bilan faylning oxirini so'raydi. Bu — qo'shimcha RTT
//   (Telegram DC gacha 150–400 ms) + indeks hajmini ikkinchi marta
//   yuklash.
//
//   Yechim: boshidagi oqimda `moov` topilmasa, faylning OXIRIDAGI qismni
//   Telegram'dan PARALLEL yuklab qo'yamiz. Brauzer indeksni so'raganda
//   javob shu zaxiradan (Telegram'ga murojaat qilmasdan) beriladi —
//   foydalanuvchi bir RTT tez ochadi.
//
//   `moov` boshida bo'lsa (faststart) — dum oynasi baribir bir marta
//   o'qiladi, lekin u faqat `warmtail` (Wi-Fi) yoqilganda va 1 MB.
// O'LCHANGAN: yangi filmlarning `moov` i 3.4–5.0 MB (masalan 4.23 MB,
// 4.96 MB).
//
// NIMA O'ZGARDI (Telegram Web K uslubi)
//   Ilgari fayl oxiridagi 8 MB "ko'r-ko'rona" yuklanardi va butun oqim shu
//   yuklanish tugashini KUTARDI. 4G da 8 MB = 4–8 s: `ttfb` 44 ms bo'lsa ham
//   `canplay` 5–7 s chiqardi (o'lchov: `canplay p50 = 5246 ms`).
//
//   tweb (`src/lib/serviceWorker/stream.ts`) buni boshqacha qiladi: faqat
//   BITTA oxirgi bo'lakni oldindan oladi (`preloadChunk(size - limit)`),
//   qolganini brauzerning o'z Range so'rovlari boshqaradi — har javob ~1 RTT.
//   Biz ham shu modelga o'tdik: oldindan faqat 1 MB (2 × 512 KB) olinadi,
//   hech qanday so'rov bu yuklanishni KUTMAYDI.
const TAIL_WINDOW = 1024 * 1024;            // oldindan olinadigan dum oynasi
const TAIL_LANES = 2;                       // 2 × 512 KB — bitta raund
const IDX_MAX = 8 * 1024 * 1024;            // indeks oynasining yuqori chegarasi
const HOFF_KEEP = 256 * 1024;               // bosh baytlardan eslab qolinadigan qism
const IDX_PAUSE_MS = 600;                   // indeks kutilayotganda oqim tanaffusi

// Kalit: `doc/size`. Ilgari faqat `size` edi — bir xil o'lchamdagi ikki
// hujjat bir-birining indeksini ishlatib yuborishi mumkin edi.
function tailKey(doc, size) { return (doc || '') + '/' + size; }

const TAIL_CACHE = new Map();               // kalit -> { start, bytes }
// Davom etayotgan prefetch promise'i. Nima uchun kerak: brauzer `moov` ni
// zaxira tayyor bo'lishidan OLDIN so'rasa, ilgari o'sha 8 MB Telegram'dan
// IKKINCHI marta tortilardi (prefetch + so'rov) — sekin va isrof. Endi
// so'rov prefetch tugashini kutadi va baytlarni keshdan oladi.
const TAIL_PROMISE = new Map();             // kalit -> Promise
const TAIL_MAX_ENTRIES = 2;                 // RAMni cheklovchi

// Indeks (moov) ANIQ oynasi: `{ start, len }` yoki `{ inHead: true }`.
const IDX_WIN = new Map();
// Keyframe jadvali: [[sekund, bayt ofseti], ...]. `moov` ichidagi
// `stss`+`stsz`+`stsc`+`stco/co64` jadvallaridan olinadi. Faqat kontent
// ma'lumoti — foydalanuvchi/sessiya/chipta yo'q.
const KF_MAP = new Map();
// Bosh baytlar (0 dan boshlab, ketma-ket) — MP4 qutilarini yurish uchun.
const HEAD_SEEN = new Map();
// Bosh bayt kelishini kutayotganlar (sahifa `warmtail` ni erta yuboradi).
const HEAD_WAIT = new Map();

// `moov` boshdagi baytlarda bormi? MP4 qutilarini (box) boshidan yurib
// tekshiramiz. `moov` topilsa — indeks allaqachon kelgan, demak.
function hasMoovInHead(bytes) {
  if (!bytes || bytes.length < 16) return false;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 0;
  const limit = Math.min(bytes.length, 128 * 1024);
  while (off + 8 <= limit) {
    const t0 = bytes[off + 4], t1 = bytes[off + 5], t2 = bytes[off + 6], t3 = bytes[off + 7];
    if (t0 === 0x6d && t1 === 0x6f && t2 === 0x6f && t3 === 0x76) return true; // 'moov'
    let size = dv.getUint32(off, false);
    if (size === 1) {
      // 64-bit o'lcham
      if (off + 16 > bytes.length) return false;
      const hi = dv.getUint32(off + 8, false), lo = dv.getUint32(off + 12, false);
      size = hi * 4294967296 + lo;
    } else if (size === 0) {
      return false;   // quti fayl oxirigacha
    }
    if (size < 8) return false;
    off += size;
  }
  return false;
}

// Indeks (`moov`) ANIQ qayerda? Bosh baytlardagi qutilarni yurib topamiz.
//   { inHead: true }   — indeks fayl boshida (faststart);
//   { start, len }     — indeks shu oraliqda (odatda `mdat` dan keyin);
//   null               — aniqlab bo'lmadi (zaxira yo'l ishlaydi).
//
// NIMA UCHUN: ilgari fayl oxiridagi 8 MB "ko'r-ko'rona" olinardi. `moov`
// 4–5 MB bo'lsa, 3–4 MB media baytlari behuda ketardi va sekin tarmoqda
// birinchi kadr shuncha kechikardi. Endi faqat kerakli oraliq olinadi.
function moovRegionInHead(bytes, size) {
  if (!bytes || bytes.length < 16 || !(size > 0)) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 0;
  // Butun mavjud bo'lakni yurib chiqamiz: qutilarni sakrab o'tganimiz uchun
  // bu bepul (faylning o'rtasidagi baytlar o'qilmaydi).
  const limit = bytes.length;
  while (off + 8 <= limit) {
    let boxSize = dv.getUint32(off, false);
    let hdr = 8;
    const t = String.fromCharCode(
      bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]);
    if (boxSize === 1) {
      if (off + 16 > bytes.length) return null;       // 64-bit sarlavha kesilgan
      boxSize = dv.getUint32(off + 8, false) * 4294967296 + dv.getUint32(off + 12, false);
      hdr = 16;
    } else if (boxSize === 0) {
      // "fayl oxirigacha" — bundan keyin boshqa quti yo'q.
      return t === 'moov' ? { inHead: true } : null;
    }
    if (boxSize < hdr || boxSize > size) return null;
    if (t === 'moov') return { inHead: true };        // indeks boshda
    if (t === 'mdat') {
      // `mdat` — media baytlari (yuzlab MB). Indeks undan KEYIN turadi:
      // shu sababli butun dumini emas, aynan `mdat` tugagan joydan o'qiymiz.
      const start = off + boxSize;
      if (start >= size) return null;
      return { start: start, len: size - start };
    }
    off += boxSize;
  }
  return null;
}

// ============================================================================
// CHROMIUM MP4 TUZATISH (esds)  — WebK `_crbug1250841` mantig'i
// ============================================================================
//
// MUAMMO
//   Telegram ba'zi videolarda MP4 ichidagi `esds` qutisida buzuq AAC
//   konfiguratsiyasini beradi: `DecoderSpecificInfo` faqat 2 bayt
//   ([0x13, 0x88]) bo'lib qolgan. Chromium buni rad etadi va faylni
//   "tushunmaydi" — natijada pleer butun faylni yuklashga o'tadi
//   (ya'ni video juda sekin ochiladi yoki umuman ochilmaydi).
//
// YECHIM
//   `esds` topilsa, ES_Descriptor -> DecoderConfigDescriptor ->
//   DecoderSpecificInfo yo'li bilan o'sha 2 baytni tekshiramiz. Aynan
//   shu buzuq qiymat bo'lsa — butun deskriptorni WebK ishlatadigan
//   ma'lum yaxshi nusxa bilan joyida almashtiramiz (hajm o'zgarmaydi).
//
// XAVFSIZLIK
//   * Faqat fayl BOSHIDA (1 MB) yoki OXIRIDA (16 MB) skanerlanadi —
//     `moov` (va u bilan `esds`) faqat shu yerda bo'ladi.
//   * Har bir hujjat uchun bir marta uriniladi; 12 MB skandan keyin
//     to'xtaydi (foydasi yo'q).
//   * Baytlar NUSXADA o'zgartiriladi — keshdagi asl nusxa buzilmaydi.
// ============================================================================
const ESDS_TAG = new Uint8Array([0x65, 0x73, 0x64, 0x73]);   // 'esds'
const MP4A_TAG = new Uint8Array([0x6d, 0x70, 0x34, 0x61]);   // 'mp4a'
const BROKEN_DSI = [0x13, 0x88];
// WebK ishlatadigan yaxshi ES_Descriptor (27 bayt, AAC LC).
const FIXED_ESDS = new Uint8Array([
  0x03, 0x27, 0x00, 0x01, 0x00, 0x04, 0x19, 0x40, 0x15,
  0x00, 0x00, 0x00, 0x00, 0x01, 0xf4, 0x00, 0x00, 0x00,
  0xbb, 0x75, 0x05, 0x07, 0x13, 0x88, 0x56, 0xe5, 0xa5
]);

const FIX_DONE = new Set();        // tuzatilgan hujjatlar
const FIX_SKIP = new Set();        // urinish befoyda bo'lgan hujjatlar
const FIX_TRIED = new Map();       // doc -> skanerlangan bayt

// `hay` ichidan `needle` ni TEPAGA qarab qidiradi (WebK `ya` bilan bir xil).
function seqIndexBack(hay, needle, end) {
  const m = needle.length;
  const n = Math.min(end === undefined ? hay.length : end, hay.length);
  outer:
  for (let i = n - m; i >= 0; i--) {
    if (hay[i] !== needle[0]) continue;
    for (let j = 1; j < m; j++) {
      if (hay[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

// MPEG-4 deskriptor uzunligi (1–4 bayt, 7 bitdan).
function readDescSize(a, i) {
  let used = 0;
  let val = 0;
  for (let k = 0; k < 4; k++) {
    const b = a[i + k];
    if (b === undefined) throw new Error('esds: chegara');
    val = (val << 7) + (b & 0x7f);
    used++;
    if (!(b & 0x80)) break;
  }
  return [used, val];
}

function dsiOf(a) {
  if (a[0] !== 0x05) throw new Error('esds: DSI');
  const r = readDescSize(a, 1);
  const n = 1 + r[0];
  return a.subarray(n, n + r[1]);
}

function dcdOf(a) {
  if (a[0] !== 0x04) throw new Error('esds: DCD');
  const r = readDescSize(a, 1);
  const n = 1 + r[0] + 13;
  return dsiOf(a.subarray(n));
}

function esDescriptorDsi(a) {
  if (a[0] !== 0x03) throw new Error('esds: ES');
  const dv = new DataView(a.buffer, a.byteOffset, a.byteLength);
  const r = readDescSize(a, 1);
  let i = 1 + r[0] + 2;                 // ES_ID
  const flags = dv.getUint8(i);
  i += 1;
  if (flags & 0x80) i += 2;             // dependsOn_ES_ID
  if (flags & 0x40) {                   // URL
    const c = readDescSize(a, i);
    i += 1 + c[0] + c[1];
  }
  return dcdOf(a.subarray(i));
}

// Buzuq `esds` bo'lsa `u8` NI JOYIDA tuzatadi. true = tuzatildi.
function patchEsds(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let t = u8.length;
  let found = null;

  for (;;) {
    const d = seqIndexBack(u8, ESDS_TAG, t);
    if (d < 4) break;
    t = d;

    const boxSize = dv.getUint32(d - 4, false);
    if (boxSize < 16 || d + boxSize > u8.length) continue;

    // 'mp4a' shu qutidan 100 bayt ichida bo'lishi kerak (sample entry).
    const b = seqIndexBack(u8, MP4A_TAG, d);
    if (b === -1 || d - b > 100) continue;

    found = { offset: d + 8, size: boxSize - 12 };
  }

  if (!found) return false;

  const body = u8.subarray(found.offset, found.offset + found.size);
  const dsi = esDescriptorDsi(body);
  if (dsi.length !== BROKEN_DSI.length) return false;
  if (dsi[0] !== BROKEN_DSI[0] || dsi[1] !== BROKEN_DSI[1]) return false;
  if (found.size < FIXED_ESDS.length) return false;

  u8.set(FIXED_ESDS, found.offset);
  return true;
}

// Javob baytlarini kerak bo'lsa tuzatilgan NUSXA bilan almashtiradi.
function applyMp4Fix(doc, start, size, u8) {
  if (!doc || !u8 || !u8.length) return u8;
  if (FIX_DONE.has(doc) || FIX_SKIP.has(doc)) return u8;

  const atHead = start < 1024 * 1024;
  const atTail = (start + u8.length) > (size - 16 * 1024 * 1024);
  if (!atHead && !atTail) return u8;

  const copy = u8.slice();
  let ok = false;
  try { ok = patchEsds(copy); } catch (e) { ok = false; }

  if (ok) {
    FIX_DONE.add(doc);
    if (FIX_DONE.size > 300) FIX_DONE.clear();
    say('🔧 MP4 esds tuzatildi (doc ' + doc.slice(0, 12) + '…)');
    return copy;
  }

  const tried = (FIX_TRIED.get(doc) || 0) + u8.length;
  if (tried > 12 * 1024 * 1024) {
    FIX_SKIP.add(doc);
    FIX_TRIED.delete(doc);
    if (FIX_SKIP.size > 300) FIX_SKIP.clear();
  } else {
    FIX_TRIED.set(doc, tried);
    if (FIX_TRIED.size > 300) FIX_TRIED.clear();
  }
  return u8;
}

// Bosh baytlarni eslab qolamiz (0 dan boshlab KETMA-KET bo'laklar).
function headNote(key, u8) {
  if (!key || !u8 || !u8.length) return;
  const cur = HEAD_SEEN.get(key);
  if (!cur) {
    HEAD_SEEN.set(key, u8.slice(0, HOFF_KEEP));
  } else if (cur.length < HOFF_KEEP) {
    const room = HOFF_KEEP - cur.length;
    const take = u8.length <= room ? u8 : u8.subarray(0, room);
    const out = new Uint8Array(cur.length + take.length);
    out.set(cur, 0);
    out.set(take, cur.length);
    HEAD_SEEN.set(key, out);
  } else {
    return;                                 // allaqachon to'lgan
  }
  while (HEAD_SEEN.size > 8) HEAD_SEEN.delete(HEAD_SEEN.keys().next().value);
  const w = HEAD_WAIT.get(key);
  if (w && w.length) {
    HEAD_WAIT.delete(key);
    for (let i = 0; i < w.length; i++) { try { w[i](); } catch (e) { /* jim */ } }
  }
}

// Bosh bayt kelishini kutamiz (chegara bilan). `warmtail` sahifadan oqim
// boshlanishidan OLDIN kelishi mumkin — shunda 1200 ms kutamiz; kelmasa
// o'zimiz o'qiymiz.
function headWait(key, ms) {
  const cur = HEAD_SEEN.get(key);
  if (cur) return Promise.resolve(cur);
  return new Promise(function (res) {
    let arr = HEAD_WAIT.get(key);
    if (!arr) { arr = []; HEAD_WAIT.set(key, arr); }
    let done = false;
    const fin = function () {
      if (done) return;
      done = true;
      const i = arr.indexOf(fin);
      if (i >= 0) arr.splice(i, 1);
      const now = HEAD_SEEN.get(key);
      if (now) res(now);
      else res(null);
    };
    arr.push(fin);
    setTimeout(fin, Math.max(50, ms || 1200));
  });
}

// Sahifa SQL keshidan olgan indeks xaritasini qabul qiladi. Bu ko'rsatma
// `indexRegion()` ning bosh baytlarni kutishini butunlay yo'q qiladi: issiq
// ochilishda moov qayerdaligi allaqachon ma'lum.
function cleanIndex(m, size) {
  if (!m || typeof m !== 'object') return null;
  if (m.inHead === true) return { inHead: true };
  const start = Number(m.start), len = Number(m.len);
  if (!Number.isFinite(start) || !Number.isFinite(len)) return null;
  if (start < 0 || len <= 0 || len > IDX_MAX || start >= size) return null;
  return { start: Math.floor(start), len: Math.floor(Math.min(len, size - start)) };
}

function storeKf(key, kf, dur) {
  if (!Array.isArray(kf) || !kf.length) return false;
  KF_MAP.set(key, { kf: kf, dur: Number(dur) || 0 });
  while (KF_MAP.size > 64) KF_MAP.delete(KF_MAP.keys().next().value);
  return true;
}

function setIndexHint(doc, size, moov, kf, dur) {
  const reg = cleanIndex(moov, size);
  if (!reg) return false;
  const key = tailKey(doc, size);
  if (!IDX_WIN.has(key)) IDX_WIN.set(key, reg);
  if (kf) storeKf(key, kf, dur);
  return true;
}

// Birinchi tomoshabin topgan xaritani sahifaga qaytaramiz — u faqat kontent
// ma'lumoti (doc/size/koordinata + ixtiyoriy keyframe jadvali), foydalanuvchi
// yoki chipta emas.
function reportIndex(doc, size, reg, kf, dur) {
  if (!doc || !(size > 0) || !reg) return;
  self.clients.matchAll().then(function (list) {
    for (const c of list) {
      try {
        c.postMessage({
          type: 'indexfound', doc: String(doc), size: Number(size),
          moov: reg, kf: kf || [], dur: Number(dur) || 0
        });
      } catch (e) { /* sahifa yopilgan bo'lishi mumkin */ }
    }
  }).catch(noop);
}

// ---------------------------------------------------------- KEYFRAME XARITASI
// `moov` ichidagi jadvallardan haqiqiy sync-sample ofsetlarini chiqaramiz:
//   stss  -> qaysi sample'lar keyframe
//   stsz  -> har bir sample hajmi
//   stsc  -> chunk boshiga necha sample tushadi
//   stco/co64 -> chunk'larning fayldagi ofseti
//   stts + mdhd -> sekundlar
// Natija: [[sekund, bayt], ...]. Video baytlari bu yerdan O'TMAYDI.
function parseKeyframes(u8, size) {
  if (!u8 || u8.length < 32) return null;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const MAX_BOXES = 20000;
  const boxAt = function (from, end) {
    const out = [];
    let off = from;
    while (off + 8 <= end && out.length < MAX_BOXES) {
      let sz = dv.getUint32(off, false);
      let hdr = 8;
      const type = String.fromCharCode(u8[off + 4], u8[off + 5], u8[off + 6], u8[off + 7]);
      if (sz === 1) {
        if (off + 16 > end) return null;
        sz = dv.getUint32(off + 8, false) * 4294967296 + dv.getUint32(off + 12, false);
        hdr = 16;
      } else if (sz === 0) {
        sz = end - off;
      }
      if (sz < hdr || off + sz > end) return null;
      out.push({ type: type, from: off, body: off + hdr, end: off + sz });
      off += sz;
    }
    return out;
  };
  const child = function (boxes, type) {
    for (let i = 0; i < boxes.length; i++) if (boxes[i].type === type) return boxes[i];
    return null;
  };
  const all = boxAt(0, u8.length);
  if (!all) return null;
  const moov = child(all, 'moov');
  if (!moov) return null;
  const mChildren = boxAt(moov.body, moov.end);
  if (!mChildren) return null;

  let mdhd = null, timescale = 0, durRaw = 0;
  let stbl = null;
  for (const trak of mChildren) {
    if (trak.type !== 'trak') continue;
    const tChildren = boxAt(trak.body, trak.end);
    if (!tChildren) continue;
    const mdia = child(tChildren, 'mdia');
    if (!mdia) continue;
    const mdChildren = boxAt(mdia.body, mdia.end);
    if (!mdChildren) continue;
    const hdlr = child(mdChildren, 'hdlr');
    if (!hdlr || hdlr.body + 12 > hdlr.end) continue;
    if (String.fromCharCode(u8[hdlr.body + 8], u8[hdlr.body + 9],
                            u8[hdlr.body + 10], u8[hdlr.body + 11]) !== 'vide') continue;
    const mh = child(mdChildren, 'mdhd');
    if (mh && mh.body + 20 <= mh.end) {
      const ver = u8[mh.body];
      if (ver === 1) {
        if (mh.body + 28 <= mh.end) {
          timescale = dv.getUint32(mh.body + 20, false);
          durRaw = dv.getUint32(mh.body + 24, false) * 4294967296
                 + dv.getUint32(mh.body + 28, false);
        }
      } else {
        timescale = dv.getUint32(mh.body + 12, false);
        durRaw = dv.getUint32(mh.body + 16, false);
      }
    }
    const minf = child(mdChildren, 'minf');
    if (!minf) continue;
    const miChildren = boxAt(minf.body, minf.end);
    if (!miChildren) continue;
    const sb = child(miChildren, 'stbl');
    if (sb) stbl = sb;
    if (stbl) break;
  }
  if (!stbl || !(timescale > 0)) return null;
  const sChildren = boxAt(stbl.body, stbl.end);
  if (!sChildren) return null;

  // --- stts: sample -> vaqt -----------------------------------------------
  const stts = child(sChildren, 'stts');
  if (!stts || stts.body + 8 > stts.end) return null;
  const sttsN = dv.getUint32(stts.body + 4, false);
  const sttsArr = [];
  for (let i = 0; i < sttsN && stts.body + 8 + i * 8 + 8 <= stts.end; i++) {
    sttsArr.push([dv.getUint32(stts.body + 8 + i * 8, false),
                  dv.getUint32(stts.body + 12 + i * 8, false)]);
  }

  // --- stsz: sample hajmlari ----------------------------------------------
  const stsz = child(sChildren, 'stsz');
  if (!stsz || stsz.body + 12 > stsz.end) return null;
  const fixed = dv.getUint32(stsz.body + 4, false);
  const sampleCount = dv.getUint32(stsz.body + 8, false);
  const sizes = fixed > 0 ? null : [];
  if (!sizes) {
    for (let i = 0; i < sampleCount && stsz.body + 12 + (i + 1) * 4 <= stsz.end; i++) {
      sizes.push(dv.getUint32(stsz.body + 12 + i * 4, false));
    }
  }
  const sampleSize = function (i) { return fixed > 0 ? fixed : (sizes[i] || 0); };

  // --- stsc: chunk -> sample soni -----------------------------------------
  const stsc = child(sChildren, 'stsc');
  if (!stsc || stsc.body + 8 > stsc.end) return null;
  const stscN = dv.getUint32(stsc.body + 4, false);
  const stscArr = [];
  for (let i = 0; i < stscN && stsc.body + 8 + i * 12 + 12 <= stsc.end; i++) {
    stscArr.push([dv.getUint32(stsc.body + 8 + i * 12, false),
                  dv.getUint32(stsc.body + 12 + i * 12, false)]);
  }
  if (!stscArr.length) return null;

  // --- stco / co64: chunk ofsetlari ---------------------------------------
  let coff = child(sChildren, 'co64') || child(sChildren, 'stco');
  if (!coff || coff.body + 8 > coff.end) return null;
  const wide = coff.type === 'co64';
  const chunkN = dv.getUint32(coff.body + 4, false);
  const chunks = [];
  const step = wide ? 8 : 4;
  for (let i = 0; i < chunkN && coff.body + 8 + (i + 1) * step <= coff.end; i++) {
    const v = wide
      ? dv.getUint32(coff.body + 8 + i * 8, false) * 4294967296
        + dv.getUint32(coff.body + 12 + i * 8, false)
      : dv.getUint32(coff.body + 8 + i * 4, false);
    chunks.push(v);
  }
  if (!chunks.length) return null;

  // --- stss: keyframe sample'lari (yo'q bo'lsa hamma sample sync) ----------
  const stss = child(sChildren, 'stss');
  const keySet = new Set();
  let hasStss = false;
  if (stss && stss.body + 8 <= stss.end) {
    hasStss = true;
    const n = dv.getUint32(stss.body + 4, false);
    for (let i = 0; i < n && stss.body + 8 + (i + 1) * 4 <= stss.end; i++) {
      keySet.add(dv.getUint32(stss.body + 8 + i * 4, false));
    }
  }
  if (!hasStss && !keySet.size && sampleCount > 4000) {
    // `stss` yo'q = hamma sample sync. Jadvalni 4000 taga qisqartiramiz.
    const stride = Math.ceil(sampleCount / 4000);
    for (let s = 1; s <= sampleCount; s += stride) keySet.add(s);
  }

  const out = [];
  let sampleNo = 1, sampleT = 0, ti = 0, tLeft = 0, tDelta = 0, si = 0;
  const maxSamples = Math.min(sampleCount || 0, 2000000);
  outer:
  for (let ci = 0; ci < chunks.length && sampleNo <= maxSamples; ci++) {
    while (si + 1 < stscArr.length && stscArr[si + 1][0] <= ci + 1) si++;
    const per = stscArr[si][1];
    if (!(per > 0) || per > 100000) break;
    let off = chunks[ci];
    for (let j = 0; j < per && sampleNo <= maxSamples; j++) {
      const sz = sampleSize(sampleNo - 1);
      const isKey = hasStss ? keySet.has(sampleNo) : keySet.has(sampleNo);
      if (isKey && off >= 0 && off < size) {
        out.push([Math.round((sampleT / timescale) * 1000) / 1000, off]);
        if (out.length >= 4000) break outer;
      }
      if (tLeft <= 0) {
        if (ti >= sttsArr.length) break outer;
        tLeft = sttsArr[ti][0];
        tDelta = sttsArr[ti][1];
        ti++;
      }
      sampleT += tDelta;
      tLeft--;
      off += sz;
      sampleNo++;
    }
  }
  if (!out.length) return null;
  const dur = durRaw > 0 ? Math.round((durRaw / timescale) * 1000) / 1000 : 0;
  return { kf: out, dur: dur };
}

// Birinchi marta topilgan `moov` baytlaridan keyframe jadvalini chiqarib,
// sahifaga (keyin esa DB'ga) yuboramiz. Baytlar allaqachon oqim uchun
// o'qilgan — qo'shimcha so'rov faqat `moov` 1 MB dan katta bo'lganda.
async function finishIndex(doc, size, key, reg, moovBytes) {
  let kf = [], dur = 0;
  const cached = KF_MAP.get(key);
  if (cached) { kf = cached.kf; dur = cached.dur; }
  else if (moovBytes) {
    try {
      const parsed = parseKeyframes(moovBytes, size);
      if (parsed) { kf = parsed.kf; dur = parsed.dur; storeKf(key, kf, dur); }
    } catch (e) { /* MP4 tuzilishi notanish bo'lsa jimsiz o'tkazamiz */ }
  }
  reportIndex(doc, size, reg, kf, dur);
}

// Indeks (moov) aniq oraliqini topamiz: avval bosh baytlardan (bepul),
// bo'lmasa 512 KB lik BIRINCHI bo'lakni o'qiymiz — u baribir oqim uchun
// kerak (kalit `chunkKey` bilan AYNAN bir xil), ya'ni ortiqcha trafik yo'q.
async function indexRegion(size, doc) {
  const key = tailKey(doc, size);
  const known = IDX_WIN.get(key);
  if (known) return known;
  let reg = null, head = null;
  head = HEAD_SEEN.get(key) || await headWait(key, 1200);
  if (head) reg = moovRegionInHead(head, size);
  if (!reg) {
    try {
      const probe = await readWindow(doc, 0, Math.min(CHUNK, size), size);
      if (probe && probe.length >= 16) {
        head = probe;
        headNote(key, probe);                 // keyingi safar bepul
        reg = moovRegionInHead(probe, size);
      }
    } catch (e) { reg = null; }
  }
  if (reg && !reg.inHead) {
    if (!(reg.len > 0)) reg = null;
    else if (reg.len > IDX_MAX) reg = { start: size - IDX_MAX, len: IDX_MAX };
  }
  // Faqat ijobiy natijani eslaymiz: bosh baytlar keyinroq kelishi mumkin.
  if (reg) {
    IDX_WIN.set(key, reg);
    while (IDX_WIN.size > 64) IDX_WIN.delete(IDX_WIN.keys().next().value);

    let moovBytes = reg.inHead ? head : null;
    if (!reg.inHead) {
      try {
        moovBytes = await readRange(reg.start, Math.min(reg.len, IDX_MAX), size, doc, 2);
      } catch (e) { moovBytes = null; }
    }
    finishIndex(doc, size, key, reg, moovBytes).catch(noop);
  }
  return reg;
}

// Faylning oxirini (MP4 indeksini) oldindan yuklab, keshga qo'yamiz.
// `doc` berilsa u DISK keshiga ham yoziladi — qayta ochishda indeks darhol
// tayyor bo'ladi (RTT ham, Telegram trafigi ham tejaladi).
//
// Eslatma: faststart fayllarda (`moov` boshda) dum baribir bir marta
// o'qiladi — bu faqat `watch.php` "warmtail" yuborganda (Wi-Fi) bo'ladi va
// 1 MB dan oshmaydi. Indeksni oldindan aniqlash uchun KUTILMAYDI: kutish
// dum oynasini klikdan keyinga surardi (o'lchangan).
function prefetchTail(size, doc) {
  if (!(size > CHUNK)) return Promise.resolve(null);          // juda kichik fayl
  const key = tailKey(doc, size);
  const ready = TAIL_CACHE.get(key);
  if (ready && ready.bytes) return Promise.resolve(ready);     // allaqachon tayyor
  if (TAIL_PROMISE.has(key)) return TAIL_PROMISE.get(key);     // davom etyapti

  const p = (async function () {
    // Asosiy ish — faylning OXIRGI oynasi: brauzer `moov` ni shu yerdan
    // qidiradi (WebK ham aynan oxirgi bo'lakni oldindan oladi).
    //
    // Bu so'rov DARHOL boshlanadi. Ilgari avval `indexRegion` kutilardi:
    // uning `headWait` chegarasi (1200 ms) butun dum oynasini klikdan
    // KEYINGA surardi — o'lchovda prefetch 1.34 s da boshlanib, 2.2 s da
    // tugardi, `canplay` esa 3.7 s edi.
    const start = Math.max(0, size - TAIL_WINDOW);
    const aligned = start - (start % CHUNK);
    const len = size - aligned;
    if (!(len > 0)) return null;
    const tailP = readRange(aligned, len, size, doc, TAIL_LANES);

    // `moov` indeksini PARALLEL aniqlaymiz: natija `IDX_WIN` ga yoziladi
    // (keyingi so'rovlar uchun bepul), topilsa uning sarlavhasi turgan
    // bo'lak ham qizdiriladi. HECH QANDAY so'rov buni kutmaydi.
    //
    // ISSIQ YO'L: xarita bazadan keldi — 1200 ms lik `headWait` umuman
    // ishlamaydi, moov sarlavhasi darhol, dum oynasi bilan BIR VAQTDA olinadi.
    const hint = IDX_WIN.get(key);
    if (hint && !hint.inHead && hint.start > 0) {
      const moovOff = hint.start - (hint.start % CHUNK);
      if (moovOff < size) {
        readWindow(doc, moovOff, Math.min(CHUNK, size - moovOff), size).then(function (bytes) {
          // Keshda kf bo'lmasa (eski yozuv), endi uni hisoblab yuboramiz.
          if (KF_MAP.has(key) || !bytes) return;
          try {
            const p = parseKeyframes(bytes, size);
            if (p && p.kf.length) { storeKf(key, p.kf, p.dur); reportIndex(doc, size, hint, p.kf, p.dur); }
          } catch (e) { /* jim */ }
        }, noop);
      }
    } else if (!hint) {
      indexRegion(size, doc).then(function (reg) {
        if (!reg || reg.inHead || !(reg.start > 0)) return;
        const moovOff = reg.start - (reg.start % CHUNK);
        readWindow(doc, moovOff, Math.min(CHUNK, size - moovOff), size).then(noop, noop);
      }).catch(noop);
    }

    const bytes = await tailP;
    if (!bytes || !bytes.length) return null;
    // Birinchi tomoshabin dum oynasini mahalliy keshga yozadi. Keyingi
    // ochilishda `moov` Telegram DC'ga emas, shu serverga so'raladi.
    if (pxNeedTailSeed(doc) && bytes.length >= 1024 * 1024) {
      r2Seed(doc, size, [bytes], bytes.length, 'tail');
      if (R2_INFO && R2_INFO.docs && !R2_INFO.docs[String(doc)]) {
        R2_INFO.docs[String(doc)] = { head: 0, tail: bytes.length };
      } else if (R2_INFO && R2_INFO.docs && R2_INFO.docs[String(doc)]) {
        R2_INFO.docs[String(doc)].tail = bytes.length;
      }
    }
    const it = { start: aligned, bytes: bytes };
    TAIL_CACHE.set(key, it);
    while (TAIL_CACHE.size > TAIL_MAX_ENTRIES) {
      TAIL_CACHE.delete(TAIL_CACHE.keys().next().value);
    }
    return it;
  })().catch(function () {
    return null;
  }).then(function (v) {
    if (TAIL_PROMISE.get(key) === p) TAIL_PROMISE.delete(key);
    return v;
  });
  TAIL_PROMISE.set(key, p);
  return p;
}

// So'ralgan oraliq allaqachon keshdami? KUTISH YO'Q.
//
// Ilgari bu funksiya 8 MB lik prefetch tugashini 6 sekundgacha KUTARDI.
// Aynan shu kutish `canplay` ni 5–7 s ga cho'zardi: brauzer `moov` so'rovi
// bitta bo'lak (~1 RTT) bilan javob olishi mumkin bo'lsa ham, butun 8 MB
// yuklanishini kutardi. Endi WebK kabi: keshda bo'lsa — darhol, bo'lmasa
// so'rov o'zining 512 KB lik oynalarini to'g'ridan-to'g'ri o'qiydi.
function awaitTail(start, want, size, doc) {
  return tailFromCache(tailKey(doc, size), start, want);
}

// So'ralgan oraliq keshda bormi? (butunlay sig'ishi kerak)
function tailFromCache(key, start, want) {
  const c = TAIL_CACHE.get(key);
  if (!c || !c.bytes) return null;
  const end = start + want;
  if (start < c.start || end > c.start + c.bytes.length) return null;
  const from = start - c.start;
  return c.bytes.subarray(from, from + want);
}

// Indeks yuklanmoqda bo'lsa, ketma-ket oqimni BIR oz to'xtatamiz: birinchi
// kadr uchun indeks SHART, media baytlari esa keyin ham kerak. Shu bilan
// sekin tarmoqda indeks tezroq keladi (oqim bilan raqobatlashmaydi).
async function waitIndex(doc, size, ms) {
  const key = tailKey(doc, size);
  const p = TAIL_PROMISE.get(key);
  if (!p) return;
  const reg = IDX_WIN.get(key);
  // Xarita ma'lum (boshda yoki SQL keshidan kelgan) — endi hech narsa
  // kutishga hojat yo'q: moov bo'lagi allaqachon parallel o'qilayapti.
  if (reg) return;
  let timer = null;
  const t = new Promise(function (res) {
    timer = setTimeout(res, Math.max(1000, ms || IDX_PAUSE_MS));
  });
  try { await Promise.race([p, t]); } catch (e) { /* jim */ }
  if (timer) clearTimeout(timer);
}

function noop() { /* bo'sh */ }

// ============================================================================
// DISK BO'LAK KESHI (Cache Storage) + 20 MB READ-AHEAD
// ============================================================================
//
// G'OYA (WebK'dan olingan)
//   Har bir yuklangan 512 KB bo'lak brauzer diskiga (Cache Storage) yoziladi.
//   Foydalanuvchi videoni qayta ochganda, orqaga qaytganda yoki sahifani
//   yangilaganda baytlar Telegram'dan EMAS, lokal keshdan keladi. R2
//   yoqilmagan bo'lsa ham bu "0 ms" effekt beradi.
//
// QOIDALAR
//   * Kalit: `doc/offset/limit`, va `offset` HAR DOIM CHUNK ga tekislangan
//     (grid). Tekislanmasa bir so'rov yozgan kalitni boshqasi topa olmasdi —
//     kesh hech qachon "urilmasdi".
//   * `doc` bo'lmasa (yoki `Save-Data: on`) kesh UMUMAN ishlamaydi —
//     eski xatti-harakat o'zgarishsiz qoladi.
//   * Faqat TO'LIQ bo'lak yoziladi; qisqa/uzilgan javob yozilmaydi.
//   * Video oxirigacha ko'rilsa — o'sha videoning keshi DARHOL o'chadi.
//   * 1 GB ga yaqinlashsa (850 MB) — uzoq ko'rilmagan videolar butunlay
//     o'chiriladi; 24 soatdan eski yozuvlar ham.
//   * `put` dan oldin baytdan NUSXA olinadi — keyingi esds tuzatish keshdagi
//     asl nusxani buzmaydi.
//
// READ-AHEAD (20 MB mobil / 48 MB Wi-Fi)
//   WebK kabi: pleer hozir turgan joydan oldinga bo'laklar fonda
//   yuklanadi va diskka yoziladi. Foydalanuvchi seek qilganda yoki oldinga
//   o'tsa — baytlar allaqachon tayyor. Yuklash `queue` bo'sh bo'lganda
//   (ya'ni pleer kutayotganda emas) ketadi, shuning uchun joriy oqimni
//   sekinlashtirmaydi.
// ============================================================================
const CACHE_NAME = 'wctg-chunks-v1';
const CACHE_TTL = 24 * 60 * 60 * 1000;        // 24 soat
const CACHE_MAX = 1024 * 1024 * 1024;         // 1 GB (kvota 55% dan oshmaydi)
const CACHE_MAX_KEYS = 4096;
const PRUNE_AT = 0.85;                        // 850 MB dan oshsa tozalash boshlanadi
// Read-ahead ikki xil: mobil internetda tejamkor, Wi-Fi'da saxiy.
// Wi-Fi'da 48 MB oldindan tayyor turishi yuqori RTT'da qotishlarni yo'q qiladi.
const READAHEAD_SLOW = 20 * 1024 * 1024;      // 20 MB (cellular / noma'lum)
const READAHEAD_FAST = 48 * 1024 * 1024;      // 48 MB (Wi-Fi / ethernet)
const INFLIGHT = new Map();                   // kalit -> Promise (ikki marta yuklamaslik)
const PF = { doc: '', cursor: 0, active: 0 };// read-ahead holati

let CACHE_OK = (typeof caches !== 'undefined');
let CACHE_FULL = false;                       // kvota 55% dan oshdi — yangi yozuv to'xtaydi
const DOC_AT = new Map();                     // doc -> oxirgi yozilgan vaqt (LRU)

// Kesh kalitidan hujjat id'sini ajratib olamiz.
function docOfKey(key) {
  const base = self.location.origin + '/__wctg/chunk/';
  if (key.indexOf(base) !== 0) return '';
  return key.slice(base.length).split('/')[0] || '';
}
let LAST_PRUNE = 0;
let CACHE_HITS = 0;
let CACHE_PUTS = 0;

function chunkKey(doc, off, len) {
  return self.location.origin + '/__wctg/chunk/' + doc + '/' + off + '/' + len;
}

async function cacheGet(key) {
  if (!CACHE_OK) return null;
  try {
    const cache = await caches.open(CACHE_NAME);
    const res = await cache.match(key);
    if (!res) return null;
    const at = Number(res.headers.get('X-WC-At')) || 0;
    if (at && (Date.now() - at) > CACHE_TTL) {
      cache.delete(key).catch(noop);
      return null;
    }
    const buf = await res.arrayBuffer();
    if (!buf || !buf.byteLength) return null;
    CACHE_HITS++;
    return new Uint8Array(buf);
  } catch (e) {
    return null;
  }
}

// Diskda joy bormi? (kvota 55% dan oshsa yozmaymiz)
async function cacheBudgetOk() {
  try {
    if (!navigator.storage || !navigator.storage.estimate) return true;
    const est = await navigator.storage.estimate();
    if (!est || !est.quota) return true;
    return (est.usage || 0) < est.quota * 0.55;
  } catch (e) {
    return true;
  }
}

function cachePut(key, u8) {
  if (!CACHE_OK || !u8 || !u8.length) return;
  (async function () {
    try {
      if (!(await cacheBudgetOk())) { CACHE_FULL = true; return; }
      CACHE_FULL = false;
      const body = new Response(u8.slice(), {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(u8.length),
          'X-WC-At': String(Date.now()),
          'X-WC-Len': String(u8.length)
        }
      });
      const cache = await caches.open(CACHE_NAME);
      await cache.put(key, body);
      CACHE_PUTS++;
      const dk = docOfKey(key);
      if (dk) DOC_AT.set(dk, Date.now());
      maybePrune();
    } catch (e) {
      /* kvota to'ldi yoki boshqa xato — oqimga ta'sir qilmaydi */
    }
  })();
}

function maybePrune() {
  const now = Date.now();
  if (now - LAST_PRUNE < 60 * 1000) return;        // 1 daqiqada bir marta
  LAST_PRUNE = now;
  pruneCache().catch(noop);
}

// Keshni HUJJAT (video) bo'yicha tozalash.
//
// QOIDALAR
//   1) Bitta video oxirigacha ko'rildi — uning keshi DARHOL butunlay o'chadi
//      (sahifa `ended` da `{type:'drop', doc}` yuboradi). Qayta bosilsa,
//      video yangidan ochiladi.
//   2) Umumiy hajm 1 GB ga yaqinlashsa (850 MB) — eng uzoq vaqt
//      "ko'rilmagan" videolar butunlay o'chiriladi. Hozir o'ynalayotgan
//      video hech qachon o'chirilmaydi.
//   3) 24 soatdan eski yozuvlar baribir o'chadi.
//
// NIMA UCHUN HUJJAT BO'YICHA
//   Ilgari eng eski BO'LAKLAR o'chirilardi: natijada yarim film keshi qolib,
//   foydasi bo'lmay qolardi. Endi butun video bo'yicha — kesh mantiqiy
//   tozalanadi va joy bo'shaydi.
async function dropDoc(doc) {
  if (!CACHE_OK || !doc) return 0;
  const prefix = self.location.origin + '/__wctg/chunk/' + doc + '/';
  const cache = await caches.open(CACHE_NAME);
  const keys = await cache.keys();
  let n = 0;
  for (let i = 0; i < keys.length; i++) {
    if (keys[i].url.indexOf(prefix) !== 0) continue;
    try { await cache.delete(keys[i]); n++; } catch (e) { /* o'tkazamiz */ }
  }
  DOC_AT.delete(doc);
  if (PF.doc === doc) { PF.doc = ''; PF.cursor = 0; }
  if (SF.doc === doc) { SF.doc = ''; SF.cursor = 0; }
  return n;
}

async function pruneCache() {
  if (!CACHE_OK) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    const keys = await cache.keys();
    if (!keys.length) return;

    const base = self.location.origin + '/__wctg/chunk/';
    const byDoc = new Map();          // doc -> { bytes, keys: [] }
    let total = 0;

    // `keys()` narxi arzon: bayt hajmini URL'dagi `len` dan olamiz —
    // har bir kalit uchun `match()` qilish (eski usul) ancha qimmat edi.
    for (let i = 0; i < keys.length; i++) {
      const u = keys[i].url;
      if (u.indexOf(base) !== 0) continue;
      const p = u.slice(base.length).split('/');
      const doc = p[0] || '';
      const len = Number(p[2]) || 0;
      let e = byDoc.get(doc);
      if (!e) { e = { bytes: 0, keys: [] }; byDoc.set(doc, e); }
      e.bytes += len;
      e.keys.push(keys[i]);
      total += len;
    }
    if (!byDoc.size) return;

    const now = Date.now();

    // Hozir o'ynalayotgan / yozilayotgan hujjatga tegilmaydi.
    function keep(doc, at) {
      if (doc && (doc === PF.doc || doc === SF.doc)) return true;
      return !!at && (now - at) < 3 * 60 * 1000;    // yaqinda ko'rilgan
    }

    // Eng eski (uzoq ko'rilmagan) hujjat birinchi turadi.
    const docs = [];
    byDoc.forEach(function (e, doc) {
      docs.push({ doc: doc, bytes: e.bytes, at: DOC_AT.get(doc) || 0 });
    });
    docs.sort(function (a, b) { return a.at - b.at; });

    for (let i = 0; i < docs.length; i++) {
      const d = docs[i];
      const expired = !!d.at && (now - d.at) > CACHE_TTL;
      const needRoom = total > CACHE_MAX * PRUNE_AT;
      if (!expired && !needRoom) break;             // qolganlari yangiroq
      if (keep(d.doc, d.at)) continue;

      const e = byDoc.get(d.doc);
      for (let k = 0; k < e.keys.length; k++) {
        try { await cache.delete(e.keys[k]); } catch (err) { /* o'tkazamiz */ }
      }
      total -= e.bytes;
      DOC_AT.delete(d.doc);
      byDoc.delete(d.doc);
      if (total <= 0) break;
    }

    // Kalit soni ham chegarada tursin (juda ko'p kichik fayl bo'lsa).
    let liveKeys = 0;
    byDoc.forEach(function (e) { liveKeys += e.keys.length; });
    if (liveKeys > CACHE_MAX_KEYS) {
      for (let i = 0; i < docs.length && liveKeys > CACHE_MAX_KEYS; i++) {
        const d = docs[i];
        if (!byDoc.has(d.doc) || keep(d.doc, d.at)) continue;
        const e = byDoc.get(d.doc);
        for (let k = 0; k < e.keys.length; k++) {
          try { await cache.delete(e.keys[k]); } catch (err) { /* o'tkazamiz */ }
        }
        liveKeys -= e.keys.length;
        byDoc.delete(d.doc);
      }
    }
  } catch (e) {
    /* kesh tozalash hech qachon oqimni buzmasligi kerak */
  }
}

// Grid bo'lagini o'qish: avval diskdan, keyin PREFIKSDAN (R2 yoki mahalliy
// disk), bo'lmasa sahifadan (Telegram). Bir xil bo'lak ikki joydan parallel
// so'ralsa — `INFLIGHT` birlashtiradi.
//
// `size` — fayl hajmi (ixtiyoriy): berilsa prefiks manbasidan (bosh 4 MB va
// oxiridagi `moov` oynasi) o'qishga urinamiz. Aynan shu narsa begona DC'dagi
// (dc=4) videolarni ham bir zumda ochadi: bosh va dum bizning serverdan,
// qolgani Telegram'dan.
async function readWindow(doc, off, len, size) {
  if (!doc || !CACHE_OK) return toU8(await readFromPage(off, len));

  const key = chunkKey(doc, off, len);
  const hit = await cacheGet(key);
  if (hit && hit.length === len) return hit;
  if (hit && hit.length) return hit;                 // qisqa bo'lsa ham ishlatamiz

  let p = INFLIGHT.get(key);
  if (p) return p;

  p = (async function () {
    // Prefiks (R2 yoki mahalliy `storage/prefix`) — Telegram'ga chiqmasdan.
    // Faqat sozlama ALLAQACHON ma'lum bo'lsa: birinchi baytni 500 ms
    // kutdirmaymiz (sahifa `r2info` ni oldindan yuboradi).
    if (size > 0 && R2_INFO && R2_INFO.enabled) {
      try {
        const pre = await r2Range(doc, off, off + len, size, R2_INFO);
        if (pre && pre.length === len) {
          cachePut(key, pre);
          return pre;
        }
      } catch (e) { /* prefiks yordamchi — Telegram davom etadi */ }
    }
    const u8 = toU8(await readFromPage(off, len));
    if (u8.length === len) cachePut(key, u8);
    return u8;
  })();


  INFLIGHT.set(key, p);
  p.then(function () { if (INFLIGHT.get(key) === p) INFLIGHT.delete(key); },
         function () { if (INFLIGHT.get(key) === p) INFLIGHT.delete(key); });
  return p;
}

// Oldinga qarab bo'laklarni fonda yuklab, diskka yozib qo'yamiz.
// `off`  — produktor qayerrgacha o'qigan
// `sent` — pleerga qayerrgacha berilgan
// Maqsad: `sent + 20 MB` gacha tayyor bo'lsin. Navbat (RAM) to'la bo'lsa
// produktor baribir kutadi, shuning uchun bu yerda qo'shimcha yuk sezilmaydi.
function maybePrefetch(doc, size, off, sent) {
  if (!doc || !CACHE_OK || !size) return;

  // Wi-Fi'da ko'proq: 48 MB oyna va 3 ta parallel bo'lak.
  const readAhead = SEED_OK ? READAHEAD_FAST : READAHEAD_SLOW;
  const lanes = SEED_OK ? 3 : 2;

  // Kichik fayl (reel/epizod) fonda to'liq yozilsin — keyingi ochilish 0 ms.
  seedWholeFile(doc, size);

  if (PF.active >= lanes) return;

  // Bo'lak chegarasiga yuqoriga tekislaymiz.
  const startW = Math.ceil(off / CHUNK) * CHUNK;
  const endW = Math.min(size, sent + readAhead);
  if (startW >= endW) return;

  if (PF.doc !== doc) { PF.doc = doc; PF.cursor = startW; }
  if (PF.cursor < startW) PF.cursor = startW;
  if (PF.cursor >= endW) return;

  const w = PF.cursor;
  const len = Math.min(CHUNK, size - w);
  if (len <= 0) return;
  PF.cursor = w + len;

  const key = chunkKey(doc, w, len);
  if (INFLIGHT.has(key)) return;

  PF.active++;
  readWindow(doc, w, len, size).then(noop, noop).then(function () { PF.active--; });
}

// ============================================================================
// KICHIK FAYLLARNI TO'LIQ KESHLASH (faqat tez/arzon tarmoqda)
// ============================================================================
//
// NIMA UCHUN
//   Reels va qisqa epizodlar ko'pincha 5–80 MB. Wi-Fi'da ularni BIR MARTA
//   to'liq diskka yozib qo'ysak, qayta ochilganda Telegram'ga umuman murojaat
//   bo'lmaydi — video bir zumda boshlanadi (yirik klientlarning IndexedDB
//   keshi ham shu usulda ishlaydi). Katta filmlar (320 MB+) bu yerga
//   kirmaydi: 1 GB kesh bitta faylga to'lib, boshqa videolar sekinlashardi.
//
// XAVFSIZLIK
//   * Faqat `SEED_OK` (Wi-Fi/ethernet, Save-Data yo'q) — mobil trafik yemaydi.
//   * `CACHE_FULL` (kvota 55%) bo'lsa darhol to'xtaydi.
//   * Bir vaqtda faqat 1 ta bo'lak va faqat read-ahead bo'sh turganda —
//     pleerning joriy oqimidan hech narsa tortib olmaydi.
const SEED_FILE_MAX = 320 * 1024 * 1024;      // 320 MB
const SF = { doc: '', cursor: 0, active: 0 }; // to'liq keshlash holati

function seedWholeFile(doc, size) {
  if (!doc || !size || !CACHE_OK) return;
  if (!SEED_OK || CACHE_FULL) return;
  if (size > SEED_FILE_MAX) return;
  if (PF.active > 0) return;                   // pleer kutmayotgan paytda ishlaymiz

  if (SF.doc !== doc) { SF.doc = doc; SF.cursor = 0; SF.active = 0; }
  if (SF.active >= 1) return;
  if (SF.cursor >= size) return;

  const w = SF.cursor;
  const len = Math.min(CHUNK, size - w);
  SF.cursor = w + len;
  SF.active++;

  // `readWindow` avval keshni tekshiradi — allaqachon yozilgan bo'lsa
  // tarmoqqa chiqmaydi, shuning uchun bu qadam deyarli bepul.
  readWindow(doc, w, len, size).then(noop, noop).then(function () { SF.active--; });
}

// ============================================================================
// R2 PREFIKS KESHI (ixtiyoriy)
// ============================================================================
//
// G'OYA
//   Har bir videoning birinchi ~5 MB i Cloudflare R2 da turadi. Foydalanuvchi
//   video ochganda baytlar R2 dan (Toshkent PoP, ~20–60 ms) keladi, Telegram
//   DC gacha bo'lgan 200–600 ms kutish YO'Q. Qolgan qism avvalgidek Telegram
//   orqali oqadi — pleer uchun bu AYNAN bir xil fayl, hech qanday manba
//   almashtirish yo'q.
//
// XAVFSIZLIK / BARQARORLIK
//   - Serverda `R2_ENABLED=0` bo'lsa `api/r2-sign.php?info=1` "enabled:false"
//     qaytaradi va bu blok UMUMAN ishlamaydi (eski yo'l o'zgarishsiz).
//   - R2 javob bermasa 60 soniya davomida urinmaymiz (circuit breaker) —
//     sekin R2 butun saytni sekinlashtirmaydi.
//   - Prefiks uzunligi HAR DOIM 4096 ga karrali: Telegram davomi shu
//     chegaradan boshlanadi, aks holda `LIMIT_INVALID` bo'lardi.
//   - R2 dan kelgan baytlar fayldan katta bo'lsa — ishonmaymiz, tashlaymiz.
// ============================================================================
let R2_INFO = null;                  // { enabled, base, prefix, put }
let R2_INFO_AT = 0;                  // qachon olingan (ms)
let R2_INFO_P = null;                // parallel so'rovni birlashtirish
let R2_DEAD_UNTIL = 0;               // shu vaqtgacha R2 ga murojaat yo'q
let SEED_OK = false;                 // sahifa "yuklash mumkin" dedi (Wi-Fi)
const R2_INFO_TTL = 5 * 60 * 1000;
// Birinchi baytni `api/r2-sign.php` javobiga qarab KUTDIRMAYMIZ. Sahifa
// sozlamani oldindan yuborsa (odatiy hol) bu kutish umuman bo'lmaydi.
const R2_INFO_WAIT = 700;            // ms — info kelmasa Telegram darhol boshlanadi
// Prefiksi yo'q hujjatlar uchun 5 daqiqa CDN'ga qayta murojaat qilmaymiz:
// aks holda har seek'da 404 olib, foydasiz RTT qo'shilardi.
const R2_MISS = new Map();           // doc -> vaqtgacha (ms)
const R2_MISS_TTL = 5 * 60 * 1000;

function r2ApiUrl(qs) {
  try {
    return new URL('api/r2-sign.php' + (qs || ''), self.registration.scope).toString();
  } catch (e) {
    return '';
  }
}

function r2Missed(doc) {
  const until = R2_MISS.get(String(doc)) || 0;
  return until > Date.now();
}

function r2MarkMiss(doc) {
  R2_MISS.set(String(doc), Date.now() + R2_MISS_TTL);
  if (R2_MISS.size > 512) {                    // xotira chegarasi
    const now = Date.now();
    R2_MISS.forEach(function (v, k) { if (v <= now) R2_MISS.delete(k); });
  }
}

// Server javobini tekshirib, ichki ko'rinishga keltiradi (yaroqsiz — null).
//
// `base` ikki xil bo'lishi mumkin:
//   * statik prefiks obyekti — `https://cdn.../p` (unga `/<doc>` qo'shiladi);
//   * SHABLON — `https://sayt/api/prefix.php?doc={doc}&exp=…&sig=…`, unda
//     `{doc}` o'rniga hujjat id'si qo'yiladi (mahalliy prefiks serveri).
// `tail` — fayl OXIRIDAGI alohida saqlangan qism (MP4 `moov` indeksi)
// qayerdan boshlanishi: `size - tail` (R2 obyekti uchun 0).
function r2Normalize(j) {
  if (!j || typeof j !== 'object') return null;
  if (!j.enabled) return { enabled: false, base: '', tpl: false, prefix: 0, tail: 0, put: false };
  if (!j.base) return null;
  const raw = String(j.base);
  const tpl = raw.indexOf('{doc}') >= 0;
  let base;
  try {
    const probe = tpl ? raw.split('{doc}').join('0') : raw;
    const u = new URL(probe, self.location.origin);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (tpl) base = raw.replace(/\/+$/, '');
    else base = u.toString().replace(/\/+$/, '');
  } catch (e) {
    return null;
  }
  let docs = null;
  if (j.docs && typeof j.docs === 'object') {
    docs = {};
    let n = 0;
    for (const k in j.docs) {
      if (!Object.prototype.hasOwnProperty.call(j.docs, k)) continue;
      const e = j.docs[k];
      if (!e || typeof e !== 'object') continue;
      docs[String(k)] = {
        head: Math.max(0, Math.floor(Number(e.head) || 0)),
        tail: Math.max(0, Math.floor(Number(e.tail) || 0))
      };
      if (++n >= 1000) break;                     // xotira chegarasi
    }
  }
  return {
    enabled: true,
    base: base,
    tpl: tpl,
    prefix: Math.max(0, Math.floor(Number(j.prefix) || 0)),
    tail: Math.max(0, Math.floor(Number(j.tail) || 0)),
    docs: docs,
    put: !!j.put
  };
}

// Sahifa yuborgan sozlama (`{type:'r2info'}`) — birinchi bayt yo'lidagi
// `api/r2-sign.php?info=1` so'rovini yo'q qiladi.
function r2AcceptInfo(j) {
  const info = r2Normalize(j);
  if (!info) return false;
  R2_INFO = info;
  R2_INFO_AT = Date.now();
  return true;
}

// Server sozlamasini bir marta so'rab, 5 daqiqa eslab qolamiz.
function r2Info(force) {
  const now = Date.now();
  if (!force && R2_INFO && (now - R2_INFO_AT) < R2_INFO_TTL) {
    return Promise.resolve(R2_INFO);
  }
  if (R2_INFO_P) return R2_INFO_P;

  const url = r2ApiUrl('?info=1');
  if (!url) return Promise.resolve({ enabled: false });

  R2_INFO_P = (async function () {
    let info = { enabled: false };
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(function () { ctrl.abort(); }, 1800);
      const res = await fetch(url, {
        credentials: 'same-origin',
        cache: 'default',
        signal: ctrl.signal
      });
      clearTimeout(timer);
      if (res.ok) {
        const j = await res.json();
        info = r2Normalize(j) || { enabled: false };
      }
    } catch (e) {
      info = { enabled: false };
    }
    R2_INFO = info;
    R2_INFO_AT = Date.now();
    R2_INFO_P = null;
    return info;
  })();

  return R2_INFO_P;
}

// Keshda bo'lsa — darhol; bo'lmasa ko'pi `ms` kutamiz (null = noma'lum).
// `null` bo'lsa bu safar R2 chetlab o'tiladi, lekin so'rov fonda davom
// etadi va keyingi Range so'rovlari R2 dan xizmat qilinadi.
function r2InfoSoon(ms) {
  if (R2_INFO) return Promise.resolve(R2_INFO);
  return new Promise(function (resolve) {
    let done = false;
    const t = setTimeout(function () {
      if (done) return;
      done = true;
      resolve(null);
    }, Math.max(0, Number(ms) || 0));
    r2Info(false).then(function (info) {
      if (done) return;
      done = true;
      clearTimeout(t);
      resolve(info || null);
    }, function () {
      if (done) return;
      done = true;
      clearTimeout(t);
      resolve(null);
    });
  });
}

function r2ObjUrl(info, doc) {
  const id = encodeURIComponent(String(doc));
  if (info && info.tpl) return info.base.split('{doc}').join(id);
  return info.base + '/p/' + id;
}

// Hujjat uchun prefiks hududlari. `null` — bu hujjatga prefiks YO'Q.
//
// `docs` xaritasi (mahalliy rejim) bo'lsa — undan aniq javob olamiz, ya'ni
// mavjud bo'lmagan hujjat uchun umuman HTTP so'rov yubormaymiz (404 RTT
// birinchi bayt yo'lida keraksiz). R2 obyekt rejimida `docs` yo'q — barcha
// hujjatlar uchun yagona `prefix` ishlatiladi.
function r2DocInfo(info, doc) {
  if (!info || !info.enabled) return null;
  if (!info.docs) {
    if (!info.prefix) return null;
    return { head: info.prefix, tail: Math.max(0, Number(info.tail) || 0) };
  }
  const e = info.docs[String(doc)];
  if (!e) return null;
  return {
    head: Math.max(0, Math.floor(Number(e.head) || 0)),
    tail: Math.max(0, Math.floor(Number(e.tail) || 0))
  };
}

// Mahalliy keshinga dum (`moov`) oynasini yozish kerakmi? Real R2 da bitta
// obyekt bor — alohida dum yozuvi yo'q, shuning uchun faqat `docs` xaritasi
// (mahalliy rejim) uchun tekshiramiz.
function pxNeedTailSeed(doc) {
  if (!SEED_OK || !R2_INFO || !R2_INFO.enabled || !R2_INFO.put) return false;
  if (!R2_INFO.docs) return false;
  const e = R2_INFO.docs[String(doc)];
  return !e || !(Number(e.tail) > 0);
}

// R2 dan prefiksni OQIB, `push` orqali navbatga beradi.
// Qaytaradi: nechta bayt berildi (4096 ga karrali, 0 = R2 ishlamadi).
//
// Diqqat: bu yerda to'liq prefiks kutib turmaymiz — birinchi bo'lak kelishi
// bilan navbatga qo'yiladi. Shu sababli birinchi kadr juda tez chiqadi.
//
// `known` — yuqorida olingan R2 sozlamasi (bo'lsa qayta so'ramaymiz).
async function r2PrefixInto(doc, size, push, known) {
  if (!doc || size < 2 * 1024 * 1024) return 0;
  if (Date.now() < R2_DEAD_UNTIL) return 0;
  if (r2Missed(doc)) return 0;

  const info = known || await r2InfoSoon(R2_INFO_WAIT);
  const di = r2DocInfo(info, doc);
  if (!di || !di.head) return 0;

  const target = Math.min(di.head, size) - (Math.min(di.head, size) % 4096);
  if (target < 4096) return 0;

  const ctrl = new AbortController();
  let timer = setTimeout(function () { ctrl.abort(); }, 1200);   // birinchi bayt
  let got = 0;
  let pending = new Uint8Array(0);
  let stopped = false;
  let missing = false;

  function feed(u8) {
    if (stopped || !u8 || !u8.length) return;
    const joined = new Uint8Array(pending.length + u8.length);
    joined.set(pending, 0);
    joined.set(u8, pending.length);
    pending = joined;

    let usable = pending.length - (pending.length % 4096);
    if (usable > target - got) usable = target - got;
    usable -= usable % 4096;
    if (usable <= 0) return;

    const out = pending.subarray(0, usable);
    push(out);
    got += usable;
    pending = pending.subarray(usable);
    if (got >= target) stopped = true;
  }

  try {
    const res = await fetch(r2ObjUrl(info, doc), {
      mode: 'cors',
      credentials: 'omit',
      cache: 'force-cache',
      signal: ctrl.signal
    });
    if (res.status === 404) { missing = true; throw new Error('HTTP 404'); }
    if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);

    // Obyekt fayldan katta bo'lishi mumkin emas. Kichikroq bo'lsa (masalan
    // `R2_PREFIX_BYTES` keyin kamaytirilgan) — shuncha baytni olamiz.
    const len = Number(res.headers.get('Content-Length')) || 0;
    if (len && len > size) {
      throw new Error('prefiks hajmi mos emas');
    }

    const reader = res.body.getReader();
    while (!stopped) {
      const r = await reader.read();
      if (r.done) break;
      clearTimeout(timer);
      timer = setTimeout(function () { ctrl.abort(); }, 20000);    // oqim to'xtadi
      feed(r.value);
    }
    clearTimeout(timer);
    try { await reader.cancel(); } catch (e) { /* allaqachon yopilgan */ }
  } catch (e) {
    clearTimeout(timer);
    if (missing) {
      // Bu hujjat uchun prefiks yuklanmagan — 5 daqiqa qayta so'ramaymiz.
      r2MarkMiss(doc);
    } else if (got === 0) {
      // R2 umuman ishlamadi — bir daqiqa bezovta qilmaymiz.
      R2_DEAD_UNTIL = Date.now() + 60000;
      return 0;
    }
    // Qisman keldi — shu joydan Telegram davom ettiradi.
  }

  return got;
}

// Range so'rovi prefiks hududida bo'lsa — prefiks manbasidan aniq oraliqni olamiz.
//
// Ikki hudud bor:
//   * BOSH — [0, prefix): fayl sarlavhasi (`ftyp`/`mdat` boshi);
//   * DUM  — [size - tail, size): MP4 `moov` indeksi. Telegram fayllari
//     "faststart" EMAS (indeks oxirida) — aynan shu qism birinchi kadrni
//     belgilaydi, shuning uchun u ham mahalliy bo'lishi kerak.
// Qolgan oraliqlar avvalgidek Telegram'dan keladi.
// `end` — EKSKLUZIV (`readWindow` va brauzer Range so'rovi bilan bir xil).
async function r2Range(doc, start, end, size, known) {
  if (!doc) return null;
  if (Date.now() < R2_DEAD_UNTIL) return null;
  if (r2Missed(doc)) return null;

  // `known` bo'lsa — kutmaymiz (birinchi bayt yo'li). Aks holda 500 ms.
  const info = known || await r2InfoSoon(500);
  const di = r2DocInfo(info, doc);
  if (!di || !di.head) return null;

  size = Math.max(0, Number(size) || 0);
  if (size && start >= size) return null;

  let last;
  if (start < di.head) {
    // Bosh prefiks ichida boshlanadi: davomi Telegram'da.
    last = Math.min(end, di.head, size || end) - 1;
  } else {
    const tailStart = di.tail > 0 ? Math.max(0, size - di.tail) : size;
    if (!di.tail || start < tailStart) return null;
    // Dum oynasi: [tailStart, size).
    last = Math.min(end, size) - 1;
  }
  if (last < start) return null;

  try {
    const ctrl = new AbortController();
    // 512 KB bo'lak: R2 edge'da ~50–200 ms, o'z serverimizda ham shunga yaqin.
    // 2.5 s — yuklama ostidagi sekin javobni ham qoplaydi; undan keyin
    // Telegram'ga o'tamiz (u HAR QANDAY holatda sekinroq).
    const timer = setTimeout(function () { ctrl.abort(); }, 2500);
    const res = await fetch(r2ObjUrl(info, doc), {
      mode: 'cors',
      credentials: 'omit',
      cache: 'force-cache',
      headers: { 'Range': 'bytes=' + start + '-' + last },
      signal: ctrl.signal
    });
    clearTimeout(timer);
    if (res.status === 404) { r2MarkMiss(doc); return null; }
    if (res.status === 416) return null;          // prefiks tugadi — Telegram
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const u8 = new Uint8Array(buf);
    if (!u8.length) return null;
    return u8;
  } catch (e) {
    // Tarmoq xatosi / kutish tugadi — 30 soniya R2 ni chetlab o'tamiz.
    R2_DEAD_UNTIL = Date.now() + 30000;
    return null;
  }
}

// Telegram'dan o'qilgan prefiksni R2 ga yozish (cache-aside).
// Faqat sahifa `seed` ruxsatini bergan bo'lsa va foydalanuvchi login
// qilgan bo'lsa ishlaydi (imzoni server beradi).
function r2Seed(doc, size, parts, bytes, part) {
  const kind = part === 'tail' ? 'tail' : 'head';
  if (!SEED_OK || !doc || !bytes) return;
  if (bytes < 1024 * 1024) return;                  // juda kichik — foydasi yo'q

  (async function () {
    try {
      const signUrl = r2ApiUrl('?doc=' + encodeURIComponent(String(doc))
        + '&size=' + encodeURIComponent(String(size)));
      if (!signUrl) return;
      const sres = await fetch(signUrl, { credentials: 'same-origin', cache: 'no-store' });
      if (!sres.ok) return;
      const j = await sres.json();
      if (!j || !j.enabled || !j.put) return;

      const body = new Blob(parts, { type: 'video/mp4' });
      if (body.size < 1024 * 1024) return;

      // R2 da bitta obyekt bor; mahalliy keshda bosh va dum alohida fayllar.
      const url = kind === 'tail' ? (j.putTail || j.put) : j.put;
      const pres = await fetch(url, {
        method: 'PUT',
        body: body,
        credentials: 'omit',
        mode: 'cors',
        headers: { 'Content-Type': 'video/mp4' }
      });
      if (pres.ok) {
        say('⬆ prefiks saqlandi (' + kind + ' '
          + (body.size / 1048576).toFixed(1) + ' MB)');
      }
    } catch (e) {
      /* jim — bu fon vazifasi, oqimga ta'sir qilmaydi */
    }
  })();
}

const STATS = { requests: 0, bytes: 0, seeks: 0, par: 0, r2: 0 };
let PROVIDES = 0;                    // sahifa necha marta "ulangan" — diagnostika

// Sahifadagi log oynasiga xabar yuborish (diagnostika)
function say(msg) {
  self.clients.matchAll()
    .then((list) => {
      for (const c of list) c.postMessage({ type: 'log', msg: msg });
    })
    .catch(() => { /* sahifa yopilgan bo'lishi mumkin */ });
}
// Sahifaga statistika yuborish (o'lchov / QA).
//
// Ishlab chiqarishda bu deaktiv (faqat `?wcperf=1` rejimida yoqiladi).
// Sahifa tomonda `window.__wcPerf` ga yig'iladi.
function stats(patch) {
  const d = Object.assign({
    requests: STATS.requests,
    bytes: STATS.bytes,
    seeks: STATS.seeks,
    par: STATS.par,
    r2: STATS.r2,
    cache: CACHE_HITS,
    stored: CACHE_PUTS,
    chunk: CHUNK,
    net: NET_HINT.effectiveType || ''
  }, patch || {});
  self.clients.matchAll()
    .then((list) => {
      for (const c of list) c.postMessage({ type: 'stats', stats: d });
    })
    .catch(() => { /* sahifa yopilgan bo'lishi mumkin */ });
}

// "Qayta ulan" degan murojaat: SW'ning xotirasi bo'shaganda chaqiriladi.
function askForProvider() {
  self.clients.matchAll()
    .then((list) => {
      for (const c of list) c.postMessage({ type: 'needProvider' });
    })
    .catch(() => { /* sahifa yopilgan bo'lishi mumkin */ });
}

// ---------------------------------------------------------------------- lifecycle
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async function () {
  // Yangi versiya faollashganda eskirgan bo'laklarni darhol tozalaymiz.
  LAST_PRUNE = 0;
  maybePrune();
  await self.clients.claim();
})()));

// ---------------------------------------------------------------------- xabarlar
self.addEventListener('message', (e) => {
  const d = e.data || {};

  // --- Sahifaga o'zimizni yetkaz (claim) ------------------------------
  //
  // Nima uchun? `activate` da `clients.claim()` bor, lekin agar sahifa
  // SW faollashgandan KEYIN yuklansa, `activate` hodisasi o'tib ketgan
  // bo'ladi va sahifa hech qachon boshqarilmay qoladi. Bu holatda
  // `<video>` so'rovi butunlay serverga (404) ketadi.
  //
  // Shuning uchun sahifa istalgan payt `claim` so'raydi — bu har doim
  // ishlaydi va ishonchli.
  if (d.type === 'claim') {
    if (e.waitUntil) e.waitUntil(self.clients.claim());
    return;
  }

  // --- Sahifa o'zini javobgar deb e'lon qildi ------------------------
  if (d.type === 'provide') {
    // Muhim: bu yerda KUTAYOTGAN so'rovlarni rad etmASLIK kerak.
    // `provide` xabari tez-tez keladi (SW yangilandi, SW qayta ishga
    // tushdi, sahifa qayta ulandi) — va u har kelganida yana keladigan
    // so'rovlarni ham yopib qo'yishi kerak edi. Aksincha: eski portni
    // yopamiz, yangisini olamiz, davom etayotgan so'rovlarga tegmaymiz.
    const old = provider;
    provider = e.ports && e.ports[0];
    if (old && old !== provider) {
      try { old.close(); } catch (err) { /* allaqachon yopilgan */ }
    }
    applyNetHint(d.net);
    PROVIDES++;
    say('Sahifa javobgar bo\'ldi · fayl hajmi: ' + d.size + ' bayt'
      + (PROVIDES > 1 ? ' · #' + PROVIDES + '-ulash' : ''));
    return;
  }

  // --- Sahifa "prefiksni R2 ga yuklash mumkin" dedi -------------------
  //
  // Nima uchun sahifa hal qiladi: mobil internetda 5 MB yuklash
  // foydalanuvchining trafigini yeydi. Sahifa Wi-Fi/ethernet va
  // `saveData` yo'qligini biladi — shunda `ok:true` yuboradi.
  if (d.type === 'seed') {
    SEED_OK = !!d.ok;
    return;
  }

  // --- Sahifa R2 sozlamasini oldindan yubordi -------------------------
  //
  // Nima uchun: birinchi video so'rovi `api/r2-sign.php?info=1` javobini
  // KUTMASLIGI kerak. Sahifa o'zi (pleer ulanishidan ancha oldin) shu
  // JSON'ni bir marta olib, shu yerga uzatadi — SW keshida darhol tayyor.
  if (d.type === 'r2info') {
    r2AcceptInfo(d.info);
    return;
  }

  // --- Sahifa SQL keshidan MP4 indeks xaritasini yubordi ----------------
  // Issiq yo'lda SW bosh baytlarni o'qib moov o'rnini qidirish uchun
  // 1200 ms kutmaydi — koordinata tayyor holda keladi.
  if (d.type === 'index') {
    setIndexHint(String(d.doc || ''), Number(d.size), d.moov, d.kf, d.dur);
    return;
  }

  // --- Seek: keyframe jadvalidan eng yaqin ofsetniOLDINDAN o'qish --------
  // Pleer qayta qurilishni boshlashidan oldin keladi — shunda birinchi
  // keyframe oqimi Telegram'dan emas, SW keshidan olinadi.
  if (d.type === 'seekhint') {
    const sk = tailKey(String(d.doc || ''), Number(d.size));
    const ent = KF_MAP.get(sk);
    const t = Number(d.t);
    if (ent && ent.kf.length && Number.isFinite(t)) {
      let best = null;
      for (let i = 0; i < ent.kf.length; i++) {
        const p = ent.kf[i];
        if (!Array.isArray(p) || !Number.isFinite(p[1])) continue;
        if (p[0] <= t) best = p;
        else if (best === null) best = p;
        else break;
      }
      if (best) {
        const off = Math.max(0, Math.min(Number(best[1]) - (Number(best[1]) % CHUNK), Number(d.size) - 1));
        readWindow(String(d.doc || ''), off, Math.min(CHUNK, Number(d.size) - off), Number(d.size))
          .then(noop, noop);
      }
    }
    return;
  }

  // --- Video oxirigacha ko'rildi — uning keshini butunlay o'chiramiz ------
  //
  // Sahifa `<video>` `ended` bo'lganda yuboradi. Keshda yarim film qolib
  // joy egallamasin: qayta bosilsa video yangidan ochiladi.
  if (d.type === 'drop') {
    dropDoc(String(d.doc || '')).then(function (n) {
      if (n > 0) say('🗑 ko‘rildi · kesh tozalandi (' + n + ' bo‘lak)');
    }, noop);
    return;
  }

  // --- Fayl oxirini (MP4 indeksini) oldindan yuklash -------------------
  //
  // Sahifa filmni ochishdan OLDIN yuboradi (mount/prefetch paytida). Shu
  // tufayli brauzer `moov` ni so'raganda javob keshdan, bir zumda bo'ladi.
  // Ilgari prefetch faqat birinchi media-javob ichida boshlanardi — ya'ni
  // brauzer allaqachon kutib turgan paytda.
  if (d.type === 'warmtail') {
    // Prefiks sozlamasini HOZIR so'rab qo'yamiz: birinchi `readWindow`
    // (dum oynasi) `r2InfoSoon(500)` da kutmasin — javob keshda bo'ladi.
    r2Info(false).catch(noop);
    if (d.size > 0) prefetchTail(Number(d.size), String(d.doc || ''));
    return;
  }

  // --- So'rov natijasi keldi (sahifadan) -----------------------------
  if (d.type === 'result') {
    const i = waiting.findIndex((j) => j.id === d.id);
    if (i < 0) return;                       // kechikkan javob (bekor qilingan)
    const job = waiting.splice(i, 1)[0];
    clearTimeout(job.timer);
    if (d.error) job.reject(new Error(d.error));
    else job.resolve(d.bytes);
    return;
  }

  // --- Diagnostika ---------------------------------------------------
  if (d.type === 'stats') {
    const p = e.ports && e.ports[0];
    const s = 'so\'rov: ' + STATS.requests + ' · ' + (STATS.bytes / 1048576).toFixed(1)
      + ' MB · seek: ' + STATS.seeks + ' ta · parallel: ' + STATS.par
      + ' · ulash: ' + PROVIDES;
    say('📊 ' + s);
    if (p) p.postMessage({ type: 'stats', text: s });
  }
  if (d.type === 'reset') { STATS.requests = 0; STATS.bytes = 0; STATS.seeks = 0; STATS.par = 0; STATS.r2 = 0; }
});

// ------------------------------------------------------------- sahifadan bayt olish
// DIQQAT: har bir so'rov uchun ALOHIDA MessageChannel yaratamiz, chunki
// javobni qaytarish uchun port kerak — boshqalar chalkashmasligi uchun.
function readFromPage(offset, length) {
  return new Promise((resolve, reject) => {
    if (!provider) {
      // SW qayta ishga tushgan (brauzer bo'sh turgan SW'ni o'chirib
      // tashlaydi) va xotirasi bo'shgan. Darhol xato bermaslik uchun
      // kutamiz: sahifa `provide` xabarini yuborgach `provider` to'lib qoladi.
      //
      // 2.5 s chegarasi YETMAYDI: katta faylda brauzer o'nlab sekund
      // davomida so'rov yuboradi, SW esa shu paytda bo'sh bo'lsa
      // `NO_PROVIDER` butun o'ynashni birdan buzadi. 8 s kutamiz.
      const waitStart = Date.now();
      let lastAsk = 0;
      const iv = setInterval(() => {
        if (provider) {
          clearInterval(iv);
          readFromPage(offset, length).then(resolve, reject);
          return;
        }
        // Sahifaga yana murojaat qilamiz: "qayta ulan". Bitta marta so'rash
        // YETMAYDI — xabar navbatda turib qolishi mumkin, shuning uchun
        // har 700 ms da takrorlaymiz.
        const now = Date.now();
        if (now - lastAsk > 700) { lastAsk = now; askForProvider(); }
        if (now - waitStart > 8000) {
          clearInterval(iv);
          // Hali ham yo'q - so'rovni bekor qilamiz; <video> o'zi qayta
          // so'raydi.
          reject(new Error('NO_PROVIDER'));
        }
      }, 700);
      lastAsk = Date.now();
      askForProvider();
      return;
    }

    const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const chan = new MessageChannel();
    const timer = setTimeout(() => {
      const i = waiting.findIndex((j) => j.id === id);
      if (i >= 0) waiting.splice(i, 1);
      reject(new Error('Telegram 30 s ichida javob bermadi'));
    }, 30000);

    waiting.push({ id: id, resolve: resolve, reject: reject, timer: timer });

    // port1 -> sahifaga (javob uchun), port2 -> o'zimizda (natija uchun)
    chan.port1.onmessage = (ev) => {
      const r = ev.data || {};
      chan.port1.close();
      const i = waiting.findIndex((j) => j.id === id);
      if (i < 0) return;
      waiting.splice(i, 1);
      clearTimeout(timer);
      if (r.error) reject(new Error(r.error));
      else resolve(r.bytes);
    };

    try {
      provider.postMessage(
        { type: 'read', id: id, offset: offset, length: length },
        [chan.port2]
      );
    } catch (err) {
      const i = waiting.findIndex((j) => j.id === id);
      if (i >= 0) waiting.splice(i, 1);
      clearTimeout(timer);
      reject(new Error('sahifaga yetkazib bo\'lmadi: ' + err.message));
    }
  });
}

// ============================================================================
// Kerakli oraliqni yig'ish
// ============================================================================
//
// Telegram'dan bir so'rovda CHUNK baytdan ko'pi kelmaydi, lekin bizga bitta
// HTTP javobida ko'proqni qaytarish kerak bo'lishi mumkin (katta moov indeks
// holati). Shuning uchun keraklicha bo'laklarni yig'amiz.
//
// `size` - fayl hajmi. U kerak, chunki QISQA javob endi har doim ham
// "fayl tugadi" degani EMAS: sahifa 4096 ga tegilash uchun limitni yuqoriga
// tekislaydi va shuning uchun so'ramandek qaytaradi. EOF ni faqat haqiqiy
// fayl chegarasidan aniqlaymiz.
//
// ---------------------------------------------------------------------------
//  TEZLIK: PARALLEL O'QISH
// ---------------------------------------------------------------------------
//
// Avval har bir bo'lak KETMA-KET so'ranardi: bitta so'rov kelishini kutib,
// keyin keyingisini yuborish. Bu bitta RTT (round-trip time) da bitta bo'lak
// degani - ya'ni tezlik RTT ga bog'liq. 720p oqim uchun sekundiga ~1.5 MB
// kerak, bitta RTT esa odatda 60-150 ms. Ya'ni ketma-ket usul ko'pincha
// 4-10 MB/s dan oshmasligi mumkin edi.
//
// Endi bir vaqtda PARALLEL ta so'rov yuboramiz. Bu xuddi Telegram Desktop
// qiladigan narsa (u katta fayllar uchun 4 ta parallel ulanish ochadi), demak
// Telegram tomonida bu NORMAL va FLOOD_WAIT bermaydi.
//
// MUHIM: parallel usul "tez, lekin nozik" - bitta bo'lak xato bo'lsa butun
// guruh to'xtaydi. Shuning uchun parallel muvaffaqiyatsiz bo'lsa, ISHONCHLI
// ketma-ket usulga QAYTAMIZ. Olingan ma'lumot YO'QOLMAY, faqat qayta o'qiladi
// (bu holat kam uchraydi - 512 KB allaqachon ishlaydigan qiymat).
const PARALLEL = 4;

// Uint8Array ga aylantirish (MessagePort strukturaviy nusxa beradi)
function toU8(b) {
  return b instanceof Uint8Array ? b : new Uint8Array(b);
}

// Bo'laklarni bitta massivga yig'ish
function concat(parts, total) {
  if (parts.length === 1) return parts[0];
  const out = new Uint8Array(total);
  let p = 0;
  for (const u8 of parts) { out.set(u8, p); p += u8.length; }
  return out;
}

// Telegram bo'lak HAJMI bilan bog'liq xatoni rad etdimi?
function isSizeRejected(err) {
  const m = String((err && err.message) || '');
  return /LIMIT_INVALID|FILE_PART_TOO_BIG|REQUEST_LARGE_INVALID/.test(m);
}

// TELEGRAM QOIDASI (amalda o'lchandi): bitta `upload.getFile` so'rovi
// 1 MB BLOK chegarasidan oshib ketmasligi shart. Agar 512 KB bo'lak
// chegarani kesib o'tsa, Telegram `LIMIT_INVALID` qaytaradi (natijada
// `<video>` 502 oladi). Shu funksiya `off` turgan 1 MB blokda qolgan
// bayt sonini beradi — har doim 4096 ga karrali va kamida 4096.
const TG_BLOCK = 1024 * 1024;
function roomInBlock(off) {
  const a = off - (off % 4096);
  return TG_BLOCK - (a % TG_BLOCK);
}

// --- Tez yo'l: bo'laklarni PARALLEL yig'ish -------------------------------
function readRangeParallel(start, goal) {
  return (async function () {
    const parts = [];
    let got = 0;

    while (got < goal) {
      const remaining = goal - got;
      const n = Math.min(PARALLEL, Math.ceil(remaining / CHUNK));

      // Bo'laklarni oldindan REJA qilamiz. Har birining boshlanishi
      // aniq belgilangan, shuning uchun ular parallel kelganda tartibini
      // saqlab qo'yishimiz mumkin.
      const jobs = [];
      let plan = 0;
      for (let k = 0; k < n; k++) {
        const off = start + got + plan;
        // 1 MB blok chegarasini kesib o'tmaymiz (aks holda LIMIT_INVALID).
        const piece = Math.min(CHUNK, roomInBlock(off), remaining - plan);
        if (piece <= 0) break;
        jobs.push({ off: off, want: piece });
        plan += piece;
      }
      if (jobs.length === 0) break;

      // DIQQAT: Promise.all BUTUN guruhni birdan rad etadi - kelgan
      // natijalarni yo'qotib yuboradi. Shuning uchun har bir bo'lakni
      // alohida ushlab, natijani yig'iz.
      const res = await Promise.all(jobs.map(async function (j) {
        try { return { u8: await readFromPage(j.off, j.want).then(toU8) }; }
        catch (err) { return { err: err }; }
      }));

      STATS.par += jobs.length;

      for (let k = 0; k < res.length; k++) {
        if (res[k].err) {
          const e = res[k].err;
          // Telegram hajmi rad etdi - bu ma'lumot, CHUNK ni kichiklashtiramiz.
          if (isSizeRejected(e)) throw e;
          // Boshqa xato (internet uzildi, vaqtout, Telegram xatosi).
          if (got > 0) {
            say('! parallel ' + jobs[k].off + '+' + jobs[k].want + ': ' + e.message
              + ' - qisman javob (' + got + ' bayt)');
            return concat(parts, got);
          }
          throw e;
        }
        const u8 = res[k].u8;
        if (u8.length) { parts.push(u8); got += u8.length; }
      }
    }

    if (!parts.length) throw new Error('Telegram hech narsa bermadi');
    return concat(parts, got);
  })();
}

// --- Ishonchli yo'l: KETMA-KET o'qish (avvalgi, tekshirilgan usul) --------
function readRangeSerial(start, goal) {
  return (async function () {
    const parts = [];
    let got = 0;

    while (got < goal) {
      // 1 MB blok chegarasini kesib o'tmaymiz (aks holda LIMIT_INVALID).
      const piece = Math.min(goal - got, CHUNK, roomInBlock(start + got));

      let u8;
      try {
        u8 = toU8(await readFromPage(start + got, piece));
      } catch (err) {
        // Telegram bo'lak hajmini rad etgan - kichiklashtirib, aynan
        // shu o'lchamdagi qiymatni TOPAMIZ.
        if (isSizeRejected(err) && CHUNK > MIN_CHUNK) {
          CHUNK = Math.max(MIN_CHUNK, CHUNK >> 1);
          say('! Telegram hajmini rad etdi - ' + (CHUNK / 1024) + ' KB bilan qayta urinaman');
          continue;
        }
        if (got === 0) throw err;
        say('! ' + (start + got) + '+' + (goal - got) + ': ' + err.message
          + ' - qisman javob qaytarilyapti');
        break;
      }

      if (!u8.length) break;
      parts.push(u8);
      got += u8.length;
    }

    if (!parts.length) return new Uint8Array(0);
    return concat(parts, got);
  })();
}

// --- Keshli, GRID ga tekislangan o'qish ------------------------------------
//
// Nima uchun grid? Disk keshining kaliti `doc/offset/limit`. Agar bir so'rov
// 128 KB dan, boshqasi 2 MB dan boshlansa — kalitlar hech qachon mos
// kelmasdi. Shuning uchun o'qishni CHUNK ga (512 KB) tekislangan oynalarga
// bo'lamiz: qaysi yo'l bilan so'ralmasin, kalit bir xil bo'ladi.
//
// Telegram 1 MB blok chegarasini kesib o'tish taqiqlangan — CHUNK (512 KB)
// va uning karrali oynalar bu chegaraga har doim sig'adi.
async function readRangeGrid(start, goal, size, doc, lanes) {
  const end = Math.min(size, start + goal);
  if (end <= start) return new Uint8Array(0);

  // Bir raundda nechta oyna (512 KB) parallel o'qiladi. Tail prefetch uchun
  // 8 ta beriladi: 8 MB lik indeks 4 raund o'rniga 2 raundda keladi.
  const par = Math.max(1, Math.min(Number(lanes) || PARALLEL, 8));

  const out = new Uint8Array(end - start);
  let filled = 0;
  let w = start - (start % CHUNK);

  while (w < end) {
    // Navbatdagi PARALLEL ta oynani rejalashtiramiz (tartib aniq).
    const batch = [];
    let b = w;
    while (batch.length < par && b < end) {
      // Birinchi oyna (fayl boshidan, so'ralgan oraliq 512 KB dan kichik):
      // tweb kabi so'ralgan oraliq bilan CHEKLAYMIZ. Ilgari 128 KB kerak
      // bo'lsa ham to'liq 512 KB so'ralardi va birinchi bayt 4 barobar
      // kechikardi (sekin tarmoqda ~1–2 s farq). MIN_CHUNK (64 KB) ga
      // tekislaymiz — kalitlar hamon takrorlanadigan bo'lib qoladi.
      let len = Math.min(CHUNK, size - b);
      if (b === 0 && end < CHUNK) {
        len = Math.min(len, Math.ceil((end - b) / MIN_CHUNK) * MIN_CHUNK);
      }
      if (len <= 0) break;
      batch.push({ off: b, want: len });
      b += len;
    }
    if (!batch.length) break;

    const res = await Promise.all(batch.map(async function (j) {
      try { return { u8: await readWindow(doc, j.off, j.want, size) }; }
      catch (err) { return { err: err }; }
    }));
    STATS.par += batch.length;

    for (let k = 0; k < res.length; k++) {
      if (res[k].err) {
        const e = res[k].err;
        if (isSizeRejected(e)) throw e;
        if (filled > 0) return out.subarray(0, filled);
        throw e;
      }
      const u8 = res[k].u8;
      if (!u8 || !u8.length) {
        if (filled > 0) return out.subarray(0, filled);
        throw new Error('Telegram hech narsa bermadi');
      }

      const from = Math.max(start, batch[k].off);
      const to = Math.min(end, batch[k].off + u8.length);
      if (to > from) {
        out.set(u8.subarray(from - batch[k].off, to - batch[k].off), from - start);
        filled = to - start;
      }
      if (u8.length < batch[k].want) return out.subarray(0, filled);  // fayl tugadi
    }

    const last = batch[batch.length - 1];
    w = last.off + last.want;
  }

  return filled === out.length ? out : out.subarray(0, filled);
}

// --- Umumiy kirish nuqtasi -------------------------------------------------
//
// Avval tez (parallel) yo'lni sinaymiz. Muvaffaqiyatsiz bo'lsa - sababiga
// qarab ikki xil qaror:
//   * Telegram hajmini rad etgan  -> CHUNK ni kichiklashtirib, parallel
//                                    yo'lni qayta sinab ko'ramiz.
//   * Boshqa xato                  -> ishonchli ketma-ket yo'lga o'tamiz.
//
// `doc` berilgan bo'lsa avval KESHLI grid yo'lini sinaymiz (disk cache +
// Telegram). U ishlamasa — quyidagi tekshirilgan eski yo'llar o'zgarishsiz
// ishlatiladi.
async function readRange(start, want, size, doc, lanes) {
  const goal = Math.min(want, size - start);
  if (goal <= 0) return new Uint8Array(0);

  if (doc && CACHE_OK) {
    try {
      return await readRangeGrid(start, goal, size, doc, lanes);
    } catch (err) {
      const msg = String((err && err.message) || err);
      if (msg === 'NO_PROVIDER') throw err;
      say('! keshli o\'qish ishlamadi (' + msg + ') - oddiy yo\'lga o\'taman');
    }
  }

  try {
    return await readRangeParallel(start, goal);
  } catch (err) {
    const msg = String((err && err.message) || err);

    // NO_PROVIDER - SW o'z-o'zini qayta ishga tushganda sahifaga
    // yetib borolmagandik. Qayta urinish ma'nosiz (u ham sahifaga bog'liq),
    // lekin SW allaqachon `needProvider` yuborgan.
    if (msg === 'NO_PROVIDER') throw err;

    if (isSizeRejected(err) && CHUNK > MIN_CHUNK) {
      CHUNK = Math.max(MIN_CHUNK, CHUNK >> 1);
      say('! Telegram bo\'lak hajmini rad etdi - ' + (CHUNK / 1024)
        + ' KB bilan qayta urinaman');
      try {
        return await readRangeParallel(start, goal);
      } catch (err2) {
        if (String((err2 && err2.message) || '') === 'NO_PROVIDER') throw err2;
        say('! ' + err2.message + ' - ketma-ket o\'qishga o\'taman');
      }
      return readRangeSerial(start, goal);
    }

    say('! tez yo\'l ishlamadi (' + msg + ') - ketma-ket o\'qishga o\'taman');
  }

  return readRangeSerial(start, goal);
}

// ------------------------------------------------------------- Range so'rovini o'qish
// "bytes=0-"      → boshidan oxirigacha   (ochiq — `open: true`)
// "bytes=100-200" → aynan shu oraliq
// "bytes=-500"    → oxirgi 500 bayt
//
// `open` alohida belgilanadi, chunki u "hammasini ber" degan so'rov —
// bunday javobni KICHIK qilib berish kerak (tez kuzatish uchun), aks holda
// foydalanuvchi birinchi kadrni ko'rish uchun o'nlab soniya kutadi.
function parseRange(header, size) {
  if (!header) return null;
  const m = /bytes=(\d*)-(\d*)/.exec(header);
  if (!m) return null;
  if (m[1] === '' && m[2] === '') return null;

  let start, end, open = false;
  if (m[1] === '') {
    const n = Number(m[2]);
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    if (m[2] === '') { end = size - 1; open = true; }
    else end = Math.min(Number(m[2]), size - 1);
  }
  if (!(start >= 0) || start > end || start >= size) return null;
  return { start: start, end: end, open: open };
}

// ---------------------------------------------------------------------- asosiy
//
// Range siz so'rov uchun progressiv oqim: 200 OK + to'liq `Content-Length`.
//
// Oqim qanday ishlaydi:
//   * Brauzer `<video>` boshlanganda Range SIZ so'rov yuboradi. Shu yerda
//     biz 200 + Content-Length: <hajm> qaytaramiz va haqiqiy ReadableStream
//     ochamiz. Endi brauzer "bu 546 MB li video" deb biladi va o'zi
//     xohlagancha (backpressure) tortib oladi.
//   * Brauzer to'xtatganda (seek yoki sahifa yopilganda) `cancel()` chaqiriladi
//     va biz o'qishni darhol to'xtatamiz — ortiqcha trafik sarflanmaydi.
//
// ---------------------------------------------------------------------------
//  IKKITA BOSQICH: DARHOL BIR BO'LAK, KEYIN QOLGANI
// ---------------------------------------------------------------------------
//
// NIMA UCHUN: avval har bir `pull` 1 MB so'raydi, ya'ni `readRangeParallel`
// ichida 2 ta parallel Telegram so'rovi (512 KB + 512 KB). Ikkalasi ham
// tugagandan KEYIN brauzerga birinchi bayt yetib boradi. Sekundiga 3-4 MB
// tezlikda bu bitta qadam ~0.5 s, sekin internetda bir necha sekun — ya'ni
// video "ochilishi" sezilarli kechikadi.
//
// Endi oqim IKKITA QADAMDA ishlaydi:
//
//   1-BOSQICH (darhol) — bitta 512 KB bo'lak. Bitta Telegram so'rovi, bitta
//     RTT. MP4 sarlavhasi (`ftyp` + `moov`) shu yerda bo'lsa, brauzer birinchi
//     kadrni deyarli darhol ko'rsatadi.
//
//   2-BOSQICH (darhol, kechikishsiz) — qolgan butun fayl. Endi tezlik
//     muhim: har tortish 2 MB va ichida 4 ta parallel so'rov (PARALLEL).
//
// NIMA UCHUN "FON ISHLOVCHI" (producer) va NAVBAT:
//
// Oqimning o'zini to'xtatib kutsa — brauzer `pull()` ga to'xtamaydi
// chaqirib turadi va video "tosib" qoladi. Shuning uchun:
//
//   * `produce()` — FONDA ishlaydi: Telegram'dan o'qib, navbatga soladi.
//     1-bosqichni darhol, 2-bosqichni ham darhol boshlaydi va
//     NAVBAT TO'LMAY turib davom etadi (foydalanuvchi ko'rayotgan paytda
//     keyingi qism oldindan tayyor bo'lib turadi — "buffer" qisqa bo'lmaydi).
//   * `pull(controller)` — faqat navbatdan oladi. Navbat bo'sh bo'lsa
//   * `pull(controller)` - faqat navbatdan oladi. Navbat bo'sh bo'lsa
//     `produce()` tugashini kutadi, lekin o'z-o'zidan Telegram'ga
//     so'rov YUBORMAYDI.
//
// XOTIRA: navbat chegaralanadi (QUEUE_MAX). Aks holda 546 MB li fayl
// butunlay RAM ga yig'ilib, telefonda brauzerni o'ldirardi. Chegara
// oshilganda `produce` kutadi — bu aynan `backpressure` roli.
// 1-bosqich: birinchi bo'lak. Ilgari 512 KB edi — brauzer birinchi baytni
// ko'rishdan oldin butun 512 KB ni kutardi (sekin tarmoqda 1–2.5 s).
// Birinchi kadr uchun 128 KB yetarli; qolgani darhol davom etadi.
const FIRST_PULL = 128 * 1024;
const REST_PULL = 2 * 1024 * 1024;   // 2-bosqich: katta bo'lak, tez
// 2-bosqich KECHIKISHI. Ilgari 2000 ms edi — ya'ni birinchi 512 KB dan
// keyin brauzer 2 SEKUND hech qanday bayt olmasdi. `moov` fayl boshida
// bo'lsa ham video shu sababli "qotib" turardi (foydalanuvchi shikoyati:
// "6 sekundda ochilyapti"). Endi kechiktirmaymiz: birinchi bo'lak
// yuborilishi bilan qolgani darhol oqadi. Tartib saqlanadi (avval 0 dan
// o'qilgan 512 KB, keyin davomi), chunki `off` ketma-ket o'sadi.
const REST_DELAY = 0;                // ms — qolgani shundan keyin yuklanadi
const START_BUFFER_SECONDS = 10;     // o'rtacha bitrate asosida taxminan 10 soniya zaxira
const QUEUE_MIN = 1;                 // kamida bitta keyingi bo'lak
const QUEUE_MAX_CAP = 6;             // yuqori chegara: 12 MB (brauzer xotirasini asraydi)

// Fayl hajmi / davomiylik orqali 10 soniyaning taxminiy bayt miqdorini olamiz.
// Oqimning birinchi 128 KB paketi kechiktirilmaydi; bu limit faqat qolgan
// bo'laklar navbatini cheklaydi. Davomiylik noma'lum bo'lsa 2 MB olamiz.
function targetBufferBytesFor(size, duration) {
  const seconds = Number(duration) || 0;
  if (!Number.isFinite(seconds) || seconds <= 0) return Math.min(size, REST_PULL);
  return Math.min(size, Math.ceil(size * Math.min(START_BUFFER_SECONDS / seconds, 1)));
}

function queueLimitFor(size, duration) {
  const remaining = Math.max(0, targetBufferBytesFor(size, duration) - FIRST_PULL);
  const parts = Math.ceil(remaining / REST_PULL);
  return Math.max(QUEUE_MIN, Math.min(QUEUE_MAX_CAP, parts));
}

async function progressiveResponse(size, mime, baseHeaders, t0, duration, docId, cacheDoc) {
  const born = (t0 || Date.now());
  const targetBufferBytes = targetBufferBytesFor(size, duration);
  const queueLimit = queueLimitFor(size, duration);
  let off = 0;                       // produktor o'qigan bayt soni (R2 + Telegram)
  let sent = 0;                      // pleerga BERILGAN bayt soni (read-ahead uchun)
  let dead = false;                  // brauzer bekor qilgan (yopilgan/seek)
  let done = false;                  // fayl to'liq o'qib bo'ldi
  let err = null;                    // oxirgi xato
  let part = 1;
  const queue = [];                  // tayyor baytlar (Uint8Array)
  const waiters = [];                // navbat bo'sh bo'lishini kutayotganlar

  // Kimdir navbatga keldi yoki shart o'zgarganda — barcha kutuvchilarni
  // uyg'otamiz. Ro'yxat bo'lgani uchun `pull` ham, `produce` ham bir vaqtda
  // kuta oladi (oldingi bitta `wake` sloti ikkinchisini yo'qotardi).
  function notify() {
    while (waiters.length) waiters.shift()();
  }
  function waitTick() {
    return new Promise(function (r) { waiters.push(r); });
  }
  function pause(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  // --- MP4 indeksini (moov) tekshirish uchun bosh baytlar ----------------
  // R2 dan ham, Telegram'dan ham birinchi 256 KB shu yerga yig'iladi.
  let headParts = [];
  let headLen = 0;
  let moovChecked = false;
  function addHead(u8) {
    if (moovChecked || !u8 || !u8.length) return;
    const room = 256 * 1024 - headLen;
    if (room <= 0) return;
    const take = u8.length <= room ? u8 : u8.subarray(0, room);
    headParts.push(take);
    headLen += take.length;
    // Bosh baytlarni umumiy xaritaga ham beramiz: `indexRegion()` ular
    // orqali indeksning ANIQ o'rnini qo'shimcha so'rovsiz topadi.
    headNote(tailKey(cacheDoc, size), take);
  }
  function checkMoov() {
    if (moovChecked) return;
    if (headLen < 64 * 1024 && off < size) return;   // hali erta
    moovChecked = true;
    const h = headParts.length === 1 ? headParts[0] : concat(headParts, headLen);
    headParts = [];
    if (!hasMoovInHead(h)) {
      prefetchTail(size, cacheDoc);
    }
  }
  // --- R2 ga yuklash uchun prefiks baytlarini yig'ish -------------------
  // Faqat R2 bo'sh bo'lganda (Telegram'dan o'qilganda) va sahifa ruxsat
  // bergan bo'lsa. 5 MB xotira — faqat birinchi o'qish paytida.
  let seedTarget = 0;
  let seedParts = [];
  let seedBytes = 0;
  let seedSent = false;
  function collectSeed(u8) {
    if (!seedTarget || seedSent || !u8 || !u8.length) return;
    const room = seedTarget - seedBytes;
    if (room <= 0) return;
    const take = u8.length <= room ? u8 : u8.subarray(0, room);
    seedParts.push(take);
    seedBytes += take.length;
    if (seedBytes >= seedTarget) {
      seedSent = true;
      const parts = seedParts;
      const total = seedBytes;
      seedParts = [];
      seedBytes = 0;
      r2Seed(docId, size, parts, total, 'head');
      // Xotiradagi sozlamani ham yangilaymiz: bu sahifa keyingi ochilishda
      // 404 so'rov yubormay, tayyor prefiksni darhol oladi.
      if (R2_INFO && R2_INFO.docs) {
        const e = R2_INFO.docs[String(docId)] || { head: 0, tail: 0 };
        e.head = Math.max(Number(e.head) || 0, total);
        R2_INFO.docs[String(docId)] = e;
      }
    }
  }

  // --- FON ISHLOVCHI -------------------------------------------------------
  async function produce() {
    try {
      let usedR2 = 0;

      // ---- 0-BOSQICH: R2 prefiksi (bo'lsa) ------------------------------
      // Bu eng katta yutuq: birinchi bayt Telegram DC dan emas, Cloudflare
      // edge'dan keladi. R2 ishlamasa — pastdagi eski yo'l o'zgarishsiz.
      if (docId) {
        // Sahifa sozlamani oldindan yuborgan bo'lsa — kutish YO'Q.
        const info = await r2InfoSoon(R2_INFO_WAIT);
        const di = r2DocInfo(info, docId);
        if (di && di.head) {
          seedTarget = (info.put && size > di.head) ? Math.min(di.head, size) : 0;
          usedR2 = await r2PrefixInto(docId, size, function (u8) {
            // R2 dan kelgan birinchi bo'laklarda ham `esds` tuzatiladi
            // (faststart MP4'da `moov` fayl boshida bo'ladi).
            const part = applyMp4Fix(docId, off, size, u8);
            off += part.length;
            STATS.bytes += part.length;
            queue.push(part);
            addHead(part);
            notify();
          }, info);
        } else if (info && info.put && info.docs) {
          // Mahalliy keshda bu hujjat hali yo'q: birinchi tomoshabin bosh
          // oynani Telegram'dan o'qib, uni keshga yozadi (keyingilari shu
          // yerdan oladi). `docs` xaritasi borligi = mahalliy rejim.
          seedTarget = Math.min(info.prefix || 4 * 1024 * 1024, size);
        }
      }

      if (dead) return;

      if (usedR2 > 0) {
        STATS.r2++;
        STATS.requests++;
        say('⚡ prefiks ' + (usedR2 / 1048576).toFixed(1) + ' MB — Telegram kutishisiz');
        stats({
          ttfb: Date.now() - born,
          first: usedR2,
          r2: true,
          progressive: true,
          size: size
        });
        checkMoov();
      } else {
        // ---- 1-BOSQICH: darhol bitta kichik bo'lak ----------------------
        const firstRaw = await readRange(0, Math.min(FIRST_PULL, size), size, cacheDoc);
        if (dead) return;
        // Chromium ba'zi Telegram MP4'larini (buzuq `esds`) o'qimaydi —
        // shu yerda tuzatamiz, aks holda pleer butun faylni tortadi.
        const first = applyMp4Fix(docId, 0, size, firstRaw);
        if (first && first.length) {
          off += first.length;
          STATS.requests++;
          STATS.bytes += first.length;
          queue.push(first);
          addHead(first);
          collectSeed(first);
          maybePrefetch(cacheDoc, size, off, sent);
          say('~ oqim #1 ' + (first.length / 1024).toFixed(0) + ' KB - darhol');
          // Birinchi bayt qancha vaqtda keldi? Bu - TTFB. Sahifa uni
          // `window.__wcPerf` da ko'radi (QA uchun).
          stats({
            ttfb: Date.now() - born,
            first: first.length,
            progressive: true,
            size: size
          });
          notify();
        }
      }
      part++;                              // keyingi bo'lak "#2" bo'lib hisoblanadi

      // ---- 2-BOSQICH: darhol qolgan fayl --------------------------------
      // Kechikish yo'q (`REST_DELAY = 0`): birinchi 512 KB yuborilishi
      // bilan davomi o'qila boshlaydi. `dead` bo'lsa to'xtaymiz.
      if (!dead && !done && REST_DELAY > 0) {
        let left = REST_DELAY;
        while (left > 0 && !dead) {
          const step = left > 50 ? 50 : left;
          await pause(step);
          left -= step;
        }
      }
      if (dead) return;

      // Moov hali aniqlanmagan bo'lsa (kichik prefiks) — hozir tekshiramiz.
      checkMoov();
      // Indeks yuklanmoqda bo'lsa — ketma-ket oqimni bir oz to'xtatamiz:
      // sekin tarmoqda ikkisi bir-biriga xalaqit bermasin.
      await waitIndex(cacheDoc, size, IDX_PAUSE_MS);
      if (dead) return;

      // ---- fayl oxirigacha (navbat to'lmasdan oldin to'xtaydi) -----------
      while (!dead && !err && off < size) {
        // Navbat to'lgan — bu BACKPRESSURE: brauzer o'z tezligida ko'rayapti,
        // biz esa ortiqcha yuklamaymiz. Bo'sh joy bo'lganda `notify` uyg'otadi.
        while (!dead && !err && queue.length >= queueLimit) await waitTick();

        const toTarget = Math.max(0, targetBufferBytes - off);
        const want = Math.min(REST_PULL, size - off, toTarget > 0 ? toTarget : REST_PULL);
        const chunkStart = off;
        const u8 = applyMp4Fix(docId, chunkStart, size,
          await readRange(chunkStart, want, size, cacheDoc));
        if (!u8 || !u8.length) break;      // Telegram kamroq berdi / fayl tugadi
        off += u8.length;
        STATS.requests++;
        STATS.bytes += u8.length;
        queue.push(u8);
        addHead(u8);
        collectSeed(u8);
        // 20 MB read-ahead: pleer hozir turgan joydan oldinga diskka yozamiz.
        maybePrefetch(cacheDoc, size, off, sent);
        if (part <= 2 || part % 20 === 0) {
          say('~ oqim #' + part + ' ' + (off / 1048576).toFixed(1) + ' / '
            + (size / 1048576).toFixed(1) + ' MB'
            + (part === 2 ? '  (qolgani — kechikishsiz)' : ''));
        }
        part++;
        notify();
      }
      checkMoov();
    } catch (e) {
      if (!dead) {
        err = e;
        say('✗ oqim ' + off + ': ' + ((e && e.message) || e));
      }
    } finally {
      done = true;
      notify();                            // `pull` buni kutayotgan bo'lishi mumkin
    }
  }

  // Fon ishlovchini shu yerda ishga tushiramiz — javob darhol qaytariladi
  // (200 OK + sarlavhalar), baytlar esa `stream` orqali keladi.
  produce();

  const stream = new ReadableStream({
    async pull(controller) {
      // Navbat bo'sh bo'lsa `produce` tugashini yoki yangi baytni kutamiz.
      while (!queue.length && !dead && !done && !err) await waitTick();
      if (dead) return;
      if (err && !queue.length) {
        try { controller.error(err); } catch (e) { /* allaqachon yopilgan */ }
        return;
      }
      if (!queue.length) { controller.close(); return; }

      const u8 = queue.shift();
      sent += u8.length;
      notify();                            // bo'sh joy bo'ldi — produce davom etsin
      controller.enqueue(u8);
      // Pleer oldinga surildi — read-ahead oynasini yangilaymiz.
      maybePrefetch(cacheDoc, size, off, sent);
    },
    cancel() {
      // Brauzer to'xtadi — Telegram'dan yana o'qimaymiz.
      dead = true;
      notify();                            // kutayotgan `pull` ni uyg'otamiz
      say('~ oqim to‘xtatildi (' + (off / 1048576).toFixed(1) + ' MB o‘qilgan)');
    }
  });

  return new Response(stream, {
    status: 200,
    headers: { ...baseHeaders, 'Content-Type': mime, 'Content-Length': String(size) }
  });
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (!/(^|\/)tgfile(\/|$)/.test(url.pathname)) return;   // boshqa so'rovlarga tegma

  // XAVFSIZLIK: faqat O'Z ORIGIN'IMIZDAGI so'rovlarni ushlaymiz.
  //
  // Service Worker boshqa ORIGIN'dagi so'rovlarni ham ko'radi: masalan,
  // boshqa sayt `<video src="https://boshqa-sayt/tgfile/?size=...">`
  // qilsa, bu SW uni ushlab, Telegram'ga proksi qilib yuboradi. Bu -
  // server-side request forgery (SSRF) yuzasi: sayt ichidagi begona
  // manzillar Telegram orqali o'qilishi mumkin bo'lardi.
  //
  // Shuning uchun origin'ni qat'iy tekshiramiz. Boshqa origin -> SW tegilmay,
  // so'rov odatdagidek networkga boradi (mavjud xavfsizlik saqlanadi).
  if (url.origin !== self.location.origin) return;

  // So'rov qabul qilingan vaqti - TTFB (first byte) ni o'lchash uchun.
  const t0 = Date.now();

  e.respondWith((async () => {
    const size = Number(url.searchParams.get('size')) || 0;
    const rawDuration = Number(url.searchParams.get('dur'));
    const duration = Number.isFinite(rawDuration) ? Math.max(0, Math.min(86400, rawDuration)) : 0;

    // Hujjat id'si — R2 prefiks kaliti. Sahifa buni `?doc=` bilan yuboradi.
    // Yo'q bo'lsa R2 bloki umuman ishlamaydi (eski xatti-harakat).
    //
    // MUHIM: 64-bitli id'ni `Number()` ga o'girmaymiz — JS 2^53 dan keyin
    // aniqlikni yo'qotadi va turli foydalanuvchilar turli kalit hisoblab
    // qolardi (kesh hech qachon "urilmasdi").
    const docRaw = String(url.searchParams.get('doc') || '');
    const docId = /^[0-9]{1,20}$/.test(docRaw) ? docRaw : '';

    // Disk keshining kaliti. `Save-Data: on` (foydalanuvchi trafikni
    // tejashni so'ragan) bo'lsa kesh va read-ahead o'chadi — hurmat qilamiz.
    const saveData = String(e.request.headers.get('Save-Data') || '').toLowerCase() === 'on';
    const cacheDoc = saveData ? '' : docId;

    // Konteyner turi. Sahifa buni `?mime=` orqali yuboradi (probe aniqlagan
    // haqiqiy tur). MKV/HEVC fayllar uchun `video/mp4` deb yuborish brauzerni
    // darhol rad etishga majbur qilardi — MIME haqiqiy bo'lishi SHART.
    const MIME_OK = /^(video|audio)\/[a-z0-9.+-]+$/i;
    const mimeQ = url.searchParams.get('mime') || '';
    const mime = MIME_OK.test(mimeQ) ? mimeQ : 'video/mp4';

    const headers = {
      'Accept-Ranges': 'bytes',
      'Content-Type': mime,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    };

    if (!size) {
      return new Response('O\'lcham ko\'rsatilmagan', {
        status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }

    const rg = parseRange(e.request.headers.get('Range'), size);

    // --- tweb: birinchi so'rovda faylning OXIRGI bo'lagini oldindan olish ---
    //
    // `tweb/src/lib/serviceWorker/stream.ts` da `preloadChunks()` aynan
    // `from === 0` bo'lganda faylning oxirgi bo'lagini yuklaydi: MP4 `moov`
    // indeksi ko'pincha fayl oxirida turadi va brauzer uni darhol so'raydi.
    // Bizda bu ishni sahifa `warmtail` xabari bilan ham qiladi, lekin har
    // yo'l (reels, izohlar posteri, to'g'ridan-to'g'ri havola) bu xabarni
    // yubormaydi. Shuning uchun SW o'zi ham birinchi so'rovda boshlaydi.
    //
    // `prefetchTail` idempotent: takroriy chaqiriq mavjud promisni qaytaradi,
    // `readWindow` esa avval keshni va prefiksni (R2/mahalliy) tekshiradi.
    if (cacheDoc && size > CHUNK && (!rg || rg.start === 0)) {
      prefetchTail(size, cacheDoc).catch(noop);
    }

    // --- 0–1 BAYT "PROBE" JAVOBI (WebK hiylasi) --------------------------
    //
    // Pleer ishga tushganda `Range: bytes=0-1` yuborib "server range'ni
    // qo'llaydimi?" deb tekshiradi. WebK bunga Telegram'ga umuman bormasdan
    // darhol 2 bayt qaytaradi — shuning uchun video "bir zumda" ochiladi.
    // Bu javob KESHLANMAYDI va hech qanday bayt o'qimaydi.
    if (rg && !rg.open && rg.start === 0 && rg.end === 1 && size >= 2) {
      return new Response(new Uint8Array(2), { status: 206, headers: {
        ...headers,
        'Content-Range': 'bytes 0-1/' + size,
        'Content-Length': '2',
        'X-WC-Served-By': 'tg-cdn-worker',
        'X-WC-Probe': '1',
      }});
    }

    // --- Range YO'Q bo'lsagina progressiv (200) javob ---------------------
    //
    // RFC 9110 §15.5.7: `206 Partial Content` faqat Range sarlavhali so'rovga
    // beriladi. Range umuman yo'q so'rovga `200 OK` + `Content-Length` +
    // ReadableStream qaytaramiz — brauzer oqimni o'zi tortadi (backpressure).
    //
    // MUHIM (O'LCHANGAN): `Range: bytes=0-` ni ham 206 bilan xizmat qilamiz.
    // Ilgari bunday so'rov ham progressiv 200 olardi va brauzer uzun javobni
    // "tugallanmagan oqim" deb sekin demuxlash qilardi. Headless-Chrome
    // dastgohi (13.8 MB, moov oxirida, RTT 150 ms / 1.5 MB/s):
    //   pure-206 `canplay` 2130 ms (buffered 0.61 s) ·
    //   progressiv-200 2640 ms (3.46 s) · git HEAD 3105 ms (6.72 s).
    // 1.5 s "o'ylash" bilan: 2432 / 3710 / 4178 ms. Ya'ni har Range so'rovi —
    // bitta bo'lak 206; brauzer keyingi oynani o'zi so'raydi (tweb modeli).
    if (!rg) {
      return progressiveResponse(size, mime, headers, t0, duration, docId, cacheDoc);
    }

    const start = rg.start;

    // QANCHA BAYT QAYTARAMIZ? (Telegram Web K modeli)
    //
    //   `bytes=X-`  (ochiq) -> faqat BITTA bo'lak: 512 KB (katta faylda 1 MB).
    //   `bytes=X-Y` (aniq)  -> so'ralgan oraliq, ko'pi 2 bo'lak.
    //
    // NIMA UCHUN: avval butun fayl bitta "oqim" (200 + to'liq uzunlik) yoki
    // 8 MB lik dum javobi sifatida berilardi va brauzer shu yuklanishning
    // tugashini kutardi. Endi brauzer o'zi kerakli oynani so'raydi, har javob
    // ~1 RTT da tayyor (tweb: `STREAM_CHUNK_MIDDLE_LIMIT = 512 KB`).
    const toEnd = size - start;              // fayl oxirigacha qancha bayt bor
    const RANGE_LIMIT = size > 75 * 1024 * 1024 ? 1024 * 1024 : CHUNK;
    let want;
    if (rg.open) {
      want = RANGE_LIMIT;                    // "bytes=X-" — bitta bo'lak
    } else {
      want = Math.min(rg.end - rg.start + 1, 2 * RANGE_LIMIT);
    }

    // Telegram'dan mavjud bo'lmagan bayt so'rash xato beradi.
    want = Math.min(want, toEnd);
    if (want <= 0) {
      return new Response(null, { status: 416, headers: {
        ...headers,
        'Content-Range': 'bytes */' + size,
      }});
    }

    let bytes;
    // MP4 indeksi (moov) oldindan yuklangan bo'lishi mumkin — Telegram'ga
    // murojaat qilmasdan, shu zaxiradan qaytaramiz (1 RTT tejaladi).
    let cached = tailFromCache(tailKey(cacheDoc, size), start, want);
    // Zaxira hali TAYYOR EMAS, lekin yuklanmoqda — kutamiz. Bu Telegram'ga
    // ikkinchi marta murojaat qilishning oldini oladi (moov 2× yuklanmaydi).
    if (!cached) {
      cached = await awaitTail(start, want, size, cacheDoc);
    }
    if (cached && cached.length) {
      STATS.requests++;
      STATS.bytes += cached.length;
      say('→ #' + STATS.requests + ' bayt ' + start + '…' + (start + cached.length - 1)
        + ' (keshdan — MP4 indeksi)');
      const cttfb = Date.now() - t0;
      stats({ ttfb: cttfb, range: start + '-' + (start + cached.length - 1), size: size, cached: true });
      // `moov` shu yerda — Chromium uchun `esds` ni tuzatib yuboramiz.
      const fixed = applyMp4Fix(docId, start, size, cached);
      return new Response(fixed, { status: 206, headers: {
        ...headers,
        'Content-Range': 'bytes ' + start + '-' + (start + fixed.length - 1) + '/' + size,
        'Content-Length': String(fixed.length),
        'X-WC-Served-By': 'tg-cdn-worker',
        'X-WC-TTFB': String(cttfb),
        'X-WC-Cached': 'tail',
      }});
    }
    // R2 prefiksi ichidagi so'rov (odatda seek yoki `probe`) — Telegram'ga
    // bormasdan, edge'dan darhol javob beramiz.
    if (docId) {
      const r2want = Math.min(want, size - start);
      const r2u8 = await r2Range(docId, start, start + r2want, size);
      if (r2u8 && r2u8.length) {
        STATS.requests++;
        STATS.bytes += r2u8.length;
        STATS.r2++;
        const rt = Date.now() - t0;
        stats({ ttfb: rt, range: start + '-' + (start + r2u8.length - 1), size: size, r2: true });
        const fixed = applyMp4Fix(docId, start, size, r2u8);
        return new Response(fixed, { status: 206, headers: {
          ...headers,
          'Content-Range': 'bytes ' + start + '-' + (start + fixed.length - 1) + '/' + size,
          'Content-Length': String(fixed.length),
          'X-WC-Served-By': 'tg-cdn-worker',
          'X-WC-TTFB': String(rt),
          'X-WC-R2': '1',
        }});
      }
    }

    try {
      bytes = await readRange(start, want, size, cacheDoc);
    } catch (err) {
      say('✗ ' + start + '+' + want + ': ' + err.message);
      return new Response('Telegram CDN dan oqib bo\'lmadi: ' + err.message, {
        status: 502, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }

    const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const u8 = applyMp4Fix(docId, start, size, raw);

    // Telegram kamroq bayt qaytarsa (internet uzilib qolsa) - faqat olinganini
    // qaytaramiz, zero to'ldirilgan "soxta" baytlarni YUBORMAYMIZ.
    if (u8.length === 0) {
      return new Response(null, { status: 502, headers: {
        'Content-Type': 'text/plain; charset=utf-8' }});
    }

    STATS.requests++;
    STATS.bytes += u8.length;
    if (start > 1024 * 1024) STATS.seeks++;
    say('→ #' + STATS.requests + ' bayt ' + start + '…' + (start + u8.length - 1)
      + ' (' + (u8.length / 1048576).toFixed(2) + ' MB)'
      + (start > 1048576 ? '  ← seek' : ''));

    // TTFB: so'rov kelgandan bayt tayyor bo'lguncha o'tgan vaqt.
    // Sahifa shuni `window.__wcPerf` da ko'radi (QA).
    const ttfb = Date.now() - t0;
    stats({ ttfb: ttfb, range: start + '-' + (start + u8.length - 1), size: size });

    // Keyingi bo'laklarni FONDA qizdiramiz (WebK: 20 MB read-ahead). Javob
    // allaqachon tayyor — bu qator foydalanuvchini kutdirmaydi, lekin keyingi
    // Range so'rovlari keshdan yoki birlashtirilgan (`INFLIGHT`) so'rovdan
    // darhol keladi.
    maybePrefetch(cacheDoc, size, start + u8.length, start + u8.length);

    return new Response(u8, { status: 206, headers: {
      ...headers,
      'Content-Range': 'bytes ' + start + '-' + (start + u8.length - 1) + '/' + size,
      'Content-Length': String(u8.length),
      'X-WC-Served-By': 'tg-cdn-worker',
      'X-WC-TTFB': String(ttfb),
    }});
  })());
});
