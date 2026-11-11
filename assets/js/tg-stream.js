/* ============================================================================
 * W CINEMA — TELEGRAM CDN PLAYER
 * ============================================================================
 *
 * VAZIFA
 *   Saytda film bosilganda video shu joyda (modal ichida) ochiladi —
 *   t.me ga o'tib ketmaydi. Telegram media baytlari brauzer tomonidan
 *   olinadi; Telegram CDN berilsa u ham ishlatilishi mumkin.
 *
 *   SAYT ORIGINIGA MEDIA BAYTLARI RELAY QILINMAYDI. Sayt baribir HTML,
 *   JavaScript, API, rasmlar va autentifikatsiyani xizmat qiladi. Bu origin
 *   video trafikini kamaytiradi, ammo nol yuk yoki minglab tomoshabin
 *   kafolati emas.
 *
 * QANDAY ISHLAYDI (uch qatlam)
 *
 *   1) Teleproto — brauzerga moslab yig'ilgan MTProto klient (~600 KB gzip).
 *      Mavjud GramJS bundle avtomatik fallback va `?tgengine=gramjs` bilan
 *      saqlanadi. Sessiya kaliti faqat brauzer localStorage'ida qoladi.
 *
 *   2) tg-cdn-worker.js — Service Worker.
 *      `tgfile/?size=N` so'rovini ushlab, 206 Partial Content qaytaradi.
 *      U Telegram'dan o'zi so'ramaydi: kerakli baytlarni sahifadan
 *      MessageChannel orqali so'raydi. Sababi — Telegram SDK Service Worker
 *      muhitida ishonchsiz.
 *
 *   3) shu fayl  <video src="tgfile/?size=N">  — odatdagi HTML5 player.
 *      Saytdagi mavjud Telegram-ko'rinishidagi boshqaruv (play, seek,
 *      ovoz, to'liq ekran) `udp-player` orqali avtomatik ulanadi.
 *
 * OCHIQ OYLMASLIGI (MUHIM)
 *   * auth_key  — faqat localStorage'da. Serverga uzatilmaydi.
 *   * 2FA parol — HECH QAYERDA saqlanmaydi: serverga ham, localStorage'ga
 *     ham yozilmaydi. Faqat shu sahifaning xotirasida (JS o'zgaruvchisi)
 *     va kiritilgach darhol yo'q qilinadi.
 *
 * FORMAT MUAMMOSI
 *   Telegram kanallarida MKV (Matroska) va HEVC/H.265 videolar ko'p.
 *   Chrome ularni <video> bilan o'ynata olmaydi. Shuning uchun video
 *   URL berilishidan OLDIN sarlavha o'qilib, format aniqlanadi:
 *     MP4 + H.264/AAC -> <video> ga ulanadi
 *     boshqasi        -> aniq sabab + "Telegram ilovasida ochish"
 *   (formatni bilmasak, foydalanuvchi chalkash "format qo'llab-quvvatlanmaydi"
 *   xatosini ko'radi va transportni aybdor deb o'ylaydi).
 * ========================================================================== */
(function (global) {
  'use strict';

  var CFG = {
    memKey: 'wc_mtproto_auth_v1'
  };

  // DIQQAT: `window.APP` ni SKRIPT YUKLANISHI VAQTIDA emas, har chaqirganda
  // jonli o'qib turamiz. Aks holda skript `window.APP` dan KEYIN yuklansa,
  // barcha manzillar bo'sh qoladi ('/tgfile/' -> 'tgfile/') va API kalitlari
  // topilmaydi.
  function base() {
    return (global.APP || {}).base || '';
  }
  function fileUrl()   { return base() + '/tgfile/'; }

  // Joriy hujjat id'si — R2 prefiks keshi uchun (`?doc=`).
  //
  // Hujjat hali aniqlanmagan bo'lsa bo'sh satr qaytadi: Service Worker
  // R2 ni umuman ishlatmaydi va avvalgi yo'l bilan ishlaydi. Ya'ni bu
  // qo'shimcha hech qanday holatda oqimni buzmaydi.
  function docQ() {
    var id = (S.loc && S.loc.id != null) ? S.loc.id
      : (S.doc && S.doc.id != null) ? S.doc.id : null;
    return (id == null || id === '') ? '' : '&doc=' + encodeURIComponent(String(id));
  }

  // Probe aniqlagan konteynerdan haqiqiy MIME. Brauzer shu sarlavhani
  // ko'radi: `video/mp4` deb yozib, MKV berilsa, Chrome faylni ochmaydi.
  function mimeOf(probe) {
    var n = String((probe && probe.containerName) || '').toUpperCase();
    if (n.indexOf('MKV') !== -1 || n.indexOf('MATROSKA') !== -1) return 'video/x-matroska';
    if (n.indexOf('WEBM') !== -1) return 'video/webm';
    if (n.indexOf('AVI') !== -1) return 'video/x-msvideo';
    if (n.indexOf('MP4') !== -1 || n.indexOf('ISO') !== -1 || n === '') return 'video/mp4';
    return 'video/mp4';
  }
  // Qaysi bundle ishlatiladi.
  //
  // Teleproto bundle hozircha brauzerda yiqiladi ("process is not defined"):
  // u Node muhiti uchun qurilgan. Shuning uchun STANDART — GramJS
  // (`tg-client.bundle.js`), u barqaror ishlaydi. Teleproto'ni sinab ko'rish
  // kerak bo'lsa, URL'ga `?tgengine=teleproto` qo'shiladi.
  var legacyBundle = true;
  try { legacyBundle = new URLSearchParams(location.search).get('tgengine') !== 'teleproto'; }
  catch (e) { legacyBundle = true; }
  function bundlePath(gz) {
    var name = legacyBundle ? 'tg-client.bundle.js' : 'teleproto-client.bundle.js';
    var path = base() + '/assets/js/' + name + (gz ? '.gz' : '');
    var version = Number(global.__WCBUNDLEV) || 0;
    return path + (version ? '?v=' + version : '');
  }
  function bundleUrl()  { return bundlePath(false); }
  function bundleGz()   { return bundlePath(true); }

  // Brauzer siqilgan faylni o'zida ocha oladimi?
  // (Chrome/Edge 80+, Firefox 113+, Safari 16.4+)
  function canGunzip() {
    return typeof global.DecompressionStream === 'function';
  }
  function swUrl()     { return base() + '/tg-cdn-worker.js'; }
  function swScope()   { return base() + '/'; }

  // ---------------------------------------------------------------- holat
  //
  // Bitta sahifada BITTA Telegram klienti yuradi. Sababi: bir auth_key
  // bilan ikki klient ochilsa, ular bir-birining paketlariga aralashadi
  // va Telegram "AUTH_BYTES_INVALID" beradi.
  var S = {
    client: null,          // joriy TelegramClient
    T: null,               // Teleproto yoki GramJS namespace (window.TgBundle)
    chan: null,            // SW bilan bog'liq MessageChannel
    size: 0,               // joriy fayl hajmi
    doc: null,             // joriy hujjat (FileLocation uchun)
    loc: null,             // InputDocumentFileLocation
    totalRead: 0,
    mount: null,           // joriy mount elementi
    cfg: null,             // udp-player konfiguratsiyasi
    job: 0,                // eskirgan ishni aniqlash uchun (job token)
    reg: null,             // registerWorker natijasi (Promise, keshlanadi)
    connecting: null,      // Telegram sessiyasini ochish (Promise, keshlanadi)
    connectingMode: null,  // `connecting` qaysi rejimda (qr | phone)
    authEpoch: 0,          // rejim almashsa eski oqimni bekor qilish uchun
    reloading: false,      // sahifa bir marta qayta yuklandimi
    play: null,            // tg-play.js oqimi (MKV/HEVC uchun), null = tabiiy
    playAbort: null,       // joriy oqimni to'xtatish uchun AbortController
    playLib: null,         // tg-play.js moduli (bir marta import qilinadi)
    me: null,              // joriy Telegram akkaunti (getMe natijasi)
    pvCache: null,         // { "kanal/post": {t, doc, size, loc, probe} } kesh
    prefetchKey: null,     // oldindan yuklanayotgan hujjat kaliti
    prefetchPromise: null, // oldindan yuklash promise
    prefetchAbort: null,   // uni to'xtatish uchun funksiya
    onPlayerReady: null,   // mount(onReady) — player o'ynashga tayyor bo'lganda
    readyFired: false,     // onReady bir marta chaqirilishi uchun
    headCache: null,       // { docId: {t, bytes} } — fayl BOSHIDAGI baytlar
    docSize: null,         // { docId: bayt } — butun fayl hajmi
    fast: null,            // minimal MTProto klient (25 KB) — GramJS'siz oqim
    fastBroken: false,     // tez yo'l ishlamadi → eski (GramJS) yo'lga qaytamiz
    mountOpts: null        // joriy mount opts (tez yo'l ishlamasa qayta ishga tushirish uchun)
  };

  // ------------------------------------------------------------------- yordam
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function apiCfg() {
    var t = (global.APP || {}).tg || {};
    return { id: Number(t.apiId) || 0, hash: String(t.apiHash || '') };
  }

  // ============================================ 1b. TEZ MTProto klient (minimal)
  //
  // NIMA UCHUN:
  //   `tg-client.bundle.js` — 5.4 MB (gzip'da 718 KB). Brauzerda parse qilish
  //   o'lchilgan: ~570 ms (Node), mobil brauzerda ~0.8–1.4 s. U video oqimi
  //   uchun FAQAT `upload.getFile` (baytlarni olish) ishlatiladi.
  //
  //   `assets/js/tg-mtproto.js` — shu vazifani ~25 KB bilan bajaradi
  //   (teleproto/GramJS kodi asosida, `.work/tools/tg-mtproto.test.mjs` da
  //   bayt-an-bayt tekshirilgan). Shu bilan 5.4 MB bundle umuman yuklanmaydi.
  //
  //   Klient Telegram DC'ga to'g'ridan-to'g'ri WebSocket orqali ulanadi —
  //   video baytlari sayt serveridan O'TMAYDI.
  var fastClientPromise = null;

  function fastClient() {
    if (fastClientPromise !== null) return fastClientPromise;
    fastClientPromise = (function () {
      try {
        if (!global.TgFast || typeof global.TgFast.createClient !== 'function') return null;
        var saved = loadSession();
        if (!saved) return null;
        var a = apiCfg();
        if (!a.id) return null;
        return global.TgFast.createClient({
          apiId: a.id,
          apiHash: a.hash,
          session: saved,
          deviceModel: 'W CINEMA Web',
          systemVersion: '1.0',
          appVersion: '1.0'
        });
      } catch (e) {
        return null;
      }
    })();
    return fastClientPromise;
  }

  // Ulanishni sahifa YO'KLANAYOTGAN paytda boshlaymiz — TLS handshake HTML
  // parse qilinishi bilan PARALLEL ketadi. Video bosilganda ulanish allaqachon
  // tayyor bo'ladi (~150–300 ms tejaladi).
  function warmFast() {
    var f = fastClient();
    if (!f) return;
    try { f.warm().catch(function () {}); } catch (e) {}
  }

  // ------------------------------------------------------- hujjat metama'lumot
  //
  // Hujjat joylashuvi (id / access_hash / file_reference / dc_id) — video
  // oqimining kaliti. Uni oldindan bilamiz — GramJS bundle'i va `findDoc`
  // RPC'si umuman kerak bo'lmaydi.
  var DOC_META_KEY = 'wc_tg_docmeta_v1';
  var DOC_META_TTL = 30 * 60 * 1000;      // 30 daqiqa (file_reference ~24 soat yashaydi)

  function b64ToU8(b64) {
    try {
      var bin = atob(String(b64 || '').replace(/-/g, '+').replace(/_/g, '/'));
      var out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    } catch (e) { return new Uint8Array(0); }
  }
  function u8ToB64(u8) {
    if (!u8 || !u8.length) return '';
    var bin = '';
    for (var i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
    try { return btoa(bin); } catch (e) { return ''; }
  }

  // GramJS `bytes` serializer Buffer yoki string qabul qiladi; Uint8Array
  // obyektini to'g'ridan-to'g'ri bersak "Bytes or str expected" xatosi chiqadi.
  function gramJsBytes(value) {
    var B = global.Buffer;
    var bytes;
    if (typeof value === 'string') {
      if (B && typeof B.from === 'function') return B.from(value, 'binary');
      return value;
    }
    if (value && value.type === 'Buffer' && Array.isArray(value.data)) value = value.data;
    if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) {
      bytes = new Uint8Array(value);
    } else if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(value)) {
      bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    } else if (Array.isArray(value)) {
      bytes = value;
    } else if (B && typeof B.isBuffer === 'function' && B.isBuffer(value)) {
      return value;
    } else {
      throw new Error('Telegram file_reference baytlari noto\'g\'ri turda');
    }
    if (B && typeof B.from === 'function') return B.from(bytes);
    // GramJS `bytes` maydoni Buffer yoki binary string qabul qiladi.
    // File reference kichik bo'lgani uchun bir baytli satr xavfsiz zaxira.
    var out = '';
    for (var i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
    return out;
  }

  function docMetaGet(key) {
    if (!key) return null;
    try {
      var raw = localStorage.getItem(DOC_META_KEY);
      if (!raw) return null;
      var all = JSON.parse(raw);
      var it = all && all[key];
      // `fr` (file_reference) BO'SH bo'lsa — bu metama'lumot ISHLATILMAYDI:
      // `upload.getFile` "FILE_REFERENCE_INVALID" bilan rad etiladi va
      // video umuman ochilmaydi. Bunday yozuvni butunlay tashlab yuboramiz.
      if (!it || !it.t || !it.id || !it.fr || (Date.now() - it.t) > DOC_META_TTL) return null;
      return it;
    } catch (e) { return null; }
  }

  function docMetaPut(key, doc) {
    if (!key || !doc) return;
    var vi = videoInfo(doc);
    docMetaSave(key, {
      t: Date.now(),
      id: String(doc.id),
      ah: String(doc.accessHash),
      fr: u8ToB64(doc.fileReference),
      dc: doc.dcId,
      size: bytesOf(doc),
      mime: doc.mime_type || '',
      fn: vi.filename || '',
      w: vi.w || 0, h: vi.h || 0, dur: vi.duration || 0
    });
  }

  // Metama'lumotni lokal keshga yozamiz (ko'p hujjat — 40 tagacha).
  function docMetaSave(key, meta) {
    if (!key || !meta) return;
    try {
      var raw = localStorage.getItem(DOC_META_KEY);
      var all = raw ? (JSON.parse(raw) || {}) : {};
      all[key] = meta;
      var keys = Object.keys(all);
      if (keys.length > 40) {
        keys.sort(function (a, b) { return (all[a].t || 0) - (all[b].t || 0); });
        for (var i = 0; i < keys.length - 40; i++) delete all[keys[i]];
      }
      localStorage.setItem(DOC_META_KEY, JSON.stringify(all));
    } catch (e) { /* kvota to'lgan bo'lishi mumkin — jim */ }
  }

  // Serverdagi keshdan hujjat metama'lumoti. Server uni Telegram orqali
  // yechib, saqlaydi — brauzer esa faqat tayyor ma'lumotni oladi (taxminan
  // 10 ms). Bu — birinchi ochilish uchun ham tez yo'lni ochadi.
  //
  // `file_reference` haqida (rasmiy hujjat: core.telegram.org/api/file-references):
  //   • U AKKAUNTGA bog'liq EMAS. Server uni hujjatning JORIY
  //     `document.file_reference` qiymati bilan solishtiradi; mos kelsa —
  //     qaysi akkauntdan bo'lsa ham qabul qilinadi.
  //   • U ESKIRADI (~1 soat). Eskirgan havola bilan `upload.getFile` →
  //     `FILE_REFERENCE_EXPIRED`. Yechim: xabarni QAYTA olib, yangi
  //     havolani olish (server buni `fresh=1` bilan qiladi).
  //
  // DIQQAT: agar bot olgan havola tomoshabbin akkauntida rad etilsa, bu
  // yo'l "ishlamaydi" — lekin bu HOLATDA ham video to'g'ri ochiladi, chunki
  // `gramFallback()` avtomatik eski (GramJS) yo'lga o'tadi va hujjatni
  // foydalanuvchining O'Z sessiyasi bilan qayta yechadi.
  var USE_SERVER_DOC_META = true;

  function docMetaFromServer(opts, fresh) {
    // `api/tg-doc.php` hujjatni BOT sessiyasi bilan yechadi, lekin
    // `file_reference` akkauntga bog'liq emas — server uni hujjatning joriy
    // qiymati bilan solishtiradi (core.telegram.org/api/file-references).
    // Eskirgan bo'lsa `fresh=1` bilan yangisi olinadi.
    // Agar bot ruxsatnomasi tomoshabbin akkauntida rad etilsa — `gramFallback()`
    // avtomatik GramJS yo'liga o'tadi, video to'g'ri ochiladi.
    if (!USE_SERVER_DOC_META) return Promise.resolve(null);
    if (!opts || !opts.channel || !opts.post) return Promise.resolve(null);
    var url = base() + '/api/tg-doc.php?ch=' + encodeURIComponent(opts.channel)
            + '&post=' + encodeURIComponent(opts.post)
            + (fresh ? '&fresh=1&_=' + Date.now() : '');
    var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    // 6 s: sovuq keshda server Telegram'dan hujjatni 3–8 s da yechadi.
    // 3 s da uzib qo'ysak, brauzer 5.4 MB GramJS bundle'iga tushib qolardi —
    // bu esa ancha SEKIN. Sokin kutish foydaliroq.
    var timer = ctl ? setTimeout(function () { try { ctl.abort(); } catch (e) {} }, fresh ? 12000 : 6000) : null;
    var init = { credentials: 'same-origin', cache: fresh ? 'no-store' : 'default' };
    if (ctl) init.signal = ctl.signal;
    return fetch(url, init)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (timer) clearTimeout(timer);
        // `fr` bo'sh bo'lsa — server eskirgan/buzilgan keshni bergan
        // bo'lishi mumkin. Bunday metama'lumotni ishlatmaganimizda eski
        // (GramJS) yo'l ishlaydi.
        if (!j || !j.ok || !j.id || !j.fr) return null;
        return {
          // Serverdagi kesh vaqti (havola qachon yangilangan) — eskirishni
          // aniqlash uchun kerak. Yo'q bo'lsa — hozirgi vaqt.
          t: Number(j.t) || Date.now(),
          id: String(j.id),
          ah: String(j.ah),
          fr: String(j.fr || ''),
          dc: j.dc,
          size: j.size,
          mime: j.mime || '',
          fn: j.fn || '',
          w: j.w || 0, h: j.h || 0, dur: j.dur || 0
        };
      })
      .catch(function () {
        if (timer) clearTimeout(timer);
        return null;
      });
  }

  // ---------------------------------------------------------------------------
  // KO'PLAB VIDEO METAMA'LUMOTI (bitta server so'rovi)
  // ---------------------------------------------------------------------------
  //
  // Saytga kirganda barcha videolarning hujjat ma'lumotini (id / access_hash /
  // file_reference / dc_id) OLDINDAN olib qo'yamiz. Keyin foydalanuvchi qaysi
  // videoni bossa ham — metama'lumoti tayyor, faqat BAYTLAR yuklanadi.
  // GramJS bundle'i (5.4 MB) umuman kerak bo'lmaydi.
  //
  // Server tomonida bitta HTTP so'rovi -> kanal bo'yicha bitta Telegram RPC.
  //
  // `list` — [{channel: 'kanal', post: 123}, ...]
  function prefetchMany(list) {
    if (!USE_SERVER_DOC_META || !list || !list.length) return Promise.resolve(0);

    // Allaqachon keshlanganlarni qaytarib tashlaymiz (serverga so'rov kam).
    var need = [];
    var seen = {};
    for (var i = 0; i < list.length; i++) {
      var it = list[i] || {};
      var ch = it.channel || it.ch;
      var post = Number(it.post || 0);
      if (!ch || !post) continue;
      var key = String(ch) + '/' + post;
      if (seen[key]) continue;
      seen[key] = 1;
      if (docMetaGet(key)) continue;      // brauzer keshida bor
      need.push({ ch: ch, post: post, key: key });
    }
    if (!need.length) return Promise.resolve(0);
    if (need.length > 120) need = need.slice(0, 120);

    var qs = [];
    for (var k = 0; k < need.length; k++) {
      qs.push(encodeURIComponent(need[k].ch) + ':' + need[k].post);
    }
    var url = base() + '/api/tg-doc.php?posts=' + qs.join(',');

    var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    // Server sovuq keshda Telegram'dan yechadi (kanal bo'yicha bitta RPC) —
    // 20 s gacha. Bu fon ishi; bosilgan video o'z vaqtida ochiladi.
    var timer = ctl ? setTimeout(function () { try { ctl.abort(); } catch (e) {} }, 25000) : null;
    var init = { credentials: 'same-origin' };
    if (ctl) init.signal = ctl.signal;

    return fetch(url, init)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (timer) clearTimeout(timer);
        if (!j || !j.ok || !j.items) return 0;
        var n = 0;
        for (var key in j.items) {
          if (!Object.prototype.hasOwnProperty.call(j.items, key)) continue;
          // Allaqachon bor yozuvni USTMA-UST qo'maymiz: GramJS orqali
          // olingan (foydalanuvchi akkauntiga tegishli) havola ustun.
          if (docMetaGet(key)) continue;
          var m = j.items[key];
          if (!m || !m.fr || !m.id) continue;
          docMetaSave(key, {
            t: Date.now(),
            id: String(m.id),
            ah: String(m.ah),
            fr: String(m.fr),
            dc: m.dc,
            size: m.size,
            mime: m.mime || '',
            fn: m.fn || '',
            w: m.w || 0, h: m.h || 0, dur: m.dur || 0
          });
          n++;
        }
        return n;
      })
      .catch(function () {
        if (timer) clearTimeout(timer);
        return 0;
      });
  }

  // ---------------------------------------------------------------------------
  // KO'PLAB VIDEO METAMA'LUMOTI — foydalanuvchining O'Z sessiyasi bilan
  // ---------------------------------------------------------------------------
  //
  // Nima uchun GramJS: `file_reference` ni Telegram foydalanuvchining O'Z
  // akkauntida beradi. Serverdagi bot sessiyasi bergan havola boshqa
  // akkauntda ishlamaydi (MadelineProto o'z `ReferenceDatabase` ini
  // qo'yadi — havolа har so'rovda o'zgaradi). GramJS esa Telegram'ning
  // o'z `file_reference` ini saqlaydi — aynan shu kerak.
  //
  // GramJS bundle'i sayt yuklanganda allaqachon yuklanmoqda (`verify()`),
  // shuning uchun bu bepul: kanal bo'yicha bitta RPC bilan hamma videolarning
  // metama'lumotini olamiz va lokal keshga yozamiz. Keyin bosilgan video
  // faqat BAYTLARINI yuklaydi (25 KB minimal klient, GramJS'siz).
  function prefetchManyGram(list) {
    if (!list || !list.length) return Promise.resolve(0);

    var need = [];
    var seen = {};
    for (var i = 0; i < list.length; i++) {
      var it = list[i] || {};
      var ch = String(it.channel || it.ch || '').replace(/^@/, '');
      var post = Number(it.post || 0);
      if (!ch || !post) continue;
      var key = ch + '/' + post;
      if (seen[key]) continue;
      seen[key] = 1;
      if (docMetaGet(key)) continue;      // brauzer keshida bor
      need.push({ ch: ch, post: post, key: key });
    }
    if (!need.length) return Promise.resolve(0);

    return ensureSession(silentView(), { fastPlayback: true }).then(function (client) {
      if (!client || !client.api || !client.api.channels) return 0;

      // Kanal bo'yicha guruhlaymiz — bitta RPC bilan o'sha kanalning
      // BARCHA postlari (Telegram flood himoyasi ham saqlanadi).
      var byCh = {};
      for (var k = 0; k < need.length; k++) {
        var g = byCh[need[k].ch] || (byCh[need[k].ch] = []);
        g.push(need[k]);
      }

      var saved = 0;
      var ps = [];
      Object.keys(byCh).forEach(function (ch) {
        var group = byCh[ch];
        var CHUNK = 20;   // bitta so'rovda ko'pi bilan 20 ta post
        for (var c = 0; c < group.length; c += CHUNK) {
          (function (chunk) {
            ps.push(
              client.api.channels.getMessages({
                channel: peerOf(ch),
                id: chunk.map(function (x) { return x.post; })
              }).then(function (r) {
                var msgs = (r && r.messages) || [];
                for (var mi = 0; mi < msgs.length; mi++) {
                  var msg = msgs[mi];
                  if (!msg || !msg.id) continue;
                  var doc = docOf(msg);
                  if (!doc) continue;
                  for (var pi = 0; pi < chunk.length; pi++) {
                    if (Number(chunk[pi].post) === Number(msg.id)) {
                      docMetaPut(chunk[pi].key, doc);
                      saved++;
                      // GramJS hujjatini RAM keshiga ham yozamiz — bosilganda
                      // `findDoc` RPC'si kerak bo'lmaydi (video darhol ochiladi).
                      try {
                        var dsize = bytesOf(doc);
                        var dloc = new S.T.Api.InputDocumentFileLocation({
                          id: doc.id,
                          accessHash: doc.accessHash,
                          fileReference: doc.fileReference,
                          thumbSize: ''
                        });
                        S.pvCache = S.pvCache || {};
                        S.pvCache[chunk[pi].key] = {
                          t: Date.now(), doc: doc, size: dsize, loc: dloc,
                          probe: quickPlaybackProbe(doc), fromGram: true
                        };
                      } catch (x) { /* loc qurish muvaffaqiyatsiz bo'lsa — jim */ }
                      break;
                    }
                  }
                }
              }).catch(function () { /* kanal ommaboy emas — jim */ })
            );
          })(group.slice(c, c + CHUNK));
        }
      });
      return Promise.all(ps).then(function () { return saved; });
    }).catch(function () { return 0; });
  }

  // Keshdagi metama'lumotdan GramJSga o'xshash "hujjat" obyektini yasaydi.
  function docMetaToDoc(it) {
    return {
      id: it.id,
      accessHash: it.ah,
      fileReference: b64ToU8(it.fr),
      dcId: it.dc,
      size: it.size,
      mime_type: it.mime || '',
      attributes: [
        { className: 'DocumentAttributeFilename', fileName: it.fn || '' },
        { className: 'DocumentAttributeVideo', w: it.w || 0, h: it.h || 0, duration: it.dur || 0 }
      ]
    };
  }

  // `FILE_REFERENCE_EXPIRED` / `_INVALID` xatosimi?
  function isFileRefErr(m) {
    // Telegram xato nomlari: FILE_REFERENCE_EXPIRED / _EMPTY / _INVALID
    // (ba'zi layerlarda raqamli variantlar ham bor). Kengaytirilgan qidiruv
    // — nomi o'zgargan bo'lsa ham, bu xatolar eski yo'lga o'tishni
    // talab qiladi.
    return /FILE_REFERENCE/.test(String(m || ''));
  }

  // Eskirgan `file_reference` ni serverdan YANGIDAN oladi.
  //
  // Telegram `file_reference` ni abadiy saqlamaydi (~1 soat). Keshda turgan
  // havola bilan `upload.getFile` chaqirilsa `FILE_REFERENCE_EXPIRED` keladi
  // va ilgari butun oqim yiqilib, foydalanuvchiga "Qayta urinish" tugmasi
  // chiqardi. Endi havolani yangilab, o'qishni o'zimiz davom ettiramiz.
  //
  // Bir vaqtda bir nechta o'qish so'rovi kelishi mumkin — shuning uchun
  // hujjat uchun bitta umumiy promise ishlatiladi (Telegram'ga bir marta
  // murojaat qilinadi).
  function refreshDocLoc(opts) {
    if (!opts || !opts.channel || !opts.post) return Promise.resolve(false);
    var key = String(opts.channel) + '/' + Number(opts.post);
    S.frRefresh = S.frRefresh || {};
    if (S.frRefresh[key]) return S.frRefresh[key];

    // Joriy (muvaffaqiyatsiz bo'lgan) havola — yangisi bilan solishtiramiz.
    var cur = '';
    try {
      if (S.loc && S.loc.fileReference) cur = u8ToB64(S.loc.fileReference);
    } catch (e) {}

    function apply(m) {
      if (!m || !m.fr) return false;
      docMetaSave(key, m);
      var doc = docMetaToDoc(m);
      var size = bytesOf(doc) || S.size;
      // Joriy hujjat boshqasi bo'lib qolgan bo'lsa (foydalanuvchi boshqa
      // videoga o'tgan) — unga tegmadim.
      if (S.doc && S.doc.id != null && String(S.doc.id) !== String(doc.id)) return false;
      S.doc = doc;
      S.loc = {
        id: doc.id,
        accessHash: doc.accessHash,
        fileReference: doc.fileReference,
        thumbSize: ''
      };
      if (size) S.size = size;
      if (S.pvCache && S.pvCache[key]) {
        S.pvCache[key].doc = doc;
        S.pvCache[key].loc = S.loc;
        S.pvCache[key].t = Date.now();
      }
      // Yangi havola bilan tez yo'l yana ishlaydi.
      S.fastBroken = false;
      return true;
    }

    // 1) Avval server KESHIDAN (tez, ~10 ms). Havolasi boshqacha bo'lsa —
    //    demak eskirgan bo'lib, yangisi tayyor.
    // 2) Xuddi shu bo'lsa — muammo eskirish emas. Kesh 5+ daqiqa eskirgan
    //    bo'lsa bir marta `fresh=1` bilan urinib ko'ramiz; aks holda darhol
    //    GramJS yo'liga o'tamiz (u TO'G'RINI yangilaydi).
    var p = docMetaFromServer(opts, false).then(function (m) {
      if (!m || !m.fr) return false;
      if (m.fr !== cur) return apply(m);
      var age = (Date.now() - (Number(m.t) || Date.now())) / 1000;
      if (age < 300) return false;
      return docMetaFromServer(opts, true).then(function (m2) {
        if (m2 && m2.fr && m2.fr !== cur) return apply(m2);
        return false;
      });
    }).catch(function () { return false; });

    S.frRefresh[key] = p.then(function (ok) {
      if (S.frRefresh) delete S.frRefresh[key];
      return ok;
    });
    return S.frRefresh[key];
  }

  // Tez yo'l ishlamasa (masalan `file_reference` eskirgan bo'lsa) — eski
  // (GramJS) yo'lga qaytamiz: hujjat qayta yechiladi.
  //
  // MUHIM: shu yerda buzilgan metama'lumot yozuvlari TOZALANADI. Aks holda
  // `mount()` -> `run()` yana xuddi shu buzilgan `S.pvCache` yozuviga
  // qaytadi va GramJS fallback'iga umuman chiqmaydi — video hech qachon
  // ochilmaydi (siklik).
  function fastFallback() {
    if (S.fastBroken) return;
    S.fastBroken = true;
    try {
      closeFastClient();
      purgeBrokenDocMeta();
      purgeCurrentDocMeta();
      var node = S.mount;
      var opts = S.mountOpts;
      if (!node || !opts) return;
      // `mount()` promise QAYTARMASDI (ichida `run()` ni o'zi boshqaradi),
      // shuning uchun `.catch()` chaqirish TypeError berardi.
      mount(node, opts);
    } catch (e) {}
  }

  // Tez yo'l ishlamadi — eski (GramJS) yo'lga o'tamiz.
  //
  // `FILE_REFERENCE_*` xatolarida `readOnceGram` ESKI havola bilan
  // ishga tushsa, Telegram uni ham rad etadi. Shuning uchun hujjatni QAYTA
  // yechish kerak — buni `fastFallback()` qiladi (mount'ni qayta ishga
  // tushiradi → `findDoc()` foydalanuvchi sessiyasi orqali yangi havola
  // oladi).
  function gramFallback(e) {
    if (!S.fastBroken) fastFallback();
    throw e;
  }

  // Joriy hujjatning metama'lumotini (RAM keshi + localStorage) tozalaydi.
  // Eskirgan `file_reference` bilan yozilgan yozuv qolsa, keyingi ochilishda
  // yana xuddi shu xato takrorlanadi.
  function purgeCurrentDocMeta() {
    try {
      var o = S.mountOpts;
      if (!o || !o.channel || !o.post) return;
      var key = String(o.channel) + '/' + Number(o.post);
      if (S.pvCache && S.pvCache[key]) delete S.pvCache[key];
      var raw = localStorage.getItem(DOC_META_KEY);
      if (!raw) return;
      var all = JSON.parse(raw) || {};
      if (!all[key]) return;
      delete all[key];
      localStorage.setItem(DOC_META_KEY, JSON.stringify(all));
    } catch (e) { /* jim */ }
  }

  // Tez (minimal MTProto) klientni yopadi.
  //
  // GramJS klienti bilan bir xil auth_key ustida parallel sessiya ochilsa,
  // Telegram "AUTH_KEY_DUPLICATED" beradi — sessiya butunlay bekor
  // qilinadi va foydalanuvchi login sahifasiga tushib qoladi. Shuning uchun
  // eski yo'liga o'tishda tez klient ALMASH ib qoldiriladi.
  function closeFastClient() {
    if (S.fast) { try { S.fast.close(); } catch (e) {} }
    S.fast = null;
  }

  // `file_reference` yo'q joylashuv — bunday hujjatni Telegram yuklab
  // bermaydi (FILE_REFERENCE_INVALID).
  function hasFileRef(loc) {
    if (!loc) return false;
    var fr = loc.fileReference;
    if (!fr) return false;
    if (typeof fr.length === 'number') return fr.length > 0;
    return true;
  }

  // Buzilgan metama'lumot yozuvlarini (RAM keshi + localStorage) tozalaydi.
  // Tez yo'ldan kelgan (`fromFast`) yozuvlar ham tozalanadi — ular eski
  // (GramJS) yo'lga o'tganda qayta ishlatilmasin.
  function purgeBrokenDocMeta() {
    try {
      if (S.pvCache) {
        Object.keys(S.pvCache).forEach(function (k) {
          var e = S.pvCache[k];
          if (!e || e.fromFast || !e.loc || !hasFileRef(e.loc)) delete S.pvCache[k];
        });
      }
      var raw = localStorage.getItem(DOC_META_KEY);
      if (raw) {
        var all = JSON.parse(raw) || {};
        var changed = false;
        Object.keys(all).forEach(function (k) {
          if (!all[k] || !all[k].fr) { delete all[k]; changed = true; }
        });
        if (changed) localStorage.setItem(DOC_META_KEY, JSON.stringify(all));
      }
    } catch (e) { /* jim */ }
  }

  // ====================================================== 1. Telegram SDK
  //
  // Faqat video ochilganda lazy-load qilinadi. Standart — GramJS; xohishga
  // ko'ra `?tgengine=teleproto` bilan Teleproto denenadi.
  var bundlePromise = null;

  function loadBundle(onProgress) {
    if (global.TgBundle && global.TgBundle.TelegramClient
        && (legacyBundle ? !global.TgBundle.__engine : global.TgBundle.__engine === 'teleproto')) {
      return Promise.resolve(global.TgBundle);
    }
    if (bundlePromise) return bundlePromise;

    bundlePromise = (function () {
      // ------------------------------------------------------------------
      // 1) SIQILGAN NUSXA (afzal yo'l)
      //
      // Teleproto gzip bundle brauzerda ochiladi; GramJS eski fallback bo'lib qoladi.
      //
      // DIQQAT: server javobni SIQIB yuborsa Content-Length YO'Q bo'ladi
      // (u siqilgan hajmni ko'rsatadi, biz esa yoyilganini sanaymiz).
      // Shuning uchun oqimni `total` ga QARAMASIZ o'qib ketamiz — aks
      // holda fayl ikki marta yuklanardi (eng sekin holatda eng ko'p yuk).
      //
      // 2) ODDIY NUSXA (zaxira) — eski brauzer, yoki .gz fayl yo'q bo'lsa.
      if (global.fetch && global.ReadableStream && global.Blob && global.URL) {
        if (canGunzip()) {
          return fetch(bundleGz(), { credentials: 'same-origin' })
            .then(function (res) {
              if (!res.ok || !res.body) throw new Error('gz yo q');
              var total = Number(res.headers.get('Content-Length')) || 0;
              var reader = res.body
                .pipeThrough(new global.DecompressionStream('gzip'))
                .getReader();
              var chunks = [], got = 0;
              return (function pump() {
                return reader.read().then(function (r) {
                  if (r.done) {
                    return injectScript(
                      URL.createObjectURL(new Blob(chunks, { type: 'text/javascript' }))
                    );
                  }
                  chunks.push(r.value);
                  got += r.value.length;
                  if (onProgress) onProgress({ bytes: got, total: total });
                  return pump();
                });
              })();
            })
            .catch(function () { return loadPlain(); });   // .gz ishlamadi
        }
        return loadPlain();
      }
      return injectScript(bundleUrl());

      // Oddiy (siqilmagan) yuklash — har doim ishlaydi.
      function loadPlain() {
        return fetch(bundleUrl(), { credentials: 'same-origin' })
          .then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            var total = Number(res.headers.get('Content-Length')) || 0;
            if (!res.body) return injectScript(bundleUrl());
            var reader = res.body.getReader();
            var chunks = [], got = 0;
            return (function pump() {
              return reader.read().then(function (r) {
                if (r.done) {
                  return injectScript(
                    URL.createObjectURL(new Blob(chunks, { type: 'text/javascript' }))
                  );
                }
                chunks.push(r.value);
                got += r.value.length;
                if (onProgress) onProgress({ bytes: got, total: total });
                return pump();
              });
            })();
          })
          .catch(function () { return injectScript(bundleUrl()); });
      }
    })();

    // Standart — GramJS. Agar `?tgengine=teleproto` bilan Teleproto tanlangan
    // bo'lsa-yu u yuklanmasa/yaroqsiz bo'lsa, GramJS'ga avtomatik qaytamiz.
    bundlePromise = bundlePromise.catch(function (err) {
      if (legacyBundle) throw err;
      legacyBundle = true;
      bundlePromise = null;
      global.TgBundle = null;
      return loadBundle(onProgress);
    });

    return bundlePromise;
  }

  function injectScript(src) {
    return new Promise(function (res, rej) {
      // Blob manzil bo'lsa, skript ishga tushgach uni bo'sh qilamiz — aks
      // holda har film ochilishida 5 MB xotira brauzerda bir qolib ketadi.
      var blob = src.indexOf('blob:') === 0;
      var s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.onload = function () {
        if (blob) { try { URL.revokeObjectURL(src); } catch (e) {} }
        var bundle = global.TgBundle;
        var matches = bundle && bundle.TelegramClient
          && (legacyBundle ? !bundle.__engine : bundle.__engine === 'teleproto');
        if (matches) res(bundle);
        else rej(new Error('Telegram client bundle kutilgan API bilan yuklanmadi'));
      };
      s.onerror = function () {
        if (blob) { try { URL.revokeObjectURL(src); } catch (e) {} }
        rej(new Error('GramJS yuklanmadi'));
      };
      document.head.appendChild(s);
    });
  }

  // ======================================================= 2. localStorage
  function loadSession() {
    try { return localStorage.getItem(CFG.memKey) || ''; } catch (e) { return ''; }
  }
  function saveSession(str) {
    try { localStorage.setItem(CFG.memKey, str); return true; }
    catch (e) { return false; }
  }

  // ======================================================== 3. QR / 2FA UI
  //
  // GramJS `token` ni XOM BAYTLAR sifatida beradi, Telegram esa
  // base64url matnini kutadi: tg://login?token=<base64url>
  function bytesToBase64Url(bytes) {
    var u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var bin = '';
    var STEP = 8192;                     // String.fromCharCode limitidan oshmaslik uchun
    for (var i = 0; i < u8.length; i += STEP) {
      bin += String.fromCharCode.apply(null, u8.subarray(i, i + STEP));
    }
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  // QR kodni chizish.
  //
  // NIMA UCHUN BU KODEK MUXIM? Skanerlash uchun uchta qoida bor, ularning
  // biri buzilsa ham telefon kodni topmaydi:
  //
  //   1) TINCH ZONA (quiet zone) — ISO/IEC 18004 bo'yicha kodning to'rt
  //      tomonida kamida 4 MODUL oq bo'sh joy bo'lishi SHART. Bu "bo'sh
  //      joy" kod chegarasini ajratib turadi. Uni yo'q qilsangiz, kod
  //      chetlarga tegib turadi va ko'pchilik skaner (jumladan Telegram)
  //      uni umuman topmaydi.
  //        Eski kod: scale = 200 / 33 = 6.06 → kod 198 px da chizilardi,
  //        canvas 200 px. Ya'ni tinch zon = 1 px. Sabab shu edi.
  //
  //   2) BUTUN MODUL — modul kengligi 6.0606 kabi KASRli bo'lsa,
  //      `fillRect` chegaralari yarim pikselga tushadi va modul chekkalari
  //      "jimgina" (anti-alias) bo'ladi. Skaner shuni ko'rmaydi.
  //      Modul o'lchami butun son bo'lishi SHART.
  //
  //   3) EKRAN ZOOMI — telefonlarda devicePixelRatio 2–3. 200x200 chizib
  //      200 px da ko'rsatsak, rasm ekranda xira bo'ladi. Biz canvas'ni
  //      DPR bo'yicha chizib, ko'rsatishda CSS px dan foydalanamiz.
  // QR login havolasi.
  //
  // Rasmiy shakl: `tg://login?token=<base64url>`.
  //
  // Nima uchun `https://t.me/login?token=` emas? Telegram ikkalasini ham
  // qabul qiladi, lekin `tg://` — kanonik shakl (core.telegram.org/api/links)
  // va QR skaner uni to'g'ridan-to'g'ri ilovaga uzatadi.
  //
  // `token` — GramJS bergan Buffer. Uni base64url ga o'girish kerak
  // (+ -> -, / -> _, = olib tashlanadi), aks holda QR belgisi buziladi.
  function tgLoginUrl(token) {
    return 'tg://login?token=' + bytesToBase64Url(token);
  }

  // Telegram logotipi (web.telegram.org/k `#logo`) — QR markazi uchun.
  var TG_LOGO_PATH = 'M80,0 C124.18278,0 160,35.81722 160,80 C160,124.18278 124.18278,160 80,160 '
    + 'C35.81722,160 0,124.18278 0,80 C0,35.81722 35.81722,0 80,0 Z '
    + 'M114.262551,46.4516129 L114.123923,46.4516129 C111.089589,46.5056249 106.482806,48.0771432 '
    + '85.1289541,56.93769 L81.4133571,58.4849956 C72.8664779,62.0684477 57.2607933,68.7965125 '
    + '34.5963033,78.66919 C30.6591745,80.2345564 28.5967328,81.765936 28.4089783,83.2633288 '
    + 'C28.0626453,86.0254269 31.8703852,86.959903 36.7890378,88.5302703 L38.2642674,89.0045258 '
    + 'C42.3926354,90.314406 47.5534685,91.7248852 50.3250916,91.7847532 C52.9151948,91.8407003 '
    + '55.7944784,90.8162976 58.9629426,88.7115451 L70.5121776,80.9327422 '
    + 'C85.6657026,70.7535853 93.6285785,65.5352892 94.4008055,65.277854 L94.6777873,65.216416 '
    + 'C95.1594319,65.1213105 95.7366278,65.0717596 96.1481181,65.4374337 '
    + 'C96.6344248,65.8695939 96.5866185,66.6880224 96.5351057,66.9075859 '
    + 'C96.127514,68.6448691 75.2839361,87.6143392 73.6629144,89.2417998 L73.312196,89.6016896 '
    + 'C68.7645143,94.2254793 63.9030972,97.1721503 71.5637945,102.355193 L73.3593638,103.544598 '
    + 'C79.0660342,107.334968 82.9483395,110.083813 88.8107882,113.958377 L90.3875424,114.996094 '
    + 'C95.0654739,118.061953 98.7330313,121.697601 103.562866,121.253237 '
    + 'C105.740839,121.052855 107.989107,119.042224 109.175465,113.09692 L109.246762,112.727987 '
    + 'C112.002037,98.0012935 117.417883,66.09303 118.669527,52.9443975 '
    + 'C118.779187,51.7924073 118.641237,50.318088 118.530455,49.6708963 L118.474159,49.3781963 '
    + 'C118.341081,48.7651315 118.067967,48.0040758 117.346762,47.4189793 '
    + 'C116.412565,46.6610871 115.002114,46.4638844 114.262551,46.4516129 Z';

  function qrRoundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Telegram uslubidagi QR: yumaloq modullar, "extra-rounded" burchaklar va
  // markazda Telegram logotipi. Tinch zona oq (skaner uchun ishonchli).
  function drawQR(container, text, size) {
    container.innerHTML = '';
    container.hidden = false;              // gizlangan holatdan chiqaramiz

    var qr = S.T.qrcode(0, 'M');
    qr.addData(text);
    qr.make();

    var count = qr.getModuleCount();        // masalan 33
    var QUIET = 4;                          // tinch zon: 4 modul
    var total = count + QUIET * 2;

    // Ko'rsatish o'lchami konteynerdan olinadi (u responsive). `devicePixelRatio`
    // kasr bo'lishi mumkin — modul o'lchamini butun songa yaxlitlaymiz.
    var disp = container.clientWidth || size || 260;
    var dpr = global.devicePixelRatio || 1;
    var perDev = Math.max(3, Math.round((disp / total) * dpr));
    var dev = perDev * total;
    var off = QUIET * perDev;

    var cv = document.createElement('canvas');
    cv.width = cv.height = dev;
    cv.style.width = cv.style.height = '100%';
    cv.style.display = 'block';
    var ctx = cv.getContext('2d');

    // Tinch zona — oq.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, dev, dev);

    function inFinder(r, c) {
      return (r < 7 && c < 7) || (r < 7 && c >= count - 7) || (r >= count - 7 && c < 7);
    }

    // Modullar — yumaloq nuqtalar (kichik bo'shliq bilan).
    var fg = '#0f0f0f';
    var pad = perDev * 0.06;
    var mod = perDev - pad * 2;
    ctx.fillStyle = fg;
    for (var r = 0; r < count; r++) {
      for (var c = 0; c < count; c++) {
        if (!qr.isDark(r, c) || inFinder(r, c)) continue;
        qrRoundRect(ctx, off + c * perDev + pad, off + r * perDev + pad, mod, mod, perDev * 0.4);
        ctx.fill();
      }
    }

    // Uchta burchak belgisi — "extra-rounded".
    function finder(mr, mc) {
      var x = off + mc * perDev, y = off + mr * perDev, s = 7 * perDev;
      ctx.fillStyle = fg;
      qrRoundRect(ctx, x, y, s, s, perDev * 1.7); ctx.fill();
      ctx.fillStyle = '#fff';
      qrRoundRect(ctx, x + perDev, y + perDev, 5 * perDev, 5 * perDev, perDev * 1.15); ctx.fill();
      ctx.fillStyle = fg;
      qrRoundRect(ctx, x + 2 * perDev, y + 2 * perDev, 3 * perDev, 3 * perDev, perDev * 0.8); ctx.fill();
    }
    finder(0, 0); finder(0, count - 7); finder(count - 7, 0);

    // Markazda Telegram logotipi. AVVAL oq doira chizamiz: u ostidagi
    // modullarni to'sadi va logotipdagi samolyot "teshigi" oq ko'rinadi
    // (aks holda teshikdan QR'ning qora modullari ko'rinib, xunuk bo'ladi).
    // Kichik oq hoshiya logotip modullarga tegmasligini ta'minlaydi.
    try {
      var logo = dev * 0.21;
      var cx = dev / 2, cy = dev / 2;
      ctx.save();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(cx, cy, logo * 0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.translate(cx - logo / 2, cy - logo / 2);
      ctx.scale(logo / 160, logo / 160);
      ctx.fillStyle = '#3390ec';
      ctx.fill(new Path2D(TG_LOGO_PATH), 'evenodd');
      ctx.restore();
    } catch (e) { /* Path2D bo'lmasa — logosiz davom etamiz */ }

    container.appendChild(cv);
  }

  // =========================================== Sessiya holati yordamchilari
  //
  // Kalit Telegram tomonidan BEKOR QILINGANINI bildiruvchi xatolar. Bunday
  // holatda kalitni tozalab, foydalanuvchini login sahifasiga qaytaramiz.
  function isAuthError(m) {
    return /AUTH_KEY_UNREGISTERED|AUTH_KEY_INVALID|SESSION_REVOKED|SESSION_EXPIRED|USER_DEACTIVATED|AUTH_KEY_DUPLICATED|AUTH_BYTES_INVALID|AUTH_RESTART/.test(String(m || ''));
  }

  function clearSession() {
    try { localStorage.removeItem(CFG.memKey); } catch (e) {}
    try { localStorage.removeItem('wc_tg_me_v1'); } catch (e) {}
    try { localStorage.removeItem('wc_tg_photo_v1'); } catch (e) {}
    S.me = null;
  }

  // Joriy Telegram akkauntni localStorage'ga ham yozamiz — shunda profil
  // sahifasi qayta ulanmasdan (getMe) ism/username'ni ko'rsata oladi.
  function saveMe(meObj) {
    S.me = meObj || null;
    try {
      if (meObj) {
        localStorage.setItem('wc_tg_me_v1', JSON.stringify({
          id: meObj.id != null ? String(meObj.id) : '',
          firstName: meObj.firstName || '',
          lastName: meObj.lastName || '',
          username: meObj.username || ''
        }));
      } else {
        localStorage.removeItem('wc_tg_me_v1');
      }
    } catch (e) {}
  }

  // =========================================== Kirish xabarnomasi (Telegram push)
  //
  // MTProto sessiya tikilgach serverga BIR MARTA `action=hello` yuboramiz.
  // Server ham `notifications` ga yozadi, ham Telegram Bot orqali shaxsiy
  // chat'iga "Hisobga kirdingiz" xabarini yuboradi. Deduplik serverda
  // (5 daqiqa), shuning uchun qayta-qayta chaqirish zararli emas.
  //
  // Muhim: bu so'rov Telegram sessiyasidan MUSTAQIL, `catch` da jim
  // yo'qotiladi — bildirishnoma yuborilmasa sayt ishlashda davom etadi.
  var HELLO_SENT = false;
  function pingLoginAlert() {
    if (HELLO_SENT) return;
    var me = S.me || null;
    if (!me || me.id == null) return;
    HELLO_SENT = true;
    try {
      var body = new URLSearchParams({ action: 'hello' });
      body.set('tg_me', JSON.stringify({
        id: String(me.id),
        firstName: me.firstName || '',
        lastName: me.lastName || '',
        username: me.username || ''
      }));
      fetch(base() + '/api/notifications.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        credentials: 'same-origin',
        keepalive: true
      }).catch(function () {});
    } catch (e) {}
  }

  // Baytlarni data-URL ga o'giradi (profil rasmi uchun).
  function bytesToDataUrl(bytes, mime) {
    var u8 = (bytes instanceof Uint8Array) ? bytes : new Uint8Array(bytes || []);
    var bin = '';
    var STEP = 8192;
    for (var i = 0; i < u8.length; i += STEP) {
      bin += String.fromCharCode.apply(null, u8.subarray(i, i + STEP));
    }
    return 'data:' + (mime || 'image/jpeg') + ';base64,' + btoa(bin);
  }

  // Telegram profil rasmini yuklab, data-URL sifatida saqlaymiz. Profil
  // sahifasi va chap paneldagi avatar shu qiymatdan foydalanadi (serverga
  // hech narsa yuborilmaydi; rasm faqat shu brauzerda qoladi).
  function savePhoto(client, meObj) {
    try {
      var ph = meObj && meObj.photo;
      if (ph && ph.className === 'UserProfilePhotoEmpty') ph = null;
      if (!client || !ph) {
        if (meObj) { try { localStorage.removeItem('wc_tg_photo_v1'); } catch (e) {} }
        return;
      }
      client.downloadProfilePhoto(meObj, { isBig: false }).then(function (buf) {
        if (!buf) return;
        var u8 = (buf instanceof Uint8Array) ? buf : new Uint8Array(buf);
        if (!u8.length) return;
        var url = bytesToDataUrl(u8, 'image/jpeg');
        try { localStorage.setItem('wc_tg_photo_v1', url); } catch (e) {}
        try { global.dispatchEvent(new Event('wc:tgPhoto')); } catch (e) {}
      }).catch(function () { /* rasm olinmasa — harf bilan ko'rsatiladi */ });
    } catch (e) { /* jim */ }
  }

  // Joriy auth oqimini bekor qiladi (QR <-> raqam almashganda). Epoch'ni
  // oshiramiz — shunda eski `start()` tugaganda yangi klientni buzmaydi.
  function resetAuth() {
    S.authEpoch++;
    if (S.client) { try { S.client.disconnect(); } catch (e) {} }
    S.client = null;
    S.authed = false;
    S.connecting = null;
    S.connectingMode = null;
    saveMe(null);
  }

  // Xatoni foydalanuvchiga tushunarli matn + qaytish kerak bo'lgan formaga
  // aylantiradi. `retry`: 'qr' | 'phone' | 'code' | 'pwd' | ''.
  function friendlyError(m) {
    m = String(m || '');
    var fw = m.match(/^FLOOD_WAIT_(\d+)/);
    if (fw) return { err: 'Juda ko\u2018p urinish. ' + fw[1] + ' soniyadan keyin qayta urinib ko\u2018ring.', retry: 'code' };
    if (/PHONE_NUMBER_INVALID/.test(m)) return { err: 'Telefon raqami noto\u2018g\u2018ri. Mamlakat kodi bilan kiriting.', retry: 'phone' };
    if (/PHONE_NUMBER_BANNED/.test(m)) return { err: 'Bu raqam Telegram tomonidan bloklangan.', retry: 'phone' };
    if (/PHONE_NUMBER_FLOOD/.test(m)) return { err: 'Juda ko\u2018p urinish. Keyinroq qayta urinib ko\u2018ring.', retry: 'phone' };
    if (/PHONE_CODE_INVALID/.test(m)) return { err: 'Kod noto\u2018g\u2018ri. Qayta kiriting.', retry: 'code' };
    if (/PHONE_CODE_EXPIRED/.test(m)) return { err: 'Kod muddati tugadi. Qaytadan kod oling.', retry: 'phone' };
    if (/PASSWORD_HASH_INVALID/.test(m)) return { err: 'Parol noto\u2018g\u2018ri. Qayta urinib ko\u2018ring.', retry: 'pwd' };
    if (/API_ID_INVALID|API_ID_PUBLISHED_FLOOD/.test(m)) return { err: 'Server sozlamasi xato (API kalit). Administratorga murojaat qiling.', retry: 'qr' };
    if (isAuthError(m)) return { err: 'Telegram sessiyasi bekor qilingan. Qaytadan kiring.', retry: 'qr' };
    return { err: 'Xatolik: ' + esc(m), retry: '' };
  }

  // Login sahifasiga o'tish. Allaqachon shu sahifada bo'lsak — qayta
  // yo'naltirmaymiz (cheksiz halqani oldini oladi).
  function goLogin() {
    if (/\/tg-login\.php/.test(location.pathname)) return;
    var next = encodeURIComponent(location.pathname + location.search);
    location.replace(base() + '/tg-login.php?next=' + next);
  }

  // Telegram sessiyani ochish (kalit keshda bo'lsa — avtomatik)
  //
  // `view` — foydalanuvchiga ko'rsatiladigan joy (QR / parol maydoni uchun).
  // `view.setState(html, klass)` bilan holatni yangilaymiz.
  function ensureSession(view, opts) {
    opts = opts || {};
    var mode = opts.mode === 'phone' ? 'phone' : 'qr';
    var allowLogin = !!opts.allowLogin;
    // `saved` FUNKSIYA darajasida turishi SHART: u quyidagi `.then()`
    // zanjirining bir necha joyida (`.getMe()` bosqichida ham) ishlatiladi.
    // Ilgari u faqat birinchi `.then(function (T) {...})` ichida e'lon
    // qilinardi — natijada keyingi `.then()` da "saved is not defined"
    // ReferenceError chiqib, oddiy (fast bo'lmagan) pleer yo'li yiqilardi.
    var saved = loadSession();

    if (S.client && S.authed) return Promise.resolve(S.client);
    if (S.connecting && S.connectingMode === mode) return S.connecting;
    // Rejim o'zgardi (QR <-> raqam): eski oqimni bekor qilib, yangisini
    // boshlaymiz. Bitta klientda ikki oqim parallel yura olmaydi.
    if (S.connecting) resetAuth();

    var a = apiCfg();
    if (!a.id || !a.hash) {
      return Promise.reject(new Error(
        'Telegram API kalitlari yo\'q (serverda API_ID / API_HASH sozlanganmagan)'));
    }

    var epoch = S.authEpoch;
    S.connectingMode = mode;

    S.connecting = loadBundle(function (info) {
      // total bosh bo'lsa (siqilgan javob) foiz yolg'on bo'lardi · shuning
      // uchun faqat necha MB yuklanganini ko'rsatamiz.
      var mb = (info.bytes / 1048576).toFixed(1);
      var matn = info.total
        ? '<b>' + Math.min(99, Math.round(info.bytes / info.total * 100)) + '%</b> · ' + mb + ' MB'
        : mb + ' MB';
      view.setState('Telegram klienti yuklanmoqda …' + matn);
    })
      .then(function (T) {
        S.T = T;

        // Saqlangan satr buzilgan bo'lishi mumkin (eski format, qo'lda
        // o'zgartirilgan). `StringSession` konstruktori xato tashlasa —
        // kalitni tozalab, login sahifasiga qaytaramiz.
        var session;
        try {
          session = new T.StringSession(saved);
        } catch (e) {
          clearSession();
          var badErr = new Error('AUTH_REVOKED');
          badErr.errorMessage = 'AUTH_REVOKED';
          throw badErr;
        }

        var clientOptions = {
          connectionRetries: 3,
          app: { platform: 'web' }
        };
        if (T.__engine === 'teleproto') {
          if (typeof T.createWebSocketTransport !== 'function') {
            throw new Error('Teleproto uchun WebSocket transport mavjud emas');
          }
          clientOptions.transport = T.createWebSocketTransport();
        } else {
          // Fallback — eski GramJS brauzer WebSocket adapteri.
          clientOptions.networkSocket = T.PromisedWebSockets;
        }
        // Bitta auth_key bilan IKKI sessiya bir vaqtda ochilmasin.
        // Tez (minimal MTProto) klient hali ulangan bo'lishi mumkin —
        // GramJS ulanishidan OLDIN uni yopamiz, aks holda Telegram
        // "AUTH_KEY_DUPLICATED" beradi va sessiya butunlay bekor qilinadi.
        closeFastClient();

        S.client = new T.TelegramClient(session, a.id, a.hash, clientOptions);

        // Saqlangan sessiyada login oqimini boshlamaymiz. Odatiy tekshiruv
        // `getMe()` bilan tasdiqlaydi; video fast path esa ortiqcha RTT'siz
        // ulanib, birinchi `findDoc()` RPC'da sessiyani tasdiqlaydi.
        if (saved && !allowLogin) {
          return S.client.connect()
            .then(function () {
              // Video yo'lida `findDoc()` o'zi sessiyani tekshiradigan
              // Telegram RPC bo'ladi. Oldindan alohida `getMe()` kutmaymiz.
              if (opts.fastPlayback) return S.client;
              return S.client.getMe().then(function (me) {
                saveMe(me); savePhoto(S.client, me); pingLoginAlert();
                return S.client;
              });
            })
            .catch(function (e) {
              var m = (e && (e.errorMessage || e.message)) || String(e);
              if (isAuthError(m)) {
                clearSession();
                var er = new Error('AUTH_REVOKED');
                er.errorMessage = 'AUTH_REVOKED';
                throw er;
              }
              throw e;
            });
        }

        return S.client.start({
          // Raqamli kirish tanlansa — foydalanuvchidan raqam so'raymiz.
          // QR rejimida esa GramJS'ga QR'ga o'tishni bildiramiz.
          phoneNumber: function () {
            if (mode === 'phone' && typeof view.askPhone === 'function') {
              return view.askPhone();
            }
            var e = new Error('QR login');
            e.errorMessage = 'RESTART_AUTH_WITH_QR';
            throw e;
          },
          phoneCode: function (isCodeViaApp) {
            if (typeof view.askCode === 'function') return view.askCode(isCodeViaApp);
            return Promise.reject(new Error('Kod maydoni topilmadi'));
          },
          password: function () { return askPassword(view); },
          qrCode: function (o) {
            var token = o && o.token;
            // view.qrBox() — element HAR SAFAR qayta topiladi (mount()
            // izohiga qarang). To'g'ridan-to'g'ri `view.qrBox` desak, rasm
            // DOM dan ajratilgan eski elementga chizilardi va ko'rinmasdi.
            //
            // MUHIM: QR ichidagi matn TO'LIQ bo'lishi SHART.
            //
            // Rasmiy hujjat (core.telegram.org/api/qr-login):
            //   "The login token must be encoded using base64url, embedded in
            //    a tg://login?token=<base64url-encoded-token> URL and shown in
            //    the form of a QR code to the user."
            //
            // Ya'ni QR `AbCd...` emas, `tg://login?token=AbCd...` bo'lishi
            // kerak. GramJS o'z namunasi ham aynan shunday yozadi:
            //   `tg://login?token=${code.token.toString('base64url')}`
            //
            // Avval bu PREFIX yo'q edi. Telegram ilovasi "Link Desktop
            // Device" qoidasi kodni o'qiyapti, lekin u login havolasi
            // emasligini ko'rib rad etardi — foydalanuvchi uchun bu
            // "QR skaner qilinmaydi" degani.
            // 300 px — telefon kamerasi uchun qulay o'lcham.
            drawQR(view.qrBox(), tgLoginUrl(token), 260);
            view.setState('');
          },
          onError: function (err) {
            var m = (err && (err.errorMessage || err.message)) || 'noma';
            // 2FA — xato emas, normal jarayon: GramJS parolni so'raydi.
            if (m === 'SESSION_PASSWORD_NEEDED') { view.needPassword(); return false; }
            var f = friendlyError(m);
            if (typeof view.showError === 'function') view.showError(f.err);
            else view.setState('<span class="tgs-err">' + f.err + '</span>');
            // Tuzatib bo'ladigan xatolarda TO'XTAMAYMIZ: GramJS o'zi
            // `phoneNumber`/`phoneCode`/`password` ni qayta so'raydi va
            // tegishli forma yana ochiladi (masalan, noto'g'ri kod).
            // Qolgan (noma'lum, konfiguratsiya) xatolarda to'xtaymiz.
            var retryable = (f.retry === 'phone' || f.retry === 'code' || f.retry === 'pwd');
            return !retryable;
          }
        }).then(function () { return S.client; });
      })
      .then(function (c) {
        // Joriy Telegram akkauntini eslab qolamiz — unikal ko'rishni
        // aynan bitta odam bo'yicha sanash uchun. getMe() xato bersa
        // ham davom etamiz (me = null bo'lib qoladi).
        // Saqlangan sessiyada bu allaqachon yuqorida bajarilgan; qayta so'ramaymiz.
        if (opts.fastPlayback || (saved && !allowLogin)) return c;
        return c.getMe().then(
          function (me) { saveMe(me); savePhoto(c, me); pingLoginAlert(); return c; },
          function () { return c; }
        );
      })
      .then(function (c) {
        // Rejim almashgan bo'lsa — bu ESKI oqim natijasi, tashlab yuboramiz.
        // Aks holda u yangi klientni almashtirib qo'yardi.
        if (epoch !== S.authEpoch) {
          try { c.disconnect(); } catch (e) {}
          var restartErr = new Error('AUTH_RESTART');
          restartErr.errorMessage = 'AUTH_RESTART';
          throw restartErr;
        }
        S.authed = !opts.fastPlayback;
        try { saveSession(c.session.save()); } catch (e) { /* localStorage to'liq */ }
        return c;
      })
      .catch(function (e) {
        // Faqat JORIY oqim holatni tozalaydi — eski oqim tegsin yo'q.
        if (epoch === S.authEpoch) {
          S.client = null; S.authed = false;
          S.connecting = null; S.connectingMode = null;
        }
        throw e;
      });

    return S.connecting;
  }

  // 2FA paroli — FAQAT shu funksiya doirasida. Hech qayerga yozilmaydi.
  function askPassword(view) {
    view.needPassword();
    return new Promise(function (resolve) {
      var inp = view.pwdInput();
      if (!inp) return Promise.reject(new Error('Parol maydoni topilmadi'));
      function submit() {
        var v = inp.value;
        if (!v) { view.setState('<span class="tgs-err">Parol bo\'sh</span>'); return; }
        // Kiritilgan parolni DARHOL yo'q qilamiz (DOM va o'zgaruvchidan).
        inp.value = '';
        resolve(v);
      }
      var form = view.pwdForm();
      if (form) form.onsubmit = function (e) { e.preventDefault(); submit(); };
      setTimeout(function () { try { inp.focus(); } catch (e) {} }, 30);
    });
  }

  // ================================================== 4. Service Worker
  //
  // SW birinchi ochilishda sahifani BIR MARTA qayta yuklashni talab qiladi
  // (shunda uning `controller` bo'ladi). Bu brauzer qoidasi — boshqa yo'l
  // yo'q. Cheksiz halqaga tushmaslik uchun vaqt bilan cheklaymiz.
  var RELOAD_AT = 'wc_sw_reload_at';

  function getSwController() {
    try {
      if (!('serviceWorker' in navigator)) return null;
      if (!navigator.serviceWorker) return null;
      return navigator.serviceWorker.controller || null;
    } catch (e) {
      return null;
    }
  }

  function waitForController(ms) {
    return new Promise(function (res) {
      try {
        if (getSwController()) return res(true);
        var t = setTimeout(function () { res(!!getSwController()); }, ms);
        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.addEventListener('controllerchange', function () {
            clearTimeout(t); res(true);
          }, { once: true });
        } else {
          clearTimeout(t); res(false);
        }
      } catch (e) {
        res(false);
      }
    });
  }

  function mayReload() {
    var now = Date.now();
    var last = 0;
    try { last = Number(sessionStorage.getItem(RELOAD_AT)) || 0; } catch (e) {}
    if (now - last < 8000) return false;
    try { sessionStorage.setItem(RELOAD_AT, String(now)); } catch (e) {}
    return true;
  }

  // Faqat o'rnatadi — hech qanday reload, hech qanday kutish.
  // Sahifa ochilishida chaqiriladi, shuning uchun foydalanuvchi hech narsa
  // ko'rmasdan sahifasi sakramaydi.
  function registerWorker() {
    if (S.reg) return S.reg;

    if (!('serviceWorker' in navigator)) {
      return Promise.resolve(null);
    }

    S.reg = (async function () {
      try {
        // `updateViaCache: 'none'` — skript HAR DOIM serverdan olinadi.
        // Aks holda brauzer eski kodni HTTP keshidan beradi va yangi
        // tuzatishlar umuman qo'llanilmaydi (kod yangi, xato eskidek).
        var reg = await navigator.serviceWorker.register(swUrl(), {
          scope: swScope(),
          updateViaCache: 'none'
        });
        try { await navigator.serviceWorker.ready; } catch (e) {}
        return reg;
      } catch (e) {
        S.reg = null;
        return null;
      }
    })();

    return S.reg;
  }

  // To'liq eskalatsiya. FAQAT film ochilganda chaqiriladi.
  //
  // SW birinchi o'rnatilgach, o'sha sahifani boshqara olmaydi — bu brauzer
  // qoidasi (qoidani yo'l qilib bo'lmaydi), shuning uchun bir marta reload
  // zarur. Lekin bu "majburiy" bo'lgani uchun faqat foydalanuvchi video
  // ko'rmoqchi bo'lganda qilinadi: hech narsa ko'rmay kirgan sayt
  // sakramaydi.
  async function ensureWorker() {
    try {
      var reg = await registerWorker();

      if (getSwController()) return true;

      // 1) activate dagi clients.claim() yetib borishi kechikishi mumkin.
      if (await waitForController(3500)) return true;

      // 2) Aniq "homiylash" — bu har qachon ishlaydi, hatto sahifa SW
      //    faollashgandan KEYIN yuklangan bo'lsa ham.
      try {
        if (reg && reg.active) reg.active.postMessage({ type: 'claim' });
        if (await waitForController(2500)) return true;
      } catch (e) { /* keyingi bosqich */ }

      // 3) Sahifani qayta yuklash — BIR MARTA (8 soniya ichida yana qilinmaydi).
      if (mayReload()) {
        location.reload();
        return false;
      }

      // 4) Oxirgi chora: eskirgan ro'yxatni tozalab, butunlay qayta o'rnatish.
      //    Boshqa urinishda yana bir marta (reload yo'q) xarakat qilamiz.
      try {
        var rs = await navigator.serviceWorker.getRegistrations();
        for (var i = 0; i < rs.length; i++) await rs[i].unregister();
        S.reg = null;
      } catch (e) { /* bo'sh */ }
      return false;
    } catch (e) {
      return false;
    }
  }

  // ============================================ 5. SW bilan bayt almashish
  //
  // DIQQAT: `navigator.serviceWorker.controller` ni bir marta olib
  // SAQLAMASLIK KERAK. SW yangilanganda controller obyekti ALMASHADI va
  // eski obyektga yuborilgan xabarlar jimgina yo'qoladi. Har doim jonli
  // qiymatni so'raymiz.
  function swCtl() { return getSwController(); }

  // --- Ko'rilgan videoning keshini o'chirish -------------------------------
  //
  // FOYDALANUVCHI TALABI: bitta video oxirigacha ko'rilsa, uning keshda
  // qolgan bo'laklari JOY EGALLAMASIN — darhol o'chsin. Qayta bosilganda
  // video yangidan ochiladi. Buni Service Worker bajaradi (`drop` xabari),
  // chunki kesh Cache API'da, sahifa xotirasida emas.
  function lookDocId(doc) {
    if (doc == null) return '';
    var s = String(doc);
    return /^[0-9]{1,20}$/.test(s) ? s : '';
  }

  function dropDocCache(doc) {
    var ctl = swCtl();
    if (!ctl || !doc) return;
    try { ctl.postMessage({ type: 'drop', doc: doc }); } catch (e) { /* SW yo'q */ }
  }

  // Kesh kaliti `docQ()` bilan AYNAN bir xil bo'lishi shart (u `S.loc.id` ni
  // afzal ko'radi) — aks holda boshqa videoning keshi o'chib ketardi.
  function currentDocId() {
    var id = (S.loc && S.loc.id != null) ? S.loc.id
      : (S.doc && S.doc.id != null) ? S.doc.id : null;
    return lookDocId(id);
  }

  // Bitta tinglovchi butun hujjat uchun: preview/oddiy/remux — barchasi shu
  // yerga tushadi (video elementi qaysi yo'l bilan yaratilganidan qat'i nazar).
  // `loop` bo'lsa `ended` umuman otilmaydi, preview esa döngüde — tegilmaydi.
  try {
    document.addEventListener('ended', function (e) {
      var v = e.target;
      if (!v || v.tagName !== 'VIDEO' || v.loop) return;
      var d = v.getAttribute('data-wc-doc') || '';
      if (!d) {
        try {
          var u = new URL(v.currentSrc || v.src, location.href);
          if (/\/tgfile\/?$/.test(u.pathname)) d = u.searchParams.get('doc') || '';
        } catch (err) { d = ''; }
      }
      dropDocCache(lookDocId(d));
    }, true);
  } catch (e) { /* eski brauzer — kesh 24 soatlik TTL bilan o'chadi */ }

  // Prefiksni R2 ga yuklash mumkinmi?
  //
  // Mobil internetda 5 MB yuklash foydalanuvchining trafigini yeydi —
  // bunday holatda YUBORMAYMIZ (faqat o'qishdan foyda olamiz). Wi-Fi,
  // ethernet yoki tarmoq turi noma'lum bo'lsa — ruxsat.
  function canSeed() {
    try {
      var c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (c && c.saveData) return false;
      if (!c) return true;
      var t = String(c.type || '');
      if (t === 'cellular' || t === 'bluetooth' || t === 'none') return false;
      if (t === 'wifi' || t === 'ethernet' || t === 'wimax') return true;
      var et = String(c.effectiveType || '');
      if (et === 'slow-2g' || et === '2g') return false;
      return true;
    } catch (e) { return false; }
  }

  function connect() {
    var ctl = swCtl();
    if (!ctl) return false;
    try {
      if (S.chan) { try { S.chan.port1.close(); } catch (e) {} }
      S.chan = new MessageChannel();
      S.chan.port1.onmessage = onRead;
      S.chan.port1.start();
      ctl.postMessage({ type: 'provide', size: S.size }, [S.chan.port2]);
      // SW R2 keshini to'ldirishi uchun ruxsat (faqat Wi-Fi/ethernet).
      try { ctl.postMessage({ type: 'seed', ok: canSeed() }); } catch (e) {}
      // MP4 indeksini (moov) DARHOL oldindan yuklashni boshlaymiz. Shu
      // tufayli brauzer indeksni so'raganda u allaqachon keshda bo'ladi.
      var did = (S.loc && S.loc.id != null) ? S.loc.id
        : (S.doc && S.doc.id != null) ? S.doc.id : '';
      warmTail(S.size, did);
      return true;
    } catch (e) {
      return false;
    }
  }

  // Fayl oxirini (MP4 `moov` indeksini) fonda yuklashni boshlaydi.
  //
  // Nima uchun alohida funksiya: indeksni iloji boricha EARLIROQ so'rash
  // kerak — hatto player hali mount bo'lmagan (prefetch bosqichida) paytda.
  // SW hali tayyor bo'lmasa, `ensureWorker()` tugashini kutamiz va keyin
  // yuboramiz — xabar yo'qolmaydi.
  function warmTail(size, docId) {
    try {
      if (!(Number(size) > 0) || docId == null || docId === '') return;
      var msg = { type: 'warmtail', size: Number(size), doc: String(docId) };
      var ctl = swCtl();
      if (ctl) { ctl.postMessage(msg); return; }
      ensureWorker().then(function () {
        var c = swCtl();
        if (c) c.postMessage(msg);
      }).catch(function () { /* film ochilganda connect() yuboradi */ });
    } catch (e) { /* ixtiyoriy tezlashtirish */ }
  }

  // Telegram'dan aniq oraliqni o'qish.
  //
  // TELEGRAM QOIDALARI (biri buzilsa "LIMIT_INVALID" keladi):
  //   1) `offset` 4096 ga tekislangan bo'lishi SHART.
  //   2) `limit` 4096 ga karrali bo'lishi SHART.
  //   3) `limit` 1 MB dan KATTA bo'lmasligi SHART.
  //   4) Bitta so'rov 1 MB BLOK chegarasidan OSHIB KETMASLIGI SHART.
  //      Ya'ni `floor(offset / 1MB)` bilan
  //      `floor((offset + limit - 1) / 1MB)` bir xil bo'lishi kerak.
  //
  // 4-qoida amalda O'LCHAB TASDIQLANDI (520 MB MP4, DC4):
  //   offset=544178176 (blokda 32768 bayt qolgan):
  //     limit=32768 → OK,  limit=36864 → LIMIT_INVALID
  //   519MB+4096, limit=1044480 (aynan chegaraga) → OK
  //   519MB+4096, limit=1048576 (chegaradan oshadi) → LIMIT_INVALID
  //
  // Ilgari shu 4-qoida buzilardi: SW 512 KB bo'lakni 1 MB chegarasidan
  // kesib o'tib so'rardi, mediabunny esa kattaroq oraliq so'rardi.
  // Natijada `<video>` so'rovi 502 bo'lib, "format ochilmadi" degan
  // CHALG'ITUVCHI xabar chiqardi. Aslida formatda muammo YO'Q edi.
  //
  // Endi har bir Telegram so'rovi joriy 1 MB blok ichida qoladi, katta
  // oraliq esa bir necha bo'lakka bo'linib ketma-ket yig'iladi.
  var TG_LIMIT = 1024 * 1024;   // 1 MB — bitta so'rovning qattiq chegarasi
  var TG_BLOCK = 1024 * 1024;   // 1 MB — Telegram bo'lak chegarasi
  var TG_MIN = 4096;            // eng kichik ruxsat etilgan `limit`
  var tgCap = TG_LIMIT;         // Telegram nima desa, shunga moslashadi

  function isLimitError(m) {
    return /LIMIT_INVALID|FILE_PART_TOO_BIG|REQUEST_LARGE_INVALID/.test(String(m || ''));
  }

  // `offset` turgan 1 MB blokda yana qancha bayt bor. Har doim 4096 ga
  // karrali va kamida 4096 (shuning uchun hech qachon nol bo'lmaydi).
  function roomInBlock(offset) {
    var aligned = Math.floor(offset / 4096) * 4096;
    return TG_BLOCK - (aligned % TG_BLOCK);
  }

  // ------------------------------------------------- BOSH BAYTLAR KESHI
  //
  //  Bir faylning birinchi `HEAD_MAX` bayti. Nima uchun kerak:
  //
  //  * `probeMp4` formatni aniqlash uchun fayl boshidan 64 KB o'qiydi;
  //  * undan keyin `<video>` `tgfile/?size=…` manziliga yana so'rov yuboradi
  //    va SW faylni 0-dan o'qishni boshlaydi.
  //
  //  Xuddi shu 64 KB (va SW ning birinchi 1 MB tortishida kelgan qismi)
  // ikkinchi marta Telegram'dan so'ralmasligi uchun saqlanadi. Natijada:
  //  video o'ynash bir so'rov bilan (Telegram'ga umuman murojaat qilmasdan)
  //  boshlanadi.
  //
  //  Kesh KAM: 2 ta hujjat, har biri 512 KB (RAM da jami ~1 MB).
  //  DIQQAT: bu kesh OLDINDAN OLISH uchun emas, faqat `probeMp4` ning o'z
  //  baytlarini `<video>` ga qaytarish uchun. U hech qachon Telegram'dan
  //  qo'shimcha so'rov yubormaydi — ya'ni umuman trafik sarflamaydi.
  //  (Ilgari keyingi reel uchun 1 MB fon rejimida tortilar edi — u aktiv
  //  video bilan bir klientda raqobatlashib, global `tgCap` ni pasaytirib
  //  butun oqimni sekinlashtirardi. Endi bunday yo'q.)
  var HEAD_MAX = 1024 * 1024;     // bitta Telegram bloki — RAM da kam
  var HEAD_KEEP = 2;              // nechta hujjatni saqlaymiz

  // Kalit — hujjat id'si. MUHIM: `S.doc`/`S.loc` KESKGA YOZISH paytida
  // emas, SO'ROVNING BOSHI da olinadi. Aks holda (foydalanuvchi shu paytda
  // slaydni almastirsa) A reelining baytlari B reelining kaliti ostiga
  // yozilib, `<video>` B ga begona MP4 sarlavhasini olib berardi — video
  // umuman ochilmasdi. `S.loc` — haqiqiy o'qilayotgan manzil, shuning uchun
  // u har doim `S.doc` dan ishonchli.
  function headId(ctx) {
    var id = (ctx && ctx.loc && ctx.loc.id != null) ? ctx.loc.id
      : (S.loc && S.loc.id != null) ? S.loc.id
      : (S.doc && S.doc.id != null) ? S.doc.id : null;
    return (id == null || id === '') ? null : String(id);
  }

  // Butun fayl hajmi (kichik fayllar uchun). Bilamiz — kash chegarasidan
  // tashqariga chiqishda Telegram'ga bo'sh so'rov yubormaslik uchun kerak:
  // 700 KB li faylning 1 MB so'rovi javobsiz qaytadi.
  function headSize(id, size) {
    if (!id) return 0;
    S.docSize = S.docSize || {};
    if (size > 0) S.docSize[id] = size;
    return Number(S.docSize[id]) || 0;
  }

  // O'qilgan baytlarni keshga yozamiz (faqat fayl BOSHI uchun — qolgan
  // joylar cheksiz o'sib ketmasligi uchun).
  function headPut(id, off, u8) {
    if (!id || !u8 || !u8.length || off !== 0) return;
    if (u8.length > HEAD_MAX) u8 = u8.subarray(0, HEAD_MAX);
    S.headCache = S.headCache || {};
    var c = S.headCache;
    c[id] = { t: Date.now(), bytes: new Uint8Array(u8) };

    // Eskirganlarni tashlab, KAM joy saqlaymiz.
    var keys = Object.keys(c);
    if (keys.length > HEAD_KEEP) {
      keys.sort(function (a, b) { return c[a].t - c[b].t; });
      for (var i = 0; i < keys.length - HEAD_KEEP; i++) delete c[keys[i]];
    }
  }

  function headGet(id) {
    if (!id) return null;
    var c = S.headCache && S.headCache[id];
    return (c && c.bytes && c.bytes.length) ? c : null;
  }

  // --------------------------------------------- TO'LIQ FAYL KESHI (disk)
  //
  //  Yuqoridagi `headCache` faylning faqat BOSHINI (512 KB) RAM da saqlaydi.
  //  Bu kesh esa butun faylni brauzerning CacheStorage'ida (diskda) saqlaydi:
  //  bir marta ko'rilgan reel IKKINCHI marta Telegram'ga umuman murojaat
  //  qilmasdan ochiladi.
  //
  //  NIMA UCHUN FAQAT KICHIK FAYLLAR: kinolar 300 MB – 2 GB; ular uchun
  //  server tomonda `api/live.php` ning `storage/live_cache` LRU keshi bor.
  //  Brauzer kvotasi bunday hajmda beqaror, shuning uchun `docMax()`
  //  dan katta fayl shunchaki keshlanmaydi — oqim odatdagidek davom etadi.
  //
  //  MUHIM: bu kesh QO'SHIMCHA Telegram so'rovi YUBORMAYDI. U faqat oqim
  //  davomida ZATAN olingan baytlarni yon tomonga yozib boradi. Shu sababli
  //  olib tashlangan `warmHead` dagi muammo (fon prefetch aktiv oqim bilan
  //  raqobatlashib global `tgCap` ni pasaytirishi) bu yerda yo'q.
  //
  //  Sozlash: `window.TG_CACHE = { on: false }` — o'chirish,
  //             `window.TG_CACHE = { maxMb: 48 }` — chegarani oshirish.
  var DOC_CACHE_NAME = 'wc-media-v1';
  var DOC_CACHE_KEEP = 24;                 // diskda nechta fayl saqlanadi (LRU)
  var DOC_CACHE_BUDGET = 512 * 1024 * 1024; // jami hajm chegarasi (512 MB)
  var DOC_ACC_KEEP   = 1;                  // RAM da bir vaqtda nechta fayl yig'iladi

  function docMax() {
    var mb = Number((global.TG_CACHE || {}).maxMb);
    // 32 MB: ko'pchilik reels sig'adi, RAM uchun xavfsiz. REEL_MAX_UPLOAD_MB
    // (50) dan past — telefonda WebView xotirasi cheklangan.
    return (mb > 0 ? mb : 32) * 1024 * 1024;
  }

  // `caches` faqat xavfsiz kontekstda bor (https yoki localhost). LAN IP
  // orqali http'da ochilsa — kesh jimgina o'chadi, oqim buzilmaydi.
  function docOk() {
    try {
      return (global.TG_CACHE || {}).on !== false
        && !!(global.caches && global.caches.open && global.Blob);
    } catch (e) { return false; }
  }

  function docUrl(id) {
    // Bu manzil HECH QACHON fetch qilinmaydi — faqat CacheStorage kaliti.
    // Kalit Telegram hujjat id'si (butun tizimda yagona), URL emas: `tgfile/`
    // manzilida hujjat identifikatori yo'q, faqat `size` bor.
    return global.location.origin + '/__wc_media__/' + encodeURIComponent(id);
  }

  // --- yig'ish: oqim davomida kelgan bo'laklarni tutib turamiz -------------
  //
  // SW `readRangeParallel` bilan bo'laklarni TARTIBSIZ yuboradi, shuning uchun
  // shunchaki ketma-ket qo'shib borish yetmaydi — uzluksiz qismni har safar
  // qayta hisoblaymiz. Ustma-ust tushadigan bo'laklar ham hisobga olinadi
  // (`readOnce` offset'ni 4096 ga tekislaydi, shuning uchun takrorlanish mumkin).
  // `Map` — oddiy obyekt emas. Kalit Telegram hujjat id'si, ya'ni raqamli
  // matn; oddiy obyektda butun songa o'xshash kalitlar QO'SHILISH TARTIBIDA
  // emas, o'sib boruvchi tartibda saqlanadi. LRU "eng eskisini tashla"
  // mantiqi shuning uchun buzilardi. `Map` tartibni kafolatlaydi.
  var docAcc = new Map();

  function docContig(a) {
    var pos = 0;
    for (var i = 0; i < a.offs.length; i++) {
      var o = a.offs[i];
      if (o > pos) break;                       // bo'shliq — bu yergacha
      var end = o + a.parts[o].length;
      if (end > pos) pos = end;
    }
    return pos;
  }

  // LRU: ham SONI, ham JAMI HAJMI chegarada bo'lishi kerak. Faqat soni
  // bilan cheklash yetmaydi — 24 x 32 MB = 768 MB brauzer kvotasini
  // oshirib, `caches.put` ni abadiy rad qilishiga olib keladi.
  function docTrim() {
    return global.caches.open(DOC_CACHE_NAME).then(function (c) {
      return c.keys().then(function (ks) {
        return Promise.all(ks.map(function (k) {
          return c.match(k).then(function (r) {
            return {
              k: k,
              t: Number(r && r.headers.get('X-Wc-T')) || 0,
              n: Number(r && r.headers.get('X-Wc-Size')) || 0
            };
          });
        })).then(function (list) {
          list.sort(function (x, y) { return x.t - y.t; });   // eng eskisi boshida
          var total = 0;
          for (var i = 0; i < list.length; i++) total += list[i].n;

          var drop = [];
          // Avval sondan oshganini, keyin hajmdan oshganini tashlaymiz.
          var keep = list.length;
          while (keep > DOC_CACHE_KEEP) {
            keep--;
            drop.push(list[keep]);
            total -= list[keep].n;               // ular endi hisoblanmaydi
          }
          var j = 0;
          while (total > DOC_CACHE_BUDGET && j < keep) {
            drop.push(list[j]); total -= list[j].n; j++;
          }
          if (!drop.length) return;
          return Promise.all(drop.map(function (d) { return c.delete(d.k); }));
        });
      });
    });
  }

  function docStore(id, blob, size) {
    if (!docOk()) return;
    // Fayl endi to'liq bor — eski "yo'q" xotirasini tozalaymiz, aks holda
    // shu sessiyada kesh topilmaydi.
    docBlob.delete(id);
    global.caches.open(DOC_CACHE_NAME).then(function (c) {
      var res = new Response(blob, {
        headers: { 'X-Wc-T': String(Date.now()), 'X-Wc-Size': String(size) }
      });
      return c.put(new Request(docUrl(id)), res).then(null, function (err) {
        // Kvota to'lgan bo'lishi mumkin. Keshni butunlay bo'shatib, shu
        // faylni bir marta qayta yozamiz — aks holda kesh ABADIY o'chib
        // qoladi (har keyingi put ham rad etiladi).
        var m = (err && (err.name || err.message)) || String(err);
        if (!/Quota|QUOTA|space/i.test(m)) throw err;
        return c.keys().then(function (ks) {
          return Promise.all(ks.map(function (k) { return c.delete(k); }));
        }).then(function () {
          return c.put(new Request(docUrl(id)), new Response(blob, {
            headers: { 'X-Wc-T': String(Date.now()), 'X-Wc-Size': String(size) }
          }));
        });
      });
    }).then(docTrim).catch(function () { /* kesh ixtiyoriy — oqim davom etadi */ });
  }

  // `readOnce` dan chaqiriladi: Telegram'dan kelgan har bir bo'lak.
  function docAccPut(id, off, u8) {
    if (!id || !u8 || !u8.length || !docOk()) return;
    var size = headSize(id, 0);
    // Hajmi noma'lum yoki juda katta (kino) — keshlamaymiz.
    if (!size || size > docMax()) return;

    var a = docAcc.get(id);
    if (!a) {
      while (docAcc.size >= DOC_ACC_KEEP) {
        var oldest = docAcc.keys().next().value;
        if (oldest === undefined) break;
        docAcc.delete(oldest);                  // RAM ni bo'shatamiz
      }
      a = { parts: {}, offs: [], got: 0, size: size };
      docAcc.set(id, a);
    }
    if (a.parts[off] !== undefined) return;
    // Himoya nusxasi: `u8` GramJS buferining o'zi bo'lishi mumkin. Nusxa
    // olish xotirani oshirmaydi — asl bufer har `readOnce` dan keyin bo'shaydi,
    // shuning uchun jami sarf baribir `size` atrofida qoladi.
    a.parts[off] = new Uint8Array(u8);
    var i = 0;
    while (i < a.offs.length && a.offs[i] < off) i++;
    a.offs.splice(i, 0, off);
    a.got = docContig(a);

    if (a.got < a.size) return;

    // Fayl to'liq yig'ildi. Oraliq `Uint8Array` YASAMAYMIZ — `subarray`
    // ko'rinishlari (nusxa emas) to'g'ridan-to'g'ri `Blob` ga beriladi.
    // Aks holda 32 MB fayl uchun bir lahza 64 MB RAM band bo'lardi; telefonda
    // bu WebView'ni o'ldirishi mumkin.
    var pieces = [], pos = 0;
    for (var k = 0; k < a.offs.length; k++) {
      var o = a.offs[k], b = a.parts[o];
      var s = pos > o ? pos - o : 0;            // ustma-ust qismni kesamiz
      if (s < b.length) pieces.push(b.subarray(s));
      if (o + b.length > pos) pos = o + b.length;
    }
    docAcc.delete(id);                          // RAM ni darhol bo'shatish
    docStore(id, new Blob(pieces, { type: 'video/mp4' }), size);
  }

  // --- o'qish: keshdan berish ----------------------------------------------
  // `caches.match` ni har so'rovda chaqirmaslik uchun natijani xotirada
  // saqlaymiz (bitta hujjat uchun bitta lookup).
  var docBlob = new Map();

  function docBlobGet(id) {
    if (!id || !docOk()) return null;
    if (!docBlob.has(id)) {
      docBlob.set(id, global.caches.open(DOC_CACHE_NAME)
        .then(function (c) { return c.match(new Request(docUrl(id))); })
        .then(function (r) { return r ? r.blob() : null; })
        .catch(function () { return null; }));
      while (docBlob.size > 3) docBlob.delete(docBlob.keys().next().value);
    }
    return docBlob.get(id);
  }

  // BITTA `upload.getFile` so'rovi. Qaytgan bayt soni `length` dan kam
  // bo'lishi mumkin (blok chegarasi tufayli) — buni `readBytes` hal
  // qiladi. Fayl tugagan bo'lsa — bo'sh massiv (xato EMAS).
  //
  // `ctx` — ixtiyoriy hujjat konteksti ({loc, dcId}). Berilmasa joriy
  // aktiv hujjat (S.loc/S.doc) ishlatiladi. Bu oldindan yuklash (prefetch)
  // uchun kerak: aktiv oqimga tegmasdan BOSHQA hujjatni o'qish imkonini
  // beradi.
  //
  // IKKITA YO'L:
  //   1) TEZ — `tg-mtproto.js` (25 KB). GramJS bundle'i umuman yuklanmaydi.
  //   2) ESKI — GramJS `S.client.invoke(...)` (fallback).
  function readOnce(offset, length, cap, ctx) {
    var aligned = Math.floor(offset / 4096) * 4096;
    var skip = offset - aligned;
    var want = Math.ceil((length + skip) / 4096) * 4096;
    if (want < TG_MIN) want = TG_MIN;
    // 3-qoida (≤1MB) va 4-qoida (blok chegarasi) birgalikda:
    var lim = Math.min(cap || tgCap, roomInBlock(offset));
    if (want > lim) want = lim;

    var loc = (ctx && ctx.loc) ? ctx.loc : S.loc;
    var dc  = (ctx && ctx.dcId != null) ? ctx.dcId : (S.doc ? S.doc.dcId : undefined);
    // Kesh kaliti SHU YERDA, so'rov yuborilishidan OLDIN aniqlanadi. Javob
    // kelganda `S.loc` boshqa reelga o'tib bo'lgan bo'lishi mumkin — keshga
    // noto'g'ri hujjat bayti yozmasligi uchun vaqt bo'yicha emas, joy
    // bo'yicha kalitlashamiz.
    var hid = headId(ctx);

    // --- TEZ YO'L: minimal MTProto klient ------------------------------
    var fast = S.fast;
    if (fast && !S.fastBroken && loc && loc.id != null) {
      var rawLoc = {
        id: loc.id,
        accessHash: loc.accessHash,
        fileReference: loc.fileReference,
        thumbSize: loc.thumbSize || '',
        dcId: dc
      };
      return fast.getFile(rawLoc, aligned, want).then(function (b) {
        var u8 = b instanceof Uint8Array ? b : new Uint8Array(b);
        return finishRead(u8, skip, length, aligned, hid);
      }).catch(function (e) {
        var eMsg = (e && (e.errorMessage || e.message)) || String(e);

        // 1) `FILE_REFERENCE_*` — keshdagi havola eskirgan. Foydalanuvchiga
        //    xato ko'rsatishdan oldin serverdan yangi havolani olib, shu
        //    so'rovni BIR marta takrorlaymiz (`frRetried` — qayta urinish
        //    cheksiz bo'lib qolmasligi uchun).
        if (isFileRefErr(eMsg) && !(ctx && ctx.frRetried)) {
          return refreshDocLoc(S.mountOpts).then(function (ok) {
            if (!ok) return gramFallback(e);
            var nc = {
              loc: S.loc,
              dcId: S.doc ? S.doc.dcId : dc,
              abort: ctx && ctx.abort,
              frRetried: true
            };
            return readOnce(offset, length, cap, nc).catch(function (e2) {
              // Yangilash ham yordam bermadi — eski yo'lga o'tamiz.
              return gramFallback(e2);
            });
          });
        }

        // 2) Yangilash yordam bermadi — mount'ni qayta ishga tushirmaymiz
        // (u cheksiz halqa berardi), xatoni yuqoriga uzatamiz.
        // 2) Yangilash yordam bermadi — eski yo'lga o'tamiz. Eskirgan havola
        //    bilan `readOnceGram` ham rad etiladi, shuning uchun hujjatni
        //    QAYTA yechish kerak — buni `fastFallback()` qiladi (mount'ni
        //    qayta ishga tushiradi → `findDoc()` yangi havola oladi).
        if (isFileRefErr(eMsg)) return gramFallback(e);

        // 3) Tez yo'l ishlamadi — eski yo'lga qaytamiz (u hujjatni qayta
        // yechishi mumkin). Eski yo'l ham yo'q bo'lsa — butun oqimni
        // qayta ishga tushiramiz.
        if (S.fastBroken) throw e;
        if (!S.client) { fastFallback(); throw e; }
        S.fastBroken = true;
        return readOnceGram(offset, length, cap, ctx, loc, dc, skip, aligned, want, hid);
      });
    }

    return readOnceGram(offset, length, cap, ctx, loc, dc, skip, aligned, want, hid);
  }

  // GramJS yo'li (fallback). `upload.GetFile` — to'liq SDK orqali.
  function readOnceGram(offset, length, cap, ctx, loc, dc, skip, aligned, want, hid) {
    if (!S.client || !S.T) {
      // Tez yo'l (tg-mtproto.js) Telegram CDN fayllarini o'qiy olmaydi va GramJS'ga
      // o'tadi - lekin tez yo'lda GramJS bundle'i umuman yuklanmagan bo'ladi.
      // Ilgari shu yerda darhol "Telegram SDK yuklanmagan" xatosi chiqib, video
      // ochilmasdi. Endi SDK'ni shu paytda (bir marta) yuklab, so'rovni takrorlaymiz.
      var gl = S.gramLoad || (S.gramLoad = ensureSession(silentView(), { fastPlayback: true }).then(
        function (c) { S.gramLoad = null; return c; },
        function (e) { S.gramLoad = null; throw e; }
      ));
      return gl.then(function () {
        if (!S.client || !S.T) throw new Error('Telegram SDK yuklanmagan');
        return readOnceGram(offset, length, cap, ctx, loc, dc, skip, aligned, want, hid);
      });
    }
    function once(l) {
      var apiLoc = new S.T.Api.InputDocumentFileLocation({
        id: l.id,
        accessHash: l.accessHash,
        fileReference: gramJsBytes(l.fileReference),
        thumbSize: l.thumbSize || ''
      });
      return S.client.invoke(new S.T.Api.upload.GetFile({
        location: apiLoc,
        offset: aligned,
        limit: want,
        precise: true
      }), dc);
    }

    return once(loc).then(function (res) {
      var b = res.bytes || res;
      var u8 = b instanceof Uint8Array ? b : new Uint8Array(b);
      return finishRead(u8, skip, length, aligned, hid);
    }).catch(function (e) {
      var gMsg = (e && (e.errorMessage || e.message)) || String(e);
      // GramJS yo'lida ham havola eskirgan bo'lishi mumkin — yangilab,
      // aynan shu so'rovni bir marta qayta yuboramiz.
      if (!isFileRefErr(gMsg) || (ctx && ctx.frRetried)) throw e;
      return refreshDocLoc(S.mountOpts).then(function (ok) {
        if (!ok) {
          // Server orqali yangilash ISHLAMAYDI: `api/tg-doc.php` hujjatni BOT
          // sessiyasi bilan yechadi va bot ruxsatnomasi tomoshabbin
          // akkauntida qabul qilinmaydi. Hujjatni foydalanuvchining O'Z
          // sessiyasi orqali QAYTA yechamiz — buning uchun butun oqimni
          // qayta ishga tushiramiz (`findDoc` yangi havola oladi).
          return gramFallback(e);
        }
        var nl = (S.loc && S.loc.id != null) ? S.loc : loc;
        return once(nl).then(function (res2) {
          var b2 = res2.bytes || res2;
          var u2 = b2 instanceof Uint8Array ? b2 : new Uint8Array(b2);
          return finishRead(u2, skip, length, aligned, hid);
        });
      });
    });
  }

  // Olingan baytlarni keshlaydi va so'ralgan oraliqni qaytaradi.
  function finishRead(u8, skip, length, aligned, hid) {
    headPut(hid, aligned, u8);
    // ZATAN olingan baytlarni disk keshiga ham yozib boramiz (qo'shimcha
    // Telegram so'rovi yo'q). Kichik fayl to'liq yig'ilsa — saqlanadi.
    docAccPut(hid, aligned, u8);
    // Telegram kamroq qaytarsa — ortiqcha joyni nol bilan
    // to'ldirmaymiz, faqat haqiqiy baytlarni qaytaramiz.
    if (u8.length <= skip) return new Uint8Array(0);
    return u8.slice(skip, skip + Math.min(length, u8.length - skip));
  }

  // To'liq oraliqni o'qish. Avval disk keshi tekshiriladi, topilmasa
  // `readBytesRemote` orqali Telegram'dan o'qiladi.
  function readBytes(offset, length, ctx) {
    if (!(length > 0)) return Promise.resolve(new Uint8Array(0));
    if (ctx && ctx.abort && ctx.abort()) return Promise.resolve(new Uint8Array(0));

    // 00) Disk keshi. Fayl avval to'liq ko'rilgan bo'lsa, Telegram'ga
    //     UMUMAN murojaat qilmaymiz — javob mahalliy diskdan keladi.
    var p = docBlobGet(headId(ctx));
    if (!p) return readBytesRemote(offset, length, ctx);

    return p.then(function (blob) {
      if (!blob || offset >= blob.size) return null;
      var end = Math.min(offset + length, blob.size);
      // `blob.slice` nusxa olmaydi — faqat `arrayBuffer()` da o'qiladi,
      // shuning uchun 32 MB fayldan 1 MB tortish arzon.
      return blob.slice(offset, end).arrayBuffer()
        .then(function (ab) { return new Uint8Array(ab); });
    }).then(function (hit) {
      return hit ? hit : readBytesRemote(offset, length, ctx);
    });
  }

  // Har bir Telegram so'rovi 1 MB blok ichida qoladi; katta oraliq bo'laklab
  // yig'iladi.
  //
  // `ctx` — ixtiyoriy hujjat konteksti ({loc, dcId, abort}). Prefetch shu
  // orqali aktiv oqimga tegmasdan boshqa hujjatni o'qiy oladi; `abort()`
  // true qaytarsa o'qish darhol to'xtaydi (foydalanuvchi slaydni tashlab
  // ketgan bo'lsa — ortiqcha trafik ketmaydi).
  function readBytesRemote(offset, length, ctx) {
    if (!(length > 0)) return Promise.resolve(new Uint8Array(0));
    if (ctx && ctx.abort && ctx.abort()) return Promise.resolve(new Uint8Array(0));

    // 0) Bosh baytlar keshi. Agar so'ralgan oraliq (yoki uning boshi)
    //    allaqachon olingan bo'lsa — Telegram'ga UMUMAT murojaat qilmaymiz.
    //    `probeMp4` va `<video>` bir xil baytlarni o'qiydi; bu kesh shu
    //    takroriy tortishni yo'q qiladi va reel ochilishini tezlashtiradi.
    var hid = headId(ctx);
    var hc = headGet(hid);
    if (hc && offset < hc.bytes.length) {
      var end = offset + length;
      if (end <= hc.bytes.length) {
        return Promise.resolve(hc.bytes.slice(offset, end));
      }
      // Keshda faylning OXIRGI bayti bo'lsa (kichik fayl to'liq kelgan) —
      // Telegram'ga bo'sh so'rov yubormaymiz.
      var full = headSize(hid, 0);
      if (full && full <= hc.bytes.length) {
        return Promise.resolve(hc.bytes.slice(offset));
      }
      // Qisman keshlangan: keshdagi qism + qolgani Telegram'dan.
      var headPart = hc.bytes.slice(offset);
      var tailFrom = hc.bytes.length;
      // Ichki chaqiruv to'g'ridan-to'g'ri Telegram yo'liga boradi: disk
      // keshi bu fayl uchun allaqachon tekshirilgan (aks holda bo'lmasdi).
      return readBytesRemote(tailFrom, end - tailFrom, ctx).then(function (tail) {
        if (!tail || !tail.length) return headPart;
        var out = new Uint8Array(headPart.length + tail.length);
        out.set(headPart, 0);
        out.set(tail, headPart.length);
        return out;
      });
    }

    var skip0 = offset - Math.floor(offset / 4096) * 4096;

    // 1) Hammasi bitta blokka va bitta so'rovga sig'adi — to'g'ridan.
    if (length <= Math.min(tgCap, roomInBlock(offset)) - skip0) {
      return readOnce(offset, length, null, ctx).catch(function (e) {
        var m = (e && (e.errorMessage || e.message)) || String(e);
        if (!isLimitError(m) || tgCap <= TG_MIN) throw e;
        // Telegram kutilganidan kichikroq chegara qo'llasa —
        // yarmini sinab ko'ramiz.
        tgCap = Math.max(TG_MIN, Math.floor(tgCap / 2));
        return readOnce(offset, length, tgCap, ctx);
      });
    }

    // 2) Katta yoki chegarani kesib o'tuvchi so'rov.
    //
    // PARALLEL O'QISH. Ilgari har bir 1 MB blok KETMA-KET o'qilardi: har
    // blok uchun to'liq RTT (150–400 ms) kutilardi, ya'ni 8 MB oraliq
    // ~3 s olardi. Endi 4 tagacha Telegram so'rovi BIR VAQTDA yuboriladi:
    // oraliq deyarli bitta RTT da keladi. Tartib saqlanadi — baytlar
    // o'z joyiga (`buf` ichidagi aniq ofsetga) yoziladi, shuning uchun
    // javoblar aralash kelishi muammo emas.
    //
    // Har bir so'rov baribir 1 MB blok ichida qoladi (Telegram qoidasi),
    // `LIMIT_INVALID` kelsa `tgCap` ikkiga bo'linadi va o'sha bo'lak
    // qaytadan, kichikroq o'lchamda o'qiladi.
    return (function () {
      // Wi-Fi/ethernet'da 6 ta parallel so'rov (yuqori RTT'ni yopish uchun),
      // mobil internetda 4 ta — trafik va flood chegarasi tejamkor bo'lsin.
      var LANES = canSeed() ? 6 : 4;   // bir vaqtda nechta so'rov

      // Oraliqni reja bo'laklariga bo'lamiz — har biri bitta blok ichida.
      var plan = [], acc = 0;
      while (acc < length) {
        var off = offset + acc;
        var skip = off - Math.floor(off / 4096) * 4096;
        var fits = Math.min(tgCap, roomInBlock(off)) - skip;
        if (fits < 1) fits = 1;
        var piece = Math.min(fits, length - acc);
        plan.push({ off: off, len: piece });
        acc += piece;
      }

      var parts = new Array(plan.length);   // indeks bo'yicha natijalar
      var cursor = 0;
      var firstErr = null;

      // Bitta reja bo'lagini to'liq o'qish (blok chegarasiga rioya qilib).
      function readSeg(seg) {
        var buf = new Uint8Array(seg.len);
        var got = 0;
        var tries = 0;

        function more() {
          if (got >= seg.len) return Promise.resolve(got);
          if (ctx && ctx.abort && ctx.abort()) return Promise.resolve(got);
          var o = seg.off + got;
          var s = o - Math.floor(o / 4096) * 4096;
          var room = Math.min(tgCap, roomInBlock(o)) - s;
          if (room < 1) room = 1;
          var want = Math.min(room, seg.len - got);
          return readOnce(o, want, null, ctx).then(function (b) {
            if (!b.length) return got;             // fayl tugadi
            buf.set(b, got);
            got += b.length;
            return more();
          }, function (e) {
            var m = (e && (e.errorMessage || e.message)) || String(e);
            if (isLimitError(m) && tgCap > TG_MIN) {
              tgCap = Math.max(TG_MIN, Math.floor(tgCap / 2));
              return more();
            }
            // BIR MARTA qayta urinish. Parallel yo'laklarda bitta so'rov
            // tasodifiy uzilishi mumkin (tarmoq/DC qisqa uzilishi). Ilgari
            // butun oraliq shu sababli yiqilardi va video "ochilmadi" deb
            // ko'rsatilardi. `FLOOD_WAIT` da kutish kerak (300 ms yetmaydi) —
            // uni qayta urinmaymiz, pastdagi `serveRead` o'zi hal qiladi.
            if (!/FLOOD_WAIT/.test(m) && tries < 1 && !(ctx && ctx.abort && ctx.abort())) {
              tries++;
              return new Promise(function (res) { setTimeout(res, 300); }).then(more);
            }
            throw e;
          });
        }

        return more().then(function (n) {
          if (!n) return new Uint8Array(0);
          return n === seg.len ? buf : buf.subarray(0, n);
        });
      }

      // Bitta "yo'lak": navbatdan reja olib, ketma-ket bajaradi. Bir nechta
      // yo'lak parallel ishlaydi — natijada 4 ta so'rov bir vaqtda ketadi.
      function lane() {
        if (cursor >= plan.length) return Promise.resolve();
        if (ctx && ctx.abort && ctx.abort()) return Promise.resolve();
        var i = cursor++;
        return readSeg(plan[i]).then(function (b) {
          parts[i] = b;
        }, function (e) {
          parts[i] = null;
          if (!firstErr) firstErr = e;
        }).then(lane);
      }

      var lanes = [];
      var n = Math.min(LANES, plan.length);
      for (var i = 0; i < n; i++) lanes.push(lane());

      return Promise.all(lanes).then(function () {
        // Faqat UZLUKSIZ boshni qaytaramiz: agar o'rtada bo'lak yetishmasa
        // (xato/tugash), keyingi baytlar noto'g'ri joyda bo'lib qolardi.
        var chunks = [], total = 0;
        for (var j = 0; j < plan.length; j++) {
          var b = parts[j];
          if (!b || !b.length) break;
          chunks.push(b);
          total += b.length;
          if (b.length < plan[j].len) break;       // fayl tugadi
        }
        if (!total) {
          if (firstErr) throw firstErr;            // hech narsa kelmadi — xato
          return new Uint8Array(0);
        }
        if (chunks.length === 1) return chunks[0];
        var out = new Uint8Array(total), p = 0;
        for (var k = 0; k < chunks.length; k++) { out.set(chunks[k], p); p += chunks[k].length; }
        return out;
      });
    })();
  }

  // SW so'rov yuborganda javob beramiz
  function onRead(ev) {
    var d = ev.data || {};
    if (d.type !== 'read') return;
    serveRead(d, ev.ports && ev.ports[0], 0);
  }

  // `attempt` — `FILE_REFERENCE_*` uchun qayta urinish hisobi: havola
  // yangilangach so'rov faqat BIR marta takrorlanadi.
  function serveRead(d, port, attempt) {

    readBytes(d.offset, d.length).then(function (out) {
      if (port) port.postMessage({ type: 'result', id: d.id, bytes: out });
      S.totalRead += out.length;
      progress();
    }).catch(function (err) {
      var m = (err && (err.errorMessage || err.message)) || String(err);

      if (m === 'NO_PROVIDER') {
        // SW o'z-o'zini qayta ishga tushirgan (brauzer bo'sh turgan
        // SW'ni o'chirib tashlaydi) — qayta ulanib, so'rovni takror qilamiz.
        connect();
        retryRange(d.offset, d.length);
        return;
      }

      // Eskirgan `file_reference`: havolani yangilab, so'rovni bir marta
      // takrorlaymiz. Foydalanuvchi "Telegram o'qish xatosi" ko'rmaydi va
      // pleer uzilib qolmaydi.
      if (isFileRefErr(m) && attempt < 1) {
        refreshDocLoc(S.mountOpts).then(function (ok) {
          if (ok) { serveRead(d, port, attempt + 1); return; }
          if (port) port.postMessage({ type: 'result', id: d.id, error: m });
          setStatus('<span class="tgs-err">Telegram o\'qish xatosi: ' + esc(m) + '</span>');
        });
        return;
      }

      if (port) port.postMessage({ type: 'result', id: d.id, error: m });
      if (/FLOOD_WAIT/.test(m)) {
        // Telegram vaqtincha tezlikni chekladi. Sabr qilamiz — video
        // o'zi qayta so'raydi.
        setStatus('<span class="tgs-warn">Telegram tezlikni chekladi, biroz kutamiz...</span>');
      } else {
        setStatus('<span class="tgs-err">Telegram o\'qish xatosi: ' + esc(m) + '</span>');
      }
    });
  }

  // SW'dan "javob yo'q" kelganda, yangi so'rovni o'zimiz uchratamiz.
  // Sahifaning fetch() ham SW orqali o'tadi — ya'ni shu so'rov <video> ning
  // keyingi so'rovi kabi ishlaydi va SW uni qayta ishlaydi.
  function retryRange(offset, length) {
    setTimeout(function () {
      fetch(fileUrl() + '?size=' + S.size + '&t=' + Date.now() + docQ(), {
        headers: { Range: 'bytes=' + offset + '-' + (offset + length - 1) }
      }).catch(function () { /* javob muhim emas */ });
    }, 90);
  }

  // SW o'z xotirasini yo'qotganda "qayta ulan" deydi.
  navigator.serviceWorker &&
  navigator.serviceWorker.addEventListener('message', function (ev) {
    var d = ev.data || {};
    if (d.type === 'needProvider' && S.chan !== null) connect();
  });

  // SW yangilandi -> controller almashdi -> darhol qayta ulanamiz.
  navigator.serviceWorker &&
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (S.chan !== null) connect();
  });

  // ============================================================ 6. UI holat
  function setStatus(html) {
    if (S.mount) {
      var n = S.mount.querySelector('.tgs-status');
      if (n) n.innerHTML = html;
    }
  }

  // ---------------------------------------------------------------- poster
  //
  // Reel ochilganda avvalgi kadr bir necha soniya YO'Q bo'lmasligi kerak:
  // Telegram'dan qancha tez kelishidan qat'i nazar poster darhol
  // ko'rinib tursin. Shu sabab `mount()` konteynerning o'ziga poster
  // fon qo'yadi; `<video>` yaratilgach esa bu fon olib tashlanadi
  // (uning o'z `poster` atributi bor).
  function posterBg(node, poster) {
    if (!node) return;
    if (!poster) { posterBgOff(node); return; }
    var u = String(poster).replace(/\\/g, '/').replace(/"/g, '%22');
    node.style.backgroundImage = 'url("' + u + '")';
    node.style.backgroundSize = 'cover';
    node.style.backgroundPosition = 'center center';
    node.style.backgroundRepeat = 'no-repeat';
  }
  function posterBgOff(node) {
    if (!node || !node.style) return;
    node.style.backgroundImage = '';
    node.style.backgroundSize = '';
    node.style.backgroundPosition = '';
    node.style.backgroundRepeat = '';
  }
  function progress() {
    if (!S.size || !S.mount) return;
    var n = S.mount.querySelector('.tgs-prog');
    if (n) {
      var pct = Math.min(100, Math.round(S.totalRead / S.size * 100));
      n.style.width = pct + '%';
      n.textContent = pct + '%';
    }
    // Jonli o'quvchi: necha MB haqiqatan Telegram'dan keldi.
    //
    // Bu FOYDALANUVCHIGA ko'rsatiladi va bir narsani isbotlaydi: fayl
    // butunlay yuklanmaydi. 520 MB film o'ynayotganda bu son ko'pincha
    // 5–40 MB da turadi — qolgani faqat o'ynash paytida so'raladi.
    var r = S.mount.querySelector('.tgs-read');
    if (r) {
      var mb = S.totalRead / 1048576;
      r.textContent = (mb < 10 ? mb.toFixed(1) : Math.round(mb)) + ' MB';
    }
  }

  /* ---------------------------------------------------------------------------
   * HOVER-PREVIEW: karta ustiga sichqoncha kelganda videoning boshini
   * OVOZSIZ o'ynatadi (YouTube/Netflix uslubi). Modal player bilan bir xil
   * Telegram konnektori + Service Worker'dan foydalanadi, lekin boshqaruv
   * yoki QR ko'rsatmaydi va xatoda JIM to'xtaydi. Sahifani HECH QACHON
   * qayta yuklamaydi (aks holda hover saytni sakratib qo'yardi).
   * ------------------------------------------------------------------------ */
  function isPreview() { return !!(S.cfg && S.cfg.preview); }

  // Player o'ynashga tayyor bo'lganda mount(onReady) ni BIR MARTA chaqiradi.
  // Reels shundan keyin pastdagi (keyingi) videoni oldindan yuklaydi.
  var identityFetch = null;
  function refreshIdentityAfterPlayback() {
    var client = S.client;
    if (!client || S.me || identityFetch) return;
    try {
      var storedMe = JSON.parse(localStorage.getItem('wc_tg_me_v1') || 'null');
      if (storedMe && storedMe.id) { S.me = storedMe; return; }
    } catch (e) {}
    identityFetch = client.getMe().then(function (me) {
      if (client !== S.client) return;
      saveMe(me);
      savePhoto(client, me);
      pingLoginAlert();
    }).catch(function () {}).then(function () { identityFetch = null; });
  }

  function fireReady() {
    if (S.readyFired) return;
    S.readyFired = true;
    // Profil so'rovi endi video ochilishining kritik yo'lida emas.
    // Dastlabki kadr tayyor bo'lgach, yetishmagan akkaunt ma'lumotini olamiz.
    if (!isPreview()) setTimeout(refreshIdentityAfterPlayback, 1200);
    if (typeof S.onPlayerReady === 'function') {
      try { S.onPlayerReady(); } catch (e) { /* jim */ }
    }
  }
  function armReady(v) {
    if (!v) return;
    v.addEventListener('canplay', fireReady, { once: true });
    v.addEventListener('playing', fireReady, { once: true });
  }

  // Login oqimini ishga tushirmaydigan "jim" view (xuddi verify() kabi).
  function silentView() {
    return {
      qrBox: function () { return null; },
      pwdForm: function () { return null; },
      pwdInput: function () { return null; },
      setState: function () {},
      needPassword: function () {},
      askPhone: function () { return Promise.reject(new Error('NO_LOGIN')); },
      askCode: function () { return Promise.reject(new Error('NO_LOGIN')); }
    };
  }

  function mountPreview(node, opts) {
    stop();
    S.mount = node;
    S.cfg = { preview: true, title: opts.title || '' };
    S.onPlayerReady = null;
    S.readyFired = false;
    S.job++;
    var job = S.job;

    node.classList.add('tgs', 'tgs-preview');
    // Poster darhol ko'rinib turadi — yuklanayotgan paytdan qat'i nazar.
    posterBg(node, opts.poster);
    // Yuklanayotganda spinner (ostidagi karta posteri ko'rinib turadi).
    node.innerHTML = '<div class="tgs-pv-load"><i></i></div>';

    // Modal player bilan AYNAN bir xil quvur: SW -> sessiya -> findDoc ->
    // probe -> (kerak bo'lsa MSE). Farqi: sahifa QAYTA YUKLANMAYDI, QR
    // ko'rsatilmaydi, xato jim o'tadi, video ovozsiz va boshqaruvsiz.
    run(node, opts, silentView(), job).catch(function () {
      // Preview xatosi ko'rsatilmaydi — karta posterida qoladi.
    });
  }

  // Preview uchun engil <video> (boshqaruvsiz, ovozsiz, halqali).
  function renderPreview(node, opts, size, probe) {
    posterBgOff(node);                 // endi `<video poster>` o'zi ko'rsatadi
    var url = fileUrl() + '?size=' + size + '&t=' + Date.now()
      + '&mime=' + encodeURIComponent(mimeOf(probe)) + docQ();
    node.innerHTML = '<video class="tgs-pv" id="playerVideo" muted playsinline loop '
      + 'preload="metadata"'
      + (opts.poster ? ' poster="' + esc(opts.poster) + '"' : '')
      + ' src="' + esc(url) + '"></video>';
    var v = document.getElementById('playerVideo');
    if (v) {
      v.muted = true;
      armReady(v);
      var p = v.play();
      if (p && p.catch) p.catch(function () { /* avtomatik o'ynash bloklangan */ });
    }
  }

  /* ---------------------------------------------------------------------------
   * ASOSIY FUNKSIYA: filmni shu joyda o'ynatish
   * ------------------------------------------------------------------------ */
  function mount(node, opts) {
    if (opts && opts.preview) { mountPreview(node, opts); return; }
    stop();                                  // avvalgi filmni to'xtatamiz
    S.mount = node;
    S.mountOpts = opts;
    // "Qayta urinish" tugmalari shu havoladan foydalanadi. Ilgari bu
    // o'zgaruvchi hech qachon yozilmasdi va xato ekranidagi "Qayta urinish"
    // tugmasi JIM ishlamasdi.
    try { global.__wcTgLast = opts; } catch (e) {}
    S.cfg = opts.cfg || {};
    S.onPlayerReady = typeof opts.onReady === 'function' ? opts.onReady : null;
    S.readyFired = false;
    S.job++;
    // Yangi mount — `file_reference` ni avtomatik tiklash huquqini ham
    // qaytaramiz. `data-tgs-dead` esa oldingi xato belgisi: u qolib ketsa
    // yangi oqimdagi xatoni "allaqachon ko'rsatilgan" deb yutib yuborardi.
    S.frAuto = 0;
    try { node.removeAttribute('data-tgs-dead'); } catch (e) {}

    node.classList.add('tgs');
    // Poster darhol ko'rinib turadi: Telegram'dan kadr kelguncha bo'sh
    // qora ekran ko'rsatmaymiz. `<video>` tayyor bo'lganda bu fon
    // `renderPlayer` da olib tashlanadi.
    posterBg(node, opts.poster);

    // Qayta o'rnatilganda QR rasmini YO'QOTMAYAPMIZ.
    //
    // GramJS login tokenini faqat BIR marta eksport qiladi. Agar rasm
    // qayta mount'da 'g'aybolib' ketsa, qayta chizilmaydi va foydalanuvchi
    // QR skanalay olmay qoladi — butun sayt ishlamay qoladi. Shuning uchun
    // eski canvas va xabarni saqlab, yangi markup ichiga qayta joylashtiramiz.
    var oldQrBox = node.querySelector('.tgs-qr');
    var oldQr = oldQrBox ? oldQrBox.querySelector('canvas') : null;
    var oldStatus = (node.querySelector('.tgs-status') || {}).innerHTML || '';
    var qrWasVisible = !!(oldQr && oldQrBox && !oldQrBox.hidden);

    node.innerHTML =
      '<div class="tgs-bar"><i class="tgs-prog"></i></div>'
      + '<div class="tgs-body">'
      + '<div class="tgs-status"></div>'
      + '<div class="tgs-qr" hidden></div>'
      + '<form class="tgs-pwd" hidden>'
      + '<label>Telegram paroli (2FA)</label>'
      + '<input type="password" autocomplete="off" placeholder="Parol">'
      + '<button type="submit">Kirish</button>'
      + '</form>'
      + '</div>';

    if (oldQr) {
      var box = node.querySelector('.tgs-qr');
      if (box) {
        box.innerHTML = '';
        box.hidden = !qrWasVisible;
        box.appendChild(oldQr);
      }
    }

    // "view" — GramJS ga holatni ko'rsatish uchun (QR / parol maydonlari).
    //
    // DIQQAT: qrBox / pwdForm / pwdInput — bu saqlangan ELEMENTLAR emas,
    // FUNKSIYALAR. Sababi: mount() bir necha marta chaqirilishi mumkin va u
    // `node.innerHTML` ni qayta yozadi, ya'ni yangi elementlar yaratiladi.
    //
    // Agar elementni bir marta ushlab qo'ysak, u DOM dan AJRATILADI va
    // keyingi chizishlar ko'rinmaydigan elementga boradi. Natija chalkash:
    // "QR skanerlang" yozuvi ko'rinadi, lekin QR rasm chiqmaydi.
    //
    // Shuning uchun har safar qayta topamiz — doim joni elementga ishlaydi.
    function find(sel) { return node.querySelector(sel); }
    var view = {
      qrBox:    function () { return find('.tgs-qr'); },
      pwdForm:  function () { return find('.tgs-pwd'); },
      pwdInput: function () { return find('.tgs-pwd input'); },
      setState: function (html) { setStatus(html); },
      needPassword: function () {
        var q = find('.tgs-qr'), p = find('.tgs-pwd');
        if (q) q.hidden = true;
        if (p) p.hidden = false;
        setStatus('Telegram <b>Settings › Privacy and Security › Two-Step Verification</b>'
          + ' dagi parolni kiriting.');
      }
    };
    // Parol yuborilgach maydon yana yashiriladi (parol DOM'da qolmasin).
    // Tinglash `node` ga bir marta ulanadi — node barqaror element, shuning
    // uchun qayta mount'dan keyin ham ishlaydi (forma esa yangilanadi).
    node.addEventListener('submit', function (e) {
      var t = e.target;
      if (!t || !t.classList || !t.classList.contains('tgs-pwd')) return;
      setTimeout(function () {
        var p = find('.tgs-pwd');
        if (p) p.hidden = true;
      }, 0);
    }, true);

    // QR allaqachon ko'rinayotgan bo'lsa, o'sha xabar saqlanadi — aks holda
    // rasm ko'rinib turib "Tayyorlanmoqda..." deb yozilgan bo'lardi.
    setStatus(qrWasVisible ? oldStatus : 'Tayyorlanmoqda...');
    var job = S.job;
    run(node, opts, view, job).catch(function (e) {
      try {
        var msg = (e && (e.errorMessage || e.message)) || String(e);
        var st = (e && e.stack) || '';
        fetch((window.APP && window.APP.base ? window.APP.base : '') + '/assets/logerr.php', {method:'POST',body:'TGSTREAM FAIL: '+msg+'\n'+st});
      } catch(x){}
      // Sahifa boshqa filmga o'tgan bo'lsa, bu xato endi ahamiyatga ega emas.
      if (S.job !== job) return;
      fail(node, e);
    });

    // WATCHDOG: "abadiy Tayyorlanmoqda..." holati.
    //
    // Agar 20 soniya ichida na <video>, na xato paydo bo'lsa — odatda
    // tarmoq/SW muammosi. Foydalanuvchi cheksiz kutib qolmasin: qayta
    // urinish tugmasini ko'rsatamiz. Sababni o'ylab topmaymiz.
    setTimeout(function () {
      if (S.job !== job) return;
      if (node.querySelector('video') || node.querySelector('.tgs-cta')) return;
      var st = node.querySelector('.tgs-status');
      if (!st) return;
      var txt = (st.textContent || '').replace(/\s+/g, ' ').trim();
      // Faqat "hali boshlanmadi" holatlarida aralashamiz: yuklash foizi
      // ko'rinib turganda foydalanuvchini chalg'itmaymiz.
      if (!/^(Tayyorlanmoqda|Telegram ulagichi tayyorlanmoqda)/.test(txt)) return;
      st.innerHTML = '<span class="tgs-warn">Pleyer javob bermayapti.</span>'
        + '<div class="tgs-dim" style="margin-top:8px">Internetni tekshirib, qayta urinib ko\'ring.</div>'
        + '<button type="button" class="tgs-btn" data-tgs-wd-retry style="margin-top:10px">Qayta urinish</button>';
      var wb = st.querySelector('[data-tgs-wd-retry]');
      if (wb) wb.onclick = function () {
        wb.disabled = true;
        wb.textContent = 'Ulanmoqda\u2026';
        mount(node, opts);
      };
    }, 20000);
  }

  async function run(node, opts, view, job) {
    // --- 1) SW tayyorligi + metadata so'rovi PARALLEL -------------------
    // Service Worker boshqaruvi va serverdagi kichik video metadata so'rovi
    // bir vaqtda boshlanadi, shuning uchun kutishlar ketma-ket qo'shilmaydi.
    // Telegram ulanishi init()/warmFast() orqali oldindan qizdiriladi. SW ilk
    // bor o'rnatilsa, brauzer qoidasi sabab bir marta reload kerak bo'lishi mumkin.
    // Hover-preview'da SW bo'lmasa, avvalgi kabi ishga tushirmaymiz.
    if (!hasSession()) { if (!isPreview()) goLogin(); return; }
    if (!swCtl() && isPreview()) return;

    var cacheKey = (opts.channel && opts.post)
      ? (String(opts.channel) + '/' + Number(opts.post)) : null;
    var memoryEntry = cacheKey && S.pvCache && S.pvCache[cacheKey];
    var memoryEntryFresh = !!(memoryEntry && (Date.now() - memoryEntry.t) < 20 * 60 * 1000);
    // Yozuvning foydalanishga yaramaydigan holatlarini HEMEN tekshiramiz —
    // serverga metama'lumot so'rovi shundan keyin qaror qilinadi.
    if (memoryEntryFresh
        && (!hasFileRef(memoryEntry.loc) || (S.fastBroken && memoryEntry.fromFast))) {
      memoryEntryFresh = false;
      delete S.pvCache[cacheKey];
    }
    var pendingPrefetch = cacheKey && S.prefetchKey === cacheKey && S.prefetchPromise;
    // Serverdan kichik metama'lumot so'rovini SW tayyorlanishi bilan parallel
    // boshlaymiz; ikkita kutish ketma-ket qo'shilmasin. Faol prefetch bo'lsa,
    // ortiqcha Telegram metadata so'rovi yubormaymiz.
    var serverMetaPromise = (!S.fastBroken && cacheKey && !docMetaGet(cacheKey)
        && !memoryEntryFresh && !pendingPrefetch)
      ? docMetaFromServer(opts) : null;

    var workerPromise = swCtl() ? Promise.resolve(true) : (function () {
      setStatus('Telegram ulagichi tayyorlanmoqda...');
      return ensureWorker();
    })();

    var workerOk = false;
    try { workerOk = await workerPromise; } catch (e) { workerOk = false; }
    if (!workerOk) {
      setStatus('<span class="tgs-warn">Telegram ulagichi tayyor emas. '
        + 'Sahifani bir marta yangilab, qayta urinib ko\'ring.</span>');
      return;
    }

    // Watch sahifasidagi prefetch hujjatni allaqachon topgan bo'lsa, shu
    // xotira keshidan foydalanamiz; serverdan qayta metadata so'ramaymiz.
    //
    // 2 TA SHART:
    //   • `file_reference` bo'sh bo'lgan yozuv ISHLATILMAYDI — Telegram
    //     uni rad etadi (FILE_REFERENCE_INVALID) va video ochilmaydi.
    //   • Tez yo'l ishlamagan bo'lsa (`S.fastBroken`) — tez yo'ldan kelgan
    //     yozuv ham ISHLATILMAYDI, aks holda `run()` yana xuddi shu
    //     buzilgan yozuvga qaytadi va GramJS fallback'iga chiqmaydi.
    memoryEntry = cacheKey && S.pvCache && S.pvCache[cacheKey];
    memoryEntryFresh = !!(memoryEntry && (Date.now() - memoryEntry.t) < 20 * 60 * 1000);
    if (memoryEntryFresh
        && (!hasFileRef(memoryEntry.loc) || (S.fastBroken && memoryEntry.fromFast))) {
      memoryEntryFresh = false;
      delete S.pvCache[cacheKey];
    }
    if (memoryEntryFresh && memoryEntry.doc && memoryEntry.size > 0) {
      S.doc = memoryEntry.doc;
      S.size = memoryEntry.size;
      S.totalRead = 0;
      headSize(memoryEntry.doc.id, memoryEntry.size);
      S.loc = memoryEntry.loc;
      S.probe = memoryEntry.probe || quickPlaybackProbe(memoryEntry.doc);
      connect();
      if (isPreview()) renderPreview(node, opts, memoryEntry.size, S.probe);
      else if (S.probe.playable === false) renderAdaptivePlayer(node, opts, memoryEntry.size, S.probe, 'Format tayyorlanmoqda…');
      else renderPlayer(node, opts, memoryEntry.size, S.probe);
      return;
    }

    // --- 1a) TEZ YO'L: GramJS bundle'siz oqim --------------------------
    //
    // Hujjat metama'lumoti (id / access_hash / file_reference / dc) oldindan
    // ma'lum bo'lsa — 5.4 MB GramJS bundle'ini umuman yuklamaymiz. Faqat
    // 25 KB li minimal MTProto klient (`tg-mtproto.js`) ishlatiladi: video
    // baytlari Telegram DC'dan to'g'ridan-to'g'ri brauzerga keladi.
    //
    // Metama'lumot manbalari (tezdan tez):
    //   1) brauzerdagi qisqa muddatli kesh (localStorage) — 0 ms
    //   2) serverdagi kesh (`api/tg-doc.php`) — ~10 ms
    //   3) eski yo'l (bundle + findDoc) — fallback
    if (!S.fastBroken && cacheKey) {
      var meta = docMetaGet(cacheKey);
      if (!meta) {
        meta = serverMetaPromise ? await serverMetaPromise : await docMetaFromServer(opts);
        if (meta) {
          // Lokal keshga yozamiz — keyingi ochilish butunlay lokal bo'ladi.
          try {
            localStorage.setItem(DOC_META_KEY, (function () {
              var raw = localStorage.getItem(DOC_META_KEY);
              var all = raw ? (JSON.parse(raw) || {}) : {};
              all[cacheKey] = meta;
              return JSON.stringify(all);
            })());
          } catch (e) { /* kvota to'lgan bo'lishi mumkin */ }
        }
      }
      // `meta.fr` bo'sh bo'lsa — tez yo'l ishlamaydi (Telegram
      // FILE_REFERENCE_INVALID beradi). Bunday holatda eski (GramJS)
      // yo'lga qaytamiz.
      var fc = (meta && meta.fr) ? fastClient() : null;
      if (fc && meta) {
        S.fast = fc;
        var fdoc = docMetaToDoc(meta);
        var fsize = bytesOf(fdoc);
        var fprobe = quickPlaybackProbe(fdoc);
        if (fsize && fprobe) {
          S.doc = fdoc;
          S.size = fsize;
          S.totalRead = 0;
          headSize(fdoc.id, fsize);
          S.loc = {
            id: fdoc.id,
            accessHash: fdoc.accessHash,
            fileReference: fdoc.fileReference,
            thumbSize: ''
          };
          S.probe = fprobe;
          connect();
          node.setAttribute('data-size', String(fsize));
          S.pvCache = S.pvCache || {};
          S.pvCache[cacheKey] = {
            t: Date.now(), doc: S.doc, size: fsize, loc: S.loc, probe: fprobe, fromFast: true
          };
          if (isPreview()) renderPreview(node, opts, fsize, fprobe);
          else renderPlayer(node, opts, fsize, fprobe);
          return;
        }
      }
    }

    // --- 1b) ESKI YO'L: GramJS bundle + findDoc (fallback) --------------
    var sessionPromise = ensureSession(view, { fastPlayback: true }).then(
      function (client) { return { client: client }; },
      function (error) { return { error: error }; }
    );

    var sessionResult = await sessionPromise;
    if (sessionResult.error) {
      var e = sessionResult.error;
      var em = (e && (e.errorMessage || e.message)) || String(e);
      // Hover-preview: login oqimini boshlamaymiz, jim to'xtaymiz.
      if (isPreview()) return;
      if (em === 'AUTH_REVOKED' || isAuthError(em)) { goLogin(); return; }
      throw new Error('Telegram ulanish: ' + em);
    }
    var client = sessionResult.client;
    if (S.job !== job) return;

    // --- 2b) Hujjat keshi --------------------------------------------
    // Hujjat metama'lumoti keshlanadi. Format probe bo'lsa ishlatiladi;
    // metadata-only prefetchda non-MP4 probe shu yerda, worker tayyor bo'lgach bajariladi.
    var cachedDoc = null;
    if (cacheKey) {
      var cHit = S.pvCache && S.pvCache[cacheKey];
      // Shu hujjat uchun prefetch HOZIR yuklanayotgan bo'lsa — uni kutamiz.
      // Shunda ikki marta `findDoc` qilinmaydi va tayyor natija darhol
      // ishlatiladi (foydalanuvchi slaydni tez almashtirganda ham tez).
      if (!cHit && S.prefetchKey === cacheKey && S.prefetchPromise) {
        try { await S.prefetchPromise; } catch (e) { /* pastda o'zimiz qidiramiz */ }
        if (S.job !== job) return;
        if (!hasSession()) { goLogin(); return; }
        cHit = S.pvCache && S.pvCache[cacheKey];
      }
      if (cHit && (Date.now() - cHit.t) < 20 * 60 * 1000) {
        S.doc = cHit.doc;
        S.size = cHit.size;
        S.totalRead = 0;
        headSize(cHit.doc && cHit.doc.id, cHit.size);
        S.loc = cHit.loc;
        S.probe = cHit.probe || quickPlaybackProbe(cHit.doc);
        cachedDoc = cHit.doc;
        if (S.probe) {
          connect();
          if (S.probe.playable !== false) {
            if (isPreview()) renderPreview(node, opts, cHit.size, S.probe);
            else renderPlayer(node, opts, cHit.size, S.probe);
          } else {
            renderAdaptivePlayer(node, opts, cHit.size, S.probe, 'Tayyorlanmoqda…');
          }
          return;
        }
      }
    }

    // --- 3) Xabar va videoni topish ----------------------------------
    var doc = cachedDoc;
    if (!doc) {
      setStatus('Telegram\'dan yuklanmoqda...');
      try {
        doc = await findDoc(client, opts);
      } catch (e) {
        var findErr = (e && (e.errorMessage || e.message)) || String(e);
        if (isAuthError(findErr)) {
          clearSession();
          resetAuth();
          goLogin();
          return;
        }
        throw e;
      }
    }
    if (S.job !== job) return;
    S.authed = true; // successful message lookup validates the stored session
    try { saveSession(client.session.save()); } catch (e) {}

    var size = bytesOf(doc);
    if (!size) throw new Error('Fayl hajmi olinmadi');

    S.doc = doc;
    S.size = size;
    S.totalRead = 0;
    headSize(doc.id, size);
    S.loc = new S.T.Api.InputDocumentFileLocation({
      id: doc.id,
      accessHash: doc.accessHash,
      fileReference: gramJsBytes(doc.fileReference),
      thumbSize: ''
    });

    // Hujjat metama'lumotini brauzer keshiga yozamiz — keyingi ochilishda
    // GramJS bundle'ini umuman yuklamasdan tez yo'l ishlaydi.
    if (cacheKey) docMetaPut(cacheKey, doc);

    connect();
    node.setAttribute('data-size', String(size));

    // --- 4) Playerni format probe'siz tez ishga tushirish --------------
    // Noma'lum fayl nomi uchun MP4 indeksi yoki oxirgi baytlarni kutmaymiz.
    // Native player darhol sinab ko'radi; xato bo'lsa onVideoError transportni
    // tekshiradi va moslashuvchan playerga o'tadi. Hover preview probe kutadi.
    var probe = quickPlaybackProbe(doc);
    if (probe.uncertain && isPreview()) {
      setStatus('Format tekshirilmoqda...');
      probe = await probeFormat(size);
    }
    S.probe = probe;                            // probeTransport uchun
    if (S.job !== job) return;

    if (cacheKey) {
      S.pvCache = S.pvCache || {};
      S.pvCache[cacheKey] = {
        t: Date.now(), doc: S.doc, size: size, loc: S.loc, probe: probe
      };
    }

    if (!probe.playable) {
      // Indeks o'qilib chiqildi va BRAUZER QABUL QILMADI (MKV/HEVC/…).
      // Lekin bu oxirgi javob EMAS: faylni shu yerda, brauzer ichida
      // qayta o'ramiz yoki qayta kodlaymiz (mediabunny). Server hech
      // narsani ko'rmaydi — hammasi foydalanuvchi kompyuterida.
      // Preview'da ham shu yo'l ishlaydi (boshqaruvsiz, jim).
      renderAdaptivePlayer(node, opts, size, probe,
        'Brauzer bu formatni to‘g‘ridan-to‘g‘ri ochmaydi — '
        + 'shuning uchun qayta tayyorlanmoqda.');
      return;
    }

    // --- 5) <video> — saytdagi mavjud boshqaruvga ulanadi ------------
    if (isPreview()) { renderPreview(node, opts, size, probe); return; }
    renderPlayer(node, opts, size, probe);
  }

  // ------------------------------------------------------------------ CTA
  //
  // `opt.fallback: true` — brauzer formatni demuxladi (H.264 emas).
  //                     Yechim: Telegram'ning o'z playerida ochish.
  // `opt.retry: true`   — bog'lanish uzildi. Yechim: qayta urinish.
  function renderCta(node, opts, probe, opt) {
    opt = opt || {};
    var ch = opts.channel ? '<div class="tgs-dim">Kanal: @' + esc(opts.channel) + '</div>' : '';

    var note;
    if (probe.sub) {
      // Haqiqiy, o'lchangan sabab — hech qanday taxminga yo'q.
      note = esc(probe.sub);
    } else if (probe.videoCodecs && probe.videoCodecs.length) {
      note = 'Video Telegram’dan to‘liq o‘qildi — transport ishlaydi. '
        + 'Muammo faqat formatda: brauzer MKV/HEVC ni <code>&lt;video&gt;</code> bilan o‘ynata olmaydi.';
    } else {
      note = 'Video Telegram’dan o‘qildi, lekin brauzer uni demuxladi. '
        + 'Boshqa brauzerda (Edge, Firefox) yoki Telegram ilovasida ko‘ring.';
    }

    node.innerHTML =
      '<div class="tgs-cta">'
      + (opts.poster ? '<img class="tgs-poster" src="' + esc(opts.poster) + '" alt="" onerror="this.style.display=\'none\'">' : '')
      + '<div class="tgs-cta-box">'
      + '<div class="tgs-cta-title">' + esc(probe.reason || 'Bu format brauzerda oynatilmaydi') + '</div>'
      + '<div class="tgs-dim">' + note + '</div>'
      + ch
      // --- Yechim tugmasi: holatga qarab
      + (opt.retry
        ? '<button type="button" class="tgs-btn" data-tgs-retry>Qayta ulanib urinish</button>'
        : '')
      + (tgOpenBtn(opts, 0, 'tgs-btn-alt')
        ? '<div class="tgs-dim" style="margin-top:10px">Yoki Telegram ilovasida oching '
          + '(film Telegram’dan o‘ynaydi, sayt ichida emas):</div>'
          + tgOpenBtn(opts, 0, 'tgs-btn-alt')
        : '')
      + '</div></div>';

    var b = node.querySelector('[data-tgs-retry]');
    if (b) b.onclick = function () {
      b.disabled = true;
      b.textContent = 'Ulanmoqda…';
      var saved = node.dataset.tgsDead;
      delete node.dataset.tgsDead;
      // SW'ni majburlaymiz, keyin filmni qayta o'rnatamiz.
      ensureWorker().then(function () {
        return mount(node, global.__wcTgLast || opts.__last || {});
      }).catch(function () { delete node.dataset.tgsDead; });
    };
  }

  // ------------------------------------------------- haqiqiy sababni aniqlash
  //
  // Nima uchun bu kerak? Oldingi kod `<video>` xato berganida DOIM
  // "kodek mos kelmaydi" deb yozardi. Bu YOLG'ON edi va ikki tomonni ham
  // chalg'itdi: haqiqiy sabab (tarmoq, SW, 502/404) yashirilgan, o'rniga
  // "HEVC/MKV" aytilgan — aynan biz 520 MB MP4/H.264 fayl haqida
  // "kodek mos emas" xabari oldik.
  //
  // Endi biz o'zimiz SW'ga kichik so'rov yuborib, haqiqiy javobni ko'ramiz.
  // Shunda xatoni to'g'ri tasniflash mumkin:
  //   * 200/206 + video baytlari  -> transport ishladi, muammo FORMATDA
  //   * 502 / 404 / bo'sh javob    -> transport ishlamadi, muammo YO'LDA
  //   * 0 (SW umuman javob bermadi)-> SW sahifani boshqarmadi
  function probeTransport(size) {
    return fetch(fileUrl() + '?size=' + size + '&mime=' + encodeURIComponent(mimeOf(S.probe || {}))
      + '&probe=1&t=' + Date.now() + docQ(), { headers: { Range: 'bytes=0-1023' } })
      .then(function (res) {
        if (!res.ok) {
          return res.text().then(function (text) {
            return {
              status: res.status,
              type: res.headers.get('Content-Type') || '',
              bytes: text.length,
              magic: '',
              err: String(text || ('HTTP ' + res.status)).slice(0, 320)
            };
          });
        }
        return res.arrayBuffer().then(function (buf) {
          var head = new Uint8Array(buf.slice(0, 16));
          var magic = '';
          for (var i = 4; i < 8 && i < head.length; i++) magic += String.fromCharCode(head[i]);
          return {
            status: res.status,
            type: res.headers.get('Content-Type') || '',
            bytes: buf.byteLength,
            // 'ftyp' = MP4 konteyneri; faqat muvaffaqiyatli media javobida tekshiriladi.
            magic: magic
          };
        });
      })
      .catch(function (e) { return { status: 0, type: '', bytes: 0, magic: '', err: String(e.message || e) }; });
  }

  // Javob haqiqatan video bayti bilan kelganmi? (MP4 = 'ftyp', Matroska = EBML)
  function isVideoBytes(d) {
    if (!d || d.bytes < 64) return false;
    if (d.magic === 'ftyp') return true;
    if (d.status === 0) return false;
    return /^video\//.test(d.type);
  }

  // <video> xato berdi. Sabah, avval haqiqiy sababni aniqlaymiz.
  function onVideoError(node, opts, probe, v) {
    if (node.dataset.tgsDead) return;          // allaqach ko'rsatilgan
    node.dataset.tgsDead = '1';
    var code = v.error ? v.error.code : 0;
    try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) {}

    probeTransport(S.size || 0).then(function (d) {
      if (isVideoBytes(d)) {
        // Transport ISHLADI. Demak bu haqiqatan format muammosi —
        // va uning yechimi bor: faylni shu yerda, brauzer ichida
        // qayta o'ramish / qayta kodlash.
        renderAdaptivePlayer(node, opts, S.size, probe,
          'Brauzer Telegram’dan kelgan faylni demuxladi — '
          + 'qayta tayyorlanmoqda.');
        return;
      }
      // Transport YO'Q. Bu boshqa xato — uni "kodek" deb aytish XATO bo'lardi.
      var why = d.status === 0
        ? 'Service Worker javob bermadi. Sahifa Telegram kanaliga ulanib turishi kerak.'
        : d.status === 502
          ? 'Telegram CDN dan bayt oqib bo‘lmadi: ' + (d.err || d.magic || 'noma’lum')
          : d.status === 404
            ? 'Service Worker so‘rovni ushlamadi (404). Sahifa yangilanishi kerak.'
            : 'Telegram javobi ' + d.status + ' — ' + (d.type || 'noma’lum tur');

      function showCta() {
        renderCta(node, opts, {
          containerName: probe.containerName,
          videoCodecs: probe.videoCodecs,
          reason: 'Video o‘ynab boshlmadi — muammo KODEKDA emas, bog‘lanishda.',
          sub: why,
          channel: opts.channel, post: opts.post
        }, { retry: true });
      }

      // Eskirgan `file_reference` — bu vaqtinchalik holat, "kodek" yoki
      // "bog'lanish" muammosi emas. Havolani yangilab, pleerni AVTOMATIK
      // bir marta qayta ochamiz; foydalanuvchidan tugma bosishni so'ramaymiz.
      if (isFileRefErr(d.err || '') && !S.frAuto) {
        S.frAuto = 1;
        refreshDocLoc(opts).then(function (ok) {
          if (ok && S.mount && S.mountOpts) mount(S.mount, S.mountOpts);
          else showCta();
        });
        return;
      }

      showCta();
    });
  }

  // ------------------------------------------------ Telegram'ning o'z playeri
  //
  //  Sizning g'oyangiz: "filmga bosilsa, Telegram o'z playerida ochsin —
  //  sayt faqat vosita bo'lsin."
  //
  //  RASMIY YO'L (core.telegram.org/api/links):
  //    tg://resolve?domain=<kanal>&post=<id>&t=<soniya>
  //
  //  Bu HAQIQIY deep link — Telegram ilovasi (yoki Telegram Web) ochiladi va
  //  xabar o'z playerida ochiladi. Ikkita muhim afzalligi:
  //
  //    1) Saytimizning playeri HEVC / MKV ni chiqarmaydi (Chrome cheklovi),
  //       Telegram'ning playeri esa CHIQARADI. Ya'ni biz "bu format
  //       ko'rinmaydi" deb CTA ko'rsatgan fayllar ham Telegram'da ochiladi.
  //    2) `t=` — foydalanuvchi saytimizda qayerda to'xtagan bo'lsa, Telegram
  //       playeri AYNAN shu daqiqadan qayta o‘ynaydi.
  //
  //  Chegara: bu haqiqiy chiqish — foydalanuvchi saytni tark etadi. Shuning
  //  uchun bizda IKKALALA yo'l ham bor: sayt ichida (hozirgi) va Telegram'da.
  function tgDeepLink(channel, post, seconds) {
    var user = String(channel || '').replace(/^@/, '');
    if (!user || !post) return '';
    var u = 'tg://resolve?domain=' + encodeURIComponent(user) + '&post=' + encodeURIComponent(post);
    // Rasmiy format: soniya yoki HhMmSs. Faqat 1 sekunddan katta bo'lsa.
    if (seconds && seconds > 1) u += '&t=' + Math.floor(seconds);
    return u;
  }

  // "Telegram'da ochish" tugmasi. `seconds` — joriy o'qish vaqti.
  function tgOpenBtn(opts, seconds, cls) {
    var link = tgDeepLink(opts.channel, opts.post, seconds);
    if (!link) return '';
    return '<a class="tgs-btn' + (cls ? ' ' + cls : '') + '"'
      + ' href="' + esc(link) + '"'
      + ' data-tg-open="1"'
      + ' title="Telegram ilovasida o‘z playerida ochiladi">'
      + '✈ Telegram’da ochish</a>';
  }


  // --- UDP bo'lmagan sahifalar uchun engil o'ynatish zaxirasi ----------------
  //
  // `player.js` (UDP) bo'lsa, u avtomatik o'ynash, boshqaruv va pauzani
  // boshqaradi. Reels sahifasida player.js yo'q — o'sha yerda <video>
  // hech qachon `play()` bo'lmay, "qotib" qolardi (foydalanuvchi shikoyati:
  // "serverdan 0 bayt · ... 20 MB da to'xtadi"). Bu funksiya faqat shunday
  // sahifalar uchun: avtomatik o'ynatish (avval jim, keyin ovozni ochish)
  // va bosilganda pauza/play. Index.php'da UDP bor — u yerda chaqirilmaydi.
  function attachNativeFallback(v) {
    if (!v) return;
    v.style.cursor = 'pointer';
    v.addEventListener('click', function () {
      if (v.paused) {
        // Foydalanuvchi bosdi — bu "user gesture", ovozni ochib o'ynatamiz.
        v.muted = false;
        var rp = v.play();
        if (rp && rp.catch) rp.catch(function () { /* jim */ });
      } else {
        v.pause();
      }
    });
    var kick = function () {
      if (!v.paused) return;
      // Avval JIM o'ynatamiz — ovozli avtomatik o'ynash ko'p brauzerlarda
      // bloklanadi. Boshlangach ovozni ochamiz.
      v.muted = true;
      var p = v.play();
      if (p && p.then) {
        p.then(function () { try { v.muted = false; } catch (e) {} })
         .catch(function () { /* jim qoladi — bosilganda ochiladi */ });
      }
    };
    kick();
    v.addEventListener('loadeddata', kick, { once: true });
    v.addEventListener('canplay', kick, { once: true });
  }

  // --------------------------------------------------------------- player
  function renderPlayer(node, opts, size, probe) {
    posterBgOff(node);                 // endi `<video poster>` o'zi ko'rsatadi
    var cfg = JSON.stringify({
      autoplay: true,
      resumeAt: (S.cfg && S.cfg.resumeAt) || 0,
      introStart: 0,
      introEnd: 0,
      title: (S.cfg && S.cfg.title) || '',
      next: (S.cfg && S.cfg.next) || null
    }).replace(/'/g, '&#39;').replace(/&/g, '&amp;');

    // `?mime=` — haqiqiy konteyner turi. SW uni avval `video/mp4` deb
    // qattiq yuborardi; MKV/HEVC faylda bu brauzerni darhol rad etishga
    // majbur qiladi (MIME haqiqiy bo'lishi SHART).
    var info = videoInfo(S.doc);
    var duration = Number(info.duration) || 0;
    var url = fileUrl() + '?size=' + size + '&dur=' + encodeURIComponent(duration)
      + '&t=' + Date.now() + '&mime=' + encodeURIComponent(mimeOf(probe)) + docQ();

    node.innerHTML =
      '<div class="udp-player" data-udp data-udp-config=\'' + cfg + '\'>'
      + '<video id="playerVideo" playsinline preload="metadata" fetchpriority="high"'
      + (opts.poster ? ' poster="' + esc(opts.poster) + '"' : '')
      + ' src="' + esc(url) + '"></video>'
      + '</div>'
      + '<div class="tgs-foot">'
      + '<span class="tgs-pill">' + esc(probe.containerName) + '</span>'
      + '<span class="tgs-dim">' + esc(probe.videoCodecs.join(', ') || 'video')
      + ' · ' + (size / 1048576).toFixed(0) + ' MB'
      + ' · <b>serverdan 0 bayt</b></span>'
      // Telegram'dan haqiqatan qancha kelgani (jonli). Butun fayl
      // YUKLANMAYDI — faqat o'ynash uchun kerakli bo'laklar olinadi.
      + '<span class="tgs-dim tgs-read" title="Telegram CDN dan shu paytga qadar olingan hajm">'
      + 'Telegram’dan: 0 MB</span>'
      + '</div>'
      // Indeks o'qilmagan bo'lsa — bu OGOHLANTIRISH, bloklash emas.
      // Film sinab ko'riladi; haqiqiy chiqarsa, pastdagi `error`
      // tinglovchisi CTA'ni ko'rsatadi. Bloklansa, o'ynatilishi mumkin
      // bo'lgan film foydalanuvchiga berilmas edi.
      + (probe.uncertain
        ? '<div class="tgs-note">Indeks (moov)ni o\'qib chiqolmadik — sabab: '
          + esc(probe.truncated || 'topilmadi') + '. Film sinab ko\'riladi.</div>'
        : '');

    // Saytdagi mavjud Telegram-ko'rinishidagi boshqaruvni ulaymiz
    // (play/pause, seek, ovoz, to'liq ekran, keyingi qism).
    var hasUdp = !!(global.UDP && global.UDP.initAll);
    try {
      if (hasUdp) global.UDP.initAll();
    } catch (e) { /* boshqaruvsiz ham ko'radi */ }

    // --- <video> haqiqiy xato bersa --------------------------------------
    //
    // Indeksni o'qib ololmagan (uncertain) holda oldindan bloklamasdik.
    // Endi brauzer o'zi sinab ko'rdi: agar haqiqiy chiqsa — CTA asosli
    // bo'ladi. Lekin endi CTA "kodek" deb YOLG'ON gapirmaydi: avval
    // `probeTransport()` orqali haqiqiy sababni o'lchaymiz (onVideoError).
    try {
      var v = document.getElementById('playerVideo');
      if (v) {
        // Ko'rildi deb topilganda keshni o'chirish uchun hujjat id'si.
        v.setAttribute('data-wc-doc', currentDocId());
        v.addEventListener('error', function () {
          onVideoError(node, opts, probe, v);
        }, { once: true });
        armReady(v);

        // UDP (player.js) bo'lmagan sahifalarda — masalan reels.php —
        // video hech qachon `play()` bo'lmasdi (yuqoridagi izohga qarang).
        if (!hasUdp) attachNativeFallback(v);
      }
    } catch (e) { /* eshituvchi ulanmadi — muammo yo'q */ }

    // Dastlabki 0 MB ni ko'rsatish (keyingi bo'laklar kelganda yangilanadi).
    progress();

  }

  // ============================================ 5b. MOSLASHUVCHAN OYNASH
  //
  // NIMAGAN?
  //
  // Yuqoridagi `renderPlayer` faqat TABIIY formatlarni ochadi
  // (MP4/H.264 — Telegram kanallarining ko'pchilik hujjatlari shunday).
  // Lekin kanalda MKV, HEVC, AVI, MPEG-TS ham bo'ladi — ular brauzer
  // tomonidan demuxlanmaydi va `<video src=…>` bo'sh natija beradi.
  //
  // BU YERDA biz shu formatlarni BRAUZER ICHIDA ochamiz:
  //
  //     MKV/HEVC/AVI/TS  ──▶  [mediabunny]  ──▶  fMP4  ──▶  MSE  ──▶  <video>
  //
  // Hech narsa serverga yuklanmaydi: Telegram baytlari to'g'ridan-to'g'ri
  // brauzerga oqadi, konvertatsiya foydalanuvchi kompyuterida bo'ladi.
  //
  // "Tabiiy ochiladimi?" deb qayta tekshirish ham shu yerda: `probe`
  // faqat MP4 indeksini o'qiy olsa aniq natija beradi, aks holda
  // haqiqiy sinov — shu oqimning o'zi.
  function renderAdaptivePlayer(node, opts, size, probe, why) {
    if (S.play || S.playAbort) return;          // allaqach boshlandi
    posterBgOff(node);                           // `<video poster>` o'zi ko'rsatadi

    // Bekor qilish. Modal yopilganda `stop()` uni otadi — konvertatsiya
    // shu zahoti to'xtaydi (Telegram'dan oqish ham to'xtaydi).
    var ctl = new AbortController();
    S.playAbort = ctl;
    // CTA chiqib qolsa, keyingi urinishda yana sinab ko'rsak bo'ladi.
    delete node.dataset.tgsDead;

    var cfg = JSON.stringify({
      autoplay: true,
      resumeAt: (S.cfg && S.cfg.resumeAt) || 0,
      introStart: 0,
      introEnd: 0,
      title: (S.cfg && S.cfg.title) || '',
      next: (S.cfg && S.cfg.next) || null
    }).replace(/'/g, '&#39;').replace(/&/g, '&amp;');

    var name = (videoInfo(S.doc).filename || probe.containerName || 'video').toUpperCase();
    var info = videoInfo(S.doc);

    node.innerHTML =
      '<div class="udp-player" data-udp data-udp-config=\'' + cfg + '\'>'
      + '<video id="playerVideo" playsinline preload="metadata" fetchpriority="high"'
      + (opts.poster ? ' poster="' + esc(opts.poster) + '"' : '')
      + '></video>'
      + '</div>'
      + '<div class="tgs-prep" data-prep>'
      + '<div class="tgs-prep-row">'
      + '<span class="tgs-prep-spin" aria-hidden="true"></span>'
      + '<span class="tgs-prep-title" data-prep-title>Tayyorlanmoqda…</span>'
      + '</div>'
      + '<div class="tgs-prep-bar"><div class="tgs-prep-fill" data-prep-bar></div></div>'
      + '<div class="tgs-dim tgs-prep-note" data-prep-note>' + esc(name)
      + (info.w ? ' · ' + info.w + '×' + info.h : '')
      + ' · ' + (size / 1048576).toFixed(0) + ' MB'
      + (why ? '<br>' + esc(why) : '') + '</div>'
      + '</div>'
      + '<div class="tgs-foot">'
      + '<span class="tgs-pill">' + esc(probe.containerName || 'video') + '</span>'
      + '<span class="tgs-dim">' + esc(probe.videoCodecs.join(', ') || 'video') + '</span>'
      + '<span class="tgs-dim"><b>serverdan 0 bayt</b></span>'
      + '<span class="tgs-dim tgs-read">Telegram’dan: 0 MB</span>'
      + '</div>';

    var v = document.getElementById('playerVideo');
    if (v) v.setAttribute('data-wc-doc', currentDocId());
    if (isPreview() && v) {
      v.muted = true; v.loop = true;
      // Oddiy rejimda avtomatik o'ynashni UDP boshqaradi; preview'da UDP
      // o'chirilgani uchun o'zimiz ishga tushiramiz (muted — ruxsat).
      var kick = function () {
        try { var p = v.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
      };
      v.addEventListener('loadeddata', kick, { once: true });
      v.addEventListener('canplay', kick, { once: true });
    }
    if (v) armReady(v);
    var bar = node.querySelector('[data-prep-bar]');
    var title = node.querySelector('[data-prep-title]');
    var note = node.querySelector('[data-prep-note]');

    // ------------------------------------------------ QOTIB QOLISH QO'RIQCHISI
    //
    // NIMA UCHUN: yangi fayllarda (MKV/HEVC, MP4 indeksi fayl oxirida) remux
    // boshlanadi-yu, `read()` dan bo'sh javob kelib jarayon JIM qotib qolishi
    // mumkin. Foydalanuvchi "Tayyorlanmoqda…" ni cheksiz ko'radi va "film
    // umuman ochilmayapti" deydi. Endi 75 soniya ichida video boshlanmasa —
    // aniq xabar, qayta urinish va Telegram havolasi ko'rsatiladi.
    var started = false;
    var phase = '';
    var lastLog = Date.now();
    var deadline = Date.now() + 75000;
    var guard = isPreview() ? 0 : setInterval(function () {
      if (ctl.signal.aborted) { clearInterval(guard); return; }
      if (started) { clearInterval(guard); return; }
      if (v && (v.currentTime > 0.05 || v.readyState >= 2)) {
        started = true; clearInterval(guard); return;
      }
      var heavy = phase === 'transcode' || phase === 'transcode-ffmpeg';
      // Kodlash (transcode) uzoq davom etishi mumkin — faqat JIMLIKni tekshiramiz.
      if (heavy ? (Date.now() - lastLog > 60000) : (Date.now() > deadline)) {
        clearInterval(guard);
        adaptiveFailed(node, opts, probe,
          new Error('STALL: video ' + (heavy ? 'kodlashda jim qoldi' : '75 soniyada boshlanmadi')));
      }
    }, 1000);

    // Saytdagi mavjud boshqaruv (play/pause, seek, ovoz, to'liq ekran)
    // shu DOM tuzilmasiga bog'liq — shuning uchun ham xuddi shu
    // strukturani yasadik.
    try { if (!isPreview() && global.UDP && global.UDP.initAll) global.UDP.initAll(); } catch (e) {}

    function setBar(ratio, label, sub) {
      if (bar) bar.style.width = Math.max(2, Math.min(100, ratio * 100)) + '%';
      if (title && label) title.textContent = label;
      if (note && sub) note.textContent = sub;
    }

    // Telegram'dan aniq oraliqni o'qish. mediabunny shu bitta
    // funksiyani ishlatsa bas — SW orasidan o'tmaydi (tezroq).
    var read = function (offset, length) {
      return readBytes(offset, length).then(function (b) {
        S.totalRead += b.length;
        progress();
        return b;
      });
    };

    loadPlayLib().then(function (lib) {
      return lib.openWithMediabunny({
        video: v,
        size: size,
        durationHint: info.duration || 0,
        filename: info.filename,
        read: read,
        signal: ctl.signal,
        log: function (m) { lastLog = Date.now(); if (note) note.textContent = m; },
        progress: function (i) {
          // Konvertatsiya o'ynashdan OLDINGA yig'ilishi mumkin — shuning
          // uchun haqiqiy "tayyor" foizi (media vaqti bo'yicha) ko'rsatiladi.
          phase = i.phase || '';
          lastLog = Date.now();
          var d = i.duration || 0;
          var media = d > 0 ? Math.min(1, (i.mediaTime + 1) / d) : 0;
          var conv = d > 0 ? Math.min(1, (i.ratio || 0)) : 0;
          var ahead = lib.bufferedAhead(v);
          var ready = Math.max(media, conv * 0.25);
          setBar(ready,
            (i.phase === 'transcode' ? 'Qayta kodlanmoqda' : 'Tayyorlanmoqda') + '…',
            name + ' · ' + lib.fmtTime(ahead) + ' oldinga tayyor'
            + (i.phase === 'transcode' ? ' · ' + Math.round(i.ratio * 100) + '%' : ''));
        }
      });
    }).then(function (h) {
      if (guard) clearInterval(guard);
      if (ctl.signal.aborted) { h.stop(); return; }
      S.play = h;
      S.playAbort = null;
      // Tayyor — tayyorgarlik panelini olib tashlaymiz.
      var p = node.querySelector('[data-prep]');
      if (p) p.parentNode.removeChild(p);
      if (!isPreview()) {
        if (global.UDP && global.UDP.initAll) {
          try { global.UDP.initAll(); } catch (e) {}
        } else {
          // Reels kabi UDP'siz sahifalarda video o'zi boshlanishi kerak.
          attachNativeFallback(v);
        }
      }

      // Orqaga seek: SourceBuffer bo'shab qolgan bo'lsa, oqim
      // shu vaqtdan qayta quradi.
      v.addEventListener('seeking', function () { h.seekNeeded(); });

      // Konvertatsiya tugagach — hech narsa qolmasin.
      h.done.catch(function () { /* stop() da to'xtatiladi */ });
    }).catch(function (e) {
      if (guard) clearInterval(guard);
      // Bekor qilingan bo'lsa — xato emas, foydalanuvchi filmni yopdi.
      if (e && e.name === 'AbortError') return;
      var m = (e && (e.errorMessage || e.message)) || String(e);

      // "Brauzer umuman o'qiy olmaydi" — oxirgi chora: ffmpeg.wasm.
      if (/^UNSUPPORTED_CODEC/.test(m)) {
        // Preview'da og'ir ffmpeg.wasm ishga tushirmaymiz — jim qoldiramiz.
        if (isPreview()) { adaptiveFailed(node, opts, probe, e); return; }
        loadPlayLib().then(function (lib) {
          return lib.openWithFfmpeg({
            video: v, size: size, filename: info.filename, read: read,
            signal: ctl.signal,
            log: function (t) { if (note) note.textContent = t; },
            progress: function (i) {
              setBar(Math.max(0.02, i.ratio || 0), 'Kodlanmoqda…',
                'Bu sekin, sabr qiling · ' + Math.round((i.ratio || 0) * 100) + '%');
            }
          });
        }).then(function (h) {
          if (ctl.signal.aborted) { h.stop(); return; }
          S.play = h;
          S.playAbort = null;
          var p = node.querySelector('[data-prep]');
          if (p) p.parentNode.removeChild(p);
          if (!isPreview()) {
            if (global.UDP && global.UDP.initAll) {
              try { global.UDP.initAll(); } catch (e) {}
            } else {
              attachNativeFallback(v);
            }
          }
        }).catch(function (e2) {
          if (e2 && e2.name === 'AbortError') return;
          adaptiveFailed(node, opts, probe, e2);
        });
        return;
      }

      // Boshqa xatolar — sababni ko'rsatib, eski CTA ga qaytamiz.
      adaptiveFailed(node, opts, probe, e);
    });
  }

  // Moslashuvchan oynash muvaffaqiyatsiz bo'lsa.
  function adaptiveFailed(node, opts, probe, e) {
    var m = (e && (e.errorMessage || e.message)) || String(e);
    if (S.playAbort) { try { S.playAbort.abort(); } catch (x) {} S.playAbort = null; }
    try {
      if (S.play && S.play.stop) S.play.stop();
    } catch (x) {}
    S.play = null;

    // Hover-preview: CTA ko'rsatmaymiz — karta posteri qoladi.
    if (isPreview()) return;

    // SABABNI TO'G'RI TASNIFLAYMIZ. Ilgari HAR QANDAY xato "muammo
    // formatda" deb ko'rsatilardi — bu chalg'ituvchi edi. Masalan
    // `LIMIT_INVALID` (Telegram so'rov hajmini rad etdi) — bu FORMAT
    // emas, o'qish/tarmoq xatosi. Formatga tegishli xato faqat
    // kodek haqiqatan dekodlanmaganda chiqadi (`UNSUPPORTED_CODEC`).
    var isFormat = /UNSUPPORTED_CODEC|undecodable_source_codec|canDecodeVideo|FORMAT_UNKNOWN|NO_VIDEO_TRACK|CANNOT_ENCODE/i.test(m);
    var isStall = /^STALL/.test(m);
    var reason, sub;
    if (isStall) {
      reason = 'Bu fayl brauzer ichida tayyorlanmadi';
      sub = 'Sabab: ' + m.replace(/^STALL:\s*/, '') + '. Fayl formati (MKV/HEVC) '
        + 'yoki Telegram oqimi to‘xtab qoldi. Pastdagi tugma orqali Telegram ilovasida oching — '
        + 'u yerda muammosiz o‘ynaydi.';
    } else if (isFormat) {
      reason = 'Bu formatni brauzer ichida ochib bo‘lmadi';
      sub = 'Sabab: ' + m + '. Telegram ilovasida bu film normal o‘ynaydi — '
        + 'pastdagi havoladan foydalaning.';
    } else {
      reason = 'Videoni tayyorlashda xatolik yuz berdi';
      sub = 'Sabab: ' + m + '. Bu video formati xatosi ekanini anglatmaydi; Telegram oqimi '
        + 'yoki ulanishida muammo bo‘lishi mumkin. Qayta urinib ko‘ring yoki Telegram ilovasida oching.';
    }

    renderCta(node, opts, {
      containerName: probe.containerName,
      videoCodecs: probe.videoCodecs,
      reason: reason,
      sub: sub,
      channel: opts.channel, post: opts.post
    }, { fallback: true });
  }

  // tg-play.js moduli — bir marta yuklanadi.
  function loadPlayLib() {
    if (!S.playLib) {
      S.playLib = import(base() + '/assets/js/tg-play.js').catch(function (e) {
        S.playLib = null;
        throw new Error('Video moduli yuklanmadi: ' + ((e && e.message) || e));
      });
    }
    return S.playLib;
  }

  function fail(node, e) {
    var m = (e && (e.errorMessage || e.message)) || String(e);
    node.innerHTML =
      '<div class="tgs-cta">'
      + '<div class="tgs-cta-box">'
      + '<div class="tgs-cta-title tgs-err">Xatolik</div>'
      + '<div class="tgs-dim">' + esc(m) + '</div>'
      + '<button type="button" class="tgs-btn" data-tgs-retry>Qayta urinish</button>'
      + '</div></div>';
    var b = node.querySelector('[data-tgs-retry]');
    if (b) b.onclick = function () {
      if (global.__wcTgLast) mount(node, global.__wcTgLast);
    };
  }

  // ================================================== 7. Telegram'dan olish
  function peerOf(p) { return '@' + String(p).replace(/^@/, ''); }
  async function findDoc(client, opts) {
    var peer = opts.channel;
    var id = Number(opts.post);
    if (!peer || !id) throw new Error('Telegram manzili noto\'g\'ri');

    var msg = null;
    var link = 'https://t.me/' + peer.replace(/^@/, '') + '/' + id;

    // 1) Odatdagi holat — public/private kanal posti. Bevosita kanal API'si
    //    getMessageByLink() dan tezroq: helper ichidagi qo'shimcha resolve va
    //    fallback chaqiriqlarini kutmaymiz.
    try {
      var r = await client.api.channels.getMessages({ channel: peerOf(peer), id: [id] });
      msg = (r && (r.messages || r)[0]) || null;
    } catch (e) {
      if (isAuthError((e && (e.errorMessage || e.message)) || '')) throw e;
    }
    if (!msg || !msg.id) {
      // 2) Link helper — t.me/c/... va ayrim privat havolalar uchun fallback.
      try { msg = await client.getMessageByLink(link); } catch (e) {
        if (isAuthError((e && (e.errorMessage || e.message)) || '')) throw e;
      }
    }
    if (!msg || !msg.id) {
      // 3) Oddiy guruh
      try {
        var r2 = await client.api.messages.getMessages({ peer: peerOf(peer), id: [id] });
        msg = (r2 && r2.messages && r2.messages[0]) || null;
      } catch (e) {
        if (isAuthError((e && (e.errorMessage || e.message)) || '')) throw e;
      }
    }
    if (!msg) throw new Error('Xabar topilmadi (kanal ommaboy emasmi?)');

    var doc = docOf(msg);
    if (doc) return doc;

    // Album bo'lishi mumkin — qo'shni xabarlarni tekshiramiz.
    var ids = [];
    for (var i = 0; i < 10; i++) ids.push(id + i);
    try {
      var rr = await client.api.channels.getMessages({ channel: peerOf(peer), id: ids });
      var list = (rr && rr.messages) || [];
      for (var k = 0; k < list.length; k++) {
        var d2 = docOf(list[k]);
        if (d2) return d2;
      }
    } catch (e) {
      if (isAuthError((e && (e.errorMessage || e.message)) || '')) throw e;
    }

    throw new Error('Bu xabarda video topilmadi');
  }

  function docOf(msg) {
    if (!msg || !msg.media) return null;
    if (msg.media.document) return msg.media.document;
    if (msg.media.webpage && msg.media.webpage.document) return msg.media.webpage.document;
    return null;
  }

  // `doc.size` Telegram SDK'larda big-integer bo'lishi mumkin — oddiy son EMAS.
  function bytesOf(doc) {
    var s = doc && doc.size;
    if (s === undefined || s === null) return 0;
    if (typeof s === 'number') return s;
    if (typeof s === 'string') return Number(s);
    return Number(s.toString());
  }

  function videoInfo(doc) {
    var a = (doc.attributes || []).find(function (x) {
      return x.className === 'DocumentAttributeVideo';
    });
    var f = (doc.attributes || []).find(function (x) {
      return x.className === 'DocumentAttributeFilename';
    });
    return {
      w: a ? a.w : 0, h: a ? a.h : 0,
      duration: a ? a.duration : 0,
      filename: f ? f.fileName : ''
    };
  }

  function nativeMp4Probe(doc) {
    var filename = String(videoInfo(doc).filename || '').toLowerCase();
    var mime = String((doc && doc.mime_type) || '').split(';')[0].trim().toLowerCase();
    if (!/\.mp4$/.test(filename) && !/\.m4v$/.test(filename)
        && mime !== 'video/mp4' && mime !== 'application/mp4') return null;
    return {
      playable: true,
      containerName: 'MP4',
      videoCodecs: [],
      reason: null,
      fastPath: true
    };
  }

  // Noma'lum fayl nomi uchun ham avval native playerga imkon beramiz.
  // Mos kelmasa, video error handler transportni tekshirib adaptive yo'lga o'tadi.
  function quickPlaybackProbe(doc) {
    var known = nativeMp4Probe(doc);
    if (known) return known;
    var info = videoInfo(doc);
    var hint = (String(info.filename || '') + ' ' + String((doc && doc.mime_type) || '')).toLowerCase();
    var containerName = 'MP4';
    if (/matroska|\.mkv|video\/x-matroska/.test(hint)) containerName = 'Matroska';
    else if (/webm/.test(hint)) containerName = 'WEBM';
    else if (/\.avi|msvideo/.test(hint)) containerName = 'AVI';
    else if (/\.mov|quicktime/.test(hint)) containerName = 'MP4';
    return {
      playable: true,
      uncertain: true,
      containerName: containerName,
      videoCodecs: [],
      reason: null,
      fastPath: true
    };
  }

  // ------------------------------------------------------- format aniqlash
  function fetchRange(start, end) {
    return fetch(fileUrl() + '?size=' + S.size + '&t=' + Date.now() + docQ(),
      { headers: { Range: 'bytes=' + start + '-' + end } })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.arrayBuffer();
      })
      .then(function (b) { return new Uint8Array(b); });
  }

  // `ctx` berilsa — baytlar TO'G'RIDAN-TO'G'RI Telegram'dan (SW orqali
  // emas) o'qiladi, shunda aktiv oqimga tegmasdan boshqa hujjatni
  // tekshirish mumkin (prefetch).
  function probeFormat(size, ctx) {
    // Hajmni yozib qo'yamiz: bosh baytlar keshi shundan foydalana oladi
    // (kichik fayl to'liq kelgan bo'lsa — bo'sh so'rov yubormasin).
    headSize(headId(ctx), Number(size) || 0);
    if (!global.WcProbe) {
      return Promise.resolve({
        playable: true, containerName: 'MP4', videoCodecs: [],
        reason: null
      });
    }
    if (ctx) {
      return global.WcProbe.probeMp4(size, function (start, end) {
        return readBytes(start, end - start + 1, ctx);
      });
    }
    return global.WcProbe.probeMp4(size, fetchRange);
  }

  // ================================================================= to'xtat
  //
  // Modal yopilganda / boshqa film ochilganda chaqiriladi.
  // Telegram klienti va SW ulanishi SAQLANADI — keyingi film darhol
  // boshlanadi (kalit, WebSocket, barchasi tayyor).
  function stop() {
    S.job++;
    // Konvertatsiya oqimini to'xtatish. Aks holda MSE yozuvi davom
    // etaveradi, Telegram'dan baytlar oqaveradi va yopilgan modal
    // orqasida resurs sarflanadi.
    if (S.playAbort) {
      try { S.playAbort.abort(); } catch (e) {}
      S.playAbort = null;
    }
    if (S.play) {
      try { S.play.stop(); } catch (e) {}
      S.play = null;
    }
    var v = document.getElementById('playerVideo');
    if (v) { try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) {} }
    S.doc = null; S.loc = null; S.size = 0; S.totalRead = 0;
    S.mount = null; S.probe = null;
    if (S.chan) { try { S.chan.port1.close(); } catch (e) {} S.chan = null; }
  }

  // ================================================================== init
  //
  // Sahifa ochilganda chaqiriladi: SW'ni darhol o'rnatamiz, shunda film
  // birinchi ochilganda kutish bo'lmaydi.
  function init() {
    try {
      // Telegram DC'ga ulanishni OLDINDAN boshlaymiz (TLS handshake sahifa
      // yuklanishi bilan parallel). Video bosilganda ulanish tayyor bo'ladi —
      // ~150–300 ms tejaladi.
      warmFast();
    } catch (e) {}
    try {
      if (!('serviceWorker' in navigator)) return;
      // Faqat O'RNATAMIZ — reload qilmaymiz. Foydalanuvchi saytga kirishi
      // bilan sahifasi sakramasligi uchun. To'liq tayyorlash (va kerak bo'lsa
      // bir marta reload) film ochilganda ensureWorker() orqali bajariladi.
      registerWorker().catch(function () { /* film ochilganda qayta uriniladi */ });
    } catch (e) {}
  }

  // Hover-preview uchun SW'ni "isitamiz": o'rnatamiz va sahifani
  // boshqarishini ta'minlaymiz — RELOAD QILMASDAN. Shunda hover paytida
  // `swCtl()` darhol tayyor bo'ladi va video kutmasdan boshlanadi.
  function warm() {
    try {
      if (!('serviceWorker' in navigator)) return Promise.resolve(false);
    } catch(e){ return Promise.resolve(false); }
    return registerWorker().then(function (reg) {
      try { if (getSwController()) return true; } catch(e){}
      try { if (reg && reg.active) reg.active.postMessage({ type: 'claim' }); } catch (e) {}
      return waitForController(2500);
    }).catch(function () { return false; });
  }

  // Tez prefetch: hujjat metama'lumotini lokal keshdan yoki serverdan oladi
  // (serverda keshlangan bo'lsa ~10 ms) va minimal klent bilan kerakli bosh
  // baytlarni oldindan yuklaydi. GramJS bundle'iga umuman murojaat qilinmaydi.
  function fastPrefetch(opts, key) {
    // Qaytarish qiymati:
    //   `null`  — tez yo'l umuman ishlatilmaydi (klient/sessiya yo'q);
    //   `true`  — tez yo'l ishlaydi;
    //   `false` — tez yo'l bu hujjat uchun ISHLAMADI (masalan Telegram
    //             `file_reference`ni rad etdi) — eski (GramJS) yo'lga qaytish.
    var f = fastClient();
    if (!f) return null;
    var meta = docMetaGet(key);
    var p = meta ? Promise.resolve(meta)
      : docMetaFromServer(opts).then(function (m) {
          if (m) docMetaSave(key, m);
          return m;
        });
    return p.then(function (m) {
      // `fr` bo'sh — bu metama'lumot ishlatilmaydi (Telegram uni rad etadi).
      if (!m || !m.fr) return false;
      S.fast = f;
      var doc = docMetaToDoc(m);
      var size = bytesOf(doc);
      if (!size) return false;
      var probe = quickPlaybackProbe(doc);
      var loc = {
        id: doc.id,
        accessHash: doc.accessHash,
        fileReference: doc.fileReference,
        thumbSize: ''
      };
      headSize(doc.id, size);
      S.pvCache = S.pvCache || {};
      S.pvCache[key] = { t: Date.now(), doc: doc, size: size, loc: loc, probe: probe, fromFast: true };
      // Joriy film: indeksni hozir, player mount bo'lishidan OLDIN yuklashni
      // boshlaymiz. Brauzer `moov` so'raganda javob keshdan keladi.
      if (opts.warmTail) warmTail(size, doc.id);

      // Faqat joriy video uchun (ixtiyoriy) bosh baytlarni oldindan olamiz.
      var warm = Math.min(Number(opts.warmBytes) || 0, 4 * 1024 * 1024);
      // Telegram `upload.getFile` limiti 1 MB, uzunlik 4096 ga bo'linishi SHART.
      // Aks holda server "LIMIT_INVALID" beradi va bo'sh ma'lumot qoladi.
      warm = Math.min(warm, 1024 * 1024);
      warm = Math.floor(warm / 4096) * 4096;
      if (!warm) return true;
      return f.getFile({
        id: doc.id,
        accessHash: doc.accessHash,
        fileReference: doc.fileReference,
        thumbSize: '',
        dcId: doc.dcId
      }, 0, warm).then(function (b) {
        headPut(doc.id, 0, b instanceof Uint8Array ? b : new Uint8Array(b));
        return true;
      }).catch(function (e) {
        var msg = (e && (e.errorMessage || e.message)) || String(e);
        // Telegram bu hujjatni rad etdi — tez yo'l BU HUJJAT uchun
        // ishlamaydi. Yozuvni tozalab, eski (GramJS) yo'lga qaytamiz.
        if (/FILE_REFERENCE|AUTH_KEY_UNREGISTERED|LIMIT_INVALID/.test(msg)) {
          try { if (S.pvCache && S.pvCache[key]) delete S.pvCache[key]; } catch (x) {}
          try {
            var raw = localStorage.getItem(DOC_META_KEY);
            if (raw) {
              var all = JSON.parse(raw) || {};
              if (all[key]) {
                delete all[key];
                localStorage.setItem(DOC_META_KEY, JSON.stringify(all));
              }
            }
          } catch (x) {}
          return false;
        }
        // Vaqtinchalik xato — mount o'zi qayta so'raydi.
        return true;
      });
    }).catch(function () {
      return false;
    });
  }

  // ============================================== oldindan yuklash (prefetch)
  //
  // Odatdagi keyingi reel/film uchun faqat METAMA'LUMOTNI tayyorlaydi.
  // watch.php joriy video uchun warmBytes bersa, so'ralgan bosh qismi qurilma
  // RAM keshiga olinadi; serverga yozilmaydi. Bekor qilinsa qolgan read to'xtaydi.
  function prefetch(opts) {
    opts = opts || {};
    var key = (opts.channel && opts.post)
      ? (String(opts.channel) + '/' + Number(opts.post)) : null;
    if (!key) return Promise.resolve(false);

    // Keshda bor bo'lsa — hech narsa qilmaymiz.
    //
    // DIQQAT: avval shu yerda `warmHead` chaqirilib, keyingi reel uchun
    // 1 MB fon rejimida tortilardi. Bu:
    //   * har o'tilgan reel uchun ~1 MB ortiqcha trafik (saytga og'irlik),
    //   * aktiv video bilan BIR klientda parallel `upload.getFile` — natijada
    //     global `tgCap` pasayib, joriy `<video>` oqimi ham "cho'q" qolardi.
    // Keyingi videolar uchun ortiqcha warm yo'q. Joriy watch sahifasi
    // `warmBytes` bersagina, o'sha miqdor oldindan olinadi (4 MiB bilan cheklanadi).
    var hit = S.pvCache && S.pvCache[key];
    if (hit && (Date.now() - hit.t) < 20 * 60 * 1000) {
      // Keshda bor, lekin indeks hali yuklanmagan bo'lishi mumkin — baribir
      // "warmtail" yuboramiz (SW takroriy ishni o'zi bloklaydi).
      if (opts.warmTail && hit.size) {
        warmTail(hit.size, (hit.loc && hit.loc.id) || (hit.doc && hit.doc.id));
      }
      return Promise.resolve(true);
    }

    // Xuddi shu hujjat allaqachon yuklanmoqda.
    if (S.prefetchKey === key && S.prefetchPromise) return S.prefetchPromise;

    // --- TEZ YO'L: metama'lumot keshda yoki serverda bo'lsa — GramJS
    // bundle'ini (5.4 MB) umuman yuklamaymiz. Faqat minimal klient (25 KB).
    // Bu sahifa yuklanganda eng katta tormoqni olib tashlaydi.
    if (!S.fastBroken) {
      var fastP = fastPrefetch(opts, key);
      if (fastP) {
        var fastAborted = false;
        S.prefetchKey = key;
        S.prefetchAbort = function () { fastAborted = true; };
        var fp = fastP.then(function (ok) {
          if (ok || fastAborted) return !!ok;
          // Tez yo'l bu hujjat uchun ishlamadi (masalan Telegram
          // `file_reference`ni rad etdi) — eski (GramJS) yo'lga qaytamiz.
          // Aks holda video umuman ochilmaydi.
          S.prefetchKey = null;
          S.prefetchAbort = null;
          return legacyPrefetch(opts, key);
        });
        S.prefetchPromise = fp;
        fp.catch(function () {}).then(function () {
          if (S.prefetchPromise === fp) {
            S.prefetchPromise = null;
            S.prefetchAbort = null;
            S.prefetchKey = null;
          }
        });
        return fp;
      }
    }

    return legacyPrefetch(opts, key);
  }

  // Eski (GramJS) yo'l: to'liq SDK orqali hujjatni topadi va keshlaydi.
  function legacyPrefetch(opts, key) {
    // Xuddi shu hujjat allaqachon yuklanmoqda.
    if (S.prefetchKey === key && S.prefetchPromise) return S.prefetchPromise;

    // Eskisini bekor qilib, yangisini boshlaymiz (bir vaqtda bittasi).
    cancelPrefetch();

    if (!hasSession()) return Promise.resolve(false);

    var aborted = false;
    S.prefetchKey = key;
    S.prefetchAbort = function () { aborted = true; };

    var p = (function () {
      try {
        return ensureSession(silentView(), { fastPlayback: true }).then(function () {
          if (aborted) return false;
          return findDoc(S.client, opts);
        }).then(function (doc) {
          if (aborted || !doc) return false;
          S.authed = true; // successful message lookup validates the session
          try { saveSession(S.client.session.save()); } catch (e) {}
          var size = bytesOf(doc);
          if (!size) return false;
          var loc = new S.T.Api.InputDocumentFileLocation({
            id: doc.id,
            accessHash: doc.accessHash,
            fileReference: gramJsBytes(doc.fileReference),
            thumbSize: ''
          });
          var ctx = { loc: loc, dcId: doc.dcId, abort: function () { return aborted; } };
          var nativeProbe = nativeMp4Probe(doc);
          var probePromise = (nativeProbe || opts.metadataOnly)
            ? Promise.resolve(nativeProbe) : probeFormat(size, ctx);
          return probePromise.then(function (probe) {
            if (aborted) return false;
            // Watch sahifasining faqat JORIY videosi uchun (ixtiyoriy)
            // bosh baytlarni shu qurilmada oldindan o'qiymiz. Serverga
            // video yuborilmaydi. `headPut()` bu baytlarni RAM'da ushlab,
            // playerning birinchi Range so'roviga qaytaradi. Keyingi videolar
            // uchun opts.warmBytes berilmaydi — trafik bilan raqobat yo'q.
            var warmBytes = Math.min(size, Math.max(0, Math.min(4 * 1024 * 1024,
              Number(opts.warmBytes) || 0)));
            S.pvCache = S.pvCache || {};
            var cacheEntry = { t: Date.now(), doc: doc, size: size, loc: loc, probe: probe };
            // Metadata'ni darhol ko'rinadigan qilamiz; player tugallanishini
            // kutmasdan ochilishi mumkin, warm read esa fon rejimida yakunlanadi.
            S.pvCache[key] = cacheEntry;
            if (opts.warmTail) warmTail(size, doc.id);
            var warm = warmBytes ? readBytes(0, warmBytes, ctx).catch(function () { return null; })
              : Promise.resolve(null);
            return warm.then(function () {
              if (aborted) return false;
              cacheEntry.t = Date.now();
              return true;
            });
          });
        });
      } catch (e) {
        return Promise.resolve(false);
      }
    })();

    S.prefetchPromise = p;
    p.catch(function (e) {
      var message = (e && (e.errorMessage || e.message)) || String(e);
      if (isAuthError(message)) {
        clearSession();
        resetAuth();
      }
    }).then(function () {
      // Faqat o'zimiz hali ham joriy promise bo'lsak tozalaymiz —
      // aks holda yangi prefetch holatini o'chirib qo'yardik.
      if (S.prefetchPromise === p) {
        S.prefetchPromise = null;
        S.prefetchAbort = null;
        S.prefetchKey = null;
      }
    });
    return p;
  }

  // `warmMedia` — hover/prefetch uchun: birinchi ~2 MB (taxminan 15 s) ni
  // shu qurilmada oldindan o'qib, RAM keshiga qo'yadi. Serverga video yuborilmaydi.
  function warmMedia(opts) {
    opts = opts || {};
    return prefetch(Object.assign({}, opts, {
      warmBytes: (opts.warmBytes != null) ? opts.warmBytes : (4 * 1024 * 1024)
    }));
  }

  function cancelPrefetch() {
    if (S.prefetchAbort) {
      try { S.prefetchAbort(); } catch (e) {}
    }
    S.prefetchAbort = null;
    S.prefetchKey = null;
    S.prefetchPromise = null;
  }

  // Sahifadan chiqishda (boshqa bo'limga o'tish) hamma narsani to'xtatamiz:
  // aktiv oqim + prefetch + SW kanali. Shunda yangi sahifa Telegram
  // kanalini kutmasdan tez ochiladi.
  function release() {
    cancelPrefetch();
    try { stop(); } catch (e) {}
  }

  // ================================================ 9. UMUMIY MTProto KLIENT
  //
  //  Reels izohlari, stiker/GIF yuborish kabi vazifalar uchun ulangan
  //  Ulangan Telegram klientini qaytaradi. Bu yerda LOGIN OQIMI YO'Q: agar kalit
  //  bo'lmasa yoki yaroqsiz bo'lsa — reject qilamiz (chaqiruvchi login
  //  sahifasiga yo'naltiradi yoki xabar ko'rsatadi).
  function commentClient() {
    if (S.client && S.authed) return Promise.resolve(S.client);
    if (!hasSession()) {
      var e = new Error('AUTH_REQUIRED');
      e.errorMessage = 'AUTH_REQUIRED';
      return Promise.reject(e);
    }
    var silent = {
      qrBox: function () { return null; },
      pwdForm: function () { return null; },
      pwdInput: function () { return null; },
      setState: function () {},
      needPassword: function () {},
      showError: function () {},
      askPhone: function () { return Promise.reject(new Error('AUTH_RESTART')); },
      askCode: function () { return Promise.reject(new Error('AUTH_RESTART')); }
    };
    return ensureSession(silent, { allowLogin: false });
  }


  // ======================================================= 8. KIRISH ESHIGI
  //
  //  Foydalanuvchi saytga kirganda BIR marta QR skanerlaydi. Kalit
  //  `localStorage` da qoladi, shuning uchun keyingi ochilishlarda —
  //  sahifa yangilangan yoki boshqa film bosilgan bo'lsa ham —
  //  skanerlash KERAK BO'LMAYDI.
  //
  //  Kalit yo'q bo'lsa, eshik QR ko'rsatadi va `onReady` chaqirilmaydi:
  //  katalog va filmlar faqat Telegram orqali ulangan payt ochiladi.

  function hasSession() {
    // Sessiya stringi formatlari o'zgarishi mumkin; unda "authKey" so'zi
    // yo'q. Shuning uchun faqat mazmunli uzunlikni
    // tekshiramiz (auth_key ~256 bayt -> base64 ~350 belgi). Kalitning
    // haqiqiy yaroqliligi `verify()` / `start()` da aniqlanadi.
    var s = loadSession();
    return !!(s && s.length > 20);
  }

  // Joriy Telegram akkaunti (unikal ko'rish uchun). Kirish/tekshirish
  // paytida `getMe()` chaqirilib saqlanadi. Maxfiy ma'lumot yo'q —
  // faqat id, ism va username; u ham faqat shu brauzerda qoladi.
  function me() {
    if (S.me) {
      return {
        id: S.me.id != null ? String(S.me.id) : '',
        firstName: S.me.firstName || '',
        lastName: S.me.lastName || '',
        username: S.me.username || ''
      };
    }
    // Xotirada yo'q (masalan, profil sahifasi qayta ulanmagan) — localStorage'dan.
    try {
      var raw = localStorage.getItem('wc_tg_me_v1');
      if (raw) {
        var m = JSON.parse(raw);
        if (m && m.id) {
          return {
            id: String(m.id),
            firstName: m.firstName || '',
            lastName: m.lastName || '',
            username: m.username || ''
          };
        }
      }
    } catch (e) {}
    return null;
  }

  // Eshikning holati: hozir ko'rsatilayotgan tugun va yopish funksiyasi.
  var gateNode = null;
  var gateFinish = null;

  function authGate(node, opts) {
    opts = opts || {};
    var done = false;
    var onReady = typeof opts.onReady === 'function' ? opts.onReady : function () {};

    function finish() {
      if (done) return;
      done = true;
      try { onReady(); } catch (e) { /* eshik yopilmay qolsa ham sayt ishlaydi */ }
    }

    node.classList.add('tgs-gate');
    node.hidden = false;
    node.innerHTML = gateHtml();

    function find(sel) { return node.querySelector(sel); }
    function state(html) {
      var n = find('.tgs-status');
      if (n) n.innerHTML = html;
    }
    function fail2(html) {
      var n = find('.tgs-gate-err');
      if (n) { n.innerHTML = html; n.hidden = false; }
      state('');
    }

    // QR maydonini ko'rsatish / yashirish. 2FA paroli faqat shu yerda
    // kiritiladi va HECH QAYERDA saqlanmaydi (ne serverga, ne localStorage'ga).
    function showQrArea(show) {
      var q = find('.tgs-qr'), p = find('.tgs-pwd');
      if (q) q.hidden = !show;
      if (!show && p) p.hidden = true;
    }

    node.addEventListener('click', function (e) {
      var t = e.target;

      // --- "qayta ro'yxatdan o'tish": eski kalitni tozalab, QR'ni qayta ko'rsatish
      var fg = t.closest && t.closest('[data-tg-forget]');
      if (fg) {
        try { localStorage.removeItem('wc_mtproto_auth_v1'); } catch (err) {}
        location.reload();
        return;
      }
    });

    // SDK almashsa ham bir xil ko‘rinish — QR/2FA maydonlari funksiya orqali
    // qayta topiladi (mount() dagi izoh shu yerda ham amal qiladi).
    var view = {
      qrBox:    function () { return find('.tgs-qr'); },
      pwdForm:  function () { return find('.tgs-pwd'); },
      pwdInput: function () { return find('.tgs-pwd input'); },
      setState: function (html) { state(html); },
      needPassword: function () {
        var q = find('.tgs-qr'), p = find('.tgs-pwd');
        if (q) q.hidden = true;
        if (p) p.hidden = false;
        state('Telegram <b>Settings › Privacy and Security › Two-Step '
          + 'Verification</b> dagi parolni kiriting.');
      }
    };

    // 2FA formasi yuborilgach maydon yashiriladi — parol DOM’da qolmasin.
    node.addEventListener('submit', function (e) {
      var t = e.target;
      if (!t || !t.classList || !t.classList.contains('tgs-pwd')) return;
      setTimeout(function () {
        var p = find('.tgs-pwd');
        if (p) p.hidden = true;
      }, 0);
    }, true);

    state('');

    // SW eshigi uchun ham kerak: eshik ochiq turishi kerak, lekin SW
    // o‘rnatilmagan bo‘lsa ham QR ishlaydi (video keyinroq ochiladi).
    ensureWorker().catch(function () { /* film ochilganda qayta uriniladi */ });

    gateNode = node;
    gateFinish = finish;

    // Kalit saqlangan bo'lsa Telegram jim tekshiriladi va eshik yopiladi —
    // foydalanuvchi hech narsani ko'rmaydi. Kalit bo'lmasa QR chiziladi.
    //
    // Bu — YAGONA yo'l: foydalanuvchi bir marta Telegram orqali
    // ro'yxatdan o'tadi, keyin barcha filmlar shu saytda o'ynaydi.
    // Kalit `localStorage` da qoladi (serverga hech narsa yuborilmaydi),
    // 2FA paroli esa HECH QAYERDA saqlanmaydi.
    if (hasSession()) node.setAttribute('data-cached', '1');

    state(hasSession() ? 'Telegram ulanishi tekshirilmoqda…'
                       : 'Telegram klienti tayyorlanmoqda…');
    showQrArea(true);

    return ensureSession(view)
      .then(function () {
        state('Telegram ulandi ✓');
        fail2('');
        finish();
      })
      .catch(function (e) {
        if (done) return;
        // QR ko'rsatilgan bo'lsa, bu oddiy holat — xato emas: foydalanuvchi
        // hali skaner qilmagan.
        if (find('.tgs-qr') && !find('.tgs-qr').hidden) { state(''); return; }

        // Kalit BOR lekin Telegram rad etdi — boshqa holat: eskirgan.
        // Yon panel ko'rsatkichi ham shuni aytishi kerak.
        if (hasSession()) {
          var d = document.getElementById('tgStatus');
          var t = document.getElementById('tgStatusTxt');
          if (d && t) {
            d.classList.remove('ok');
            d.classList.add('err');
            t.textContent = 'Kalit eskirgan';
            d.title = '“Yana” · “Telegram bilan qayta ulanish”';
          }
        }
        fail2('Ulanish muvaffaqiyatsiz: '
          + esc((e && e.message) || e)
          + '<br><span class="tgs-dim">'
          + (hasSession()
            ? 'Kalit eskirgan bo‘lishi mumkin — menyudan “Telegram bilan '
              + 'qayta ulanish” ni bosing.'
            : 'Sahifani yangilab, qayta urinib ko‘ring.')
          + '</span>');
      });
  }

  // Eshikning yagona markup'i.
  //
  //  Bitta yo'l bor: Telegram orqali ro’yxatdan o’tish (QR skanerlash).
  //  Sizning g'oyangiz shu: saytimiz kanal ko’rinishida, foydalanuvchi bir
  //  marta Telegram orqali ro’yxatdan o’tadi, keyin video shu saytda
  //  o’ynaydi. Server video baytini umuman ko’rmaydi.
  //
  //  Tanlov (Telegram Web / sayt ichida) olib tashlandi: Telegram o’z playerini
  //  sayt ichiga qo’yishga qarshi turadi (X-Frame-Options: deny), shuning uchun
  //  uning muqobili foydalanuvchini saytdan chiqarib yuborardi.
  function gateHtml() {
    return '<div class="tgs-gate-in">'
      + '<div class="tgs-gate-ic">Telegram</div>'
      + '<h2>Telegram orqali ro’yxatdan o’ting</h2>'
      + '<p class="tgs-dim">Bir marta QR skanerlang · shu brauzer uchun '
      + 'ro‘yxatdan o‘tgan hisoblanadi. Keyin barcha filmlar shu saytda '
      + 'o‘ynaydi va <b>Telegram CDN</b> dan oqadi: <b>sayt serveriga video '
      + 'bayti tushmaydi</b> · og‘irlikni Telegram ko‘taradi.</p>'
      + '<div class="tgs-status"></div>'
      + '<div class="tgs-qr" hidden></div>'
      + '<form class="tgs-pwd" hidden>'
      + '<label>Telegram paroli (2FA)</label>'
      + '<input type="password" autocomplete="off" placeholder="Parol">'
      + '<button type="submit">Kirish</button>'
      + '</form>'
      + '<p class="tgs-gate-err tgs-err" hidden></p>'
      + '<p class="tgs-gate-alt"><a href="javascript:void(0)" '
      + 'data-tg-forget>🔁 Qayta ro’yxatdan o’tish</a></p>'
      + '</div>';
  }

  // ------------------------------------------- "Telegram'da ochish" tugmasi
  //
  //  `tg://` — haqiqiy protokol. Faqat Telegram ilovasi O'RNATILGAN
  //  qurilmada ishlaydi. O'rnatilmagan kompyuterda brauzer uni "noma'lum
  //  protokol" deb tashlab ketadi — foydalanuvchi hech nara ko'rmaydi.
  //
  //  SHUNING UCHUN zaxira: `tg://` ni urinib ko'ramiz, 1.6 sekund keyin
  //  sahifa hali ham ko'rinib tursa (ya'ni ilova ochilmadi) — `t.me`
  //  havolasini ochamiz. U har qanday qurilmada ishlaydi: ilova o'rnatilgan
  //  bo'lsa ilova, yo'q bo'lsa Telegram Web ochiladi.
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('[data-tg-open]');
    if (!a) return;
    var href = a.getAttribute('href') || '';
    if (href.indexOf('tg://') !== 0) return;               // allaqali https

    e.preventDefault();

    // Zaxira havolani QURISH — satrni almashtirish emas.
    //
    // Eslatma: `tg://resolve?domain=wcinemauz&post=2` da `domain=` kalit
    // so'z va `post=` — qiymat. Ularni oddiy `replace` bilan almashtirsa
    // `https://t.me/domain=wcinemauz/2` chiqadi (soxta manzil!). Shuning
    // uchun query qismini HAQIQIY tahlil qilib, kalit-qiymat juftligini
    // olib quramiz:
    //
    //    tg://resolve?domain=<kanal>&post=<id>[&t=<soniya>]
    //         ->  https://t.me/<kanal>/<id>[?t=<soniya>]
    var q = href.slice(href.indexOf('?') + 1);
    var params = {};
    q.split('&').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i < 0) return;
      try {
        params[decodeURIComponent(kv.slice(0, i))] =
          decodeURIComponent(kv.slice(i + 1));
      } catch (e) { params[kv.slice(0, i)] = kv.slice(i + 1); }
    });

    var dom = (params.domain || '').replace(/^@/, '');
    var post = params.post || '';
    var https = (dom && post)
      ? 'https://t.me/' + encodeURIComponent(dom) + '/' + encodeURIComponent(post)
      : 'https://t.me/';
    // `t=` — Telegram Web ham qo'llaydi: qaysi daqiqadan boshlash.
    if (params.t && Number(params.t) > 1) https += '?t=' + Math.floor(params.t);

    var wentAway = false;
    var onHide = function () { wentAway = true; };
    document.addEventListener('visibilitychange', onHide, { once: true });
    window.addEventListener('pagehide', onHide, { once: true });
    window.addEventListener('blur', onHide, { once: true });

    // Telegram ilovasi chaqiruvni qabul qiladi.
    try { window.location.href = href; } catch (e) { /* pastga qarang */ }

    setTimeout(function () {
      document.removeEventListener('visibilitychange', onHide);
      // Sahifa ko'rinib tursa — ilova OCHILMADI. Zaxirani ochamiz.
      if (!wentAway && !document.hidden) {
        try { window.open(https, '_blank', 'noopener'); } catch (e) {}
      }
    }, 1600);
  }, true);

  global.TgStream = {
    mount: mount,
    stop: stop,
    init: init,
    // Hover-preview uchun SW'ni oldindan tayyorlash (reload qilmaydi).
    warm: warm,
    // Keyingi videoni oldindan tayyorlash (faqat metama'lumot keshlanadi).
    prefetch: prefetch,
    // Saytga kirganda BARCHA videolarning metama'lumotini bitta server
    // so'rovi bilan oldindan olish. Keyin bosilgan video darhol ochiladi.
    prefetchMany: prefetchMany,
    // Xuddi shu, lekin foydalanuvchining O'Z sessiyasi (GramJS) orqali —
    // `file_reference` shunda to'g'ri akkauntga tegishli bo'ladi.
    prefetchManyGram: prefetchManyGram,
    warmMedia: warmMedia,
    cancelPrefetch: cancelPrefetch,
    // Sahifadan chiqishda: oqim + prefetch + SW kanalini to'xtatish.
    release: release,
    // Kirish eshigi — saytga kirganda chaqiriladi (QR skanerlash).
    authGate: authGate,
    hasSession: hasSession,
    // Joriy Telegram akkaunt (id/ism) — unikal ko'rish uchun.
    me: me,
    // Login sahifasi (`tg-login.js`) uchun: QR yoki RAQAM bilan kirish.
    // `view` — askPhone / askCode / needPassword / setState beradi.
    login: function (view, opts) {
      opts = opts || {};
      return ensureSession(view, { mode: opts.mode || 'qr', allowLogin: true });
    },
    // Kalitni JIM tekshirish (login sahifasidagi "allaqachon kirgan" holati).
    // Kalit yaroqli bo'lsa — resolve; yaroqsiz/yo'q bo'lsa — reject.
    verify: function () {
      if (!hasSession()) return Promise.reject(new Error('NO_SESSION'));
      var silent = {
        qrBox: function () { return null; },
        pwdForm: function () { return null; },
        pwdInput: function () { return null; },
        setState: function () {},
        needPassword: function () {},
        askPhone: function () { return Promise.reject(new Error('AUTH_RESTART')); },
        askCode: function () { return Promise.reject(new Error('AUTH_RESTART')); }
      };
      return ensureSession(silent, { allowLogin: false });
    },
    // Xato matnini tushunarli ko'rinishga aylantirish (login sahifasi uchun).
    friendlyError: friendlyError,
    // Kalitni tozalash. `reload === false` bo'lsa qayta yuklamaydi.
    forget: function (reload) {
      clearSession();
      if (reload === false) return;
      location.reload();
    },
    // Ulangan MTProto klient (izohlar, stiker/GIF uchun).
    // Kalit bo'lmasa/yaroqsiz bo'lsa reject bo'ladi (login talab qilinadi).
    client: commentClient,
    // Telegram SDK bundle (Api, utils) — klient ulangandan keyin mavjud bo'ladi.
    bundle: function () { return S.T || null; },
    // Telegram ilovasida o'z playerida ochish (ixtiyoriy zaxira).
    tgLink: tgDeepLink,
    // Eslikni qayta ko'rsatish (kalit eskirgan bo'lsa).
    gate: function () { if (gateNode) { gateNode.hidden = false; } },
    boshqarish: {          // diagnostika uchun (konsoldan)
      holat: function () { return S; },
      session: loadSession
    }
  };
})(window);
