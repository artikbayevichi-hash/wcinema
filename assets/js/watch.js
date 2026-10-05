/* ==========================================================================
   watch.js - YouTube uslubidagi ko'rish sahifasi
   ==========================================================================
   Vazifa:
     1) Video player (direct/file/hls -> `.udp-player`, telegram ->
        `TgStream.mount()`, embed -> `<iframe>`).
     2) Qismlar ro'yxati (o'ng panelda, VERTIKAL skroll). Agar qismlar
        bo'lmasa (kino/multfilm) - o'rniga aralash tavsiyalar.
     3) Izohlar - `tg-comments.js` moduli (stiker/emoji/GIF/rasm/@ + like,
        reply, o'chirish). Faqat mavzu endpointi boshqa (`api/video-topic.php`).
     4) Chat - `tg-chat.js` moduli, kategoriyaga mos xona avtomatik ochiladi.
     5) Pastda aralash tavsiyalar qatori.

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
    genres:    W.genres || [],
    // Yon panelda nima ko'rinadi: qismlar (true) yoki tavsiyalar (false).
    // `hasPlaylist` serverda hisoblanadi (film -> tavsiyalar, anime -> qismlar).
    sideEpisodes: !!W.hasPlaylist,
    resumeAt: 0,
    switching: false,
    viewed: false,
    durSaved: {}
  };

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

  function watchUrl(epId) {
    return base + '/watch.php?c=' + D.id + (epId ? '&e=' + epId : '');
  }

  // ==================================================================== VIDEO
  /** `player.js` ga `data-udp-config` uchun JSON (attribute ichida). */
  function udpConfig() {
    var cfg = {
      autoplay: true,
      resumeAt: Math.floor(S.resumeAt) || 0,
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
        onReady: function () { wireVideo(m.querySelector('video')); }
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

    v.addEventListener('loadedmetadata', function () { saveDuration(v); });
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
  function renderHead() {
    var t = el('watchTitle');
    var e = curEp();
    if (t) {
      t.textContent = e && S.episodes.length > 1
        ? D.title + ' — ' + e.number + '-qism'
        : D.title;
    }

    var sub = el('watchSub');
    if (sub) {
      var views = Number(D.views) || 0;
      var parts = [];
      parts.push('<span class="watch-chip">\u{1F4E5} '
        + (views > 0 ? fmtViews(views) + ' ko‘rildi' : 'Yangi') + '</span>');
      if (e && e.number) {
        parts.push('<span class="watch-chip">\u{1F3A9} ' + esc(e.season)
          + '-fasl · ' + esc(e.number) + '-qism</span>');
      }
      if (D.rating) parts.push('<span class="watch-chip">★ ' + Number(D.rating).toFixed(1) + '</span>');
      if (D.year)    parts.push('<span class="watch-chip">' + esc(D.year) + '</span>');
      if (D.quality) parts.push('<span class="watch-chip">' + esc(D.quality) + '</span>');
      var ago = fmtAgo(D.added_at || D.created_at);
      if (ago) parts.push('<span>' + esc(ago) + '</span>');
      sub.innerHTML = parts.join('');
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

  function renderActions() {
    var box = el('watchActions');
    if (!box) return;
    var likes = Number(D.likes) || 0;
    box.innerHTML =
      '<button type="button" class="watch-act" id="actLike" title="Yoqdi">'
      + '\u{1F44D} <span>' + (likes > 0 ? fmtViews(likes) : 'Yoqdi') + '</span></button>'
      + '<button type="button" class="watch-act" id="actWatchlist" title="Kutubxonaga qo‘shish">'
      + '\u{1F4DA} <span>Kutubxona</span></button>'
      + '<button type="button" class="watch-act" id="actShare">'
      + '\u{1F517} <span>Ulashish</span></button>'
      + (S.sideEpisodes && S.episodes.length > 1
        ? '<button type="button" class="watch-act" id="actAllEps">'
          + '\u{1F4CF} <span>Qismlar</span></button>'
        : '');

    // --- Like (YouTube uslubidagi "👍 Yoqdi")
    var lk = el('actLike');
    if (lk) {
      lk.classList.toggle('on', !!D.has_liked);
      lk.onclick = function () {
        if (!W.loggedIn) { toast('Yoqish uchun kiring'); return; }
        lk.classList.add('busy');
        fetch(base + '/api/like.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          credentials: 'same-origin',
          body: 'id=' + encodeURIComponent(D.id)
        }).then(function (r) { return r.json(); }).then(function (r) {
          if (r.success === false) throw new Error(r.message || 'Xato');
          D.has_liked = !!r.liked;
          D.likes = Number(r.likes) || 0;
          lk.classList.toggle('on', D.has_liked);
          lk.querySelector('span').textContent = D.likes > 0 ? fmtViews(D.likes) : 'Yoqdi';
        }).catch(function (err) {
          toast(err.message || 'Xatolik');
        }).finally(function () { lk.classList.remove('busy'); });
      };
    }

    var w = el('actWatchlist');
    if (w) {
      w.classList.toggle('on', !!D.in_watchlist);
      w.onclick = function () {
        if (!W.loggedIn) { toast('Kutubxonaga qo‘shish uchun kiring'); return; }
        w.classList.add('busy');
        fetch(base + '/api/watchlist.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          credentials: 'same-origin',
          body: 'id=' + encodeURIComponent(D.id)
        }).then(function (r) { return r.json(); }).then(function (r) {
          if (r.success === false) throw new Error(r.message || 'Xato');
          D.in_watchlist = !!r.in_watchlist;
          w.classList.toggle('on', D.in_watchlist);
          toast(D.in_watchlist ? 'Kutubxonaga qo‘shildi' : 'Kutubxonadan olib tashlandi');
        }).catch(function (err) {
          toast(err.message || 'Xatolik');
        }).finally(function () { w.classList.remove('busy'); });
      };
    }

    var sh = el('actShare');
    if (sh) {
      sh.onclick = function () {
        var shareUrl = watchUrl(S.selectedId || '');
        if (navigator.share) {
          navigator.share({ title: D.title, url: shareUrl }).catch(function () {});
          return;
        }
        if (navigator.clipboard) {
          navigator.clipboard.writeText(shareUrl)
            .then(function () { toast('\u{1F517} Havola nusxalandi'); })
            .catch(function () { toast('Havolani nusxalab bo‘lmadi'); });
          return;
        }
        toast(shareUrl);
      };
    }

    var ae = el('actAllEps');
    if (ae) {
      ae.onclick = function () {
        S.sideEpisodes = true;
        renderSide();
        var box2 = el('watchSide');
        if (box2 && box2.scrollIntoView) box2.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
    }
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

  function renderSide() {
    var title = el('watchSideTitle');
    var count = el('watchSideCount');
    var list  = el('watchSideList');
    if (!list) return;

    if (S.sideEpisodes) {
      if (title) title.textContent = 'Qismlar';
      if (count) count.textContent = S.episodes.length + ' ta';
      list.innerHTML = S.episodes.length
        ? S.episodes.map(epRow).join('')
        : '<div class="watch-side-empty">Qismlar hali qo‘shilmagan</div>';
    } else {
      if (title) title.textContent = 'Tavsiyalar';
      if (count) count.textContent = 'kino · anime · multfilm';
      list.innerHTML = S.related.length
        ? S.related.map(recRow).join('')
        : '<div class="watch-side-empty">Hozircha tavsiya yo‘q</div>';
    }
  }

  // ===================================================== PASTKI TAVSIYALAR
  function cardHTML(c) {
    var poster = c.poster
      ? '<img src="' + esc(c.poster) + '" alt="" loading="lazy" referrerpolicy="no-referrer"'
        + ' onerror="this.remove()">'
      : '';
    var fallback = poster ? '' :
      '<div class="poster-fallback">' + catEmoji(c.category_slug, c.category) + '</div>';

    var badges = [];
    if (c.is_series) {
      badges.push('<span class="badge badge-series">'
        + esc(c.episodes || c.total_episodes || 0) + ' QISM</span>');
    }
    if (c.is_premium) badges.push('<span class="badge badge-premium">\u{1F48E}</span>');

    var dur = Number(c.duration) > 0
      ? '<span class="yt-dur">' + fmtTime(c.duration) + '</span>' : '';

    var meta = [];
    meta.push(Number(c.views) > 0 ? fmtViews(c.views) + ' ko‘rildi' : 'Yangi');
    var ago = fmtAgo(c.added_at || c.created_at);
    if (ago) meta.push(ago);

    var sub = [];
    if (c.category) sub.push(esc(c.category));
    if (c.year) sub.push(esc(c.year));
    if (c.rating) sub.push('<span class="rating">★ ' + Number(c.rating).toFixed(1) + '</span>');

    return '<a class="card yt-card" href="' + esc(base + '/watch.php?c=' + c.id) + '">'
      + '<span class="yt-thumb">' + poster + fallback + badges.join('') + dur + '</span>'
      + '<span class="yt-body">'
      +   '<span class="yt-av">' + catEmoji(c.category_slug, c.category) + '</span>'
      +   '<span class="yt-text">'
      +     '<span class="yt-title">' + esc(c.title) + '</span>'
      +     '<span class="yt-meta">' + meta.join(' · ') + '</span>'
      +     (sub.length ? '<span class="yt-sub">' + sub.join(' · ') + '</span>' : '')
      +   '</span>'
      + '</span></a>';
  }

  function renderRelated() {
    var box = el('watchRelated');
    var row = el('watchRelatedRow');
    if (!box || !row) return;
    if (!S.related.length) { box.hidden = true; return; }
    box.hidden = false;
    row.innerHTML = S.related.map(cardHTML).join('');
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
  /**
   * Xonalar async yuklanadi (`api/chat.php?action=rooms`). Videoning
   * kategoriyasiga MOS xonani avtomatik ochamiz: kino -> 🎬, anime -> 🌸,
   * multfilm -> 🧸, boshqalar -> 💬 Hammaga.
   */
  function initChat() {
    if (!global.TGChat) return;
    var hint = W.roomHint || 'general';
    var tries = 0;

    (function wait() {
      var rooms = (global.TGChat._state && global.TGChat._state.rooms) || [];
      if (rooms.length) {
        var pick = null;
        for (var i = 0; i < rooms.length; i++) {
          if (rooms[i].key === hint) { pick = rooms[i]; break; }
        }
        global.TGChat.openRoom(pick || rooms[0]);
        return;
      }
      if (tries++ < 40) setTimeout(wait, 150);
    })();
  }

  // ============================================================ QISM ALMASH
  function switchEpisode(epId) {
    epId = Number(epId) || 0;
    if (S.switching || !epId) return;
    if (epId === Number(S.selectedId)) return;
    S.switching = true;

    // Chuqur havola darhol yangilanadi - "Ulashish" va "orqaga" to'g'ri ishlaydi.
    try {
      history.pushState({ ep: epId }, '', watchUrl(epId).replace(base, ''));
    } catch (e) {}

    api('/api/content.php?id=' + encodeURIComponent(D.id) + '&episode=' + epId)
      .then(function (d) {
        S.playback  = d.playback || S.playback;
        S.resumeAt  = (d.progress && d.progress.position > 5) ? d.progress.position : 0;
        if (d.episodes && d.episodes.length) S.episodes = d.episodes;
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
  }

  // ============================================================ ISHGA TUSHISH
  function boot() {
    // Agar progress allaqachon ma'lum bo'lsa (keyingi sahifaga o'tish),
    // bo'sh qism 0 dan qayta o'ynamasligi kerak.
    S.resumeAt = (D.progress && D.progress.position > 5) ? D.progress.position : 0;

    renderHead();
    renderSide();
    renderRelated();
    mountPlayer();
    bindSideClicks();
    initComments();
    initChat();

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
    renderRelated: renderRelated,
    switchEpisode: switchEpisode
  };
})(window);
