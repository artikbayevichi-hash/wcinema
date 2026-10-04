/* ============================================================================
 * W CINEMA — TELEGRAM CDN PLAYER
 * ============================================================================
 *
 * VAZIFA
 *   Saytda film bosilganda video shu joyda (modal ichida) ochiladi —
 *   t.me ga o'tib ketmaydi. Video baytlari esa BRAUZER tomonidan
 *   to'g'ridan-to'g'ri Telegram CDN dan olinadi.
 *
 *   SERVERGA VIDEO YUQMAYDI. Sayt serveri faqat HTML/JS beradi
 *   (bir necha yuz KB). Minglab tomoshabin bir vaqtda ko'rsa ham
 *   saytga deyarli umuman yuk tushmaydi.
 *
 * QANDAY ISHLAYDI (uch qatlam)
 *
 *   1) GramJS (5.3 MB) — brauzerdagi MTProto klient.
 *      Foydalanuvchi bir marta QR skanerlaydi; auth_key shu brauzerning
 *      localStorage'ida qoladi. Server kalitni HECH QACHON ko'rmaydi.
 *      (GramJS og'ir, shuning uchun faqat film birinchi marta
 *      ochilganda yuklanadi va keyin brauzer keshida saqlanadi.)
 *
 *   2) tg-cdn-worker.js — Service Worker.
 *      `tgfile/?size=N` so'rovini ushlab, 206 Partial Content qaytaradi.
 *      U Telegram'dan o'zi so'ramaydi: kerakli baytlarni sahifadan
 *      MessageChannel orqali so'raydi. Sababi — GramJS Service Worker
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
  function bundleUrl()  { return base() + '/assets/js/tg-client.bundle.js'; }
  function bundleGz()   { return bundleUrl() + '.gz'; }

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
    client: null,          // GramJS TelegramClient
    T: null,               // GramJS namespace (window.TgBundle)
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
    readyFired: false      // onReady bir marta chaqirilishi uchun
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

  // ============================================================ 1. GramJS
  //
  // 5.3 MB. Faqat film birinchi marta ochilganda yuklanadi (sabab: boshqa
  // foydalanuvchilar uchun bu og'ir). Yuklanish jarayoni foiz bilan
  // ko'rsatiladi, chunki birinchi ochilish sekin bo'lishi mumkin.
  var bundlePromise = null;

  function loadBundle(onProgress) {
    if (global.TgBundle && global.TgBundle.TelegramClient) {
      return Promise.resolve(global.TgBundle);
    }
    if (bundlePromise) return bundlePromise;

    bundlePromise = (function () {
      // ------------------------------------------------------------------
      // 1) SIQILGAN NUSXA (afzal yo'l)
      //
      // 5.3 MB o'rniga 718 KB. Server hech narsa siqmaydi — ochish
      // brauzerning o'zida bo'ladi. Bu saytni tezlashtiradigan eng katta
      // qadam, chunki GramJS faqat Telegram filmi ochilganda kerak.
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
        if (global.TgBundle && global.TgBundle.TelegramClient) res(global.TgBundle);
        else rej(new Error('GramJS yuklandi, lekin topilmadi'));
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
        var saved = loadSession();

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

        S.client = new T.TelegramClient(
          session,
          a.id,
          a.hash,
          {
            connectionRetries: 3,
            // Brauzerda TCP socket yo'q -> GramJS WebSocket transportini
            // ishlatadi (Telegram Web ham shu yo'l bilan ishlaydi).
            networkSocket: T.PromisedWebSockets,
            app: { platform: 'web' }
          }
        );

        // Kalit bor va bu shunchaki TEKSHIRISH (login sahifasidagi qayta
        // kirish emas): Telegramga jim ulanib, sessiya yaroqli ekanini
        // tasdiqlaymiz. Yaroqsiz bo'lsa — kalitni tozalab, AUTH_REVOKED
        // tashlaymiz (chaqiruvchi login sahifasiga yo'naltiradi).
        if (saved && !allowLogin) {
          return S.client.connect()
            .then(function () { return S.client.getMe(); })
            .then(function (me) { saveMe(me); savePhoto(S.client, me); pingLoginAlert(); return S.client; })
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
        S.authed = true;
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

  function waitForController(ms) {
    return new Promise(function (res) {
      if (navigator.serviceWorker.controller) return res(true);
      var t = setTimeout(function () { res(!!navigator.serviceWorker.controller); }, ms);
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        clearTimeout(t); res(true);
      }, { once: true });
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
      return Promise.reject(new Error('Brauzeringiz Service Worker\'ni qo\'llamaydi'));
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
        await navigator.serviceWorker.ready;
        return reg;
      } catch (e) {
        S.reg = null;
        throw new Error('Service Worker o\'rnatilmadi: ' + ((e && e.message) || e));
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
    var reg = await registerWorker();

    if (navigator.serviceWorker.controller) return true;

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
  }

  // ============================================ 5. SW bilan bayt almashish
  //
  // DIQQAT: `navigator.serviceWorker.controller` ni bir marta olib
  // SAQLAMASLIK KERAK. SW yangilanganda controller obyekti ALMASHADI va
  // eski obyektga yuborilgan xabarlar jimgina yo'qoladi. Har doim jonli
  // qiymatni so'raymiz.
  function swCtl() { return navigator.serviceWorker.controller; }

  function connect() {
    var ctl = swCtl();
    if (!ctl) return false;
    if (S.chan) { try { S.chan.port1.close(); } catch (e) {} }
    S.chan = new MessageChannel();
    S.chan.port1.onmessage = onRead;
    S.chan.port1.start();
    ctl.postMessage({ type: 'provide', size: S.size }, [S.chan.port2]);
    return true;
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

  // BITTA `upload.getFile` so'rovi. Qaytgan bayt soni `length` dan kam
  // bo'lishi mumkin (blok chegarasi tufayli) — buni `readBytes` hal
  // qiladi. Fayl tugagan bo'lsa — bo'sh massiv (xato EMAS).
  //
  // `ctx` — ixtiyoriy hujjat konteksti ({loc, dcId}). Berilmasa joriy
  // aktiv hujjat (S.loc/S.doc) ishlatiladi. Bu oldindan yuklash (prefetch)
  // uchun kerak: aktiv oqimga tegmasdan BOSHQA hujjatni o'qish imkonini
  // beradi.
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

    return S.client.invoke(new S.T.Api.upload.GetFile({
      location: loc,
      offset: aligned,
      limit: want,
      precise: true
    }), dc).then(function (res) {
      var b = res.bytes || res;
      var u8 = b instanceof Uint8Array ? b : new Uint8Array(b);
      // Telegram kamroq qaytarsa — ortiqcha joyni nol bilan
      // to'ldirmaymiz, faqat haqiqiy baytlarni qaytaramiz.
      if (u8.length <= skip) return new Uint8Array(0);
      return u8.slice(skip, skip + Math.min(length, u8.length - skip));
    });
  }

  // To'liq oraliqni o'qish. Har bir Telegram so'rovi 1 MB blok ichida
  // qoladi; katta oraliq bo'laklab yig'iladi.
  //
  // `ctx` — ixtiyoriy hujjat konteksti ({loc, dcId, abort}). Prefetch shu
  // orqali aktiv oqimga tegmasdan boshqa hujjatni o'qiy oladi; `abort()`
  // true qaytarsa o'qish darhol to'xtaydi (foydalanuvchi slaydni tashlab
  // ketgan bo'lsa — ortiqcha trafik ketmaydi).
  function readBytes(offset, length, ctx) {
    if (!(length > 0)) return Promise.resolve(new Uint8Array(0));
    if (ctx && ctx.abort && ctx.abort()) return Promise.resolve(new Uint8Array(0));

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

    // 2) Katta yoki chegarani kesib o'tuvchi so'rov — bo'laklab yig'amiz.
    return (function () {
      var parts = [], got = 0;

      function finish() {
        if (!got) return new Uint8Array(0);
        if (parts.length === 1) return parts[0];
        var out = new Uint8Array(got), p = 0;
        for (var i = 0; i < parts.length; i++) { out.set(parts[i], p); p += parts[i].length; }
        return out;
      }

      function step() {
        if (got >= length) return finish();
        if (ctx && ctx.abort && ctx.abort()) return finish();
        var off = offset + got;
        var skip = off - Math.floor(off / 4096) * 4096;
        // Shu blokka sig'adigan maksimal foydali bayt soni.
        var fits = Math.min(tgCap, roomInBlock(off)) - skip;
        if (fits < 1) fits = 1;                    // hech qachon to'xtamasin
        var piece = Math.min(fits, length - got);
        return readOnce(off, piece, null, ctx).then(function (b) {
          if (!b.length) return finish();          // fayl tugadi
          parts.push(b);
          got += b.length;
          return step();
        }, function (e) {
          var m = (e && (e.errorMessage || e.message)) || String(e);
          if (isLimitError(m) && tgCap > TG_MIN) {
            tgCap = Math.max(TG_MIN, Math.floor(tgCap / 2));
            return step();
          }
          if (got) return finish();                // borini qaytaramiz
          throw e;
        });
      }

      return step();
    })();
  }

  // SW so'rov yuborganda javob beramiz
  function onRead(ev) {
    var d = ev.data || {};
    if (d.type !== 'read') return;
    var port = ev.ports && ev.ports[0];

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
      fetch(fileUrl() + '?size=' + S.size + '&t=' + Date.now(), {
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
  function fireReady() {
    if (S.readyFired) return;
    S.readyFired = true;
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
    var url = fileUrl() + '?size=' + size + '&t=' + Date.now()
      + '&mime=' + encodeURIComponent(mimeOf(probe));
    node.innerHTML = '<video class="tgs-pv" id="playerVideo" muted playsinline loop '
      + 'preload="auto"'
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
    S.cfg = opts.cfg || {};
    S.onPlayerReady = typeof opts.onReady === 'function' ? opts.onReady : null;
    S.readyFired = false;
    S.job++;

    node.classList.add('tgs');

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
      // Sahifa boshqa filmga o'tgan bo'lsa, bu xato endi ahamiyatga ega emas.
      if (S.job !== job) return;
      fail(node, e);
    });
  }

  async function run(node, opts, view, job) {
    // --- 1) SW -------------------------------------------------------
    if (!swCtl()) {
      // Hover-preview paytida sahifani QAYTA YUKLAMAYMIZ — shunchaki
      // jimgina o'tkazib yuboramiz (keyingi hovergacha SW tayyor bo'ladi).
      if (isPreview()) return;
      setStatus('Telegram ulagichi tayyorlanmoqda...');
      var ok = await ensureWorker();
      if (!ok) {
        setStatus('<span class="tgs-warn">Telegram ulagichi tayyor emas. '
          + 'Sahifani bir marta yangilab, qayta urinib ko\'ring.</span>');
        return;
      }
    }

    // --- 2) Telegram sessiyasi ---------------------------------------
    // Sayt eshigi (`tg-guard`) allaqachon login talab qiladi; lekin sessiya
    // ochilish paytida bekor qilingan bo'lsa ham shu yerga kelamiz.
    if (!hasSession()) { if (!isPreview()) goLogin(); return; }
    var client;
    try {
      client = await ensureSession(view);
    } catch (e) {
      var em = (e && (e.errorMessage || e.message)) || String(e);
      // Hover-preview: login oqimini boshlamaymiz, jim to'xtaymiz.
      if (isPreview()) return;
      if (em === 'AUTH_REVOKED' || isAuthError(em)) { goLogin(); return; }
      throw new Error('Telegram ulanish: ' + em);
    }
    if (S.job !== job) return;

    // --- 2b) Hujjat keshi --------------------------------------------
    // Bir marta topilgan fayl (doc/loc) va format (probe) keshlanadi.
    // Keyingi mount — hover YOKI oldindan yuklash (prefetch) — bir ZUMDA
    // ochiladi: qayta findDoc/probe qilinmaydi.
    var cacheKey = (opts.channel && opts.post)
      ? (String(opts.channel) + '/' + Number(opts.post)) : null;
    if (cacheKey) {
      var cHit = S.pvCache && S.pvCache[cacheKey];
      // Shu hujjat uchun prefetch HOZIR yuklanayotgan bo'lsa — uni kutamiz.
      // Shunda ikki marta `findDoc` qilinmaydi va tayyor natija darhol
      // ishlatiladi (foydalanuvchi slaydni tez almashtirganda ham tez).
      if (!cHit && S.prefetchKey === cacheKey && S.prefetchPromise) {
        try { await S.prefetchPromise; } catch (e) { /* pastda o'zimiz qidiramiz */ }
        if (S.job !== job) return;
        cHit = S.pvCache && S.pvCache[cacheKey];
      }
      if (cHit && (Date.now() - cHit.t) < 20 * 60 * 1000) {
        S.doc = cHit.doc;
        S.size = cHit.size;
        S.totalRead = 0;
        S.loc = cHit.loc;
        S.probe = cHit.probe;
        connect();
        if (cHit.probe && cHit.probe.playable !== false) {
          if (isPreview()) renderPreview(node, opts, cHit.size, cHit.probe);
          else renderPlayer(node, opts, cHit.size, cHit.probe);
        } else {
          renderAdaptivePlayer(node, opts, cHit.size, cHit.probe, 'Tayyorlanmoqda…');
        }
        return;
      }
    }

    // --- 3) Xabar va videoni topish ----------------------------------
    setStatus('Telegram\'dan yuklanmoqda...');
    var doc = await findDoc(client, opts);
    if (S.job !== job) return;

    var size = bytesOf(doc);
    if (!size) throw new Error('Fayl hajmi olinmadi');
    var info = videoInfo(doc);

    S.doc = doc;
    S.size = size;
    S.totalRead = 0;
    S.loc = new S.T.Api.InputDocumentFileLocation({
      id: doc.id,
      accessHash: doc.accessHash,
      fileReference: doc.fileReference,
      thumbSize: ''
    });

    connect();
    node.setAttribute('data-size', String(size));

    // --- 4) Formatni aniqlash (video URL berilishidan OLDIN) ---------
    setStatus('Format tekshirilmoqda...');
    var probe = await probeFormat(size);
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
      + '&probe=1&t=' + Date.now(), { headers: { Range: 'bytes=0-1023' } })
      .then(function (res) {
        return res.arrayBuffer().then(function (buf) {
          var head = new Uint8Array(buf.slice(0, 16));
          var magic = '';
          for (var i = 4; i < 8 && i < head.length; i++) magic += String.fromCharCode(head[i]);
          return {
            status: res.status,
            type: res.headers.get('Content-Type') || '',
            bytes: buf.byteLength,
            // 'ftyp' = MP4 konteyneri. Boshqasi (masalan 'yxta' = "Media
            // is too big") = Telegram bizga video bermagan.
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

      renderCta(node, opts, {
        containerName: probe.containerName,
        videoCodecs: probe.videoCodecs,
        reason: 'Video o‘ynab boshlmadi — muammo KODEKDA emas, bog‘lanishda.',
        sub: why,
        channel: opts.channel, post: opts.post
      }, { retry: true });
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
    var url = fileUrl() + '?size=' + size + '&t=' + Date.now()
      + '&mime=' + encodeURIComponent(mimeOf(probe));

    node.innerHTML =
      '<div class="udp-player" data-udp data-udp-config=\'' + cfg + '\'>'
      + '<video id="playerVideo" playsinline preload="auto"'
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
      + '<video id="playerVideo" playsinline preload="auto"'
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
        log: function (m) { if (note) note.textContent = m; },
        progress: function (i) {
          // Konvertatsiya o'ynashdan OLDINGA yig'ilishi mumkin — shuning
          // uchun haqiqiy "tayyor" foizi (media vaqti bo'yicha) ko'rsatiladi.
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
    var isFormat = /UNSUPPORTED_CODEC|undecodable_source_codec|canDecodeVideo/i.test(m);
    var reason, sub;
    if (isFormat) {
      reason = 'Bu formatni brauzer ichida ochib bo‘lmadi';
      sub = 'Sabab: ' + m + ' (serverdan kelgan baytlar to‘g‘ri, muammo formatda)';
    } else {
      reason = 'Videoni tayyorlashda xatolik yuz berdi';
      sub = 'Sabab: ' + m + '. Serverdan kelgan baytlar to‘g‘ri — bu format xatosi emas, '
        + 'qayta urinib ko‘ring yoki Telegram ilovasida oching.';
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

    // 1) GramJS'ning tayyor metodi — t.me/kanal/1, t.me/c/123/1, privat
    //    havola hammasini o'zi to'g'ri ochadi.
    try { msg = await client.getMessageByLink(link); } catch (e) { /* keyingisi */ }
    if (!msg || !msg.id) {
      // 2) Kanal xabarlari uchun channels.getMessages (maydon: `channel`)
      try {
        var r = await client.api.channels.getMessages({ channel: peerOf(peer), id: [id] });
        msg = (r && (r.messages || r)[0]) || null;
      } catch (e) { /* keyingisi */ }
    }
    if (!msg || !msg.id) {
      // 3) Oddiy guruh
      try {
        var r2 = await client.api.messages.getMessages({ peer: peerOf(peer), id: [id] });
        msg = (r2 && r2.messages && r2.messages[0]) || null;
      } catch (e) { /* keyingisi */ }
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
    } catch (e) { /* keyingi */ }

    throw new Error('Bu xabarda video topilmadi');
  }

  function docOf(msg) {
    if (!msg || !msg.media) return null;
    if (msg.media.document) return msg.media.document;
    if (msg.media.webpage && msg.media.webpage.document) return msg.media.webpage.document;
    return null;
  }

  // `doc.size` GramJS'da big-integer (Long) — oddiy son EMAS.
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

  // ------------------------------------------------------- format aniqlash
  function fetchRange(start, end) {
    return fetch(fileUrl() + '?size=' + S.size + '&t=' + Date.now(),
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
    if (!('serviceWorker' in navigator)) return;
    // Faqat O'RNATAMIZ — reload qilmaymiz. Foydalanuvchi saytga kirishi
    // bilan sahifasi sakramasligi uchun. To'liq tayyorlash (va kerak bo'lsa
    // bir marta reload) film ochilganda ensureWorker() orqali bajariladi.
    registerWorker().catch(function () { /* film ochilganda qayta uriniladi */ });
  }

  // Hover-preview uchun SW'ni "isitamiz": o'rnatamiz va sahifani
  // boshqarishini ta'minlaymiz — RELOAD QILMASDAN. Shunda hover paytida
  // `swCtl()` darhol tayyor bo'ladi va video kutmasdan boshlanadi.
  function warm() {
    if (!('serviceWorker' in navigator)) return Promise.resolve(false);
    return registerWorker().then(function (reg) {
      if (navigator.serviceWorker.controller) return true;
      try { if (reg && reg.active) reg.active.postMessage({ type: 'claim' }); } catch (e) {}
      return waitForController(2500);
    }).catch(function () { return false; });
  }

  // ============================================== oldindan yuklash (prefetch)
  //
  // Keyingi reel/film uchun faqat METAMA'LUMOTNI tayyorlaydi: Telegram'dan
  // xabarni topib (findDoc) doc/size/loc ni keshlaydi. Video baytlari
  // o'ynalmaydi — shuning uchun aktiv oqimga xalaqit bermaydi. Foydalanuvchi
  // o'sha slaydga o'tganda mount keshdan bir zumda ochiladi (qayta findDoc
  // yo'q). Agar foydalanuvchi slaydni tashlab ketsa — cancelPrefetch()
  // o'qishni to'xtatadi.
  function prefetch(opts) {
    opts = opts || {};
    var key = (opts.channel && opts.post)
      ? (String(opts.channel) + '/' + Number(opts.post)) : null;
    if (!key) return Promise.resolve(false);

    // Keshda bor bo'lsa — hech narsa qilmaymiz.
    var hit = S.pvCache && S.pvCache[key];
    if (hit && (Date.now() - hit.t) < 20 * 60 * 1000) return Promise.resolve(true);

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
        return ensureSession(silentView()).then(function () {
          if (aborted) return false;
          return findDoc(S.client, opts);
        }).then(function (doc) {
          if (aborted || !doc) return false;
          var size = bytesOf(doc);
          if (!size) return false;
          var loc = new S.T.Api.InputDocumentFileLocation({
            id: doc.id,
            accessHash: doc.accessHash,
            fileReference: doc.fileReference,
            thumbSize: ''
          });
          var ctx = { loc: loc, dcId: doc.dcId, abort: function () { return aborted; } };
          return probeFormat(size, ctx).then(function (probe) {
            if (aborted) return false;
            S.pvCache = S.pvCache || {};
            S.pvCache[key] = { t: Date.now(), doc: doc, size: size, loc: loc, probe: probe };
            return true;
          });
        });
      } catch (e) {
        return Promise.resolve(false);
      }
    })();

    S.prefetchPromise = p;
    p.catch(function () {}).then(function () {
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
  //  GramJS klientini qaytaradi. Bu yerda LOGIN OQIMI YO'Q: agar kalit
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
    // DIQQAT: GramJS `StringSession.save()` — bu "1" + base64 satri; unda
    // "authKey" so'zi YO'Q. Shuning uchun faqat mazmunli uzunlikni
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

    // GramJS bilan bir xil ko‘rinish — QR/2FA maydonlari funksiya orqali
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
    // GramJS bundle (Api, utils) — klient ulangandan keyin mavjud bo'ladi.
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
