/* ==========================================================================
   watch.js - YouTube uslubidagi ko'rish sahifasi
   ==========================================================================
   Vazifa:
     1) Video player (direct/file/hls -> `.udp-player`, telegram ->
        `TgStream.mount()`, embed -> `<iframe>`).
     2) Izohlar - `tg-comments.js` moduli (stiker/emoji/GIF/rasm/@ + like,
        reply, o'chirish). Faqat mavzu endpointi boshqa (`api/video-topic.php`).
     3) Yon panel (YouTube kanal sahifasi kabi, ikki blok):
        - QISMLAR (faqat serial/anime, vertikal skroll) + qism raqami
          kiritish maydoni (Enter -> shu qismga sakrash);
        - aralash tavsiyalar - SARLAVHASIZ, ichki skrollsiz; izohlar
          bilan birga pastga ketadi va `IntersectionObserver` orqali
          pastga tushgan sayin keyingi sahifa yuklanadi (`api/related.php`).

    DIQQAT: bu sahifada CHAT yo'q (`tg-chat.js` ham yuklanmaydi) - chat
    alohida `chat.php` sahifasida.

   Reels moduli (`reels.js`) bu sahifada YUKLANMAYDI: u `#commentsModal`
   va carousel bilan ishlaydi. Shu sababli kompozitor yuborishini,
   matn maydoni o'sishini va Enter->yuborishni shu fayl qo'lda bog'laydi
   (reels.js dagi kodning aynan bir xili).
   ========================================================================== */
(function (global) {
  'use strict';

  var W     = global.WATCH || {};
  var APP   = global.APP || {};
  var base  = APP.base || '';
  var D     = W.content || null;

  // Kontent yo'q bo'lsa (404) - hech narsa qilmaymiz, PHP allaqachon
  // chiroyli "topilmadi" ekranini chizgan.
  if (!D) return;

  // ------------------------------------------------------------------ holat
  var S = {
    episodes:  W.episodes || [],
    selectedId: Number(W.selectedId) || 0,
    playback:  W.playback || null,
    related:   W.related || [],
    // Lazy load holati: nechta yuklandi, yana bormi, so'rov yuborilayotganmi.
    // Boshlang'ich ma'lumot `watch.php` dan keladi (bir sahifa), qolgani
    // `api/related.php` dan - foydalanuvchi pastga tushganda.
    relOffset: Number(W.relatedOffset) || 0,
    relMore:   !!W.relatedHasMore,
    relBusy:   false,
    genres:    W.genres || [],
    // Yon panelda nima ko'rinadi: qismlar (true) yoki tavsiyalar (false).
    // `hasPlaylist` serverda hisoblanadi (film -> tavsiyalar, anime -> qismlar).
    sideEpisodes: !!W.hasPlaylist,
    // Mobil "QISM TANLASH" fasl filtri: 0 = barcha fasllar, aks holda
    // tanlangan fasl raqami. Desktopda chiplar yashirin bo'lgani uchun
    // doim 0 qoladi — ro'yxat butunlay ko'rinadi.
    epSeason: 0,
    resumeAt: 0,
    switching: false,
    viewed: false,
    streamGeneration: 0,
    embedFailed: false,     // embed pleyeri ochilmadi -> o'z pleyerimizga qaytdik
    embedFailedKey: '',     // qaysi postda (channel/post) ishlamadi
    userPickedOwn: false,   // foydalanuvchi "Bizning pleyer" ni o'zi tanladimi
    embedRetry: false,      // "Tez pleyer" bosildi -> tekshiruv natijasini aytamiz
    durSaved: {},
    instantDoneFor: '',     // 1 s lik instant kadr ko'rsatilgan channel/post
    introDoneFor: '',       // 19 MB intro allaqachon ko'rsatilgan channel/post
    gwTriedFor: ''          // server gateway urinilgan channel/post (loop himoyasi)
  };

  /* Reels klipining CTA havolasi `watch.php?c=..&e=..#t=95` shaklida keladi
     ("🎬 To'liq qismni tomosha qilish (1:35 dan)"). Bu soniya `resumeAt`
     ustidan USTUN bo'lishi shart - aks holda foydalanuvchi "davom etish"
     nuqtasidan boshlab, butunlay boshqa joyda bo'lib qolardi. */
  var hashStart = 0;
  (function () {
    var m = /^#t=(\d+)$/.exec(location.hash || '');
    if (m) hashStart = Math.max(0, parseInt(m[1], 10) || 0);
  })();
  S.hashStart = hashStart;

  var CAT_EMOJI = {
    kino: '\u{1F3AC}', anime: '\u{1F338}', multfilm: '\u{1F9F8}', multflim: '\u{1F9F8}',
    serial: '\u{1F4FA}', film: '\u{1F3A5}', kinoqizi: '\u{1F3AC}', bolalar: '\u{1F9F8}'
  };

  // ============================================================ YORDAMCHILAR
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function el(id) { return document.getElementById(id); }

  function api(path) {
    return fetch(base + path, {
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin'
    }).then(function (r) {
      return r.json().catch(function () {
        throw new Error('Server javobi buzildi');
      }).then(function (d) {
        if (!r.ok || (d && d.success === false)) {
          throw new Error((d && d.message) || ('Xato ' + r.status));
        }
        return d;
      });
    });
  }

  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    var p = function (n) { return n < 10 ? '0' + n : '' + n; };
    return h > 0 ? h + ':' + p(m) + ':' + p(s) : m + ':' + p(s);
  }

  function fmtViews(n) {
    n = Number(n) || 0;
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.0', '') + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace('.0', '') + 'K';
    return String(n);
  }

  function fmtAgo(str) {
    if (!str) return '';
    var t = Date.parse(String(str).replace(' ', 'T'));
    if (isNaN(t)) return '';
    var d = Math.max(0, (Date.now() - t) / 1000);
    var Y = 31536000, MO = 2592000, DY = 86400, H = 3600, MI = 60;
    if (d >= Y)  return Math.floor(d / Y) + ' yil oldin';
    if (d >= MO) return Math.floor(d / MO) + ' oy oldin';
    if (d >= DY) return Math.floor(d / DY) + ' kun oldin';
    if (d >= H)  return Math.floor(d / H) + ' soat oldin';
    if (d >= MI) return Math.floor(d / MI) + ' daqiqa oldin';
    return 'hozirgina';
  }

  function catEmoji(slug, name) {
    var s = String(slug || '').toLowerCase();
    if (CAT_EMOJI[s]) return CAT_EMOJI[s];
    var n = String(name || '').toLowerCase();
    var keys = Object.keys(CAT_EMOJI);
    for (var i = 0; i < keys.length; i++) {
      if (s.indexOf(keys[i]) !== -1 || n.indexOf(keys[i]) !== -1) return CAT_EMOJI[keys[i]];
    }
    return '\u{1F3AC}';
  }

  var toastTimer = null;
  function toast(msg, kind) {
    var b = el('watchToast');
    if (!b) return;
    b.innerHTML = esc(msg);
    // DIQQAT: `.reels-toast` da `opacity: 0`, ko'rinishi uchun `show`
    // klassi SHART. Ilgari bu yerda `className = ...` yozilardi va u
    // `show` ni o'chirib yuborardi — natijada sahifadagi HECH QANDAY
    // toast ko'rinmasdi ("tugma hech narsa qilmayapti" bo'lib tuyulardi).
    b.className = 'reels-toast' + (kind ? ' ' + kind : '');
    b.hidden = false;
    void b.offsetWidth;                 // transition uchun reflow
    b.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      b.classList.remove('show');
      setTimeout(function () { b.hidden = true; }, 220);
    }, 3200);
  }

  /* Yoqdi/Yoqmadi/Saqlash login talab qiladi. Foydalanuvchi kirmagan
     (yoki sessiyasi muddati o'tgan - API 401 qaytargan) bo'lsa, tugma
     "jim" turib qolmasligi uchun login oynasiga yo'naltiramiz; kirib
     qaytgach aynan shu sahifa (va qism) ochiladi. Aks holda foydalanuvchi
     tugma ishlamayotgandek taassurot qolar edi. */
  function needLogin() {
    var next = encodeURIComponent(location.pathname + location.search);
    location.href = (base || '') + '/tg-login.php?next=' + next;
  }

  function epIndex(id) {
    for (var i = 0; i < S.episodes.length; i++) {
      if (Number(S.episodes[i].id) === Number(id)) return i;
    }
    return -1;
  }
  function ep(id) {
    var i = epIndex(id);
    return i >= 0 ? S.episodes[i] : null;
  }
  function curEp() { return ep(S.selectedId); }

  // ==================================================== QISMLARNI OLDINDAN TAYYORLASH
  //
  // MUAMMO: har bir qism almashganda `mount()` Telegram'dan HUJJATNI qayta
  // izlaydi (`findDoc` — kanal xabarlarini o'qish) va FORMATNI qayta aniqlaydi
  // (`probeFormat` — 64 KB o'qish). Ikkalasi ham tarmoqda, ketma-ket turadi -
  // shuning uchun "ikkinchi qism" har doim sekin ochiladi.
  //
  // YECHIM: `TgStream.prefetch({channel, post})` shu ishlarni OLDINDAN qilib
  // qo'yadi (1 ta xabar + 64 KB) va `pvCache` ga yozadi. `mount()` esa:
  //   * kalit keshda bo'lsa -> darhol `renderPlayer()` (s kutish umuman yo'q);
  //   * hali yuklanayotgan bo'lsa -> `prefetchPromise` ni KUTADI.
  // Ya'ni bu yerda yozgan kodimiz "boshqaruvni oldindan olib qo'yish" bilan
  // cheklangan - qolganini `tg-stream.js` o'zi hal qiladi.
  //
  // NIMA UCHUN `reels.js` dagi kabi emas: reels uchun bitta kanal, qisqa
  // klip; kinoda qismlar boshqa-boshqa postlarda va uzoq ko'riladi, ya'ni
  // oldindan tayyorlash foydasi katta.
  var lastPrefetchKey = '';   // ketma-ket takror so'rovlarni filtrlaymiz

  /**
   * Bitta qismni oldindan tayyorlaydi. `TgStream` yo'q/ishlamayotgan bo'lsa
   * jim o'tadi - hech qanday xato ko'rsatmaydi (shu sahifa ishlashda davom etadi).
   *
   * @param {object|null} e  qism (`S.episodes` dagi bir element)
   */
  function prefetchEpisode(e) {
    if (!e) return;
    var channel = e.tg_channel || '';
    var post    = Number(e.tg_post) || 0;
    if (!channel || !post) return;          // t.me emas (embed/direct fayl) - yuklanmaydi

    var key = channel + '/' + post;
    if (key === lastPrefetchKey) return;    // allaqachon so'ralgan
    lastPrefetchKey = key;

    if (!global.TgStream || typeof global.TgStream.prefetch !== 'function') return;
    try {
      // `warmTail`: katta filmlarda (1–4 GB) birinchi kadr MP4 `moov`
      // indeksini kutadi. Uni metama'lumot bilan BIR paytda boshlaymiz —
      // `episode.php` javobi kelguncha dum oynasi allaqachon yuklanmoqda.
      // Lekin bu QO'SHIMCHA trafik — saveData / 2G / 3G da qo'shmaymiz.
      var cn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      var et = (cn && cn.effectiveType) || '';
      var warmTail = !(cn && (cn.saveData || /^(slow-)?2g$|^3g$/.test(et)));
      global.TgStream.prefetch({ channel: channel, post: post, warmTail: warmTail });
    } catch (err) { /* jim: oldindan yuklash ixtiyoriy qulaylik */ }
  }

  /**
   * Joriy video uchun MP4 indeksini IMKON QADAR ERTA boshlaydi.
   * `TgStream.connect()` ham buni qiladi, lekin u player mount bo'lgach
   * ishga tushadi. SQL bootstrap'dagi doc id + hajm tayyor bo'lgani uchun
   * uni sahifa ochilishidayoq / qism almashganda darhol yuboramiz.
   */
  function warmCurrentIndex() {
    try {
      var SB = global.WCStreamBoot;
      var TS = global.TgStream;
      if (!SB || typeof SB.docMeta !== 'function') return;
      if (!TS || typeof TS.warmTail !== 'function') return;
      var e = curEp();
      if (!e || !e.tg_channel || !e.tg_post) return;
      var d = SB.docMeta(e.tg_channel + '/' + Number(e.tg_post));
      if (!d || !d.id || !(Number(d.size) > 0)) return;
      TS.warmTail(Number(d.size), String(d.id));
    } catch (err) { /* jim: faqat tezlashtirish */ }
  }

  /** Keyingi qismni, so'ng oldingi qismni zaxira sifatida tayyorlaydi. */
  function prefetchAdjacent() {
    var i = epIndex(S.selectedId);
    if (i < 0) return Promise.resolve(0);
    var nearby = [S.episodes[i + 1] || null, S.episodes[i - 1] || null]
      .filter(function (e) { return !!(e && e.tg_channel && e.tg_post); });
    if (!nearby.length) return Promise.resolve(0);
    if (global.TgStream && typeof global.TgStream.prefetchManyGram === 'function') {
      return global.TgStream.prefetchManyGram(nearby.map(function (e) {
        return { channel: e.tg_channel, post: e.tg_post };
      }));
    }
    // Zaxira yo'l: minimal prefetch so'rovi (video baytlari emas).
    nearby.forEach(prefetchEpisode);
    return Promise.resolve(nearby.length);
  }

  /**
   * Keyingi qismni oldindan tayyorlab qo'yadi (faqat BOSHI + moov dumi).
   *
   * Siljiydigan oyna: 2-qism ko'rilayotganda 3-qism, 3-qismga o'tgach
   * 4-qism tayyorlanadi. `3 s ko'rgach` degan eski cheklov olib tashlandi:
   * endi yangi qismning BIRINCHI KADRI chiqishi bilanoq navbatdagi qism
   * fon rejimida olinadi — keyingi bosish "seek" kabi tez bo'ladi.
   *
   * @param {boolean} force  qism almashish jarayonida ham chaqirishga ruxsat
   */
  var nextWarmDone = {};   // "channel/post" -> true
  function warmNextEpisode(force) {
    if (S.switching && !force) return;
    var i = epIndex(S.selectedId);
    var nx = i >= 0 ? S.episodes[i + 1] : null;
    if (!nx || !nx.tg_channel || !nx.tg_post) return;
    var key = nx.tg_channel + '/' + nx.tg_post;
    if (nextWarmDone[key]) return;

    // Trafik tejash: saveData yoqilgan yoki sekin ulanish (2G/3G) bo'lsa
    // fon yuklash qilinmaydi — joriy video oqimi ustun.
    var cn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    var et = (cn && cn.effectiveType) || '';
    if (cn && (cn.saveData || /^(slow-)?2g$|^3g$/.test(et))) return;

    nextWarmDone[key] = true;
    if (!global.TgStream || typeof global.TgStream.warmNext !== 'function') return;
    try {
      global.TgStream.warmNext({
        channel: nx.tg_channel, post: nx.tg_post, warmBytes: 1024 * 1024
      });
    } catch (e) { /* ixtiyoriy qulaylik — xato ko'rsatmaymiz */ }
  }

  function watchUrl(epId) {
    return base + '/watch.php?c=' + D.id + (epId ? '&e=' + epId : '');
  }

  // ==================================================================== VIDEO
  /** `player.js` ga `data-udp-config` uchun JSON (attribute ichida). */
  function udpConfig() {
    var cfg = {
      autoplay: true,
      resumeAt: S.hashStart ? 0 : (Math.floor(S.resumeAt) || 0),
      introStart: 0,
      introEnd: 0,
      title: D.title || '',
      next: null
    };
    if (S.episodes.length) {
      var i = epIndex(S.selectedId);
      var nx = i >= 0 ? S.episodes[i + 1] : null;
      if (nx) {
        cfg.next = {
          href: watchUrl(nx.id),
          label: (nx.number || nx.id) + '-qism'
        };
      }
    }
    return cfg;
  }
  function udpAttr(obj) {
    return JSON.stringify(obj).replace(/'/g, '&#39;').replace(/&/g, '&amp;');
  }

  // ================================================ PLEYER TANLOVI (EMBED)
  //
  // IKKI PLEYER, ikkisi ham saqlanadi:
  //   fast -> Telegram rasmiy embed pleyeri (`t.me/...?embed=1`). Video
  //           baytlari Telegram CDN'idan ketadi: Telegram Web bilan bir xil
  //           tezlik, sayt serveri baytlarni ko'rmaydi.
  //   own  -> bizning pleyer (MTProto + Service Worker). "Davom etish",
  //           sifat tanlash, keyingi qism tugmasi shu yerda ishlaydi.
  //
  // Tanlov `localStorage` da eslab qolinadi. Embed faqat OMMAVIY kanal
  // postlarida mumkin; `t.me/c/...` (xususiy kanal) da avtomatik o'chadi.
  var PMODE_KEY = 'wc_pmode';

  function tgEmbed() {
    var e = W.tgEmbed;
    if (!e || !e.channel || !Number(e.post)) return null;
    return e;
  }

  function pmode() {
    var m = '';
    try { m = String(localStorage.getItem(PMODE_KEY) || ''); } catch (e) {}
    if (m === 'fast' || m === 'own') return m;   // foydalanuvchi aniq tanladi
    // OMMAVIY postlarda eng tez yo'lni STANDART qilamiz: Telegram rasmiy
    // embed pleyeri video baytlarini to'g'ridan-to'g'ri o'z CDN'idan beradi —
    // sayt origin'i ularni umuman KO'RMAYDI. `effectivePmode()` embed faqat
    // `api/tg-embed.php` "playable" deganda yoqadi; katta fayllarda avtomatik
    // o'z MTProto pleyerimizga qaytamiz (xavfsiz zaxira).
    // Vaqtga sakrash (davom etish yoki `#t=95`) kerak bo'lsa embed bila
    // olmaydi — bunday hollarda o'z pleyerni tanlaymiz.
    if (tgEmbed() && !S.hashStart && !(Number(S.resumeAt) > 5)) return 'fast';
    return 'own';
  }

  function setPmode(m) {
    try { localStorage.setItem(PMODE_KEY, m); } catch (e) {}
  }

  // ---------------------------------------------------------------
  //  EMBED QAYERDA ISHLAYDI? (server tekshiruvi + kesh)
  //
  //  Telegram rasmiy embed pleyeri video baytlarini Telegram CDN'idan beradi,
  //  LEKIN faqat KICHIK fayllarni. Katta kinoda u video o'rniga
  //  "Media is too big — VIEW IN TELEGRAM" chiqaradi, ya'ni o'ynatmaydi.
  //  Buni brauzerdan bilib bo'lmaydi (iframe cross-origin), shuning uchun
  //  bir marta `api/tg-embed.php` dan so'raymiz: u t.me HTML'ini o'qib
  //  `playable` qaytaradi (6 soat server keshi). Natijani brauzerda ham
  //  eslab qolamiz - qayta so'ramaymiz.
  // ---------------------------------------------------------------
  var EMBED_BAD_KEY = 'wc_embed_bad';
  var EMBED_OK_KEY  = 'wc_embed_ok';
  var EMBED_BAD_TTL = 7 * 24 * 3600 * 1000;
  var EMBED_OK_TTL  = 6 * 3600 * 1000;

  function embedKey() {
    var e = tgEmbed();
    return e ? (e.channel + '/' + Number(e.post)) : '';
  }

  function readMap(key) {
    try {
      var v = JSON.parse(localStorage.getItem(key) || '{}');
      return (v && typeof v === 'object') ? v : {};
    } catch (e) { return {}; }
  }

  function writeMap(key, obj) {
    try { localStorage.setItem(key, JSON.stringify(obj)); } catch (e) {}
  }

  // null yoki { at: <vaqt>, reason: 'too_big'|'not_found'|... }
  function embedBadInfo() {
    var k = embedKey();
    if (!k) return { at: Date.now(), reason: 'no_channel' };
    var v = readMap(EMBED_BAD_KEY)[k];
    if (!v) return null;
    if (typeof v === 'number') v = { at: v, reason: '' };   // eski format
    if (!v.at || (Date.now() - v.at) > EMBED_BAD_TTL) return null;
    return v;
  }

  function isEmbedBad() { return !!embedBadInfo(); }

  function markEmbedBad(reason) {
    var k = embedKey();
    if (!k) return;
    var all = readMap(EMBED_BAD_KEY);
    all[k] = { at: Date.now(), reason: String(reason || '') };
    writeMap(EMBED_BAD_KEY, all);
  }

  function clearEmbedBad() {
    var k = embedKey();
    if (!k) return;
    var all = readMap(EMBED_BAD_KEY);
    if (!(k in all)) return;
    delete all[k];
    writeMap(EMBED_BAD_KEY, all);
  }

  // 'ok' (embed o'ynatadi) | 'bad' (o'ynatmaydi) | 'unknown' (hali tekshirilmagan)
  function embedState() {
    var k = embedKey();
    if (!k) return 'bad';
    if (isEmbedBad()) return 'bad';
    var at = Number(readMap(EMBED_OK_KEY)[k]) || 0;
    if (at && (Date.now() - at) < EMBED_OK_TTL) return 'ok';
    return 'unknown';
  }

  function markEmbedOk() {
    var k = embedKey();
    if (!k) return;
    var all = readMap(EMBED_OK_KEY);
    all[k] = Date.now();
    writeMap(EMBED_OK_KEY, all);
    clearEmbedBad();
  }

  // SQL bootstrap'dan kelgan tayyor javobni brauzer keshiga uramiz.
  // Natija: embedState() darhol 'ok'/'bad' qaytaradi va checkEmbed()
  // UMUMAN chaqirilmaydi -> api/tg-embed.php ga so'rov yuborilmaydi.
  function seedEmbedFromBoot() {
    var SB = global.WCStreamBoot;
    if (!SB) return;
    var e = SB.embed();
    if (!e || e.reason === 'unknown') return;   // server bilmadi -> eski yo'l
    var k = embedKey();
    if (!k) return;
    if (e.playable) markEmbedOk();
    else markEmbedBad(e.reason || '');
  }

  // Ommaviy kanal posti uchun SQL keshida anonim CDN manzili bor bo'lsa,
  // telegram oqimini oddiy <video src> ga aylantiramiz. Bu holda MTProto
  // sessiyasi, file_reference va Service Worker umuman ishlatilmaydi.
  function applyBootPlayback() {
    var SB = global.WCStreamBoot;
    if (!SB || typeof SB.effectivePlayback !== 'function') return;
    S.playback = SB.effectivePlayback(S.playback);
  }

  var embedCheckFor = '';     // qaysi post uchun so'rov yuborilgan
  var embedCoolUntil = 0;     // server javob bermasa — 30 s qayta so'ramaymiz

  // "Tez pleyer" bosilganda embed nima uchun ishlamaganini OSHKORA aytamiz.
  // Aks holda tugma "hech narsa qilmayapti" bo'lib tuyuladi.
  function embedBadToast(reason) {
    if (reason === 'too_big') {
      return 'Telegram bu katta faylni oqizmaydi \u2014 o\u2018z pleyerimizda ochiladi';
    }
    if (reason === 'not_found') {
      return 'Bu post ommaviy emas \u2014 o\u2018z pleyerimizda ochiladi';
    }
    if (reason === 'no_video') {
      return 'Bu postda video yo\u2018q \u2014 o\u2018z pleyerimizda davom etamiz';
    }
    return 'Telegram pleyeri ishlamadi \u2014 o\u2018z pleyerimizda ochiladi';
  }

  function checkEmbed() {
    var e = tgEmbed();
    if (!e || embedState() !== 'unknown') return;
    var k = embedKey();
    if (embedCheckFor === k) return;
    // Server yaqinda javob bermadi: cheksiz qayta so'rov (va qayta-qayta
    // toast) zanjirini to'xtatamiz.
    if (Date.now() < embedCoolUntil) return;
    embedCheckFor = k;
    var url = (APP.base || '') + '/api/tg-embed.php?channel=' +
      encodeURIComponent(e.channel) + '&post=' + Number(e.post);
    var done = function (d) {
      if (!d || !d.success) {
        // Tarmoq/server xatosi: "ishlamaydi" deb BELGILAMAYMIZ (post
        // sog'lom bo'lishi mumkin). Faqat foydalanuvchiga aytamiz.
        embedCheckFor = '';
        embedCoolUntil = Date.now() + 30000;
        if (S.embedRetry) {
          S.embedRetry = false;
          toast('Tekshirib bo\u2018lmadi \u2014 o\u2018z pleyerimizda davom eting');
        }
        renderPMode();
        return;
      }
      var wasRetry = !!S.embedRetry;                // foydalanuvchi bosganmi?
      var wantFast = wasRetry || pmode() === 'fast';
      if (d.playable) markEmbedOk();
      else markEmbedBad(d.reason || '');
      if (embedKey() !== k) { S.embedRetry = false; return; }  // boshqa qismga o'tdik
      if (d.playable) {
        S.embedRetry = false;
        if (wantFast && !S.embedFailed && !S.userPickedOwn) {
          setPmode('fast');
          if (wasRetry) toast('\u26A1 Telegram pleyeri ochildi');
          mountPlayer();                            // "tez" tanlangan - embedga o'tamiz
          return;
        }
        renderPMode();
        return;
      }
      // O'ynatmaydi: agar foydalanuvchi endigina bosgan bo'lsa - sababini aytamiz.
      if (S.embedRetry) {
        S.embedRetry = false;
        setPmode('own');                            // behuda "fast" ni eslab qolmaymiz
        toast(embedBadToast(d.reason || ''));
      }
      renderPMode();
    };
    if (global.fetch) {
      global.fetch(url, { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(done)
        .catch(function () { done(null); });
    }
  }

  // Amaldagi rejim: embed bu postda ishlamasa (yoki bir marta ochilmasa) —
  // o'z pleyerimizga qaytamiz.
  function effectivePmode() {
    if (pmode() !== 'fast') return 'own';
    if (S.embedFailed || embedState() !== 'ok') return 'own';
    return 'fast';
  }

  function embedUrl(e) {
    return 'https://t.me/' + encodeURIComponent(e.channel) + '/' + Number(e.post)
      + '?embed=1&mode=tme&discussion=0';
  }

  function embedBadNote() {
    var b = embedBadInfo();
    var r = (b && b.reason) || '';
    if (r === 'too_big') {
      return 'Telegram pleyeri katta faylni oqizmaydi — bizning pleyer ishlatilmoqda';
    }
    if (r === 'not_found') {
      return 'Bu post ommaviy emas — bizning pleyer ishlatilmoqda';
    }
    return 'Bu videoda Telegram pleyeri ishlamaydi — bizning pleyer ishlatilmoqda';
  }

  function renderPMode() {
    var box = el('watchPMode');
    if (!box) return;
    if (!tgEmbed()) {                 // embed umuman mumkin emas
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    var st = embedState();
    if (st === 'unknown') {           // server tekshiruvi ketmoqda
      var cooling = Date.now() < embedCoolUntil;
      if (S.embedRetry || cooling) {
        // Foydalanuvchi "Tez pleyer" ni bosdi (yoki server yaqinda javob
        // bermadi): panel yo'qolib qolmasin — holat KO'RINIB tursin.
        box.hidden = false;
        box.innerHTML =
          '<button type="button" class="watch-pmode-btn off" data-pmode="fast" disabled>'
          + (cooling && !S.embedRetry
            ? '\u26A0\uFE0F Tekshirib bo\u2018lmadi'
            : '\u23F3 Tekshirilmoqda\u2026')
          + '</button>'
          + '<button type="button" class="watch-pmode-btn on" data-pmode="own">'
          + '\u25B6 Bizning pleyer <span>MTProto</span></button>';
      } else {
        box.hidden = true;
        box.innerHTML = '';
      }
      checkEmbed();
      return;
    }
    if (st === 'bad') {
      // Embed bu postda o'ynatmaydi — sababini aytamiz. "Tez pleyer" tugmasi
      // QOLADI: foydalanuvchi qayta urinishi mumkin (masalan, post tuzatilgan
      // yoki keyinroq ochilgan bo'lsa). Bosilganda `wc_embed_bad` tozalanadi.
      box.hidden = false;
      box.innerHTML =
        '<button type="button" class="watch-pmode-btn off" data-pmode="fast"'
        + ' title="Qayta urinish — Telegram CDN orqali">'
        + '\u26A1 Tez pleyer <span>Telegram CDN</span></button>'
        + '<button type="button" class="watch-pmode-btn on" data-pmode="own"'
        + ' title="MTProto + Service Worker — davom etish va sifat nazorati">'
        + '\u25B6 Bizning pleyer <span>MTProto</span></button>'
        + '<i class="watch-pmode-note warn">' + esc(embedBadNote()) + '</i>';
      return;
    }
    var eff = effectivePmode();
    box.hidden = false;
    box.innerHTML =
      '<button type="button" class="watch-pmode-btn' + (eff === 'fast' ? ' on' : '') + '"'
      + ' data-pmode="fast" title="Telegram CDN orqali — eng tez">'
      + '\u26A1 Tez pleyer <span>Telegram CDN</span></button>'
      + '<button type="button" class="watch-pmode-btn' + (eff === 'own' ? ' on' : '') + '"'
      + ' data-pmode="own" title="MTProto + Service Worker — davom etish va sifat nazorati">'
      + '\u25B6 Bizning pleyer <span>MTProto</span></button>';
  }

  function bindPMode() {
    var box = el('watchPMode');
    if (!box) return;
    box.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-pmode]');
      if (!b) return;
      var m = b.getAttribute('data-pmode');
      if (m !== 'fast' && m !== 'own') return;

      if (m === 'fast') {
        // Ongli tanlov: "ishlamaydi" belgisini tozalab, qaytadan tekshiramiz.
        // Embed darhol o'rnatilmaydi — tekshiruv `playable:true` desa
        // `checkEmbed()` o'zi almashtiradi. Aks holda o'z pleyerimiz
        // (va joriy o'rni) buzilmaydi.
        S.userPickedOwn = false;
        clearEmbedBad();
        S.embedFailed = false;
        embedCheckFor = '';
        S.embedRetry = true;
        if (embedState() === 'ok') {                  // embed allaqachon tasdiqlangan
          S.embedRetry = false;
          setPmode('fast');
          mountPlayer();
          return;
        }
        // Panelda "tekshirilmoqda" ko'rsatamiz, so'ng natijani aytamiz.
        renderPMode();
        toast('Telegram pleyeri tekshirilmoqda\u2026');
        return;
      }

      S.userPickedOwn = true;
      var was = effectivePmode();                       // setPmode'dan OLDIN
      setPmode('own');
      if (was !== 'own') mountPlayer();                 // embeddan o'z pleyerimizga
      else renderPMode();
    });
  }

  // Embed pleyerini o'rnatadi. `false` — embed manzili yo'q (chaqiruvchi
  // o'z pleyerini o'rnatadi).
  //
  // MUHIM: Telegram embed sahifasi ommaviy bo'lmagan/o'chirilgan postda
  // "Post not found" ko'rsatadi va buni DOM'dan o'qib bo'lmaydi (cross-origin).
  // Lekin widget o'z balandligini `postMessage({event:'resize', height})`
  // bilan yuboradi: haqiqiy video post ~400-500 px, "topilmadi" esa ~66 px.
  // Shu farq orqali embed ishlamayotganini aniqlaymiz.
  var embedFrame = null;
  var embedGeneration = -1;
  var embedMsgBound = false;

  function bindEmbedMessages() {
    if (embedMsgBound) return;
    embedMsgBound = true;
    global.addEventListener('message', function (ev) {
      if (ev.origin !== 'https://t.me') return;
      var d = ev.data;
      if (typeof d === 'string') {
        try { d = JSON.parse(d); } catch (e) { return; }
      }
      if (!d || d.event !== 'resize') return;
      var frame = embedFrame;
      if (!frame || !frame.isConnected) return;      // eski (o'chirilgan) oyna
      var h = Number(d.height) || 0;
      if (h > 0 && h < 150) embedGone(embedGeneration);
    });
  }

  function embedGone(generation) {
    if (generation !== S.streamGeneration) return;
    if (S.embedFailed) return;
    S.embedFailed = true;
    S.embedFailedKey = embedKey();
    markEmbedBad('not_found');                        // keyingi safar darhol 'own'
    toast('Bu postda Telegram pleyeri ishlamaydi — o‘z pleyerimizga o‘tdik');
    mountPlayer();
  }

  function mountEmbed(host, pb, generation) {
    var e = tgEmbed();
    if (!e) return false;
    host.innerHTML =
      '<div class="player-wrap watch-embed">'
      + '<iframe src="' + esc(embedUrl(e)) + '"'
      + ' allow="autoplay; fullscreen; encrypted-media; picture-in-picture"'
      + ' allowfullscreen referrerpolicy="origin" title="Telegram pleyer"></iframe>'
      + '</div>';
    var frame = host.querySelector('iframe');
    if (!frame) return true;
    embedFrame = frame;
    embedGeneration = generation;
    bindEmbedMessages();
    // ZAXIRA: Telegram oynasi 9 soniyada ochilmasa (tarmoq/blok) — o'z
    // pleyerimizga qaytamiz. `S.embedFailed` qayta urinishning oldini oladi.
    var loaded = false;
    frame.addEventListener('load', function () { loaded = true; });
    setTimeout(function () {
      if (loaded || generation !== S.streamGeneration) return;
      embedGone(generation);
    }, 9000);
    return true;
  }

  function mountTelegramFallback(host, pb, generation) {
    if (generation !== S.streamGeneration) return;
    try { if (global.UzPlayer && typeof global.UzPlayer.destroyAll === 'function') global.UzPlayer.destroyAll(); } catch (e) {}
    try { if (global.UDP) global.UDP.destroyAll(); } catch (e) {}
    try { if (global.TgStream) global.TgStream.stop(); } catch (e) {}
    host.innerHTML = '';

    // Server gateway (prototip): faqat `TG_GATEWAY_MODE=primary` bo'lsa.
    // Xato bo'lsa — pastdagi odatdagi brauzer-MTProto yo'liga qaytamiz.
    // `S.gwTriedFor` qayta urinish loop'ining oldini oladi.
    var gwKey = (pb.channel || '') + '/' + (Number(pb.post) || 0);
    if (global.WCGateway && typeof global.WCGateway.mount === 'function'
        && global.WCGateway.primary() && S.gwTriedFor !== gwKey) {
      S.gwTriedFor = gwKey;
      var gwStarted = global.WCGateway.mount(
        host, pb, generation,
        function () {
          if (generation === S.streamGeneration) {
            mountTelegramFallback(host, pb, generation);
          }
        },
        function (tv) {
          if (generation !== S.streamGeneration) return;
          wireVideo(tv);
          prefetchAdjacent();
          if (typeof pb.onVideo === 'function') { try { pb.onVideo(tv); } catch (ex) {} }
        }
      );
      if (gwStarted) return;
    }

    if (!global.TgStream || typeof global.TgStream.mount !== 'function') {
      host.innerHTML = '<div class="player-wrap no-video"><div class="nv-msg">Telegram moduli yuklanmadi. Sahifani yangilang.</div></div>';
      return;
    }
    var m = document.createElement('div');
    m.className = 'watch-tg';
    host.appendChild(m);
    var e2 = curEp();
    var key = (pb.channel || '') + '/' + (Number(pb.post) || 0);

    // 3 BOSQICHLI TEZ KADR: 1 s instant (~150 KB) -> 19 MB intro -> asl video.
    // Sekin internetda 19 MB ham 2 s ichida yetib bormaydi, shuning uchun
    // avval eng kichigi ko'rsatiladi. HAMMASI brauzer <- Telegram CDN'idan
    // keladi — sayt origin'i video baytlarini KO'RMAYDI.
    // `S.instantDoneFor` / `S.introDoneFor` loop'ning oldini oladi: handoff
    // qayta mount qilganda o'tgan bosqich o'tkazib yuboriladi.
    var instant = null;
    var intro = null;
    try {
      var allPv = global.__WCPREVIEW || {};
      var pv = allPv[key];
      if (pv) {
        var ip = pv.instant;
        if (ip && ip.ch && Number(ip.p) && S.instantDoneFor !== key) {
          instant = { ch: ip.ch, p: Number(ip.p), dur: Number(ip.dur) || 1 };
        }
        if (pv.ch && Number(pv.p) && S.introDoneFor !== key) {
          intro = { ch: pv.ch, p: Number(pv.p), dur: Number(pv.dur) || 20 };
        }
      }
    } catch (e) {}

    global.TgStream.mount(m, {
      channel: pb.channel || '',
      post: Number(pb.post) || 0,
      url: pb.url || '',
      deep: pb.deep || '',
      poster: pb.poster || '',
      cfg: global.UzPlayer ? undefined : udpConfig(),
      epLabel: e2 ? (e2.season + '-fasl ' + e2.number + '-qism') : '',
      instant: instant,
      onInstantEnd: function () {
        S.instantDoneFor = key;
        // Qayta mount: endi intro (yoki intro yo'q bo'lsa to'g'ridan-to'g'ri
        // asl video) tanlanadi — instant ikkinchi marta ko'rsatilmaydi.
        if (generation === S.streamGeneration) {
          mountTelegramFallback(host, pb, generation);
        }
      },
      intro: intro,
      onIntroEnd: function () {
        S.introDoneFor = key;
        if (generation === S.streamGeneration) {
          mountTelegramFallback(host, pb, generation);   // endi ASL video
        }
      },
      onReady: function () {
        var tv = m.querySelector('video');
        if (tv && global.UzPlayer && typeof global.UzPlayer.attach === 'function') {
          try { global.UzPlayer.attach(tv, { poster: pb.poster || '' }); } catch (ex) {}
        }
        wireVideo(tv);
        prefetchAdjacent();
        // Birinchi kadr chiqishi bilan keyingi qismning BOSHINI tayyorlaymiz.
        // 3 soniya kutmaymiz — bu anime qismlarida "keyingi" bosilganda
        // video yangi Telegram so'rovini kutmaydi.
        onVideoReady(function () { warmNextEpisode(); });
        if (typeof pb.onVideo === 'function') { try { pb.onVideo(tv); } catch (ex) {} }
      }
    });
  }

  function mountMediaFlow(host, pb, url, generation) {
    if (generation !== S.streamGeneration) return;
    try {
      if (global.UzPlayer && typeof global.UzPlayer.mount === 'function') {
        global.UzPlayer.mount(host, { type: 'direct', src: url, poster: pb.poster || '' });
      } else {
        var poster = pb.poster ? ' poster="' + esc(pb.poster) + '"' : '';
        host.innerHTML = '<div class="player-wrap has-video-container">'
          + '<div class="udp-player" data-udp data-udp-config="' + udpAttr(udpConfig()) + '">'
          + '<video playsinline preload="auto"' + poster + '></video></div></div>';
        var rawVideo = host.querySelector('video');
        if (rawVideo) rawVideo.src = url;
        if (global.UDP) global.UDP.initAll();
      }
    } catch (e) {
      mountTelegramFallback(host, pb, generation);
      return;
    }

    var video = host.querySelector('video');
    if (!video) {
      mountTelegramFallback(host, pb, generation);
      return;
    }
    video.preload = 'auto';
    var mediaReady = false;
    var fallbackUsed = false;
    video.addEventListener('loadeddata', function () { mediaReady = true; }, { once: true });
    video.addEventListener('playing', function () { mediaReady = true; }, { once: true });
    video.addEventListener('error', function () {
      if (mediaReady || fallbackUsed || generation !== S.streamGeneration) return;
      fallbackUsed = true;
      mountTelegramFallback(host, pb, generation);
    }, { once: true });
    wireVideo(video);
  }

  // ===================================================== HLS va TELEGRAM PARALLEL
  //
  // MUAMMO: server `type: 'hls'` desa, pleyer HLS tayyor bo'lguncha KUTARDI
  // (film birinchi marta ochilsa - yuklab, bo'laklab bo'lguncha), Telegram esa
  // umuman ishga tushmasdi: ya'ni texnologiyalar KETMA-KET edi.
  //
  // YECHIM (poyga): HLS tayyormi - 1 ta tezkor so'rov bilan tekshiramiz (bu so'rov
  // tayyorlashni ham BOSHLAB beradi).
  //   * tayyor  -> darhol HLS (eng tez, diskdan);
  //   * tayyor emas -> Telegram'ni DARHOL boshlaymiz, HLS fonda tayyorlanadi va
  //     Telegram birinchi kadrni ko'rsatishga ulgurmasa, HLS tayyor bo'lishi bilan
  //     unga o'tamiz. Telegram o'ynab ketgan bo'lsa, uni bezovta qilmaymiz.
  // Telegram'ga kirmagan foydalanuvchida Telegram boshlanmaydi (login oynasi
  // chiqmasin) - eski tartib: HLS tayyor bo'lishini kutadi.
  function hlsMediaFor(pb) {
    var sep = String(pb.url || '').indexOf('?') !== -1 ? '&' : '?';
    return { type: 'hls', src: pb.url || '', poster: pb.poster || '', refresh: pb.url + sep + 'json=1' };
  }

  function tgSourceFor(pb) {
    var e = curEp();
    var channel = pb.channel || (e && e.tg_channel) || D.tg_channel || '';
    var post = Number(pb.post || (e && e.tg_post) || D.tg_post) || 0;
    if (!channel || !post) return null;
    return {
      channel: channel,
      post: post,
      url: 'https://t.me/' + channel + '/' + post,
      deep: pb.deep || '',
      poster: pb.poster || ''
    };
  }

  function tgLoggedIn() {
    try {
      return !!(global.TgStream && typeof global.TgStream.me === 'function' && global.TgStream.me());
    } catch (e) { return false; }
  }

  /** .env: HLS_MODE = prefer | fallback | off (watch.php uzatadi). */
  function hlsMode() {
    var m = String(global.__WC_HLS_MODE || 'fallback').toLowerCase();
    return (m === 'prefer' || m === 'off') ? m : 'fallback';
  }

  /** Fallback rejimida Telegram shuncha ms ichida o'ynamasa — HLS tekshiriladi. */
  function hlsWaitMs() {
    var v = Number(global.__WC_HLS_FALLBACK_MS);
    return v >= 2000 ? v : 8000;
  }

  /** true qaytarsa - poyga shu yerda boshqaruvni oldi; false - eski oddiy yo'l. */
  function raceHlsTelegram(host, pb, generation) {
    var mode = hlsMode();
    var tg   = tgSourceFor(pb);
    var tgOk = !!(tg && tgLoggedIn() && typeof global.TgStream.mount === 'function');
    if (!tgOk) return false;   // Telegram yo'q — HLS oddiy yo'l bilan ochiladi

    var media = hlsMediaFor(pb);
    var done = false;          // g'olib aniq (yoki Telegram o'ynab ketdi)
    var tgPlaying = false;
    var pollTimer = null;
    var waitTimer = null;
    var t0 = Date.now();

    function alive() { return generation === S.streamGeneration; }
    function stopPoll() {
      if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
      if (waitTimer) { clearTimeout(waitTimer); waitTimer = null; }
    }

    function probe() {
      var ctl = global.AbortController ? new AbortController() : null;
      var to = ctl ? setTimeout(function () { try { ctl.abort(); } catch (e) {} }, 4000) : null;
      return fetch(media.refresh, {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: ctl ? ctl.signal : undefined
      }).then(function (r) {
        if (to) clearTimeout(to);
        return !!r.ok;                       // 200 = playlist tayyor; 503/502 = hali yo'q
      }).catch(function () {
        if (to) clearTimeout(to);
        return false;
      });
    }

    function useHls() {
      if (done || !alive() || mode === 'off') return;
      done = true;
      stopPoll();
      try { if (global.UzPlayer && typeof global.UzPlayer.destroyAll === 'function') global.UzPlayer.destroyAll(); } catch (e) {}
      try { if (global.TgStream) global.TgStream.stop(); } catch (e) {}
      host.innerHTML = '';
      try { global.UzPlayer.mount(host, media); } catch (e) {}
      wireVideo(host.querySelector('video'));
    }

    function useTelegram() {
      if (!alive()) return;
      tg.onVideo = function (v) {
        if (!v) return;
        v.addEventListener('playing', function () {
          tgPlaying = true;
          done = true;                       // Telegram o'ynab ketdi - HLS'ga o'tmaymiz
          stopPoll();
        }, { once: true });
        // Telegram o'ynay olmasa (DC javob bermadi, limit) — HLS'ni darhol tekshiramiz.
        v.addEventListener('error', function () {
          if (!done && !tgPlaying && alive()) wait(0);
        }, { once: true });
      };
      mountTelegramFallback(host, tg, generation);
    }

    // HLS tayyor bo'lguncha kutish. Prefer rejimida tez (1.5 s), fallbackda
    // sekin-orqaga (5 s -> 30 s) — Telegram yaxshi ishlayotganda bekorga
    // so'rov yubormaymiz (minglab tomoshabin uchun bu muhim).
    function poll(delay) {
      if (done || tgPlaying || !alive() || (Date.now() - t0) > 180000) return;
      if (pollTimer) clearTimeout(pollTimer);
      pollTimer = setTimeout(function () {
        probe().then(function (r) {
          if (done || tgPlaying || !alive()) return;
          if (r) { useHls(); return; }
          poll(mode === 'prefer' ? 1500 : Math.min(30000, delay * 2));
        });
      }, delay);
    }

    // `delay` ms dan keyin HLS'ni bir marta tekshirish (0 = darhol).
    function wait(delay) {
      if (done || tgPlaying || !alive() || mode === 'off') return;
      if (waitTimer) { clearTimeout(waitTimer); waitTimer = null; }
      waitTimer = setTimeout(function () {
        waitTimer = null;
        if (done || tgPlaying || !alive()) return;
        probe().then(function (r) {
          if (done || tgPlaying || !alive()) return;
          if (r) useHls();
          else poll(mode === 'prefer' ? 1500 : 5000);
        });
      }, Math.max(0, delay));
    }

    host.innerHTML = '<div class="player-wrap no-video"><div class="nv-msg">Video ulanmoqda\u2026</div></div>';

    // HLS o'chirilgan: faqat Telegram. U ham bo'lmasa chaqiruvchi HLS'ni ochadi.
    if (mode === 'off') {
      useTelegram();
      return true;
    }

    // prefer: HLS tayyor bo'lsa darhol u (eski xatti-harakat).
    if (mode === 'prefer') {
      probe().then(function (ready) {
        if (!alive()) return;
        if (ready) { useHls(); return; }
        useTelegram();                       // HLS tayyor emas - Telegram DARHOL
        poll(1500);
      });
      return true;
    }

    // fallback (standart): Telegram DARHOL boshlanadi, HLS — zaxira.
    useTelegram();
    wait(hlsWaitMs());
    return true;
  }

  function mountPlayer() {
    var host = el('watchPlayer');
    if (!host) return;
    S.streamGeneration += 1;
    var generation = S.streamGeneration;
    // Yangi video: `playing`/`canplay` kelguncha boshqa so'rovlar kutadi.
    armVideoReady();

    try { if (global.UzPlayer && typeof global.UzPlayer.destroyAll === 'function') global.UzPlayer.destroyAll(); } catch (e) {}
    try { if (global.UDP) global.UDP.destroyAll(); } catch (e) {}
    try { if (global.TgStream) global.TgStream.stop(); } catch (e) {}
    host.innerHTML = '';
    // Poster + spinner birinchi kadrgacha qoladi (qism almashtirishda
    // `switchEpisode` allaqachon chizgan; birinchi ochilishda shu yerda).
    showPlayerLoading('');

    // Pleyer tanlovi paneli (faqat Telegram embed mumkin bo'lsa ko'rinadi).
    // Boshqa qismga o'tildi — oldingi qismning "embed ishlamadi" holatini
    // tozalaymiz (u faqat o'sha postga tegishli edi).
    if (S.embedFailed && S.embedFailedKey !== embedKey()) S.embedFailed = false;
    renderPMode();

    var pb = S.playback || {};
    var type = pb.type || 'none';

    if (global.UzPlayer && typeof global.UzPlayer.configure === 'function') {
      try {
        var e = curEp();
        var i = epIndex(S.selectedId);
        var nx = i >= 0 ? S.episodes[i + 1] : null;
        global.UzPlayer.configure({
          contentId: D.id,
          episodeId: S.selectedId || 0,
          title: e && S.episodes.length > 1 ? (D.title + ' — ' + e.number + '-qism') : D.title,
          apiBase: base,
          loggedIn: !!(W.loggedIn),
          autoplay: true,
          resumeAt: S.hashStart ? 0 : (Math.floor(S.resumeAt) || 0),
          next: nx ? { id: nx.id, label: (nx.number || nx.id) + '-qism' } : null,
          onNext: nx ? function (nid) { switchEpisode(Number(nid)); } : null
        });
      } catch (ex) {}
    }

    // HLS + Telegram poygasi (parallel): qarang `raceHlsTelegram`.
    if (type === 'hls' && global.UzPlayer && typeof global.UzPlayer.mount === 'function'
        && raceHlsTelegram(host, pb, generation)) {
      return;
    }

    if (type === 'direct' || type === 'file' || type === 'hls') {
      if (global.UzPlayer && typeof global.UzPlayer.mount === 'function') {
        var media = {
          type: type === 'hls' ? 'hls' : 'direct',
          src: pb.url || '',
          poster: pb.poster || '',
          crossOrigin: pb.crossOrigin
        };
        if (type === 'hls') {
          var sep = String(pb.url || '').indexOf('?') !== -1 ? '&' : '?';
          media.refresh = pb.url + sep + 'json=1';
        }
        global.UzPlayer.mount(host, media);
        wireVideo(host.querySelector('video'));
        return;
      }
      var poster = pb.poster ? ' poster="' + esc(pb.poster) + '"' : '';
      var vattrs = '';
      if (type === 'hls') {
        var sep2 = String(pb.url || '').indexOf('?') !== -1 ? '&' : '?';
        vattrs = ' data-hls-pending="1" data-hls-refresh="'
          + esc(pb.url + sep2 + 'json=1') + '"';
      } else if (pb.url) {
        vattrs = ' src="' + esc(pb.url) + '"';
      }
      host.innerHTML =
        '<div class="player-wrap has-video-container">'
        + '<div class="udp-player" data-udp data-udp-config="' + udpAttr(udpConfig()) + '">'
        + '<video playsinline preload="metadata"' + poster + vattrs + '></video>'
        + '</div></div>';
      if (global.UDP) global.UDP.initAll();
      wireVideo(host.querySelector('video'));
      return;
    }

    if (type === 'embed') {
      host.innerHTML = '<div class="player-wrap"><iframe src="' + esc(pb.url) + '"'
        + ' allow="autoplay; fullscreen; encrypted-media; picture-in-picture"'
        + ' allowfullscreen referrerpolicy="origin" title="player"></iframe></div>';
      return;
    }

    if (type === 'telegram') {
      // 1) ENG TEZ YO'L: Telegram'ning rasmiy embed pleyeri.
      //
      // `t.me/<kanal>/<post>?embed=1` sahifasi video baytlarini Telegram'ning
      // o'z CDN'idan beradi — Telegram Web'dagi kabi. Bizning MTProto pleyer
      // esa O'CHIRILMAGAN: foydalanuvchi pastdagi tugma bilan almashadi.
      if (effectivePmode() === 'fast' && mountEmbed(host, pb, generation)) return;

      if (!APP.mediaflowEnabled) {
        mountTelegramFallback(host, pb, generation);
        return;
      }
      host.innerHTML = '<div class="player-wrap no-video"><div class="nv-msg">Video oqimi ulanmoqda…</div></div>';
      fetch(base + '/api/mediaflow-url.php', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify({ content_id: Number(D.id) || 0, episode_id: Number(S.selectedId) || 0 })
      }).then(function (response) {
        return response.json().catch(function () { throw new Error('Invalid response'); }).then(function (data) {
          if (!response.ok || !data || data.success === false || !data.url) {
            throw new Error('MediaFlow unavailable');
          }
          return data;
        });
      }).then(function (data) {
        if (generation !== S.streamGeneration) return;
        mountMediaFlow(host, pb, data.url, generation);
      }).catch(function () {
        if (generation === S.streamGeneration) mountTelegramFallback(host, pb, generation);
      });
      return;
    }

    // `none` - manba yo'q: poster + xabar (+ Telegram'da ochish tugmasi).
    var posterImg = pb.poster
      ? '<img class="nv-poster" src="' + esc(pb.poster) + '" alt="" onerror="this.style.display=\'none\'">'
      : '';
    var openBtn = pb.url
      ? '<a class="nv-btn" href="' + esc(pb.url) + '" target="_blank" rel="noopener">'
        + '\u{1F4F1} Ilovada ochish</a>'
      : '';
    host.innerHTML = '<div class="player-wrap no-video">' + posterImg
      + '<div class="nv-msg">' + esc(pb.warning || 'Video mavjud emas') + '</div>'
      + openBtn + '</div>';
  }

  // ------------------------------------------------- ko'rish / progress
  function anonId() {
    try {
      var v = localStorage.getItem('wc_anon_id');
      if (v && v.length >= 8) return v;
      v = (global.crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : ('anon-' + Date.now().toString(36) + '-'
           + Math.random().toString(36).slice(2, 10));
      localStorage.setItem('wc_anon_id', v);
      return v;
    } catch (e) { return ''; }
  }

  function tgUserId() {
    try {
      if (global.TgStream && typeof global.TgStream.me === 'function') {
        var m = global.TgStream.me();
        return m ? (m.id || '') : '';
      }
    } catch (e) {}
    return '';
  }

  /**
   * Ko'rish faqat VIDEO HAQIQATAN oqilganda sanaladi (30 sekund). Sabab:
   * `api/views.php` viewer_key bo'yicha bitta marta yozadi - agar biz
   * sahifa ochilishiday sanasak, `?e=2` dan `?e=3` ga o'tgan odamning
   * qismlari sanalmagan qolardi.
   */
  function wireVideo(v) {
    if (!v) return;
    var watched = 0, lastT = 0, nextWarmed = false;

    v.addEventListener('play', function () {
      if (v.currentTime) lastT = v.currentTime;
    }, true);

    v.addEventListener('timeupdate', function () {
      var t = v.currentTime || 0;
      var dt = t - lastT;
      lastT = t;
      // Seek (sakrash) hisobga olinmaydi - faqat haqiqiy ko'rish.
      if (dt > 0 && dt < 5) watched += dt;
      // Joriy qism 3 s binsa — keyingi qismning dastlabki 1 MB ini fon rejimida
      // tayyorlaymiz: "Keyingi qism" bosilganda video keshdan darhol ochiladi.
      if (watched >= 3 && !nextWarmed) {
        nextWarmed = true;
        warmNextEpisode();
      }
      if (watched >= 30) countView();
      saveProgressSoon(v);
    }, true);

    v.addEventListener('loadedmetadata', function () {
      // Reels CTA'sidan kelgan `#t=` ni bir marta qo'llaymiz. Seek bitta
      // marta bajariladi - aks holda `timeupdate` har safar boshqa
      // nuqtaga qaytarib, foydalanuvchining harakati bekor bo'lardi.
      if (S.hashStart && v.currentTime < S.hashStart - 1) {
        try { v.currentTime = S.hashStart; } catch (e) {}
        lastT = S.hashStart;
      }
      saveDuration(v);
    });
    v.addEventListener('pause', function () { saveProgress(v); });
    v.addEventListener('ended', function () { saveProgress(v); });
    // Anonim CDN manzili ishlamasa (eskirgan/bloklangan) — o'z pleyerimizga
    // qaytamiz. Foydalanuvchi video DOIM ochiladi, kesh xatosi tufayli emas.
    v.addEventListener('error', function () {
      if (!S.playback || !S.playback.cdnSource || global.__WC_CDN_FAILED) return;
      global.__WC_CDN_FAILED = true;
      var orig = S.playback.original;
      if (orig) {
        S.playback = orig;
        mountPlayer();
      }
    }, true);
  }

  function countView() {
    if (S.viewed || !D.id) return;
    S.viewed = true;
    // MTProto (PHP sessiyasi yo'q) uchun ko'rish tarixini mahalliy saqlaymiz:
    // profilning "Tarix" yorlig'i aynan shu localStorage'dan o'qiydi.
    // "Tomosha qilingan" chipi ham shu ro'yxatdan foydalanadi, shuning uchun
    // PHP sessiyali foydalanuvchida ham mahalliy nusxa yuritiladi.
    mirrorLib('history', true);
    var body = new URLSearchParams();
    body.set('id', D.id);
    var tg = tgUserId();
    if (tg) body.set('tg_id', tg); else body.set('anon', anonId());
    fetch(base + '/api/views.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      credentials: 'same-origin',
      body: body.toString()
    }).catch(function () {});
  }

  var progTimer = null;
  function saveProgressSoon(v) {
    if (progTimer) return;
    progTimer = setTimeout(function () { progTimer = null; saveProgress(v); }, 10000);
  }
  function saveProgress(v) {
    if (!isLoggedIn() || !v) return;
    if (!v.duration || !isFinite(v.duration)) return;
    fetch(withMeQS(base + '/api/progress.php'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      credentials: 'same-origin',
      body: new URLSearchParams({
        content_id: D.id,
        episode_id: S.selectedId || 0,
        position: Math.floor(v.currentTime || 0),
        duration: Math.floor(v.duration)
      }).toString()
    }).catch(function () {});
  }

  /** Serverda ffmpeg yo'q - haqiqiy davomiylik faqat brauzerdan olinadi. */
  function saveDuration(v) {
    if (!v || !v.duration || !isFinite(v.duration)) return;
    var key = D.id + ':' + (S.selectedId || 0);
    if (!key || S.durSaved[key]) return;
    S.durSaved[key] = true;
    fetch(base + '/api/duration.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      credentials: 'same-origin',
      body: new URLSearchParams({
        content_id: D.id,
        episode_id: S.selectedId || 0,
        duration: Math.round(v.duration)
      }).toString()
    }).catch(function () {});
  }

  // ============================================================ SARLAVHA
  //
  // YouTube YERLASUVI (sarlavha ostidagi bo'sh joy ham):
  //
  //   <h1> Sinov anime 1 — 2-qism
  //   +--------------------------------------------------------+
  //   | [av] W CINEMA          ★ 8.0   2024                 |
  //   |      8 ta foydalanuvchi [👍 3,9 ming][👎] [📚] [🔗] [📋]|
  //   +--------------------------------------------------------+
  //   📅 1,2 ming ko'rildi · 3 kun oldin
  //
  // O'ZGARISH: avval hammasi bitta "chiplar" qatorida edi
  // (📅 ko'rildi · 🎩 1-fasl · 1-qism · ★ reyting · yil · sifat).
  // Endi:
  //   · 🎩 "1-fasl · 1-qism" YO'QOLDI (kinomanba saytdan olib tashlandi);
  //   · ★ reyting va yil kanal qatoriga ko'chdi ("Obuna" tugmasi o'rniga);
  //   · ko'rish + vaqt ikkinchi qatorda qoldi — YouTube'dagi kabi.
  // ======================================================= YOUTUBE QATLAMI
  // Tavsif matnini (ta'rif kartasi ichida) ko'rsatish. Avval foydalanuvchi
  // so'rovi bilan o'chirilgan edi - shu sabab false.
  var SHOW_DESC = false;

  /* Ta'rif kartasi bosilganda kengayadi (YouTube'dagi "...yana"). */
  function initDescToggle(d) {
    if (!d || d._ytBound) return;
    d._ytBound = true;
    function toggle(ev) {
      if (ev && ev.target && ev.target.closest && ev.target.closest('a')) return;
      if (!d.classList.contains('has-more')) return;
      var open = d.classList.toggle('open');
      d.setAttribute('aria-expanded', open ? 'true' : 'false');
      var b = el('watchDescBody');
      if (b) b.hidden = !open;
    }
    d.addEventListener('click', toggle);
    d.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(ev); }
    });
  }

  /* "Obuna bo'lish" tugmasi. Kanal bitta (SITE_NAME), shuning uchun holat
     brauzerda (localStorage) saqlanadi; bosilganda tugma "Obunada" bo'ladi. */
  var SUB_KEY = 'wc_channel_sub_v1';
  function isSubscribed() {
    try { return localStorage.getItem(SUB_KEY) === '1'; } catch (e) { return false; }
  }
  function paintSubscribe(b) {
    var on = isSubscribed();
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.innerHTML = on
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg><span>Obunada</span>'
      : '<span>Obuna bo‘lish</span>';
  }
  function initSubscribe() {
    var b = el('watchSubBtn');
    if (!b) return;
    paintSubscribe(b);
    if (b._ytBound) return;
    b._ytBound = true;
    b.addEventListener('click', function () {
      var on = !isSubscribed();
      try { localStorage.setItem(SUB_KEY, on ? '1' : '0'); } catch (e) {}
      paintSubscribe(b);
      toast(on ? 'Kanalga obuna bo‘ldingiz' : 'Obuna bekor qilindi');
    });
  }

  /* Tavsiyalar chiplari: Hammasi / Yangi / Tomosha qilingan.
     Filtr faqat ko'rinishni o'zgartiradi (kartalar DOM'da qoladi), shuning
     uchun lazy load bilan kelgan yangi kartalarga ham qayta qo'llanadi. */
  var recFilter = 'all';
  function recSeen(id) {
    try { return !!(global.WCLib && global.WCLib.has('history', Number(id))); } catch (e) { return false; }
  }
  function applyRecFilter() {
    var list = el('watchSideRecList');
    if (!list) return;
    var rows = list.querySelectorAll('.watch-rec');
    var shown = 0;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], ok = true;
      if (recFilter === 'new')  ok = r.getAttribute('data-new') === '1';
      if (recFilter === 'seen') ok = recSeen(r.getAttribute('data-id'));
      r.hidden = !ok;
      if (ok) shown++;
    }
    var emp = list.querySelector('.watch-side-empty.f');
    if (!shown && rows.length) {
      if (!emp) {
        emp = document.createElement('div');
        emp.className = 'watch-side-empty f';
        list.appendChild(emp);
      }
      emp.textContent = recFilter === 'seen'
        ? 'Hali hech narsa tomosha qilinmagan'
        : 'Hozircha yangi kontent yo‘q';
    } else if (emp) { emp.remove(); }
  }
  function initRecChips() {
    var box = el('watchChips');
    if (!box || box._ytBound) return;
    box._ytBound = true;
    box.addEventListener('click', function (ev) {
      var b = ev.target.closest && ev.target.closest('.watch-chip-f');
      if (!b) return;
      recFilter = b.getAttribute('data-f') || 'all';
      var all = box.querySelectorAll('.watch-chip-f');
      for (var i = 0; i < all.length; i++) {
        var on = all[i] === b;
        all[i].classList.toggle('on', on);
        all[i].setAttribute('aria-selected', on ? 'true' : 'false');
      }
      applyRecFilter();
      // Filtrdan keyin ro'yxat qisqa qolsa, keyingi sahifani yuklaymiz.
      if (S.relMore && recMoreNear()) loadMoreRelated();
    });
  }

  /* Izohlarni saralash (YouTube "Saralash"): yangi / eng yaxshi / eski.
     tg-comments.js ro'yxatni o'zi qayta chizadi, shuning uchun
     MutationObserver bilan tartib qayta qo'llanadi. */
  var cSort = 'new';
  function cLikeNum(node) {
    var n = node.querySelector('.reels-c-like-n');
    if (!n) return 0;
    var s = String(n.textContent || '').trim().toUpperCase().replace(',', '.');
    var v = parseFloat(s) || 0;
    if (/K$/.test(s)) v *= 1e3;
    if (/M$/.test(s)) v *= 1e6;
    return v;
  }
  function applyCommentSort() {
    var list = el('commentsList');
    if (!list) return;
    var kids = [].slice.call(list.children).filter(function (k) {
      return k.classList && k.classList.contains('reels-c-thread');
    });
    if (kids.length < 2) return;
    if (!kids[0]._ytIdx) kids.forEach(function (k, i) { if (!k._ytIdx) k._ytIdx = i + 1; });
    var sorted = kids.slice();
    if (cSort === 'top') {
      sorted.sort(function (a, b) { return (cLikeNum(b) - cLikeNum(a)) || (a._ytIdx - b._ytIdx); });
    } else if (cSort === 'old') {
      sorted.sort(function (a, b) { return b._ytIdx - a._ytIdx; });
    } else {
      sorted.sort(function (a, b) { return a._ytIdx - b._ytIdx; });
    }
    var same = sorted.every(function (k, i) { return k === kids[i]; });
    if (same) return;
    var anchor = kids[kids.length - 1].nextSibling;
    sorted.forEach(function (k) { list.insertBefore(k, anchor); });
  }
  function initCommentSort() {
    var btn = el('watchSortBtn'), menu = el('watchSortMenu');
    var list = el('commentsList');
    if (!btn || !menu || btn._ytBound) return;
    btn._ytBound = true;
    function close() { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); }
    btn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      menu.hidden = !menu.hidden;
      btn.setAttribute('aria-expanded', menu.hidden ? 'false' : 'true');
    });
    menu.addEventListener('click', function (ev) {
      var it = ev.target.closest && ev.target.closest('.watch-sort-item');
      if (!it) return;
      cSort = it.getAttribute('data-sort') || 'new';
      [].forEach.call(menu.querySelectorAll('.watch-sort-item'), function (x) {
        x.classList.toggle('on', x === it);
      });
      close();
      applyCommentSort();
    });
    document.addEventListener('click', function (ev) {
      if (!menu.hidden && !(ev.target.closest && ev.target.closest('#watchSort'))) close();
    });
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') close(); });
    if (list && typeof global.MutationObserver === 'function') {
      var busy = false;
      new global.MutationObserver(function () {
        if (busy) return;
        busy = true;
        // Yangi kelgan (indekssiz) ustunlarni oldin belgilab olamiz.
        var kids = [].slice.call(list.children).filter(function (k) {
          return k.classList && k.classList.contains('reels-c-thread');
        });
        kids.forEach(function (k, i) { if (!k._ytIdx) k._ytIdx = i + 1; });
        if (cSort !== 'new') applyCommentSort();
        busy = false;
      }).observe(list, { childList: true });
    }
  }

  /* Izoh yozish joyi yonidagi avatar: foydalanuvchining PROFIL RASMI
     (izohlardagi bilan bir xil manba: saytga yuklangan rasm -> Telegram rasmi).
     Rasm bo'lmasa bosh harf, ism ham yo'q bo'lsa odam belgisi. */
  function initComposerAvatar() {
    var a = el('watchCav');
    if (!a) return;
    var TG = global.TGComments;
    var meId = '', meName = '';
    function ident() {
      try {
        var raw = tgMeRaw();
        if (raw) {
          var m = JSON.parse(raw);
          meId = String(m.id || '');
          meName = String(m.firstName || m.username || '').trim();
        }
      } catch (e) {}
      if (!meName && W.user && (W.user.name || W.user.username)) {
        meName = String(W.user.name || W.user.username);
      }
    }
    function letter() {
      a.textContent = meName ? meName.charAt(0).toUpperCase() : '';
      a.classList.toggle('anon', !meName);
    }
    function showPhoto(url) {
      a.classList.remove('anon');
      a.textContent = '';
      var im = document.createElement('img');
      im.alt = '';
      im.referrerPolicy = 'no-referrer';
      im.onerror = function () { letter(); };
      im.src = url;
      a.appendChild(im);
    }
    function paint() {
      ident();
      var photo = '';
      try { photo = (TG && TG.currentUserPhoto && TG.currentUserPhoto()) || ''; } catch (e) {}
      if (photo) { showPhoto(photo); return; }
      letter();
    }
    paint();
    // Saytga yuklangan rasm serverdan keyin keladi (izohlardagi kabi).
    if (TG && TG.loadNames && meId) {
      try {
        TG.loadNames([meId]).then(function () {
          if (a.querySelector('img')) return;
          var h = TG.avatarHtml(meId, meName) || '';
          var mm = /src="([^"]+)"/.exec(h);
          if (mm) {
            var d = document.createElement('textarea');
            d.innerHTML = mm[1];            // &amp; kabilarni qaytaramiz
            showPhoto(d.value);
          }
        });
      } catch (e) {}
    }
    // Boshqa oynada/sahifada rasm o'zgarsa yoki login bo'lsa yangilanadi.
    global.addEventListener('storage', paint);
    global.addEventListener('focus', paint);
  }

  function renderHead() {
    var t = el('watchTitle');
    var e = curEp();
    if (t) {
      t.textContent = e && S.episodes.length > 1
        ? D.title + ' — ' + e.number + '-qism'
        : D.title;
    }

    // --- Kanal qatori: saytdagi foydalanuvchilar soni ------------------
    // YouTube'da kanal = videoni nashr etuvchi va unda "N obunachi" turadi.
    // Bu saytda kanal SITE_NAME ("W CINEMA"), obunachi esa yo'q - shuning
    // uchun foyalanuvchi so'rovi bilan "obunachi" o'rniga SAYTDA
    // RO'YXATDAN O'TGANLAR soni ko'rsatiladi (`users` jadvalidagi
    // qatorlar, serverda `Catalog::getSubscriberCount()` bilan
    // hisoblanadi - frontend qo'shimcha so'rov yubormaydi).
    var subs = el('watchSubs');
    if (subs) {
      var sn = Number(W.subscribers) || 0;
      subs.textContent = sn > 0
        ? fmtViews(sn) + ' ta foydalanuvchi'
        : 'Hali kim ro‘yxatdan o‘tmagan';
    }

    // --- Ikkinchi qator: ko'rish + vaqt --------------------------------
    var sub = el('watchSub');
    if (sub) {
      var views = Number(D.views) || 0;
      var parts = [];
      parts.push('<span class="watch-stat"><b>'
        + (views > 0 ? fmtViews(views) + ' ko‘rildi' : 'Yangi') + '</b></span>');
      var ago = fmtAgo(D.added_at || D.created_at);
      if (ago) parts.push('<span class="watch-stat"><b>' + esc(ago) + '</b></span>');
      // Kino / anime / multfilmning content ID si qidiruv natijalari bilan
      // bir xil ko'rinib turadi (watch.php?c=<ID> havolasidagi raqam).
      var contentId = parseInt(D.id, 10) || 0;
      if (contentId) parts.push('<span class="watch-stat watch-stat-id">ID: '
        + contentId + '</span>');
      sub.innerHTML = parts.join('');
    }

    // --- Kinomanba ma'lumoti (kanal qatorida, "Obuna" o'rniga) ---------
    // YouTube'da shu yerda "Obuna" tugmasi turadi. Bizda kanal
    // tugmasi kerak emas, shuning uchun filmning o'z ma'lumoti:
    // reyting, yil va sifat.
    var bg = el('watchBadges');
    if (bg) {
      var b = [];
      if (D.rating) b.push('<span class="watch-badge-rating">★ '
        + Number(D.rating).toFixed(1) + '</span>');
      if (D.year)   b.push('<span class="watch-badge-year">' + esc(D.year) + '</span>');
      if (D.quality) b.push('<span class="watch-badge-q">'
        + esc(D.quality) + '</span>');
      bg.innerHTML = b.join('');
      bg.hidden = b.length === 0;
    }

    renderActions();

    // Tavsif
    // VAQTINCHA O'CHIRILGAN (foydalanuvchi so'rovi): tavsif matni va janr
    // havolalari ("Bu sinov anime", Komediya, Fantaziya) ko'rsatilmaydi.
    // Ma'lumot DB/API da saqlanib turadi — qaytarish uchun shu 3 qatorni
    // olib tashlash kifoya.
    var d = el('watchDesc');
    if (!d) return;
    // YouTube "ta'rif kartasi": doim ko'rinadi (ko'rishlar + vaqt + reyting/yil).
    // Tavsif matni/janrlar esa SHOW_DESC bayrog'i bilan boshqariladi.
    d.hidden = false;
    var descTxt = SHOW_DESC ? String(D.description || '').trim() : '';
    var descGen = SHOW_DESC ? (S.genres || []) : [];
    var dBody = el('watchDescBody');
    if (dBody) {
      var h = '';
      if (descTxt) h += '<p class="watch-desc-txt">' + esc(descTxt).replace(/\n/g, '<br>') + '</p>';
      if (descGen.length) {
        h += '<div class="watch-desc-genres">' + descGen.map(function (x) {
          return '<a href="index.php?g=' + encodeURIComponent(x.slug || '') + '">'
            + esc(x.name) + '</a>';
        }).join('') + '</div>';
      }
      dBody.innerHTML = h;
      d.classList.toggle('has-more', !!h);
      dBody.hidden = !h || !d.classList.contains('open');
    }
    initDescToggle(d);
    initSubscribe();
    return;
    var desc = String(D.description || '').trim();
    var genres = S.genres || [];
    if (!desc && !genres.length) { d.hidden = true; return; }
    d.hidden = false;
    var long = desc.length > 260;
    var txt = el('watchDescTxt');
    if (!txt) {
      d.innerHTML = '<p class="watch-desc-txt" id="watchDescTxt"></p>'
        + (genres.length ? '<div class="watch-desc-genres" id="watchDescGenres"></div>' : '')
        + (long ? '<button type="button" class="watch-desc-more" id="watchDescMore">Ko‘rsatish</button>' : '');
    }
    txt = el('watchDescTxt');
    txt.textContent = long ? desc.slice(0, 260) + '…' : desc;
    if (long) {
      var more = el('watchDescMore');
      more.onclick = function () {
        var open = txt.textContent.slice(-1) !== '…' && txt.textContent.length > 260;
        txt.textContent = open ? desc.slice(0, 260) + '…' : desc;
        more.textContent = open ? 'Ko‘rsatish' : 'Yashirish';
      };
    }
    var g = el('watchDescGenres');
    if (g) {
      g.innerHTML = genres.map(function (x) {
        return '<a href="index.php?g=' + encodeURIComponent(x.slug || '') + '">'
          + esc(x.name) + '</a>';
      }).join('');
    }
  }

  // ============================================== HARAKAT TUGMASI (YouTube)
  //
  // YouTube action-bar tartibi:
  //   [👍 3,9 ming | 👎]  [Share]  [Download]  [Save]  [⋯]
  //
  // Bizda:
  //   [👍 son | 👎 son]  [📚 Kutubxona ▾]  [🔗 Ulashish]  [📋 Qismlar]
  //
  //   · 👍 va 👎 chap navigatsiya tugmasi (`.ig-item`) uslubida;
  //   · ikkalasida ham HISOBLAGICH bor va u 1 DAN BOSHLANADI
  //     (birinchi odam bosganda "1", keyingisi "2", ...);
  //   · 📚 bosilganda menyu ochiladi: Keyinroq ko'rish / Saqlash;
  //   · 🔗 bosilganda Instagram uslubidagi ulashish oynasi ochiladi.

  /* Sonni silliq "o'sib kelayotgan" ko'rinishida yangilash.
     NIMA UCHUN: oddiy `textContent` almashtirish sonning o'zgarganini
     ko'zga urmaydi; foyalanuvchi esa "1 dan boshlab hisoblanib kelsin"
     deb so'ragan - ya'ni raqamning o'sishi KO'RINISHI kerak.

     VAQTINCHA setTimeout ishlatiladi (rAF EMAS): yashirin tabda rAF
     callback'i hech qachon kelmaydi va son o'rtoq qiymatda qolib
     ketardi. setTimeout esa sekinlashtirilganda ham YAKUNIY qiymatga
     yetib boradi. */
  function animCount(node, from, to, fmt) {
    if (!node) return;
    from = Number(from) || 0;
    to   = Number(to) || 0;
    if (from === to) { node.textContent = fmt(to); return; }
    if (node._t) clearTimeout(node._t);
    var t0 = Date.now(), dur = 340;
    function step() {
      var p = Math.min(1, (Date.now() - t0) / dur);
      var e = 1 - Math.pow(1 - p, 3);              // easeOutCubic
      node.textContent = fmt(Math.round(from + (to - from) * e));
      if (p < 1) node._t = setTimeout(step, 32);
      else { node._t = 0; node.textContent = fmt(to); }
    }
    node._t = setTimeout(step, 32);
  }

  /* Ovoz berish tugmasidagi matn: son > 0 bo'lsa RAQAM, aks holda
     so'z ("Yoqdi" / "Yoqmadi"). 0 ni "0" deb ko'rsatmaymiz - son
     birinchi bosishda 1 dan boshlanadi. */
  function voteTxt(n, zeroWord) {
    return (Number(n) || 0) > 0 ? fmtViews(n) : zeroWord;
  }

  /* API so'roviga joriy Telegram foydalanuvchisini qo'shish.
     `api/chat.php` foydalanuvchini `reelUserId()` bilan aniqlaydi - u
     avval PHP sessiyasini, bo'lmasa `tg_me` ni tekshiradi. Saytning
     qolgan qismi (reels / notifications / profile) ham shu kalitni
     `localStorage['wc_tg_me_v1']` dan o'zi qo'shib yuboradi. */
  /* Joriy Telegram akkaunt (MTProto) JSON satri. Avval localStorage keshi
     (`wc_tg_me_v1`), bo'lmasa tirik `TgStream.me()` dan olinadi: ba'zi
     holatlarda kesh hali yozilmagan bo'ladi, lekin klient ulangan bo'ladi.
     `wc-lib.js` dagi `tgId()` bilan bir xil mantiq. */
  function tgMeRaw() {
    try { var v = localStorage.getItem('wc_tg_me_v1'); if (v) return v; } catch (e) {}
    try {
      if (global.TgStream && typeof global.TgStream.me === 'function') {
        var m = global.TgStream.me();
        if (m && m.id) {
          return JSON.stringify({
            id: String(m.id),
            firstName: m.firstName || '',
            lastName: m.lastName || '',
            username: m.username || ''
          });
        }
      }
    } catch (e) {}
    return '';
  }

  function withMeQS(path) {
    var m = tgMeRaw();
    if (!m) return path;
    return path + (path.indexOf('?') >= 0 ? '&' : '?') + 'tg_me=' + encodeURIComponent(m);
  }

  /* Foydalanuvchi kirganmi? PHP sessiyasi (`W.loggedIn`) YOKI brauzerdagi
     MTProto akkaunt (`wc_tg_me_v1` / `TgStream.me()`) yetarli. Sayt asosan
     MTProto orqali ishlaydi - u yerda serverda PHP sessiyasi bo'lmaydi va
     `W.loggedIn` false qoladi; shu sabab yoqdi/saqlash bosilganda noto'g'ri
     login oynasiga qaytarilardi. */
  function isLoggedIn() {
    if (W.loggedIn) return true;
    if (tgMeRaw()) return true;
    // Saytning o'z "kirilgan" belgisi (nav guard ham shuni tekshiradi):
    // kalit bo'lsa login oynasiga aylantirmaymiz; server tanimasa - amal
    // mahalliy bajariladi (`localVote` / `localSave`).
    try {
      var k = localStorage.getItem('wc_mtproto_auth_v1');
      return !!(k && k.length > 20);
    } catch (e) { return false; }
  }

  /* Mahalliy kutubxona yozuvi uchun element (`app.js` dagi `libItem` bilan
     bir xil maydonlar). */
  function libItem() {
    return {
      id: D.id,
      title: D.title,
      poster: D.poster,
      category: D.category,
      year: D.year
    };
  }

  /* Server amali bajarilgach mahalliy kutubxonani ham yangilaymiz: PHP
     sessiyasi bo'lmagan (MTProto) foydalanuvchining profili "Saqlanganlar /
     Yoqqanlar / Tarix"ni aynan shu localStorage'dan ko'rsatadi. Server
     javob bermay qolsa ham amal foydalanuvchiga ko'rinadi. */
  function mirrorLib(kind, on) {
    // PHP sessiyasi bor foydalanuvchining profili serverdan o'qiydi -
    // mahalliy nusxa kerak emas (va chalkashtirmaydi).
    // PHP sessiyasi bor foydalanuvchida ham mahalliy nusxa yuritiladi: TV'dagi
    // "Yoqqanlar / Saqlanganlar / Keyinroq ko'rish" qatorlari shundan o'qiydi.
    var lib = global.WCLib;
    if (!lib) return;
    try {
      if (on) lib.add(kind, libItem());
      else lib.remove(kind, D.id);
    } catch (e) {}
  }

  /* Saqlash menyusini yopish. Elementni doim ID orqali qidirish shart
     (`renderActions` har qism almashishda `innerHTML` ni qayta yozadi -
     eski closure'da eskirgan element qolardi). */
  function closeSaveMenu() {
    var m = el('actSaveMenu');
    if (m) m.hidden = true;
  }

  /* Menyuni tugmaning tagiga, lekin EKRAN CHEGARASIDA ushlab turish.
     `.watch-menu` `position: fixed` (telefonda `.watch-actions`
     ichidagi `overflow-x: auto` kesib yubormasin), shuning uchun
     koordinatani JS beradi. */
  function placeSaveMenu() {
    var m = el('actSaveMenu'), b = el('actWatchlist');
    if (!m || !b) return;
    var r = b.getBoundingClientRect();
    var vw = document.documentElement.clientWidth;
    var vh = global.innerHeight || 0;
    var mw = m.offsetWidth, mh = m.offsetHeight;
    var left = Math.min(Math.max(8, r.left), Math.max(8, vw - mw - 8));
    var top = r.bottom + 6;
    if (top + mh > vh - 8) top = Math.max(8, r.top - mh - 6);  // pastda joy yo'q -> yuqorida
    m.style.left = left + 'px';
    m.style.top = top + 'px';
  }
  /* Tashqarini bosganda yopish faqat BIR MARTA ulanadi. */
  renderActions.bindMenuClose = function () {
    if (renderActions._menuClosed) return;
    renderActions._menuClosed = true;
    document.addEventListener('click', closeSaveMenu);
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') closeSaveMenu();
    });
    // Menyu `fixed` joylashadi - oyna o'zgarsa yoki sahifa skroll
    // bo'lsa eski koordinatada qolib, tugmadan ajrab ketardi.
    global.addEventListener('resize', closeSaveMenu);
    global.addEventListener('scroll', closeSaveMenu, true);
  };

  /* Instagram uslubidagi chiziqli ikonkalar (emoji o'rniga) - tugmalar
     bir xil uslubda, monoxrom ko'rinishga ega bo'ladi. */
  function actSvg(inner) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
      + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
  }
  var ACT_ICON = {
    thumbUp:   actSvg('<path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>'),
    thumbDown: actSvg('<path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/>'),
    bookmark:  actSvg('<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>'),
    send:      actSvg('<path d="M22 2 11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/>'),
    list:      actSvg('<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>'),
    clock:     actSvg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>')
  };

  function renderActions() {
    var box = el('watchActions');
    if (!box) return;

    // PHP sessiyasi bo'lmasa (MTProto) "yoqdi/saqlash" holatini mahalliy
    // kutubxonadan olamiz: server `WATCH.content` ni sessiyasiz hisoblaydi
    // (has_liked=false), asl holat esa `index.php`/profil kabi localStorage'da.
    if (!W.loggedIn && global.WCLib) {
      D.has_liked    = global.WCLib.has('liked', D.id);
      D.in_watchlist = global.WCLib.has('saved', D.id);
    }

    var likes = Number(D.likes) || 0;
    var dislikes = Number(D.dislikes) || 0;

    // Yoqdi | Yoqmadi - chap navigatsiya uslubidagi ikkita tugma.
    //
    // DIQQAT - `.watch-act-vote-n` (SON) boshqa tugmalardan ataylab
    // ajratilgan: tor ekranda CSS matnlarni yashiradi, lekin son har
    // doim ko'rinib turadi (YouTube'da ham "3,9 ming" o'chirilmaydi).
    var vote = '<div class="watch-vote">'
      + '<button type="button" class="watch-act watch-act-vote' + (D.has_liked ? ' on' : '') + '"'
      +     ' id="actLike" title="Yoqdi" aria-label="Yoqdi" aria-pressed="' + (D.has_liked ? 'true' : 'false') + '">'
      +     ACT_ICON.thumbUp + ' <span class="watch-act-vote-n" id="actLikeN">' + esc(voteTxt(likes, 'Yoqdi')) + '</span></button>'
      + '<button type="button" class="watch-act watch-act-vote watch-act-vote-d' + (D.has_disliked ? ' on' : '') + '"'
      +     ' id="actDislike" title="Yoqmadi" aria-label="Yoqmadi" aria-pressed="' + (D.has_disliked ? 'true' : 'false') + '">'
      +     ACT_ICON.thumbDown + ' <span class="watch-act-vote-n" id="actDislikeN">' + esc(voteTxt(dislikes, 'Yoqmadi')) + '</span></button>'
      + '</div>';

    // 📚 - ustida MENYU turadi (`data-go` = chap navigatsiyadagi bo'limga).
    var save = '<span class="watch-act-wrap">'
      + '<button type="button" class="watch-act" id="actWatchlist" title="Kutubxonaga qo\'shish" aria-label="Kutubxona">'
      +   ACT_ICON.bookmark + ' <span class="watch-act-t">Kutubxona</span></button>'
      + '<div class="watch-menu" id="actSaveMenu" hidden>'
      +   '<button type="button" class="watch-menu-item" data-go="later">'
      +     '<span class="watch-menu-ico">' + ACT_ICON.clock + '</span>'
      +     '<span class="watch-menu-lab">Keyinroq ko‘rish</span></button>'
      +   '<button type="button" class="watch-menu-item" data-go="save">'
      +     '<span class="watch-menu-ico">' + ACT_ICON.bookmark + '</span>'
      +     '<span class="watch-menu-lab">Saqlash</span></button>'
      + '</div></span>';

    // Qolgan tugmalardagi matnlar `.watch-act-t` - 1180px dan kichikda
    // CSS ularni yashiradi va tugma faqat ikonkaga aylanadi.
    box.innerHTML = vote
      + save
      + '<button type="button" class="watch-act" id="actShare" title="Ulashish" aria-label="Ulashish">'
      +   ACT_ICON.send + ' <span class="watch-act-t">Ulashish</span></button>'
      + (S.sideEpisodes && S.episodes.length > 1
        ? '<button type="button" class="watch-act" id="actAllEps" title="Qismlar ro\'yxati" aria-label="Qismlar">'
          + ACT_ICON.list + ' <span class="watch-act-t">Qismlar</span></button>'
        : '');

    // --- Yoqish / Yoqmaslik ------------------------------------------
    // Ikkalasi bitta so'rov (POST /api/like.php?type=...). Server
    // `type` bo'yicha qaror qabul qiladi va javobda IKKALA holatni ham
    // qaytaradi - shuning uchun frontend qayta so'rov yubormaydi.
    function voteSync(r) {
      var oldL = D.likes, oldD = D.dislikes;
      D.has_liked    = !!r.liked;
      D.has_disliked = !!r.disliked;
      D.likes        = Number(r.likes) || 0;
      D.dislikes     = Number(r.dislikes) || 0;
      var lk = el('actLike'), dk = el('actDislike');
      if (lk) lk.classList.toggle('on', D.has_liked);
      if (dk) dk.classList.toggle('on', D.has_disliked);
      if (lk) lk.setAttribute('aria-pressed', D.has_liked ? 'true' : 'false');
      if (dk) dk.setAttribute('aria-pressed', D.has_disliked ? 'true' : 'false');
      // Sonlar ANIMATSIYA bilan 1 dan boshlab o'sib/tushib boradi.
      animCount(el('actLikeN'), oldL, D.likes, function (n) { return voteTxt(n, 'Yoqdi'); });
      animCount(el('actDislikeN'), oldD, D.dislikes, function (n) { return voteTxt(n, 'Yoqmadi'); });
      fireState();
    }

    /* Server 401 qaytarsa (foydalanuvchini tanimadi) login oynasiga emas,
       amalni mahalliy bajarib qo'yamiz - aks holda MTProto foydalanuvchisi
       login <-> watch orasida aylanib qolardi. */
    function localVote(type) {
      var lib = global.WCLib;
      if (!lib) { needLogin(); return; }
      if (type === 'like') {
        var on = lib.toggle('liked', libItem());
        D.has_liked    = on;
        D.has_disliked = false;
        D.likes = Math.max(0, (Number(D.likes) || 0) + (on ? 1 : -1));
      } else {
        D.has_disliked = !D.has_disliked;
        if (D.has_disliked && D.has_liked) { lib.remove('liked', D.id); D.has_liked = false; }
        D.dislikes = Math.max(0, (Number(D.dislikes) || 0) + (D.has_disliked ? 1 : -1));
      }
      voteSync({ liked: D.has_liked, disliked: D.has_disliked, likes: D.likes, dislikes: D.dislikes });
    }

    function bindVote(btnId, type) {
      var b = el(btnId);
      if (!b) return;
      b.onclick = function () {
        if (b.classList.contains('busy')) return;
        if (!isLoggedIn()) { needLogin(); return; }
        b.classList.add('busy');
        b.setAttribute('aria-busy', 'true');
        // ANIQ holat yuboramiz: server idempotent bo'ladi, ikki marta bosish
        // yoki qayta yuborish tasodifan bahoni bekor qilmaydi.
        var vote = (type === 'like')
          ? (D.has_liked ? 'none' : 'like')
          : (D.has_disliked ? 'none' : 'dislike');
        fetch(withMeQS(base + '/api/like.php'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          credentials: 'same-origin',
          body: 'id=' + encodeURIComponent(D.id)
                + '&type=' + encodeURIComponent(type)
                + '&vote=' + encodeURIComponent(vote)
        }).then(function (raw) {
          // 401: PHP sessiyasi ham, server tan oladigan `tg_me` ham yo'q.
          // Login oynasiga aylantirmasdan amalni mahalliy bajaramiz.
          if (raw.status === 401) { localVote(type); return null; }
          return raw.json();
        }).then(function (r) {
          if (!r) return;
          if (r.success === false) throw new Error(r.message || 'Xato');
          voteSync(r);
          // Profilning "mahalliy" rejimi (MTProto) shu nusxadan ko'rsatadi.
          mirrorLib('liked', !!D.has_liked);
        }).catch(function (err) {
          toast(err.message || 'Xatolik');
        }).finally(function () {
          b.classList.remove('busy');
          b.removeAttribute('aria-busy');
        });
      };
    }
    bindVote('actLike', 'like');
    bindVote('actDislike', 'dislike');

    // ================================================= SAQLASH MENYUSI
    // 📚 tugmasi o'zi SAQLAMAYDI - u MENYU ochadi (foydalanuvchi
    // so'rovi): "Keyinroq ko'rish" / "Saqlash". Shulardan biri
    // bosilganda avval kontent kutubxonaga QO'SHILADI, keyin chap
    // navigatsiyadagi bo'limga O'TILADI.
    //
    // NIMA UCHUN avval holatni tekshiramiz: `api/watchlist.php` POST i
    // TOGGLE (qo'sh/olib tashla). Kontent allaqachon saqlangan bo'lsa,
    // ko'r-ko'rona yuborilgan POST uni O'CHIRIB YUBORARDI.
    var w = el('actWatchlist');
    if (w) {
      w.classList.toggle('on', !!D.in_watchlist);
      w.onclick = function (ev) {
        ev.stopPropagation();          // hujum document'ga ketmasin
        var m = el('actSaveMenu');
        if (!m) return;
        m.hidden = !m.hidden;
        if (!m.hidden) placeSaveMenu();
      };
    }

    function ensureSaved() {
      if (D.in_watchlist) return Promise.resolve(true);
      return fetch(withMeQS(base + '/api/watchlist.php'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        credentials: 'same-origin',
        body: 'id=' + encodeURIComponent(D.id) + '&in_watchlist=1'
      }).then(function (raw) {
        // 401: server tanimadi - mahalliy kutubxonaga qo'shib qo'yamiz.
        if (raw.status === 401) { return localSave(); }
        return raw.json();
      }).then(function (r) {
        if (!r) return false;
        if (r.success === false) throw new Error(r.message || 'Xato');
        D.in_watchlist = !!r.in_watchlist;
        if (w) w.classList.toggle('on', D.in_watchlist);
        // Profilning "mahalliy" rejimi uchun nusxa.
        mirrorLib('saved', D.in_watchlist);
        return D.in_watchlist;
      });
    }

    /* Serverga saqlab bo'lmasa (401) mahalliy kutubxonaga qo'shamiz. */
    function localSave() {
      var lib = global.WCLib;
      if (!lib) return false;
      try { lib.add('saved', libItem()); } catch (e) {}
      D.in_watchlist = true;
      if (w) w.classList.toggle('on', true);
      return true;
    }

    var sm = el('actSaveMenu');
    if (sm) {
      sm.onclick = function (ev) {
        ev.stopPropagation();
        var it = ev.target.closest && ev.target.closest('[data-go]');
        if (!it) return;
        if (!isLoggedIn()) { needLogin(); closeSaveMenu(); return; }
        it.classList.add('busy');
        ensureSaved().then(function () {
          if (global.TvMode && global.TvMode.isTv()) {
            closeSaveMenu();
            toast('Video Saqlanganlar / Keyinroq ko‘rish ro‘yxatiga qo‘shildi');
            return;
          }
          // `nav.php` dagi Kutubxona bo'limi:
          //   Keyinroq ko'rish -> saved.php
          //   Saqlanganlar     -> saved.php (saved.php -> profile.php?tab=saved)
          location.href = 'saved.php';
        }).catch(function (err) {
          toast(err.message || 'Xatolik');
        }).finally(function () { it.classList.remove('busy'); });
      };
    }

    var sh = el('actShare');
    if (sh) sh.onclick = function () { openShare(); };

    /* "Qismlar" tugmasi yon paneldagi qismlar kassetasiga olib boradi.
       Tugma faqat `S.sideEpisodes` ro'ylangan paytda chiqadi
       (`renderActions`), ya'ni panel allaqachon ko'rinmoqda. */
    var ae = el('actAllEps');
    if (ae) {
      ae.onclick = function () {
        var box2 = el('watchSideEpBlock') || el('watchSide');
        if (box2 && box2.scrollIntoView) box2.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
    }

    // Menyu yopish hodisasi (document/Escape) faqat bir marta ulanadi.
    renderActions.bindMenuClose();
  }

  // ============================================== ULASHISH OYNASI (Instagram)
  //
  // Foyalanuvchi so'rovi: "Ulashish" bosilsa Instagram'dagidek CHATLAR
  // chiqsin va pastida boshqa platformalar (Telegram, WhatsApp,
  // ssilkadan nusxa ...).
  //
  //   YUQORI qism - saytdagi suhbatlar (`api/chat.php?action=contacts`)
  //   PASTI  qism - platformalar gorizontal qatorida
  //
  // Kontaktni bosganda: havola klipbordga nusxalanadi va chat YANGI
  // TABDA ochiladi (`chat.php?u=ID` - `tg-chat.js` shu parametrni
  // o'qib, to'g'ridan-to'g'ri shu suhbatni ochadi). Video sahifasi
  // joyida qoladi.
  function shareUrl() { return watchUrl(S.selectedId || ''); }

  function copyText(txt) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(txt);
    }
    return Promise.reject(new Error('Klipbord mavjud emas'));
  }

  function closeShare() {
    var s = el('shareSheet'), b = el('shareBackdrop');
    if (s) s.hidden = true;
    if (b) b.hidden = true;
    document.body.classList.remove('share-lock');
  }

  function shareCardData() {
    // Chatga yuboriladigan video karta uchun oqim ma'lumotlari. Video
    // serverga ko'chirilmaydi - faqat manzil/poster/sarlavha ketadi va
    // qabul qiluvchi chatda o'sha yerda o'ynatadi.
    var pb = S.playback || {};
    var e = curEp();
    var title = D.title || 'Video';
    if (e && e.number && D.is_series) title += ' \u00b7 ' + e.number + '-qism';
    return {
      title:    title,
      poster:   pb.poster || D.poster || '',
      duration: (e && e.duration) ? e.duration : (Number(D.duration) || 0),
      type:     pb.type || '',
      id:       D.id,
      episode:  S.selectedId || 0,
      channel:  pb.channel || '',
      post:     pb.post || 0,
      url:      pb.url || '',
      deep:     pb.deep || '',
      link:     shareUrl()
    };
  }

  function postShareToChat(peerId, data) {
    var params = new URLSearchParams();
    params.set('action', 'share');
    params.set('peer_id', String(peerId));
    Object.keys(data).forEach(function (k) {
      var v = data[k];
      if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
    });
    var raw = tgMeRaw();
    if (raw) params.set('tg_me', raw);
    return fetch(base + '/api/dm.php', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || d.success === false || !d.message) {
        throw new Error((d && d.message) || 'Yuborilmadi');
      }
      return d;
    });
  }

  function sendToContact(id, name) {
    // DIQQAT: avval havola nusxalanadi va chat yangi tabda ochilardi - bu
    // "yuborish" emas edi (foydalanuvchi qo'lda yopishtirishi kerak edi).
    // Endi video karta to'g'ridan-to'g'ri suhbatga YUBORILADI.
    if (!isLoggedIn()) { needLogin(); return; }
    postShareToChat(id, shareCardData()).then(function () {
      toast('\u2705 Yuborildi' + (name ? ' \u2014 ' + name : ''));
      closeShare();
      // Xohlasa suhbatni yangi oynada ochib ko'rsatamiz.
      var url = base + '/chat.php?u=' + encodeURIComponent(id);
      try {
        var win = window.open(url, '_blank');
        if (win) { try { win.opener = null; } catch (e) {} }
      } catch (e) { /* popup bloklandi - muhim emas, xabar yuborildi */ }
    }).catch(function (e) {
      toast('Yuborilmadi: ' + (e && e.message ? e.message : 'xatolik'));
    });
  }

  function sharePlatItems() {
    var u = encodeURIComponent(shareUrl());
    var t = encodeURIComponent(D.title || 'W CINEMA');
    var both = encodeURIComponent((D.title || '') + '\n' + shareUrl());
    var list = [
      // `p` - rang uchun (watch.css), `href` bo'lsa brauzer o'zi ochadi,
      // `act` bo'lsa bizning JS bajaradi.
      { p: 'tg', ico: '&#9992;&#65039;', lab: 'Telegram',    href: 'https://t.me/share/url?url=' + u + '&text=' + t },
      { p: 'wa', ico: '&#128172;',       lab: 'WhatsApp',    href: 'https://wa.me/?text=' + both },
      { p: 'fb', ico: 'f',               lab: 'Facebook',    href: 'https://www.facebook.com/sharer/sharer.php?u=' + u },
      { p: 'tw', ico: 'X',               lab: 'X (Twitter)', href: 'https://twitter.com/intent/tweet?url=' + u + '&text=' + t },
      { p: 'em', ico: '&#9993;',         lab: 'Email',       href: 'mailto:?subject=' + t + '&body=' + both },
      { p: 'cp', ico: '&#128203;',       lab: 'Nusxa olish', act: 'copy' }
    ];
    if (navigator.share) {
      list.push({ p: 'nv', ico: '&#128228;', lab: 'Boshqa', act: 'native' });
    }
    return list;
  }

  /* Panel birinchi ochilganda quriladi - keyin faqat `hidden`
     almashtiriladi (qayta-qayta yaratilmaydi, hodisalar yo'qolmaydi). */
  function shareSheet() {
    var s = el('shareSheet');
    if (s) return s;
    var host = document.createElement('div');
    host.innerHTML =
        '<div class="share-backdrop" id="shareBackdrop" hidden></div>'
      + '<div class="share-sheet" id="shareSheet" hidden role="dialog" aria-modal="true" aria-label="Ulashish">'
      +   '<div class="share-grab"></div>'
      +   '<div class="share-head">'
      +     '<span class="share-title">Ulashish</span>'
      +     '<button type="button" class="share-close" id="shareClose" aria-label="Yopish">&#10005;</button>'
      +   '</div>'
      +   '<div class="share-sub">Suhbatlar</div>'
      +   '<div class="share-chats" id="shareChats"><p class="share-empty">Yuklanmoqda…</p></div>'
      +   '<div class="share-sub">Boshqa platformalar</div>'
      +   '<div class="share-plat" id="sharePlat"></div>'
      + '</div>';
    var frag = document.createDocumentFragment();
    while (host.firstChild) frag.appendChild(host.firstChild);
    document.body.appendChild(frag);

    el('shareBackdrop').onclick = closeShare;
    el('shareClose').onclick    = closeShare;
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') closeShare();
    });

    // Chatlar: yopiq ro'yxatga delegation (elementlar keyin qo'shiladi).
    el('shareChats').onclick = function (ev) {
      var b = ev.target.closest && ev.target.closest('[data-peer]');
      if (!b) return;
      sendToContact(b.getAttribute('data-peer'), b.getAttribute('data-name') || '');
    };
    // Platformalar: faqat `data-act` li tugmalar; oddiy <a> ni
    // brauzer o'zi ochadi (target="_blank").
    el('sharePlat').onclick = function (ev) {
      var it = ev.target.closest && ev.target.closest('[data-act]');
      if (!it) return;
      var act = it.getAttribute('data-act');
      if (act === 'copy') {
        copyText(shareUrl())
          .then(function () { toast('\u{1F517} Havola nusxalandi'); })
          .catch(function () { toast(shareUrl()); });
        return;
      }
      if (act === 'native' && navigator.share) {
        navigator.share({ title: D.title, url: shareUrl() }).catch(function () {});
      }
    };
    return el('shareSheet');
  }

  /* Chatlar ro'yxati faqat bir marta so'raladi (har ochilishda emas). */
  function loadShareChats() {
    var box = el('shareChats');
    if (!box || loadShareChats.done) return;
    loadShareChats.done = true;
    fetch(withMeQS(base + '/api/chat.php?action=contacts'), { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var list = (d && d.contacts) || [];
        if (!list.length) {
          // Suhbatlar bo'lmasa - bo'sh holat yaxshi ko'rsatiladi va
          // foydalanuvchi chat sahifasiga olib boriladi (havola nusxalanib,
          // keyin suhbat ochiladi).
          box.innerHTML = '<p class="share-empty">Hozircha suhbat yo‘q. '
            + '<a href="' + base + '/chat.php">Chat sahifasida</a> '
            + 'yozib boshlang — keyin bu yerda chiqadi.</p>';
          return;
        }
        box.innerHTML = list.map(function (u) {
          var nm = (((u.first_name || '') + ' ' + (u.last_name || ''))
            .replace(/\s+/g, ' ').trim()) || u.username || 'Foydalanuvchi';
          var img = u.avatar
            ? '<img src="' + esc(u.avatar) + '" alt="" onerror="this.remove()">' : '';
          return '<button type="button" class="share-contact" data-peer="' + esc(String(u.id)) + '"'
            + ' data-name="' + esc(nm) + '">'
            + '<span class="share-av"><span class="share-av-fb">'
            + esc(nm.charAt(0).toUpperCase()) + '</span>' + img + '</span>'
            + '<span class="share-cname">' + esc(nm) + '</span></button>';
        }).join('');
      })
      .catch(function () {
        loadShareChats.done = false;            // keyingi ochilishda qayta urinadi
        box.innerHTML = '<p class="share-empty">Suhbatlarni yuklab bo‘lmadi</p>';
      });
  }

  function openShare() {
    var s = shareSheet();
    el('sharePlat').innerHTML = sharePlatItems().map(function (x) {
      var ico = '<span class="share-plat-ico">' + x.ico + '</span>';
      var lab = '<span class="share-plat-lab">' + esc(x.lab) + '</span>';
      if (x.href) {
        return '<a class="share-plat-item" data-p="' + x.p + '" href="' + esc(x.href) + '"'
          + ' target="_blank" rel="noopener">' + ico + lab + '</a>';
      }
      return '<button type="button" class="share-plat-item" data-p="' + x.p + '"'
        + ' data-act="' + x.act + '">' + ico + lab + '</button>';
    }).join('');
    s.hidden = false;
    el('shareBackdrop').hidden = false;
    document.body.classList.add('share-lock');
    loadShareChats();
  }

  // ============================================================== YON PANEL
  function thumbInner(c) {
    var fb = '<div class="watch-ep-fb">' + catEmoji(c.category_slug, c.category) + '</div>';
    if (!c.poster) return fb;
    // Birinchi kadr chiqquncha posturlar yuklanmaydi (`data-lazy-src`).
    // `fireVideoReady()` ularni bir zumda to'ldiradi.
    var attr = vReady ? ' src="' : ' data-lazy-src="';
    return '<img' + attr + esc(c.poster) + '" alt="" loading="lazy" referrerpolicy="no-referrer"'
      + ' onerror="this.remove()">' + fb;
  }

  function epRow(e) {
    var on = Number(e.id) === Number(S.selectedId);
    // Sarlavha "Qism N" bo'lgani uchun takrorlamaymiz: ostida faqat davomiylik,
    // joriy qismda esa "Hozir ijro etilmoqda".
    var meta = [];
    if (on) meta.push('<span class="watch-ep-seen">Hozir ijro etilmoqda</span>');
    else if (e.duration) meta.push(fmtTime(e.duration));
    return '<button type="button" class="watch-ep' + (on ? ' on' : '') + '" data-ep="' + esc(e.id) + '">'
      + '<span class="watch-ep-num">' + esc(e.number || e.id) + '</span>'
      + '<span class="watch-ep-thumb">'
      +   thumbInner({ poster: e.thumbnail ? thumbUrl(e.thumbnail) : '', category_slug: D.category_slug, category: D.category })
      +   (e.duration ? '<span class="watch-ep-dur">' + fmtTime(e.duration) + '</span>' : '')
      + '</span>'
      + '<span class="watch-ep-text">'
      +   '<span class="watch-ep-ttl">' + esc(e.title || (e.number + '-qism')) + '</span>'
      +   (meta.length ? '<span class="watch-ep-meta">' + meta.join(' · ') + '</span>' : '')
      + '</span></button>';
  }

  /* Tavsiya kartochkasidagi kichik belgi.
   *
   * Anime/serialda 1-qismning davomiyligini emas, QISMLAR SONINI ko'rsatamiz:
   * saytda bor qism / jami rejalashtirilgan qism -> "11/16". Format izoh
   * qidiruvidagi (nav.php) anime kartochkalari bilan bir xil.
   * Kino/multfilmda eski holat saqlanadi — video davomiyligi (mas. 24:00). */
  function recDurBadge(c) {
    if (c.is_series && c.category_slug === 'anime') {
      var rel = parseInt(c.episodes, 10) || 0;
      var tot = parseInt(c.total_episodes, 10) || 0;
      if (rel > 0 || tot > 0) {
        var txt = tot > rel ? (rel + '/' + tot) : String(rel || tot);
        return '<span class="watch-ep-dur">' + esc(txt) + '</span>';
      }
    }
    return Number(c.duration) > 0
      ? '<span class="watch-ep-dur">' + fmtTime(c.duration) + '</span>' : '';
  }

  /* Yon paneldagi ixchak "tavsiya qatori" - `watch.php?c=ID`
     havolasidagi <a>. Karta uslublari `.watch-rec*` (watch.css). */
  function recRow(c) {
    var meta = [];
    meta.push(Number(c.views) > 0 ? fmtViews(c.views) + ' ko‘rildi' : 'Yangi');
    var ago = fmtAgo(c.added_at || c.created_at);
    if (ago) meta.push(ago);
    // "Yangi" belgisi: 3 kundan yangi qo'shilganlarga (YouTube'dagi kabi).
    var ts = Date.parse(String(c.added_at || c.created_at || '').replace(' ', 'T'));
    var isNew = !isNaN(ts) && (Date.now() - ts) < 3 * 86400 * 1000;
    return '<a class="watch-rec" data-id="' + esc(c.id) + '" data-new="' + (isNew ? '1' : '0') + '"'
      + ' href="' + esc(base + '/watch.php?c=' + c.id) + '">'
      + '<span class="watch-rec-thumb">'
      +   thumbInner(c)
      +   (isNew ? '<span class="watch-rec-new">Yangi</span>' : '')
      +   recDurBadge(c)
      + '</span>'
      + '<span class="watch-rec-text">'
      +   '<span class="watch-rec-ttl">' + esc(c.title) + '</span>'
      +   '<span class="watch-rec-ch">' + esc(W.siteName || 'W CINEMA') + '</span>'
      +   '<span class="watch-rec-meta">' + meta.join(' · ') + '</span>'
      + '</span></a>';
  }


  /** `episodes.thumbnail` odatda `uploads/...` yoki to'liq URL bo'ladi. */
  function thumbUrl(t) {
    if (!t) return '';
    t = String(t);
    if (/^(https?:)?\/\//i.test(t) || t.charAt(0) === '/') return t;
    return base + '/' + t.replace(/^\/+/, '');
  }

  /* Yon panel YouTube kanal sahifasi kabi IKKI blokdan iborat:

       1) `watchSideEpBlock`  - QISMLAR. Faqat serial/animedda
                                  (`hasPlaylist`); o'z ichida vertikal
                                  skroll. Tepasida qism raqami kiritish
                                  maydoni (`.watch-ep-find`).
       2) `watchSideRecBlock` - aralash tavsiyalar (kino + anime +
                                  multfilm). SARLAVHASI YO'Q va ichki
                                  skrolli yo'q: izohlar bilan birga
                                  sahifa bo'ylab pastga ketadi.

     Film/multfilmda 1-blok `hidden` bo'ladi, 2-blok butun joyni oladi -
     bo'sh o'ng ustun hech qachon qolmaydi.

     Tavsiyalar LAZY LOAD qilinadi: dastlab `watch.php` bir sahifani
     beradi, qolgani `loadMoreRelated()` orqali (`api/related.php`)
     foydalanuvchi ro'yxat oxiriga yetganda yuklanadi. */
  function renderSide() {
    var epBlock = el('watchSideEpBlock');
    var list    = el('watchSideList');
    var count   = el('watchSideCount');
    var recList = el('watchSideRecList');

    // --- 1) Qismlar
    if (list) {
      if (S.sideEpisodes) {
        if (count) count.textContent = S.episodes.length + ' ta';
        // Fasl chiplari + filtr/qidiruv birgalikda ro'yxatni quradi.
        renderSeasons();
        filterEpisodes();
      } else {
        list.innerHTML = '';
      }
    }
    if (epBlock) epBlock.hidden = !S.sideEpisodes;
    syncEpMobileUI();

    // --- 2) Tavsiyalar (sarlavhasiz, YouTube sidebar uslubida)
    if (recList) {
      recList.innerHTML = S.related.length
        ? S.related.map(recRow).join('')
        : '<div class="watch-side-empty">Hozircha tavsiya yo\u2018q</div>';
    }
    applyRecFilter();
    syncRecMore();
  }

  /* O'quvchi (spinner) ko'rinishini holatga moslaydi: faqat "yana bor"
     degan paytdagina ko'rinadi. */
  function syncRecMore() {
    var more = el('watchRecMore');
    if (!more) return;
    more.hidden = !(S.relMore && !S.relBusy);
  }

  /** Keyingi sahifa tavsiyalarni yuklaydi (YouTube uslubidagi lazy load). */
  function loadMoreRelated() {
    // Qayta-qayta so'rov yuborilmasin (sentinel ko'rinishda tursa).
    if (!S.relMore || S.relBusy) return;
    // chegaraga urish himoyasi: cheksiz o'sishni to'xtatamiz.
    if (S.related.length >= 60) { S.relMore = false; syncRecMore(); return; }
    S.relBusy = true;
    syncRecMore();

    api('/api/related.php?id=' + encodeURIComponent(D.id)
        + '&offset=' + encodeURIComponent(S.relOffset))
      .then(function (d) {
        var items = d.items || [];
        // Joriy kontent tasoddan qaytib kelsa, uni ko'rsatmaymiz.
        var fresh = items.filter(function (c) { return Number(c.id) !== Number(D.id); });
        S.related = S.related.concat(fresh);
        S.relOffset += items.length;
        S.relMore   = !!d.has_more && items.length > 0;
        var recList  = el('watchSideRecList');
        if (recList && fresh.length) {
          var empty = recList.querySelector('.watch-side-empty');
          if (empty) empty.remove();
          recList.insertAdjacentHTML('beforeend', fresh.map(recRow).join(''));
          applyRecFilter();
        }
      })
      .catch(function () {
        // Xatoda "yana bor" ni o'chiriramiz - aks holda har scroll'da
        // bir xil so'rov takrorlanib, spinner o'zi osilib qolardi.
        S.relMore = false;
      })
      .finally(function () {
        S.relBusy = false;
        syncRecMore();
        /* Ro'yxat uzaydi. Agar sentinel endi ham ekranda qolsa
           (foydalanuvchi allaqachon sahifa pastida turibdi, yoki
           bitta qadamda ko'p qator sig'di) - davom ettiramiz.
           Aks holda keyingi `scroll` hodisasi bilan yuklanardi, lekin
           foydalanuvchi qo'lda scroll qilmasa (touchpad, D-Pad)
           ro'yxat yarim bo'lib qolardi. */
        if (S.relMore && recMoreNear()) {
          setTimeout(loadMoreRelated, 220);
        }
      });
  }

  /** Sentinel ekrana yaqinlashdimi? (ikkala usul ham shuni tekshiradi) */
  function recMoreNear() {
    var more = el('watchRecMore');
    if (!more) return false;
    var r = more.getBoundingClientRect();
    var vh = global.innerHeight || document.documentElement.clientHeight;
    // 400px - foydalanuvchi scroll boshganda ham vaqtincha bo'sh joy bo'ladi
    return r.top <= vh + 400 && r.bottom >= -400;
  }

  /** Sentinel ko'rinishga yaqinlashganda keyingi sahifani yuklaydi. */
  function initRecObserver() {
    var more = el('watchRecMore');
    if (!more) return;
    syncRecMore();
    if (!S.relMore) return;

    // 1) Asosiy usul: IntersectionObserver (barcha zamonaviy brauzerlar).
    if (typeof global.IntersectionObserver === 'function') {
      var io = new global.IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          if (entries[i].isIntersecting) loadMoreRelated();
        }
      }, { rootMargin: '400px 0px' });
      io.observe(more);
    }

    /* 2) Zaxira usul: `scroll` hodisasi + o'lcham o'zgarishi.
       Ba'zi muhitlarda (ayrim TV brauzerlari, WebView'lar, avtomatlashtirilgan
       muhitlar) `IntersectionObserver` callback umuman yuborilmaydi - shunda
       ro'yxat to'liq bo'lib qolmaydi. `scroll` bilan xuddi shu natijaga
       erishamiz.

       Throttle uchun `requestAnimationFrame` emas, `setTimeout` ishlatiladi:
       rAF yashirin (background) tab'lar va avtomatlashtirilgan muhitlarda
       butunlay ishlamaydi - u holda zaxira yo'limiz ham o'lib qolardi.
       120ms chastota foydalanuvchi uchun sezilmaydi. */
    var ticking = false;
    function check() {
      if (ticking) return;
      ticking = true;
      setTimeout(function () {
        ticking = false;
        if (S.relMore && !S.relBusy && recMoreNear()) loadMoreRelated();
      }, 120);
    }
    global.addEventListener('scroll', check, { passive: true });
    global.addEventListener('resize', check, { passive: true });

    // Sahifa allaqachon pastda bo'lsa (qaytib kelganda) - darhol tekshiramiz.
    check();
  }

  /* --------------------------------------------------------- QISM RAQAMI
     YouTube playlist'idagi "jump to episode" odati: maydonga raqam
     yoziladi, Enter bosiladi -> shu qism darhol ochiladi. Kiritish
     paytida ro'yxat ham filtrlanadi (faqat mos qismlar qoladi) -
     YouTube'dagi playlist qidiruviga o'xshaydi. */
  function epMatches(e, q) {
    if (!q) return true;
    return String(e.number) === q
        || String(e.id) === q
        || (e.title || '').toLowerCase().indexOf(q) !== -1;
  }

  /* ------------------------------------------------ MOBIL FASL TANLASH
     Mobil "QISM TANLASH" grid'idagi fasl chiplari. Desktopda
     `.watch-ep-seasons` CSS'da yashiringan (faqat mobil ko'rinadi). */
  function seasonList() {
    var seen = {};
    S.episodes.forEach(function (e) { seen[e.season || 1] = true; });
    return Object.keys(seen).map(Number).sort(function (a, b) { return a - b; });
  }
  /** Fasl chiplari qatorini quradi (`renderSide`/chip bosilishida). */
  function renderSeasons() {
    var epBlock = el('watchSideEpBlock');
    var head = epBlock && epBlock.querySelector('.watch-side-head');
    if (!head) return;
    var box = el('watchEpSeasons');
    if (!box) {
      box = document.createElement('div');
      box.className = 'watch-ep-seasons';
      box.id = 'watchEpSeasons';
      var form = el('watchEpFind');
      if (form) head.insertBefore(box, form);
      else head.appendChild(box);
    }
    var seasons = seasonList();
    if (!seasons.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = '';
    function chip(n, label) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'watch-ep-season' + (S.epSeason === n ? ' on' : '');
      b.setAttribute('data-season', String(n));
      b.setAttribute('aria-pressed', S.epSeason === n ? 'true' : 'false');
      b.textContent = label;
      b.addEventListener('click', function () {
        S.epSeason = n;
        renderSeasons();
        filterEpisodes();
      });
      return b;
    }
    box.appendChild(chip(0, 'Barcha'));
    seasons.forEach(function (s) { box.appendChild(chip(s, s + '-fasl')); });
  }

  /* Mobil ekranda sarlavha va qidiruv maydonini moslaydi:
       • "Qismlar"  ->  "Qism tanlash"  (CSS UPPERCASE => "QISM TANLASH")
       • inputmode "numeric" -> "text"  (nom YOKI raqam bo'yicha qidirish) */
  function syncEpMobileUI() {
    var mob = typeof global.matchMedia === 'function'
      && global.matchMedia('(max-width: 768px)').matches;
    var t = el('watchSideTitle');
    if (t) t.textContent = (mob && S.sideEpisodes) ? 'Qism tanlash' : 'Qismlar';
    var inp = el('watchEpFindInput');
    if (inp) {
      inp.setAttribute('inputmode', mob ? 'text' : 'numeric');
      inp.placeholder = mob ? 'Nom yoki raqam…' : 'Qism raqami…';
    }
  }
  /** Mobil sarlavha/qidiruv moslashuvini resize'da yangilab turadi. */
  function bindEpMobileUI() {
    if (typeof global.addEventListener !== 'function') return;
    var dc = null;
    global.addEventListener('resize', function () {
      clearTimeout(dc);
      dc = setTimeout(syncEpMobileUI, 120);
    });
  }

  /** Kiritilgan so'zga mos qismlarni ko'rsatadi (bo'sh -> to'liq ro'yxat).
     Fasl filtri (`S.epSeason`) va matn qidiruvi birgalikda qo'llanadi. */
  function filterEpisodes() {
    var list = el('watchSideList');
    if (!list || !S.sideEpisodes) return;
    var inp = el('watchEpFindInput');
    var raw = inp ? inp.value.trim() : '';
    var q = raw.toLowerCase();
    var rows = S.episodes;
    if (S.epSeason) {
      rows = rows.filter(function (e) { return (e.season || 1) === S.epSeason; });
    }
    if (q) {
      rows = rows.filter(function (e) { return epMatches(e, q); });
    }
    if (!rows.length) {
      list.innerHTML = '<div class="watch-side-empty">'
        + (S.episodes.length
            ? (raw ? esc(raw) + ' topilmadi' : 'Bu faslda qismlar yo\u2018q')
            : 'Qismlar hali qo\u2018shilmagan')
        + '</div>';
      return;
    }
    list.innerHTML = rows.map(epRow).join('');
  }

  function initEpFind() {
    var form = el('watchEpFind');
    var inp  = el('watchEpFindInput');
    if (!form || !inp) return;

    inp.addEventListener('input', filterEpisodes);
    // iOS "x" tugmasi - ikkala holatda ham filtr yangilanadi.
    inp.addEventListener('search', filterEpisodes);

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var raw = inp.value.trim();
      var q = raw.toLowerCase();
      if (!q) return;
      var ep = q ? S.episodes.filter(function (e) { return epMatches(e, q); })[0] : null;
      if (!ep) {
        toast('"' + raw + '" qismi topilmadi');
        return;
      }
      // Maydoni tozalab, ro'yxatni to'liq holatga qaytaramiz.
      inp.value = '';
      filterEpisodes();
      inp.blur();
      switchEpisode(Number(ep.id) || 0);
    });
  }

  // ================================================================= IZOH
  function initComments() {
    if (!global.TGComments || !global.TGComments.enabled()) {
      // Telegram izohlari o'chirilgan (TG_COMMENTS_CHAT yo'q).
      var list = el('commentsList');
      if (list) list.innerHTML = '<div class="reels-c-empty">Izohlar vaqtincha faol emas</div>';
      return;
    }

    // Ro'yxatni bo'shatamiz - `open()` o'z holatini ("yuklanmoqda") qo'yadi.
    var list = el('commentsList');
    if (list) list.innerHTML = '<div class="reels-c-loading"><span class="spinner"></span></div>';

    // YouTube uslubidagi qisqartirilgan izohlar: matn faqat bitta qator
    // ko'rinadi (`watch.css` `.reels-c-body` -> `line-clamp: 1`), bosilganda
    // to'liq ochiladi/yopiladi. Delegatsiya — satrlar har qachon
    // qayta chizilganda ham ishlaydi (`.open` klassi o'sha elementda).
    if (list && !list.__bodyToggle) {
      list.__bodyToggle = true;
      list.addEventListener('click', function (e) {
        // Havola ichida bosilganda — faqat havola ochiladi (toggle emas).
        if (e.target.closest && e.target.closest('a')) return;
        var b = e.target.closest && e.target.closest('.reels-c-body');
        if (!b) return;
        b.classList.toggle('open');
      });
    }

    // --- TELEFON REJIMI: qisqartirilgan izohlar (watch.css) ---
    // Yopiq holatda ro'yxatda faqat boshidagi 2 TA XABAR ko'rinadi,
    // yozish maydoni yashirin. Blok ustidan bosilsa (yoki tugma bilan)
    // `wc-full` qo'shiladi — video TAGIDA to'liq oyna ochiladi: barcha
    // izohlar (ichki skroll) + kompozitor. Kompyuterda hech narsa
    // o'zgarmaydi (`mq` tekshiruvi + CSS 768px media query).
    if (list && !list.__fullToggle && list.closest) {
      list.__fullToggle = true;
      var wcWrap = list.closest('.watch-comments-wrap');
      var moreBtn = wcWrap && wcWrap.querySelector('.watch-c-more');
      var mqPhone = global.matchMedia
        ? global.matchMedia('(max-width: 768px)') : null;
      // 3+ xabar borsa qisqartiriladi (CSS `:has` bilan bir xil shart).
      var wcCollapsible = function () {
        return list.querySelectorAll(':scope > .reels-c-thread').length > 2;
      };
      var wcSetFull = function (on) {
        if (!wcWrap) return;
        wcWrap.classList.toggle('wc-full', on);
        if (moreBtn) {
          moreBtn.textContent = on
            ? 'Yopish' : 'Barcha izohlarni ko‘rish';
        }
      };
      if (moreBtn) {
        moreBtn.addEventListener('click', function () {
          wcSetFull(!wcWrap.classList.contains('wc-full'));
        });
      }
      list.addEventListener('click', function (e) {
        if (!wcWrap) return;
        if (wcWrap.classList.contains('wc-full')) return; // allaqachon ochiq
        if (mqPhone && !mqPhone.matches) return;          // faqat telefon rejimi
        if (!wcCollapsible()) return;                     // 1-2 xabar — o'zi to'liq
        // O'z-o'zidan ishlaydigan elementlar — panel ochilmaydi:
        // havola, ovozli xabar tugmasi, media (rasm/video/lightbox).
        if (e.target.closest && e.target.closest('a, .tv-play, .reels-c-media')) return;
        wcSetFull(true);
      });
    }

    // Kalit = episodes.id (reels moduli esa reels.id ishlatadi).
    // Izohlar so'rovi video tayyor bo'lgach boshlanadi (tarmoq navbati
    // avval FAQAT video uchun) — 4 s zaxira taymer bilan.
    onVideoReady(openComments);

    // --- Kompozitor yuborishi. `tg-comments.js` formani BOG'LAMAYDI
    //     (reels.js bog'laydi), shuning uchun shu yerda qilamiz.
    document.addEventListener('submit', function (e) {
      var form = e.target.closest && e.target.closest('#commentForm');
      if (!form) return;
      e.preventDefault();
      var input = el('commentInput');
      var body = (input && input.value ? input.value : '').trim();
      if (!body) return;
      var btn = el('commentSend');
      if (btn) btn.disabled = true;
      global.TGComments.sendText(body).then(function () {
        if (input) { input.value = ''; input.style.height = 'auto'; }
      }).catch(function (err) {
        toast(err && err.message ? err.message : 'Izoh yuborilmadi');
      }).finally(function () {
        if (btn) btn.disabled = false;
      });
    });

    // --- Matn maydoni matn uzunligiga qarab o'sadi (chat kabi).
    var cinput = el('commentInput');
    if (cinput) {
      cinput.addEventListener('input', function (e) {
        var t = e.target;
        t.style.height = 'auto';
        t.style.height = Math.min(120, t.scrollHeight) + 'px';
      });
      // Shift+Enter -> qator uzilishi; Enter -> yuborish.
      cinput.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' || e.shiftKey) return;
        e.preventDefault();
        var f = e.target.form;
        if (!f) return;
        if (f.requestSubmit) f.requestSubmit();
        else f.dispatchEvent(new Event('submit', { cancelable: true }));
      });
    }

    /* Yon panel qismlar yoki tavsiyalar ko'rsatishi - buni PHP
       (`hasPlaylist`) hal qiladi: film/multfilm -> tavsiyalar,
       anime/serial -> qismlar. Bu yerda qo'shimcha bog'lanish kerak emas. */
  }

  /** Joriy qismga izohlar panelini ochadi. */
  function openComments() {
    var e = curEp();
    var key = e ? Number(e.id) : 0;
    if (!key) {
      // Qismsiz film: izohlar butun kontentga biriktiriladi.
      key = -Number(D.id);
    }
    var label = e
      ? D.title + ' · ' + e.season + '-fasl ' + e.number + '-qism'
      : D.title;
    // Izoh mavzusi `StreamBootstrap` tomonidan SQL keshiga yozilgan va
    // `__WCBOOT.topic` ichida tayyor keladi.Uni uzatamiz — tg-comments.js
    // `api/video-topic.php` ga so'rov yubormaydi (1 ta so'rov tejaladi).
    var SB = global.WCStreamBoot;
    var bootTopic = SB && typeof SB.topicId === 'function' ? SB.topicId() : 0;
    return global.TGComments.open({
      id: key,
      topic_id: bootTopic || 0,
      title: label,
      comments: 0
    }).catch(function () { /* modul o'zi ko'rsatadi */ });
  }

  // ================================================================== CHAT
  /* DIQQAT: bu sahifada chat YO'Q. `tg-chat.js` ham yuklanmaydi
     (watch.php dan skript va `chat.css` olib tashlangan), shuning uchun
     `initChat`/`TGChat` kodini ham olib tashladik. Chat alohida `chat.php`
     sahifasida (pastki nav markazidagi "Chat" tugmasi). */

  // ==================================================== QISM ALMASH (YORDAMCHI)
  /* Qism almashtirganda SARLAVHANING FAQAT qism raqamini yangilaymiz.
     `renderHead()` chaqirilmaydi: u butun ma'lumot blokini (ko'rishlar,
     reyting, tavsif, janrlar, tugmalar) qayta quradi — bular qismga
     bog'liq emas va ko'z o'ngida "yangilanib" ketmasligi kerak. */
  function syncEpisodeTitle() {
    var t = el('watchTitle');
    if (!t) return;
    var e = curEp();
    t.textContent = (e && S.episodes.length > 1)
      ? D.title + ' — ' + e.number + '-qism'
      : D.title;
  }

  /* Yondagi qismlar ro'yxatida FAQAT "tanlangan" belgisini siljitish.
     `renderSide()` chaqirilmaydi: u butun ro'yxatni qayta chizib, skroll
     holatini yo'qotadi va boshqa bloklarga ham ta'sir qiladi. */
  function syncActiveEpisode(epId) {
    var list = el('watchSideList');
    if (!list) return;
    var btns = list.querySelectorAll('[data-ep]');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      var id = Number(b.getAttribute('data-ep'));
      var on = id === Number(epId);
      if (on === b.classList.contains('on')) continue;
      b.classList.toggle('on', on);

      // "Hozir ijro etilmoqda" yozuvini ham moslashtiramiz.
      var meta = b.querySelector('.watch-ep-meta');
      if (on) {
        if (!meta) {
          var text = b.querySelector('.watch-ep-text');
          if (text) {
            meta = document.createElement('span');
            meta.className = 'watch-ep-meta';
            text.appendChild(meta);
          }
        }
        if (meta) meta.innerHTML = '<span class="watch-ep-seen">Hozir ijro etilmoqda</span>';
      } else if (meta) {
        var e = ep(id);
        if (e && e.duration) meta.textContent = fmtTime(e.duration);
        else if (meta.parentNode) meta.parentNode.removeChild(meta);
      }
    }
  }

  /* `api/episode.php` javobini qo'llash — click va brauzer orqaga/qayta
     ikkalasi ham SHU funksiyani ishlatadi. Faqat player va qism belgisi
     o'zgaradi; `renderHead()`/`renderSide()`/`openComments()` CHAQIRILMAYDI. */
  function applyEpisodeData(d, epId) {
    S.playback  = d.playback || S.playback;
    S.resumeAt  = (d.progress && d.progress.position > 5) ? d.progress.position : 0;
    S.selectedId = epId;

    // Embed mavjudligi qismdan qismga farq qiladi (ommaviy/xususiy post).
    // `tgEmbed()` har safar `W.tgEmbed` ni o'qiyapti — global obyektni
    // yangilash kifoya, qayta render kerak emas.
    W.tgEmbed = d.tgEmbed || null;
    // Yangi qismning SQL bootstrap'i kelsa (api/episode.php), uni faollashtiramiz.
    if (d.boot && typeof d.boot === 'object') global.__WCBOOT = d.boot;
    // Yangi qismning `moov` indeksini darhol yuklashni boshlaymiz — kino
    // fayllarida birinchi kadr shu dum bo'lagiga bog'liq.
    warmCurrentIndex();
    global.__WC_CDN_FAILED = false;
    seedEmbedFromBoot();
    applyBootPlayback();
    S.embedFailed = false;
    S.embedFailedKey = '';
    S.gwTriedFor = '';

    // Yangi qismning 15s preview'i tayyor bo'lsa, xaritaga qo'shamiz:
    // `mountPlayer()` uni avval o'ynatadi, so'ng asl videoga o'tadi.
    if (d.preview) {
      if (!global.__WCPREVIEW) global.__WCPREVIEW = {};
      global.__WCPREVIEW[d.preview.ch + '/' + Number(d.preview.p)] = d.preview;
    }

    // Faqat qism raqami va yondagi "tanlangan" belgisi o'zgaradi.
    syncEpisodeTitle();
    syncActiveEpisode(epId);

    // Siljiydigan oyna: S.selectedId allaqachon YANGI qism (N+1). Shu qism
    // ochilgan zahoti uning keyingisi (N+2) ham tayyorlanadi — 3 s kutish yo'q.
    // `force` kerak: `switchEpisode` hali S.switching=true bo'lganda chaqiramiz.
    onVideoReady(function () {
      prefetchAdjacent();
      warmNextEpisode(true);
    });
    mountPlayer();
  }

  // ============================================================ QISM ALMASH
  function switchEpisode(epId) {
    epId = Number(epId) || 0;
    if (S.switching || !epId) return;
    if (epId === Number(S.selectedId)) return;
    S.switching = true;

    // `#t=` reels klipining nuqtasi edi - boshqa qismga o'tganda u
    // ma'nosiz (yangisida 95-soniyasi boshqa joy). Faqat joriy video uchun.
    S.hashStart = 0;

    // KLIK JAVOBI DARHOL: eski oqim to'xtatiladi va poster + spinner shu
    // yerning o'zida chiziladi — `episode.php` javobini kutmasdan.
    armVideoReady();
    try { if (global.TgStream) global.TgStream.stop(); } catch (e) {}
    try { if (global.UDP) global.UDP.destroyAll(); } catch (e) {}
    try { if (global.UzPlayer && global.UzPlayer.destroyAll) global.UzPlayer.destroyAll(); } catch (e) {}
    var wHost = el('watchPlayer');
    if (wHost) wHost.innerHTML = '';
    showPlayerLoading((S.playback && S.playback.poster) || '');

    // Chuqur havola darhol yangilanadi - "Ulashish" va "orqaga" to'g'ri ishlaydi.
    try {
      // Loyiha /tele_uzdub papkasida ishlaydi; base ni olib tashlash
      // refreshda root /watch.php ga olib borib, Apache 404 chiqaradi.
      history.pushState({ ep: epId }, '', watchUrl(epId));
    } catch (e) {}

    // MUHIM: Telegram hujjatini `episode.php` SO'ROVI bilan PARALLEL tayyorlaymiz.
    //
    // Oldingi ketma-ket oqim shunday edi:
    //   content.php (tarmoq)  ->  mount()  ->  findDoc (Telegram)  ->  probe (Telegram)
    // Ya'ni ikki bosqich tarmoqda BIR-BIRINI kutardi. Endi kichik
    // `episode.php` javoblanayotgan paytda `findDoc` + `probe` allaqachin
    // yuguradi va `mount()` ularni KESHDAN oladi (yoki jarayonda bo'lsa
    // kutadi) — natijada qism ochilishi ikki barobar tezlashadi.
    prefetchEpisode(ep(epId));

    // FAQAT yangi qismning pleyer ma'lumotini olamiz. Eski `api/content.php`
    // butun kontentni (janr, tavsif, barcha qismlar, tavsiyalar...) qaytarib,
    // sahifaning yarim qismini qayta chizarga majbur qilardi — anime
    // qismlarida bu "hamma narsa yangilanib ketayapti" degan taassurot beradi.
    // Endi qolgan bloklar tinch qoladi, faqat player almashadi.
    api('/api/episode.php?id=' + encodeURIComponent(D.id) + '&episode=' + epId)
      .then(function (d) {
        applyEpisodeData(d, epId);
        return null;
      })
      .then(function () {
        // Blokni TUMASHTIRISH shart: `switchEpisode` birinchi qatorida
        // `S.switching` ni o'rniga qo'yadi, uni faqat muvaffaqiyatdan
        // keyin (yoki xatodan keyin) bo'shatamiz.
        S.switching = false;
      })
      .catch(function (err) {
        S.switching = false;
        toast(err && err.message ? err.message : 'Qismni yuklab bo‘lmadi');
        // Havolani orqaga qaytaramiz - foydalanuvchi "yo'qotilmasin".
        try { history.replaceState({}, '', watchUrl(S.selectedId)); } catch (e) {}
      });
  }

  // Bravoorizon (orqaga/qayta) tugmalarida qismni almashtiramiz.
  function bindSideClicks() {
    var list = el('watchSideList');
    if (!list) return;
    list.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-ep]');
      if (!b) return;
      e.preventDefault();
      switchEpisode(Number(b.getAttribute('data-ep')) || 0);
    });

    // Ustiga borish = "bu qismni ko'rmoqchi" belgisi. Shu qismning Telegram
    // hujjatini shu zahoti tayyorlaymiz: ro'yxatda siljitish tuguni bosish
    // odatda bir necha yuz ms oldin bo'ladi - shu vaqt Telegram ishi
    // tugunlaydi va bosilgachida video DARHOL ochiladi.
    //
    // `mouseover` (delegatsiya) `mouseenter` dan tez: elementlar
    // `renderSide()` da qayta quriladi, `mouseenter` esa yangi elementga
    // ulangan bo'lishi kerak edi - `mouseover` har safar ishlaydi.
    list.addEventListener('mouseover', function (e) {
      var b = e.target.closest && e.target.closest('[data-ep]');
      if (!b) return;
      var id = Number(b.getAttribute('data-ep')) || 0;
      if (!id || id === Number(S.selectedId)) return;
      prefetchEpisode(ep(id));
    });
  }

  // ============================================== BIRINCHI KADR (READY) DARVOZASI
  //
  // Nima uchun: video ochilayotganda brauzerning tarmoq navbati FAQAT video
  // uchun bo'lishi kerak. Izohlar, tavsiya posturlari va boshqa so'rovlar
  // birinchi kadr (`playing`) chiqqandan keyin boshlanadi — aks holda ular
  // video bilan raqobatlashib, ochilishni kechiktiradi.
  //
  // Xavfsizlik: 4 soniyalik zaxira taymer — video umuman ochilmasa (xato,
  // ruxsat yo'q) panel "abadiy bo'sh" qolmaydi.
  var vReady = false;
  var vWaiters = [];
  var vTimer = null;

  function onVideoReady(fn) {
    if (typeof fn !== 'function') return;
    if (vReady) { try { fn(); } catch (e) {} return; }
    vWaiters.push(fn);
  }

  function hydrateThumbs() {
    try {
      var imgs = document.querySelectorAll('img[data-lazy-src]');
      for (var i = 0; i < imgs.length; i++) {
        var u = imgs[i].getAttribute('data-lazy-src');
        if (!u) continue;
        imgs[i].removeAttribute('data-lazy-src');
        imgs[i].src = u;
      }
    } catch (e) {}
  }

  function fireVideoReady() {
    if (vReady) return;
    vReady = true;
    if (vTimer) { clearTimeout(vTimer); vTimer = null; }
    // Birinchi kadr keldi — posterdagi spinner olib tashlanadi.
    try {
      var host = el('watchPlayer');
      if (host) {
        host.classList.remove('is-loading');
        var ld = host.querySelector('.watch-load');
        if (ld && ld.parentNode) ld.parentNode.removeChild(ld);
      }
    } catch (e) {}
    var q = vWaiters;
    vWaiters = [];
    for (var i = 0; i < q.length; i++) {
      try { q[i](); } catch (e) { /* bittasi xato bo'lsa qolgani davom etadi */ }
    }
    hydrateThumbs();
  }

  function armVideoReady() {
    vReady = false;
    if (vTimer) clearTimeout(vTimer);
    vTimer = setTimeout(fireVideoReady, 4000);
  }

  function isPlayerVideo(n) {
    var host = el('watchPlayer');
    return !!(host && n && host.contains(n));
  }

  document.addEventListener('playing', function (e) {
    if (e.target && e.target.tagName === 'VIDEO' && isPlayerVideo(e.target)) fireVideoReady();
  }, true);
  document.addEventListener('canplay', function (e) {
    if (e.target && e.target.tagName === 'VIDEO' && isPlayerVideo(e.target)) fireVideoReady();
  }, true);

  // Bosish paytida poster + spinner DARHOL chiziladi (hech narsa kutilmaydi).
  function showPlayerLoading(poster) {
    var host = el('watchPlayer');
    if (!host) return;
    if (poster) {
      var u = String(poster).replace(/\\/g, '/').replace(/"/g, '%22');
      host.style.setProperty('--wposter', 'url("' + u + '")');
    }
    host.classList.add('is-loading');
  }

  // ============================================================ ISHGA TUSHISH
  function boot() {
    // Agar progress allaqachon ma'lum bo'lsa (keyingi sahifaga o'tish),
    // bo'sh qism 0 dan qayta o'ynamasligi kerak.
    S.resumeAt = (D.progress && D.progress.position > 5) ? D.progress.position : 0;

    // SQL keshidan kelgan ma'lumotlar: qo'shimcha API so'rovlarining oldini oladi.
    seedEmbedFromBoot();
    applyBootPlayback();
    // Joriy videoning MP4 indeksini player mount bo'lishidan OLDIN boshlaymiz.
    warmCurrentIndex();

    renderHead();
    renderSide();
    mountPlayer();
    bindSideClicks();
    bindPMode();
    initEpFind();
    bindEpMobileUI();
    // Birinchi kadr chiqquncha: tavsiyalar kuzatuvchisi va avatar so'rovi
    // kutadi (tarmoq navbati faqat video uchun).
    onVideoReady(initRecObserver);
    initComments();
    initRecChips();
    initCommentSort();
    onVideoReady(initComposerAvatar);

    // Qism almashtirilganda skroll yuqoriga qaytadi.
    function onWatchPop() {
      var m = /[?&]e=(\d+)/.exec(location.search);
      var id = m ? Number(m[1]) : 0;
      if (!id) {
        // `e` yo'q: App Shell bo'lsa router sahifani o'zi qayta chizadi.
        if (!(global.WCApp && global.WCApp.isEnabled && global.WCApp.isEnabled())) {
          location.reload();
        }
        return;
      }
      if (id === Number(S.selectedId)) return;
      // `pushState` bilan o'zgartirganimiz uchun `switchEpisode` ham
      // `pushState` qilardi - bu yerda faqat `replace` qilamiz.
      S.switching = true;
      // Orqaga/qayta ham faqat qismni almashtiradi — sahifa qayta chizilmaydi.
      api('/api/episode.php?id=' + encodeURIComponent(D.id) + '&episode=' + id)
        .then(function (d) {
          applyEpisodeData(d, id);
          return null;
        })
        .catch(function () {})
        .finally(function () { S.switching = false; });
    }

    global.addEventListener('popstate', function () {
      // App Shell navigatsiyani o'zi boshqaradi; u qism o'zgarganini
      // `wc:watchpop` orqali yuboradi.
      if (global.WCApp && global.WCApp.isEnabled && global.WCApp.isEnabled()) return;
      onWatchPop();
    });
    document.addEventListener('wc:watchpop', onWatchPop);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  /* ---- TV (pult) uchun: tv-watch.js shu amallarni chaqiradi ---------------- */
  function fireState() {
    try { document.dispatchEvent(new CustomEvent('wc:watchState')); } catch (e) {}
  }

  /** Saqlanganlarga qo'shish / olib tashlash (aniq holat bilan). */
  function tvToggleSaved() {
    if (!isLoggedIn()) { needLogin(); return Promise.resolve(!!D.in_watchlist); }
    var want = !D.in_watchlist;
    return fetch(withMeQS(base + '/api/watchlist.php'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      credentials: 'same-origin',
      body: 'id=' + encodeURIComponent(D.id) + '&in_watchlist=' + (want ? '1' : '0')
    }).then(function (raw) {
      // 401: server tanimadi - amal mahalliy bajariladi.
      if (raw.status === 401) return { success: true, in_watchlist: want };
      return raw.json();
    }).then(function (r) {
      if (r.success === false) throw new Error(r.message || 'Xato');
      D.in_watchlist = !!r.in_watchlist;
      var w = el('actWatchlist');
      if (w) w.classList.toggle('on', D.in_watchlist);
      mirrorLib('saved', D.in_watchlist);
      fireState();
      return D.in_watchlist;
    });
  }

  /** "Keyinroq ko'rish" ro'yxati (shu brauzerda saqlanadi). */
  function tvToggleLater() {
    var lib = global.WCLib;
    if (!lib) return false;
    var on = lib.toggle('later', libItem());
    fireState();
    return on;
  }

  // Boshqa modullar (sinovlar, konsol) uchun.
  global.Watch = {
    state: S,
    mountPlayer: mountPlayer,
    renderSide: renderSide,
    loadMoreRelated: loadMoreRelated,
    filterEpisodes: filterEpisodes,
    switchEpisode: switchEpisode,
    tv: {
      toggleSaved: tvToggleSaved,
      toggleLater: tvToggleLater
    }
  };
})(window);
