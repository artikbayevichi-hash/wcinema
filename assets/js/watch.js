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
    durSaved: {}
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
    b.className = 'reels-toast' + (kind ? ' ' + kind : '');
    b.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { b.hidden = true; }, 2800);
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
      global.TgStream.prefetch({ channel: channel, post: post });
    } catch (err) { /* jim: oldindan yuklash ixtiyoriy qulaylik */ }
  }

  /** Joriy qismdan KEYINGISINI tayyorlaydi (oxirgi qismda hech narsa qilmaydi). */
  function prefetchNext() {
    var i = epIndex(S.selectedId);
    if (i < 0) return;
    prefetchEpisode(S.episodes[i + 1] || null);
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

  function mountPlayer() {
    var host = el('watchPlayer');
    if (!host) return;

    // Eski player'ni to'liq tozalaymiz - aks holda eski `<video>` oqishda
    // davom etadi va Telegram klienti ikki barobar yuklanadi.
    try { if (global.UDP) global.UDP.destroyAll(); } catch (e) {}
    try { if (global.TgStream) global.TgStream.stop(); } catch (e) {}
    host.innerHTML = '';

    var pb = S.playback || {};
    var type = pb.type || 'none';
    var cfg = udpConfig();

    if (type === 'direct' || type === 'file' || type === 'hls') {
      var poster = pb.poster ? ' poster="' + esc(pb.poster) + '"' : '';
      var vattrs = '';
      if (type === 'hls') {
        var sep = String(pb.url || '').indexOf('?') !== -1 ? '&' : '?';
        vattrs = ' data-hls-pending="1" data-hls-refresh="'
          + esc(pb.url + sep + 'json=1') + '"';
      } else if (pb.url) {
        vattrs = ' src="' + esc(pb.url) + '"';
      }
      host.innerHTML =
        '<div class="player-wrap has-video-container">'
        + '<div class="udp-player" data-udp data-udp-config="' + udpAttr(cfg) + '">'
        + '<video playsinline preload="auto"' + poster + vattrs + '></video>'
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
      // Video SHU KONTEYNERDA ochiladi - t.me ga o'tmaydi. `tg-stream.js`
      // o'z `<video>` sini ichiga qo'yadi (GramJS + Service Worker).
      //
      // `TgStream` yo'q bo'lsa (skript yuklanmagan / bloklangan) xatoga
      // tushmaslik kerak - aks holda butun sahifa yarim chiziq qoladi.
      if (!global.TgStream || typeof global.TgStream.mount !== 'function') {
        host.innerHTML = '<div class="player-wrap no-video">'
          + '<div class="nv-msg">Telegram moduli yuklanmadi. Sahifani yangilang.</div>'
          + '</div>';
        return;
      }
      var m = document.createElement('div');
      m.className = 'watch-tg';
      host.appendChild(m);
      var e = curEp();
      global.TgStream.mount(m, {
        channel: pb.channel || '',
        post:    Number(pb.post) || 0,
        url:     pb.url || '',
        deep:    pb.deep || '',
        poster:  pb.poster || '',
        cfg:     cfg,
        epLabel: e ? (e.season + '-fasl ' + e.number + '-qism') : '',
        // Player tayyor bo'lgach KEYINGI qismni oldindan tayyorlaymiz:
        // foydalanuvchi shu paytda joriy qismni ko'rayotgan bo'ladi, demak
        // tarmoq bo'sh - yuklash uning hisobiga tez ketadi.
        onReady: function () {
          wireVideo(m.querySelector('video'));
          prefetchNext();
        }
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
    var watched = 0, lastT = 0;

    v.addEventListener('play', function () {
      if (v.currentTime) lastT = v.currentTime;
    }, true);

    v.addEventListener('timeupdate', function () {
      var t = v.currentTime || 0;
      var dt = t - lastT;
      lastT = t;
      // Seek (sakrash) hisobga olinmaydi - faqat haqiqiy ko'rish.
      if (dt > 0 && dt < 5) watched += dt;
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
  }

  function countView() {
    if (S.viewed || !D.id) return;
    S.viewed = true;
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
    if (!W.loggedIn || !v) return;
    if (!v.duration || !isFinite(v.duration)) return;
    fetch(base + '/api/progress.php', {
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
      parts.push('<span class="watch-chip">\u{1F4E5} '
        + (views > 0 ? fmtViews(views) + ' ko‘rildi' : 'Yangi') + '</span>');
      var ago = fmtAgo(D.added_at || D.created_at);
      if (ago) parts.push('<span>' + esc(ago) + '</span>');
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
    var d = el('watchDesc');
    if (!d) return;
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
  function withMeQS(path) {
    var m = '';
    try { m = localStorage.getItem('wc_tg_me_v1') || ''; } catch (e) {}
    if (!m) return path;
    return path + (path.indexOf('?') >= 0 ? '&' : '?') + 'tg_me=' + encodeURIComponent(m);
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

  function renderActions() {
    var box = el('watchActions');
    if (!box) return;
    var likes = Number(D.likes) || 0;
    var dislikes = Number(D.dislikes) || 0;

    // Yoqdi | Yoqmadi - chap navigatsiya uslubidagi ikkita tugma.
    //
    // DIQQAT - `.watch-act-vote-n` (SON) boshqa tugmalardan ataylab
    // ajratilgan: tor ekranda CSS matnlarni yashiradi, lekin son har
    // doim ko'rinib turadi (YouTube'da ham "3,9 ming" o'chirilmaydi).
    var vote = '<div class="watch-vote">'
      + '<button type="button" class="watch-act watch-act-vote' + (D.has_liked ? ' on' : '') + '"'
      +     ' id="actLike" title="Yoqdi" aria-label="Yoqdi">'
      +     '👍 <span class="watch-act-vote-n" id="actLikeN">' + esc(voteTxt(likes, 'Yoqdi')) + '</span></button>'
      + '<button type="button" class="watch-act watch-act-vote watch-act-vote-d' + (D.has_disliked ? ' on' : '') + '"'
      +     ' id="actDislike" title="Yoqmadi" aria-label="Yoqmadi">'
      +     '👎 <span class="watch-act-vote-n" id="actDislikeN">' + esc(voteTxt(dislikes, 'Yoqmadi')) + '</span></button>'
      + '</div>';

    // 📚 - ustida MENYU turadi (`data-go` = chap navigatsiyadagi bo'limga).
    var save = '<span class="watch-act-wrap">'
      + '<button type="button" class="watch-act" id="actWatchlist" title="Kutubxonaga qo\'shish" aria-label="Kutubxona">'
      +   '📚 <span class="watch-act-t">Kutubxona</span></button>'
      + '<div class="watch-menu" id="actSaveMenu" hidden>'
      +   '<button type="button" class="watch-menu-item" data-go="later">'
      +     '<span class="watch-menu-ico">&#128339;</span>'
      +     '<span class="watch-menu-lab">Keyinroq ko‘rish</span></button>'
      +   '<button type="button" class="watch-menu-item" data-go="save">'
      +     '<span class="watch-menu-ico">&#128278;</span>'
      +     '<span class="watch-menu-lab">Saqlash</span></button>'
      + '</div></span>';

    // Qolgan tugmalardagi matnlar `.watch-act-t` - 1180px dan kichikda
    // CSS ularni yashiradi va tugma faqat ikonkaga aylanadi.
    box.innerHTML = vote
      + save
      + '<button type="button" class="watch-act" id="actShare" title="Ulashish" aria-label="Ulashish">'
      +   '🔗 <span class="watch-act-t">Ulashish</span></button>'
      + (S.sideEpisodes && S.episodes.length > 1
        ? '<button type="button" class="watch-act" id="actAllEps" title="Qismlar ro\'yxati" aria-label="Qismlar">'
          + '📋 <span class="watch-act-t">Qismlar</span></button>'
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
      // Sonlar ANIMATSIYA bilan 1 dan boshlab o'sib/tushib boradi.
      animCount(el('actLikeN'), oldL, D.likes, function (n) { return voteTxt(n, 'Yoqdi'); });
      animCount(el('actDislikeN'), oldD, D.dislikes, function (n) { return voteTxt(n, 'Yoqmadi'); });
    }

    function bindVote(btnId, type) {
      var b = el(btnId);
      if (!b) return;
      b.onclick = function () {
        if (!W.loggedIn) { needLogin(); return; }
        b.classList.add('busy');
        fetch(base + '/api/like.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          credentials: 'same-origin',
          body: 'id=' + encodeURIComponent(D.id)
                + '&type=' + encodeURIComponent(type)
        }).then(function (raw) {
          // Sessiya muddati o'tgan - javob 401: login oynasiga yo'naltiramiz.
          if (raw.status === 401) { needLogin(); return null; }
          return raw.json();
        }).then(function (r) {
          if (!r) return;
          if (r.success === false) throw new Error(r.message || 'Xato');
          voteSync(r);
        }).catch(function (err) {
          toast(err.message || 'Xatolik');
        }).finally(function () { b.classList.remove('busy'); });
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
      return fetch(base + '/api/watchlist.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        credentials: 'same-origin',
        body: 'id=' + encodeURIComponent(D.id)
      }).then(function (raw) {
        // Sessiya muddati o'tgan - javob 401: login oynasiga yo'naltiramiz.
        if (raw.status === 401) { needLogin(); return null; }
        return raw.json();
      }).then(function (r) {
        if (!r) return false;
        if (r.success === false) throw new Error(r.message || 'Xato');
        D.in_watchlist = !!r.in_watchlist;
        if (w) w.classList.toggle('on', D.in_watchlist);
        return D.in_watchlist;
      });
    }

    var sm = el('actSaveMenu');
    if (sm) {
      sm.onclick = function (ev) {
        ev.stopPropagation();
        var it = ev.target.closest && ev.target.closest('[data-go]');
        if (!it) return;
        if (!W.loggedIn) { needLogin(); closeSaveMenu(); return; }
        it.classList.add('busy');
        ensureSaved().then(function () {
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

  function sendToContact(id, name) {
    // DIQQAT: `window.open(..., '_blank', 'noopener')` CHROMEDA `null`
    // qaytaradi (opener uzilganligi sababli). Bu esa bizda "ochilmadi"
    // deb talqin qilinib, sahifa O'ZI ham chatga ketib qolardi —
    // natijada ikkita ochilardi. Shuning uchun `noopener` ishlatilmaydi,
    // `opener` esa keyin o'zimiz uzamiz.
    var url = base + '/chat.php?u=' + encodeURIComponent(id);
    var win = null;
    try { win = window.open(url, '_blank'); } catch (e) { win = null; }
    if (win) { try { win.opener = null; } catch (e) {} }
    copyText(shareUrl()).then(function () {
      toast('\u{1F517} Havola nusxalandi — ' + (name ? name + ' bilan ' : '') + 'chatda yuboring');
    }).catch(function () {
      toast('Havolani nusxalab bo‘lmadi: ' + shareUrl());
    });
    if (win) closeShare();
    else location.href = url;                  // popup bloklangan bo'lsa
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
    return '<img src="' + esc(c.poster) + '" alt="" loading="lazy" referrerpolicy="no-referrer"'
      + ' onerror="this.remove()">' + fb;
  }

  function epRow(e) {
    var on = Number(e.id) === Number(S.selectedId);
    var meta = [];
    if (e.duration) meta.push(fmtTime(e.duration));
    if (e.title) meta.push(esc(e.title));
    if (on) meta.push('<span class="watch-ep-seen">&#9654; Hozir</span>');
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

  /* Yon paneldagi ixchak "tavsiya qatori" - `watch.php?c=ID`
     havolasidagi <a>. Karta uslublari `.watch-rec*` (watch.css). */
  function recRow(c) {
    var meta = [];
    meta.push(Number(c.views) > 0 ? fmtViews(c.views) + ' ko‘rildi' : 'Yangi');
    var ago = fmtAgo(c.added_at || c.created_at);
    if (ago) meta.push(ago);
    return '<a class="watch-rec" href="' + esc(base + '/watch.php?c=' + c.id) + '">'
      + '<span class="watch-rec-thumb">'
      +   thumbInner(c)
      +   (Number(c.duration) > 0 ? '<span class="watch-ep-dur">' + fmtTime(c.duration) + '</span>' : '')
      + '</span>'
      + '<span class="watch-rec-text">'
      +   '<span class="watch-rec-ttl">' + esc(c.title) + '</span>'
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

    // Kalit = episodes.id (reels moduli esa reels.id ishlatadi).
    openComments();

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
    return global.TGComments.open({
      id: key,
      topic_id: 0,
      title: label,
      comments: 0
    }).catch(function () { /* modul o'zi ko'rsatadi */ });
  }

  // ================================================================== CHAT
  /* DIQQAT: bu sahifada chat YO'Q. `tg-chat.js` ham yuklanmaydi
     (watch.php dan skript va `chat.css` olib tashlangan), shuning uchun
     `initChat`/`TGChat` kodini ham olib tashladik. Chat alohida `chat.php`
     sahifasida (pastki nav markazidagi "Chat" tugmasi). */

  // ============================================================ QISM ALMASH
  function switchEpisode(epId) {
    epId = Number(epId) || 0;
    if (S.switching || !epId) return;
    if (epId === Number(S.selectedId)) return;
    S.switching = true;

    // `#t=` reels klipining nuqtasi edi - boshqa qismga o'tganda u
    // ma'nosiz (yangisida 95-soniyasi boshqa joy). Faqat joriy video uchun.
    S.hashStart = 0;

    // Chuqur havola darhol yangilanadi - "Ulashish" va "orqaga" to'g'ri ishlaydi.
    try {
      history.pushState({ ep: epId }, '', watchUrl(epId).replace(base, ''));
    } catch (e) {}

    // MUHIM: Telegram hujjatini `content.php` SO'ROVI bilan PARALLEL tayyorlaymiz.
    //
    // Oldingi ketma-ket oqim shunday edi:
    //   content.php (tarmoq)  ->  mount()  ->  findDoc (Telegram)  ->  probe (Telegram)
    // Ya'ni ikki bosqich tarmoqda BIR-BIRINI kutardi. Endi `content.php`
    // javotlanayotgan paytda `findDoc` + `probe` allaqachin yuguradi va
    // `mount()` ularni KESHDAN ozi oladi (yoki jarayonda bo'lsa kutadi) -
    // natijada ochilish sekinligi ikki barobar kamayadi.
    //
    // `S.episodes` hozirgidan YANGI ro'yxatni ko'rsatadi, shuning uchun
    // eski kalitni `cancelPrefetch()` bilan avval tozalash shart emas:
    // `tg-stream.js` bitta vaqtda bittasini saqlaydi va `mount()` o'z
    // kalitini topsa, o'sha promise'ni kutadi.
    prefetchEpisode(ep(epId));

    api('/api/content.php?id=' + encodeURIComponent(D.id) + '&episode=' + epId)
      .then(function (d) {
        S.playback  = d.playback || S.playback;
        S.resumeAt  = (d.progress && d.progress.position > 5) ? d.progress.position : 0;
        if (d.episodes && d.episodes.length) S.episodes = d.episodes;
        // Yangi qismlar ro'yxatida fasl filtrisi mos kelmasligi mumkin -
        // "Barcha" holatiga qaytaramiz.
        S.epSeason = 0;
        S.selectedId = epId;
        renderHead();
        renderSide();
        mountPlayer();
        return openComments();
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
        try { history.replaceState({}, '', watchUrl(S.selectedId).replace(base, '')); } catch (e) {}
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

  // ============================================================ ISHGA TUSHISH
  function boot() {
    // Agar progress allaqachon ma'lum bo'lsa (keyingi sahifaga o'tish),
    // bo'sh qism 0 dan qayta o'ynamasligi kerak.
    S.resumeAt = (D.progress && D.progress.position > 5) ? D.progress.position : 0;

    renderHead();
    renderSide();
    mountPlayer();
    bindSideClicks();
    initEpFind();
    bindEpMobileUI();
    initRecObserver();
    initComments();

    // Qism almashtirilganda skroll yuqoriga qaytadi.
    global.addEventListener('popstate', function () {
      var m = /[?&]e=(\d+)/.exec(location.search);
      var id = m ? Number(m[1]) : 0;
      if (id && id !== Number(S.selectedId)) {
        // `pushState` bilan o'zgartirganimiz uchun `switchEpisode` ham
        // `pushState` qilardi - bu yerda faqat `replace` qilamiz.
        S.switching = true;
        api('/api/content.php?id=' + encodeURIComponent(D.id) + '&episode=' + id)
          .then(function (d) {
            S.playback = d.playback || S.playback;
            if (d.episodes && d.episodes.length) S.episodes = d.episodes;
            S.epSeason = 0;
            S.selectedId = id;
            renderHead(); renderSide(); mountPlayer();
            return openComments();
          })
          .catch(function () {})
          .finally(function () { S.switching = false; });
      } else {
        location.reload();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Boshqa modullar (sinovlar, konsol) uchun.
  global.Watch = {
    state: S,
    mountPlayer: mountPlayer,
    renderSide: renderSide,
    loadMoreRelated: loadMoreRelated,
    filterEpisodes: filterEpisodes,
    switchEpisode: switchEpisode
  };
})(window);
