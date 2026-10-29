/* ==========================================================================
   UzDub player - `assets/player/player.js`
   ==========================================================================
   Bitta yengil, freymvorksiz player:
     · MP4 / WebM / HLS (hls.js faqat .m3u8 uchun lazy yuklanadi)
     · Telegram oqimi (`tg-stream.js` yaratgan <video> ga "attach" bo'ladi)
     · Katta ekran (fullscreen), rasm-ichida-rasm (PiP)
     · Klaviatura, mobil qo'l harakatlari, progressni saqlash
     · Tezlik / sifat menyulari, ovoz va tezlikni eslab qolish
     · Keyingi qismga avtomatik o'tish + bekor qilish mumkin bo'lgan toast

   Integratsiya:
     window.UzPlayer.configure({...})  - joriy kontent/qism konteksti
     window.UzPlayer.mount(host, media) - yangi <video> yaratib joylashtiradi
     window.UzPlayer.attach(video)      - mavjud <video> ni boyitadi
     window.UDP.initAll() / destroyAll() - eski `tg-stream.js` bilan moslik
   ========================================================================== */
(function (global) {
  'use strict';

  var doc = global.document;
  var HLS_CDN = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.20/dist/hls.min.js';

  var SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

  var ICONS = {
    play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.12v13.76a1 1 0 0 0 1.52.85l10.4-6.88a1 1 0 0 0 0-1.7L9.52 4.27A1 1 0 0 0 8 5.12z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/></svg>',
    rew: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.6 12a7.6 7.6 0 1 0 2.3-5.4"/><path d="M4.4 3.8v4.6h4.6"/><text x="12" y="15.9" text-anchor="middle" font-size="8.6" font-weight="700" font-family="Arial, Helvetica, sans-serif" fill="currentColor" stroke="none">10</text></svg>',
    fwd: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19.4 12a7.6 7.6 0 1 1-2.3-5.4"/><path d="M19.6 3.8v4.6H15"/><text x="12" y="15.9" text-anchor="middle" font-size="8.6" font-weight="700" font-family="Arial, Helvetica, sans-serif" fill="currentColor" stroke="none">10</text></svg>',
    vol: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5v5h3.4l4.6 4V5.5L7.4 9.5z" fill="currentColor" stroke="none"/><path d="M15.5 8.8a4.6 4.6 0 0 1 0 6.4"/><path d="M18.2 6.2a8.2 8.2 0 0 1 0 11.6"/></svg>',
    mute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5v5h3.4l4.6 4V5.5L7.4 9.5z" fill="currentColor" stroke="none"/><path d="m16 9.5 5 5M21 9.5l-5 5"/></svg>',
    pip: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M5 4.5h14a2.5 2.5 0 0 1 2.5 2.5v10a2.5 2.5 0 0 1-2.5 2.5H5A2.5 2.5 0 0 1 2.5 17V7A2.5 2.5 0 0 1 5 4.5zm0 2a.5.5 0 0 0-.5.5v10a.5.5 0 0 0 .5.5h14a.5.5 0 0 0 .5-.5V7a.5.5 0 0 0-.5-.5H5z"/><rect x="11.5" y="10.8" width="7" height="5" rx="1.2"/></svg>',
    full: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21 11V3h-8l3.29 3.29-10 10L3 13v8h8l-3.29-3.29 10-10z"/></svg>',
    exitFull: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M22 3.41 16.71 8.7 20 12h-8V4l3.29 3.29L20.59 2 22 3.41zM3.41 22l5.29-5.29L12 20v-8H4l3.29 3.29L2 20.59 3.41 22z"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.6 2.8 20.2h18.4L12 3.6z"/><path d="M12 9.2v4.6M12 17h.01"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4.5" y="10" width="15" height="10" rx="2.2"/><path d="M8 10V7.4a4 4 0 0 1 8 0V10"/></svg>'
  };

  // ------------------------------------------------------------- kontekst
  /* Anibla uslubidagi ikonkalar (skrinshotdan o'lchangan shakllar). Yuqoridagi ICONS ni bosib o'tadi. */
  ICONS.play = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round" aria-hidden="true"><path d="M8 5v14l11.2-7z"/></svg>';
  ICONS.pause = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="4.2" y="3.6" width="6" height="16.8" rx="2"/><rect x="13.8" y="3.6" width="6" height="16.8" rx="2"/></svg>';
  ICONS.rew = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4.65 4.65A10.4 10.4 0 0 1 20.8 17.6"/><path d="M2.2 7.1 3.2 2.3 7 6.1z" fill="currentColor" stroke-width="1" stroke-linejoin="round"/><text x="7.8" y="21.4" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="9.2" font-weight="600" fill="currentColor" stroke="none">10</text></svg>';
  ICONS.fwd = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M19.35 4.65A10.4 10.4 0 0 0 3.2 17.6"/><path d="M21.8 7.1 20.8 2.3 17 6.1z" fill="currentColor" stroke-width="1" stroke-linejoin="round"/><text x="16.2" y="21.4" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="9.2" font-weight="600" fill="currentColor" stroke="none">10</text></svg>';
  ICONS.vol = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M2 9.1a1 1 0 0 1 1-1h3.8l4.1-3.7c.7-.6 1.4-.2 1.4.6v14c0 .8-.7 1.2-1.4.6L6.8 15.9H3a1 1 0 0 1-1-1z"/><path d="M14.4 8.8a3.3 3.3 0 0 1 0 6.4M17.4 6.8a5.4 5.4 0 0 1 0 10.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  ICONS.mute = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M2 9.1a1 1 0 0 1 1-1h3.8l4.1-3.7c.7-.6 1.4-.2 1.4.6v14c0 .8-.7 1.2-1.4.6L6.8 15.9H3a1 1 0 0 1-1-1z"/><path d="M15.6 9.6l5 4.8M20.6 9.6l-5 4.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  ICONS.pip = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.2 10V8.6a3.3 3.3 0 0 0-3.3-3.3H6.3A3.3 3.3 0 0 0 3 8.6v7a3.3 3.3 0 0 0 3.3 3.3H9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M5.6 11.8 9.6 8.7v3.1z"/><rect x="11.4" y="13.4" width="9.6" height="6.6" rx="1.7"/></svg>';
  ICONS.full = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M3.8 3.8h7.7L3.8 11.5z"/><path d="M20.2 20.2h-7.7l7.7-7.7z"/></svg>';
  ICONS.exitFull = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M3.8 10.4 10.4 3.8v6.6z"/><path d="M13.6 13.6h6.6l-6.6 6.6z"/></svg>';

  var CFG = {
    contentId: 0,
    episodeId: 0,
    title: '',
    apiBase: '',
    loggedIn: false,
    autoplay: true,
    resumeAt: 0,
    next: null,
    onNext: null
  };

  var instances = [];
  var hlsPromise = null;

  function configure(partial) {
    if (!partial) return;
    Object.keys(partial).forEach(function (k) {
      if (Object.prototype.hasOwnProperty.call(partial, k)) CFG[k] = partial[k];
    });
  }

  // ------------------------------------------------------------- yordamchi
  function el(tag, cls, html) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    var p = function (n) { return n < 10 ? '0' + n : '' + n; };
    return h > 0 ? h + ':' + p(m) + ':' + p(s) : m + ':' + p(s);
  }

  function clamp(n, a, b) { return Math.min(b, Math.max(a, n)); }

  function lsGet(k) {
    try { return global.localStorage.getItem(k); } catch (e) { return null; }
  }
  function lsSet(k, v) {
    try { global.localStorage.setItem(k, String(v)); } catch (e) {}
  }
  function lsDel(k) {
    try { global.localStorage.removeItem(k); } catch (e) {}
  }

  function resumeKey() {
    if (!CFG.contentId) return '';
    return 'uzp:resume:' + CFG.contentId + ':' + (CFG.episodeId || 0);
  }

  function tgMeRaw() {
    var v = lsGet('wc_tg_me_v1');
    if (v) return v;
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

  function withMe(path) {
    var m = tgMeRaw();
    if (!m) return path;
    return path + (path.indexOf('?') >= 0 ? '&' : '?') + 'tg_me=' + encodeURIComponent(m);
  }

  function apiUrl(path) {
    if (!path) return '';
    if (/^https?:\/\//i.test(path)) return path;
    var base = CFG.apiBase || '';
    if (path.charAt(0) !== '/') path = '/' + path;
    return base + path;
  }

  // ---------------------------------------------------------- hls.js yuklash
  function loadHls(cb, fail) {
    if (global.Hls) { cb(global.Hls); return; }
    if (hlsPromise) { hlsPromise.then(cb, fail); return; }
    hlsPromise = new Promise(function (resolve, reject) {
      var s = doc.createElement('script');
      s.src = HLS_CDN;
      s.async = true;
      s.onload = function () { resolve(global.Hls); };
      s.onerror = function () { reject(new Error('hls.js yuklanmadi')); };
      doc.head.appendChild(s);
    });
    hlsPromise.then(cb, fail);
  }

  // ============================================================ INSTANCE
  function init(root, video, media, existing) {
    if (!root || !video) return null;
    if (root.getAttribute('data-uzp-ready') === '1') return null;
    root.setAttribute('data-uzp-ready', '1');
    root.classList.add('uzp');
    video.classList.add('uzp-video');
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.controls = false;
    video.preload = existing ? (video.getAttribute('preload') || 'auto') : (CFG.autoplay ? 'auto' : 'metadata');

    var inst = {
      root: root,
      video: video,
      media: media || {},
      hls: null,
      destroyed: false,
      resumeApplied: false,
      durationSaved: false,
      lastServerSave: 0,
      lastLocalSave: 0,
      hideTimer: null,
      toastTimer: null,
      clickTimer: null,
      lastTap: 0,
      lastTapX: 0,
      lastTouchAt: 0,
      dragging: false,
      menuOpen: false,
      listeners: []
    };

    // Eski `tg-stream` elementi: video allaqachon src bilan keladi.
    if (media && media.poster) video.setAttribute('poster', media.poster);

    buildUI(inst);
    bindVideo(inst);
    bindControls(inst);
    bindKeyboard(inst);
    restorePreferences(inst);

    // HLS bo'lsa, hls.js ni darhol (manba so'ralishidan oldin) yuklab olamiz.
    if (media && media.type === 'hls' && !global.Hls) { try { loadHls(function () {}, function () {}); } catch (e) {} }
    if (!existing) startMedia(inst, media);

    instances.push(inst);

    // Birinchi ko'rinish: boshqaruv paneli 2.5 s ko'rinib turadi.
    showControls(inst, true);
    setTimeout(function () {
      if (!inst.destroyed) scheduleHide(inst);
    }, 2500);

    return inst;
  }

  // ------------------------------------------------------------------ UI
  function buildUI(inst) {
    var root = inst.root;
    var v = inst.video;

    var loading = el('div', 'uzp-loading', '<span class="uzp-spinner" aria-hidden="true"></span>');
    loading.setAttribute('aria-label', 'Yuklanmoqda');
    loading.setAttribute('role', 'status');
    loading.setAttribute('aria-live', 'polite');

    var big = el('button', 'uzp-bigplay', ICONS.play);
    big.type = 'button';
    big.setAttribute('aria-label', 'O‘ynatish');

    var top = el('div', 'uzp-top',
      '<span class="uzp-top-title" data-top-title></span>'
      + '<span class="uzp-top-tag" data-top-tag hidden>AUTO</span>');

    var rippleL = el('div', 'uzp-ripple left', '<span>−10s</span>');
    var rippleR = el('div', 'uzp-ripple right', '<span>+10s</span>');

    var err = el('div', 'uzp-error',
      '<div class="uzp-error-ico">' + ICONS.warn + '</div>'
      + '<div class="uzp-error-t" data-err-t></div>'
      + '<button type="button" class="uzp-retry">Qayta urinish</button>');
    err.hidden = true;
    err.setAttribute('role', 'alert');

    var bar = el('div', 'uzp-bar');
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', 'Video boshqaruvi');
    bar.innerHTML =
        '<div class="uzp-seek" role="slider" tabindex="0" aria-label="Video vaqti"'
      + ' aria-valuemin="0" aria-valuemax="0" aria-valuenow="0" aria-valuetext="0:00">'
      +   '<div class="uzp-seek-track">'
      +     '<div class="uzp-seek-buf"></div>'
      +     '<div class="uzp-seek-play"></div>'
      +     '<div class="uzp-seek-thumb"></div>'
      +     '<div class="uzp-seek-tip"><span>0:00</span></div>'
      +   '</div>'
      + '</div>'
      + '<div class="uzp-row">'
      +   '<div class="uzp-row-l">'
      +     '<button type="button" class="uzp-btn uzp-play" data-act="play" aria-label="O‘ynatish">' + ICONS.play + '</button>'
      +     '<button type="button" class="uzp-btn uzp-skip" data-act="rew" aria-label="10 soniya orqaga">' + ICONS.rew + '</button>'
      +     '<button type="button" class="uzp-btn uzp-skip" data-act="fwd" aria-label="10 soniya oldinga">' + ICONS.fwd + '</button>'
      +     '<span class="uzp-time"><span data-cur>0:00</span></span>'
      +   '</div>'
      +   '<div class="uzp-row-r">'
      +     '<span class="uzp-time"><span data-dur>0:00</span></span>'
      +     '<div class="uzp-menu-wrap">'
      +       '<button type="button" class="uzp-btn uzp-pill" data-act="speed" aria-haspopup="menu" aria-expanded="false" aria-label="O‘ynatish tezligi"><span data-speed-lbl>1×</span></button>'
      +       '<div class="uzp-menu" data-menu="speed" role="menu" hidden>'
      +         '<div class="uzp-menu-h">Tezlik</div>'
      +         SPEEDS.map(function (s) {
                  return '<button type="button" class="uzp-menu-item' + (s === 1 ? ' on' : '') + '" role="menuitemradio" aria-checked="' + (s === 1 ? 'true' : 'false') + '" data-speed="' + s + '">' + s + '×</button>';
                }).join('')
      +       '</div>'
      +     '</div>'
      +     '<div class="uzp-menu-wrap uzp-select-quality">'
      +       '<button type="button" class="uzp-btn uzp-txt" data-act="quality" aria-haspopup="menu" aria-expanded="false" aria-label="Sifat"><span data-quality-lbl>Auto</span></button>'
      +       '<div class="uzp-menu" data-menu="quality" role="menu" hidden>'
      +         '<div class="uzp-menu-h">Sifat</div>'
      +         '<button type="button" class="uzp-menu-item on" role="menuitemradio" aria-checked="true" data-level="-1">Auto</button>'
      +       '</div>'
      +     '</div>'
      +     '<div class="uzp-vol">'
      +       '<button type="button" class="uzp-btn" data-act="mute" aria-label="Ovozni o‘chirish">' + ICONS.vol + '</button>'
      +       '<input class="uzp-vol-range" type="range" min="0" max="1" step="0.01" value="1" aria-label="Ovoz balandligi">'
      +     '</div>'
      +     '<button type="button" class="uzp-btn" data-act="pip" aria-label="Rasm ichida rasm">' + ICONS.pip + '</button>'
      +     '<button type="button" class="uzp-btn" data-act="full" aria-label="To‘liq ekran">' + ICONS.full + '</button>'
      +   '</div>'
      + '</div>';

    var frag = doc.createDocumentFragment();
    frag.appendChild(loading);
    frag.appendChild(big);
    frag.appendChild(top);
    frag.appendChild(rippleL);
    frag.appendChild(rippleR);
    frag.appendChild(err);
    frag.appendChild(bar);
    root.appendChild(frag);

    inst.ui = {
      loading: loading,
      big: big,
      top: top,
      topTitle: top.querySelector('[data-top-title]'),
      topTag: top.querySelector('[data-top-tag]'),
      err: err,
      errT: err.querySelector('[data-err-t]'),
      retry: err.querySelector('.uzp-retry'),
      bar: bar,
      seek: bar.querySelector('.uzp-seek'),
      seekTrack: bar.querySelector('.uzp-seek-track'),
      seekBuf: bar.querySelector('.uzp-seek-buf'),
      seekPlay: bar.querySelector('.uzp-seek-play'),
      seekThumb: bar.querySelector('.uzp-seek-thumb'),
      seekTip: bar.querySelector('.uzp-seek-tip'),
      seekTipT: bar.querySelector('.uzp-seek-tip span'),
      playBtn: bar.querySelector('[data-act="play"]'),
      cur: bar.querySelector('[data-cur]'),
      dur: bar.querySelector('[data-dur]'),
      speedBtn: bar.querySelector('[data-act="speed"]'),
      speedLbl: bar.querySelector('[data-speed-lbl]'),
      qualityBtn: bar.querySelector('[data-act="quality"]'),
      qualityLbl: bar.querySelector('[data-quality-lbl]'),
      speedMenu: bar.querySelector('[data-menu="speed"]'),
      qualityMenu: bar.querySelector('[data-menu="quality"]'),
      muteBtn: bar.querySelector('[data-act="mute"]'),
      volRange: bar.querySelector('.uzp-vol-range'),
      pipBtn: bar.querySelector('[data-act="pip"]'),
      fullBtn: bar.querySelector('[data-act="full"]'),
      rippleL: rippleL,
      rippleR: rippleR
    };

    if (CFG.title) inst.ui.topTitle.textContent = CFG.title;
    if (!v.requestPictureInPicture) inst.ui.pipBtn.style.display = 'none';

    // Sifat menyusida darhol "Auto" ko'rsatiladi (MP4 uchun ham).
    setQualityLabel(inst, 'Auto');
  }

  // -------------------------------------------------------------- video events
  function on(inst, target, ev, fn, opts) {
    target.addEventListener(ev, fn, opts);
    inst.listeners.push(function () { target.removeEventListener(ev, fn, opts); });
  }

  function bindVideo(inst) {
    var v = inst.video;
    var ui = inst.ui;

    on(inst, v, 'loadstart', function () { showLoading(inst); });
    on(inst, v, 'waiting', function () { showLoading(inst); });
    on(inst, v, 'stalled', function () { if (!v.paused) showLoading(inst); });
    on(inst, v, 'canplay', function () { hideLoading(inst); });
    on(inst, v, 'playing', function () {
      hideLoading(inst);
      inst.root.classList.remove('is-blocked');
      inst.root.classList.remove('is-paused');
      inst.root.classList.add('is-playing');
      syncPlayBtn(inst);
      dismissNext(inst);
      scheduleHide(inst);
    });
    on(inst, v, 'pause', function () {
      inst.root.classList.add('is-paused');
      inst.root.classList.remove('is-playing');
      syncPlayBtn(inst);
      showControls(inst, true);
      saveProgress(inst, true);
    });
    on(inst, v, 'play', function () {
      inst.root.classList.remove('is-blocked');
      syncPlayBtn(inst);
      showControls(inst, true);
    });
    on(inst, v, 'volumechange', function () { syncVolume(inst); });
    on(inst, v, 'ratechange', function () { syncSpeed(inst); });
    on(inst, v, 'durationchange', function () { syncDuration(inst); });
    on(inst, v, 'loadedmetadata', function () {
      syncDuration(inst);
      applyResume(inst);
      saveDuration(inst);
      if (CFG.autoplay) tryPlay(inst);
    });
    on(inst, v, 'timeupdate', function () {
      syncTime(inst);
      var now = Date.now();
      if (now - inst.lastLocalSave > 2500) {
        inst.lastLocalSave = now;
        saveLocal(inst);
      }
      if (now - inst.lastServerSave > 10000) {
        inst.lastServerSave = now;
        saveProgress(inst, false);
      }
    });
    on(inst, v, 'progress', function () { syncBuffer(inst); });
    on(inst, v, 'seeked', function () { syncTime(inst); showControls(inst, true); });
    on(inst, v, 'ended', function () {
      inst.root.classList.add('is-paused');
      clearResume(inst);
      saveProgress(inst, true);
      showControls(inst, true);
      maybeNext(inst);
    });
    on(inst, v, 'error', function () { showVideoError(inst); });
    on(inst, v, 'enterpictureinpicture', function () { syncFullIcons(inst); });
    on(inst, v, 'leavepictureinpicture', function () { syncFullIcons(inst); });

    // Doble klik (kompyuter) - to'liq ekran. Telefonda qo'l harakati ishlatiladi.
    on(inst, v, 'dblclick', function (e) {
      if (Date.now() - inst.lastTouchAt < 900) return;
      e.preventDefault();
      if (inst.clickTimer) { clearTimeout(inst.clickTimer); inst.clickTimer = null; }
      toggleFull(inst);
    });

    // Yagona bosish - o'ynatish/pauza; telefonda panel holatiga qarab.
    on(inst, inst.root, 'pointerup', function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      if (e.target.closest && e.target.closest('button, input, .uzp-bar, .uzp-menu, .uzp-error, .uzp-next')) return;

      var touch = e.pointerType === 'touch' || e.pointerType === 'pen';
      if (touch) inst.lastTouchAt = Date.now();

      if (touch) {
        var now = Date.now();
        if (now - inst.lastTap < 330 && Math.abs(e.clientX - inst.lastTapX) < 90) {
          if (inst.clickTimer) { clearTimeout(inst.clickTimer); inst.clickTimer = null; }
          inst.lastTap = 0;
          var r = v.getBoundingClientRect();
          var left = e.clientX < r.left + r.width / 2;
          seekBy(inst, left ? -10 : 10);
          ripple(inst, left);
          showControls(inst, true);
          return;
        }
        inst.lastTap = now;
        inst.lastTapX = e.clientX;
        if (!isActive(inst)) { showControls(inst, true); return; }
      }

      if (inst.clickTimer) clearTimeout(inst.clickTimer);
      inst.clickTimer = setTimeout(function () {
        inst.clickTimer = null;
        togglePlay(inst);
      }, touch ? 280 : 210);
    });

    // Foydalanuvchi qo'lyozmasi panelni ko'rsatadi.
    on(inst, inst.root, 'pointermove', function (e) {
      if (e.pointerType === 'mouse') showControls(inst, false);
    });
    on(inst, inst.root, 'pointerleave', function (e) {
      if (e.pointerType === 'mouse') scheduleHide(inst);
    });

    on(inst, v, 'enterpictureinpicture', function () { syncFullIcons(inst); });
    on(inst, v, 'leavepictureinpicture', function () { syncFullIcons(inst); });
  }

  // ---------------------------------------------------------------- controls
  function bindControls(inst) {
    var ui = inst.ui;
    var v = inst.video;

    ui.big.addEventListener('click', function (e) {
      e.stopPropagation();
      togglePlay(inst);
    });

    ui.bar.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-act]');
      var sp = e.target.closest && e.target.closest('[data-speed]');
      var ql = e.target.closest && e.target.closest('[data-level]');

      if (sp) {
        e.stopPropagation();
        var s = parseFloat(sp.getAttribute('data-speed')) || 1;
        setSpeed(inst, s);
        closeMenus(inst);
        return;
      }
      if (ql) {
        e.stopPropagation();
        setQuality(inst, parseInt(ql.getAttribute('data-level'), 10));
        closeMenus(inst);
        return;
      }
      if (!b) return;
      e.stopPropagation();
      var act = b.getAttribute('data-act');
      if (act === 'play') togglePlay(inst);
      else if (act === 'rew') { seekBy(inst, -10); showControls(inst, true); }
      else if (act === 'fwd') { seekBy(inst, 10); showControls(inst, true); }
      else if (act === 'mute') toggleMute(inst);
      else if (act === 'pip') togglePip(inst);
      else if (act === 'full') toggleFull(inst);
      else if (act === 'speed') toggleMenu(inst, 'speed');
      else if (act === 'quality') toggleMenu(inst, 'quality');
    });

    ui.volRange.addEventListener('input', function () {
      var val = parseFloat(ui.volRange.value);
      if (isNaN(val)) val = 1;
      v.muted = val <= 0;
      v.volume = clamp(val, 0, 1);
      showControls(inst, true);
    });

    // ---- progress: pointer drag + hover tooltip
    var seek = ui.seek;

    function ratioAt(e) {
      var r = ui.seekTrack.getBoundingClientRect();
      var x = (e.clientX != null) ? e.clientX : 0;
      if (!r.width) return 0;
      return clamp((x - r.left) / r.width, 0, 1);
    }

    function preview(e) {
      var r = ui.seekTrack.getBoundingClientRect();
      if (!r.width) return;
      var ratio = ratioAt(e);
      var dur = safeDuration(v);
      ui.seekTip.style.left = (ratio * 100) + '%';
      ui.seekTipT.textContent = fmtTime(ratio * dur);
      ui.seekThumb.style.left = (ratio * 100) + '%';
      seek.classList.add('is-hover');
    }

    on(inst, seek, 'pointerdown', function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      inst.dragging = true;
      seek.classList.add('is-drag');
      try { seek.setPointerCapture(e.pointerId); } catch (err) {}
      preview(e);
      seekTo(inst, ratioAt(e) * safeDuration(v));
      e.preventDefault();
    });

    on(inst, seek, 'pointermove', function (e) {
      preview(e);
      if (inst.dragging) seekTo(inst, ratioAt(e) * safeDuration(v));
    });

    function endDrag(e) {
      if (!inst.dragging) return;
      inst.dragging = false;
      seek.classList.remove('is-drag');
      if (e && e.clientX != null) seekTo(inst, ratioAt(e) * safeDuration(v));
      try { seek.releasePointerCapture(e.pointerId); } catch (err) {}
      showControls(inst, true);
    }
    on(inst, seek, 'pointerup', endDrag);
    on(inst, seek, 'pointercancel', endDrag);
    on(inst, seek, 'pointerleave', function () {
      if (!inst.dragging) seek.classList.remove('is-hover');
    });

    on(inst, seek, 'keydown', function (e) {
      var dur = safeDuration(v);
      if (e.key === 'ArrowLeft') { e.preventDefault(); seekTo(inst, v.currentTime - 5); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); seekTo(inst, v.currentTime + 5); }
      else if (e.key === 'Home') { e.preventDefault(); seekTo(inst, 0); }
      else if (e.key === 'End') { e.preventDefault(); seekTo(inst, dur); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); seekTo(inst, v.currentTime + dur * 0.1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); seekTo(inst, v.currentTime - dur * 0.1); }
    });

    ui.retry.addEventListener('click', function (e) {
      e.stopPropagation();
      retry(inst);
    });

    on(inst, doc, 'fullscreenchange', function () { syncFullIcons(inst); });
    on(inst, doc, 'webkitfullscreenchange', function () { syncFullIcons(inst); });

    on(inst, doc, 'click', function (e) {
      if (!inst.menuOpen) return;
      if (inst.root.contains(e.target)) return;
      closeMenus(inst);
    });

    on(inst, global, 'pagehide', function () { saveProgress(inst, true); });
    on(inst, doc, 'visibilitychange', function () {
      if (doc.visibilityState === 'hidden') saveProgress(inst, true);
    });
  }

  // ---------------------------------------------------------------- keyboard
  function bindKeyboard(inst) {
    on(inst, doc, 'keydown', function (e) {
      var t = e.target;
      var tag = (t && t.tagName) ? String(t.tagName).toUpperCase() : '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // Faqat eng oxirgi (joriy) player klaviaturaga javob beradi.
      if (instances[instances.length - 1] !== inst) return;

      var k = e.key;
      var dur = safeDuration(inst.video);
      var handled = true;

      if (k === ' ' || k === 'k' || k === 'K') togglePlay(inst);
      else if (k === 'ArrowLeft' || k === 'j' || k === 'J') { seekBy(inst, -10); showControls(inst, true); }
      else if (k === 'ArrowRight' || k === 'l' || k === 'L') { seekBy(inst, 10); showControls(inst, true); }
      else if (k === 'ArrowUp') { setVolume(inst, inst.video.volume + 0.05); showControls(inst, true); }
      else if (k === 'ArrowDown') { setVolume(inst, inst.video.volume - 0.05); showControls(inst, true); }
      else if (k === 'm' || k === 'M') toggleMute(inst);
      else if (k === 'f' || k === 'F') toggleFull(inst);
      else if (k === 'p' || k === 'P') togglePip(inst);
      else if (k === '<' || k === ',') { stepSpeed(inst, -1); showControls(inst, true); }
      else if (k === '>' || k === '.') { stepSpeed(inst, 1); showControls(inst, true); }
      else if (k === 'Home') { seekTo(inst, 0); showControls(inst, true); }
      else if (k === 'End') { seekTo(inst, dur); showControls(inst, true); }
      else if (/^[0-9]$/.test(k)) { seekTo(inst, dur * (parseInt(k, 10) / 10)); showControls(inst, true); }
      else handled = false;

      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    });
  }

  // -------------------------------------------------------------- preferences
  function restorePreferences(inst) {
    var v = inst.video;
    var vol = parseFloat(lsGet('uzp:volume'));
    if (!isNaN(vol) && vol >= 0 && vol <= 1) v.volume = vol;
    var muted = lsGet('uzp:muted');
    if (muted === '1') v.muted = true;
    var speed = parseFloat(lsGet('uzp:speed'));
    if (!isNaN(speed) && speed >= 0.5 && speed <= 2) {
      try { v.playbackRate = speed; } catch (e) {}
    }
    syncVolume(inst);
    syncSpeed(inst);
  }

  // ------------------------------------------------------------------ source
  function startMedia(inst, media) {
    var v = inst.video;
    media = media || {};
    inst.media = media;
    if (media.poster) v.setAttribute('poster', media.poster);

    if (media.type === 'hls') {
      if (media.refresh) {
        showLoading(inst);
        fetch(media.refresh, {
          credentials: 'same-origin',
          headers: { 'X-Requested-With': 'XMLHttpRequest' }
        }).then(function (r) { return r.json(); }).then(function (d) {
          startHls(inst, (d && d.url) ? d.url : media.src);
        }).catch(function () {
          startHls(inst, media.src);
        });
      } else {
        startHls(inst, media.src);
      }
      return;
    }

    if (!media.src) {
      showError(inst, 'Video manbai topilmadi.');
      return;
    }
    v.src = media.src;
    try { v.load(); } catch (e) {}
  }

  function startHls(inst, src) {
    if (!src) { showError(inst, 'HLS manzili topilmadi.'); return; }
    var v = inst.video;

    function native() {
      if (v.canPlayType('application/vnd.apple.mpegurl')) {
        v.src = src;
        try { v.load(); } catch (e) {}
        if (CFG.autoplay) tryPlay(inst);
        return true;
      }
      return false;
    }

    if (global.Hls && global.Hls.isSupported()) {
      buildHls(inst, src);
      return;
    }
    if (native()) return;

    showLoading(inst);
    loadHls(function (Hls) {
      if (!Hls || !Hls.isSupported()) {
        if (!native()) showError(inst, 'Brauzer HLS oqimini qo‘llab-quvvatlamaydi.');
        return;
      }
      buildHls(inst, src);
    }, function () {
      if (!native()) showError(inst, 'HLS moduli yuklanmadi. Internetni tekshirib, qayta urinib ko‘ring.');
    });
  }

  function buildHls(inst, src) {
    var Hls = global.Hls;
    var v = inst.video;
    if (inst.hls) { try { inst.hls.destroy(); } catch (e) {} inst.hls = null; }

    var hls = new Hls({
      enableWorker: true,
      capLevelToPlayerSize: true,
      maxBufferLength: 30,
      backBufferLength: 30,
      // tez boshlanish: birinchi bo'lakni manifest tahlilidan oldin olishni boshlaydi,
      // va boshlang'ich tezlik taxmini 4 Mbit/s (juda past sifatdan boshlamaydi)
      startFragPrefetch: true,
      abrEwmaDefaultEstimate: 4000000
    });
    inst.hls = hls;

    hls.on(Hls.Events.MANIFEST_PARSED, function () {
      hideLoading(inst);
      buildQualityMenu(inst);
      if (CFG.autoplay) tryPlay(inst);
    });
    hls.on(Hls.Events.LEVEL_SWITCHED, function () { syncQuality(inst); });
    hls.on(Hls.Events.ERROR, function (evt, data) {
      if (!data || !data.fatal) return;
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        try { hls.startLoad(); return; } catch (e) {}
      } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        try { hls.recoverMediaError(); return; } catch (e) {}
      }
      showError(inst, 'HLS oqimini yuklab bo‘lmadi. Qayta urinib ko‘ring.');
    });

    hls.loadSource(src);
    hls.attachMedia(v);
  }

  function retry(inst) {
    hideError(inst);
    showLoading(inst);
    if (inst.hls) {
      try { inst.hls.destroy(); } catch (e) {}
      inst.hls = null;
    }
    var v = inst.video;
    try { v.removeAttribute('src'); v.load(); } catch (e) {}
    inst.resumeApplied = false;
    startMedia(inst, inst.media);
  }

  // ---------------------------------------------------------------- playback
  function safeDuration(v) {
    return isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
  }

  function tryPlay(inst) {
    var v = inst.video;
    var p = v.play();
    if (p && p.catch) {
      p.catch(function () {
        // Avtomatik o'ynatish bloklandi - foydalanuvchi tugma bosishi kerak.
        inst.root.classList.add('is-paused', 'is-blocked');
        showControls(inst, true);
      });
    }
  }

  function togglePlay(inst) {
    var v = inst.video;
    if (v.paused || v.ended) {
      var p = v.play();
      if (p && p.catch) p.catch(function () {});
    } else {
      v.pause();
    }
  }

  function seekBy(inst, delta) {
    seekTo(inst, inst.video.currentTime + delta);
  }

  function seekTo(inst, t) {
    var v = inst.video;
    var dur = safeDuration(v);
    if (!dur) return;
    var to = clamp(Number(t) || 0, 0, Math.max(0, dur - 0.15));
    try { v.currentTime = to; } catch (e) {}
    syncTime(inst, to);
  }

  function setVolume(inst, val) {
    var v = inst.video;
    v.muted = false;
    v.volume = clamp(val, 0, 1);
    if (v.volume > 0) lsSet('uzp:volume', v.volume.toFixed(2));
    lsSet('uzp:muted', '0');
  }

  function toggleMute(inst) {
    var v = inst.video;
    if (v.muted || v.volume <= 0) {
      v.muted = false;
      if (v.volume <= 0) v.volume = 0.6;
      lsSet('uzp:muted', '0');
    } else {
      v.muted = true;
      lsSet('uzp:muted', '1');
    }
  }

  function setSpeed(inst, speed) {
    speed = parseFloat(speed) || 1;
    try { inst.video.playbackRate = speed; } catch (e) {}
    lsSet('uzp:speed', speed);
    syncSpeed(inst);
  }

  function stepSpeed(inst, dir) {
    var cur = inst.video.playbackRate || 1;
    var i = SPEEDS.indexOf(cur);
    if (i < 0) {
      // Eng yaqin qiymatni topamiz.
      var best = 0;
      for (var j = 0; j < SPEEDS.length; j++) {
        if (Math.abs(SPEEDS[j] - cur) < Math.abs(SPEEDS[best] - cur)) best = j;
      }
      i = best;
    }
    i = clamp(i + dir, 0, SPEEDS.length - 1);
    setSpeed(inst, SPEEDS[i]);
  }

  function toggleFull(inst) {
    var v = inst.video;
    var d = doc;
    var isFull = d.fullscreenElement || d.webkitFullscreenElement;
    if (isFull) {
      if (d.exitFullscreen) d.exitFullscreen().catch(function () {});
      else if (d.webkitExitFullscreen) d.webkitExitFullscreen();
      return;
    }
    var root = inst.root;
    if (root.requestFullscreen) {
      root.requestFullscreen().catch(function () {
        if (v.webkitEnterFullscreen) v.webkitEnterFullscreen();
      });
    } else if (root.webkitRequestFullscreen) {
      root.webkitRequestFullscreen();
    } else if (v.webkitEnterFullscreen) {
      v.webkitEnterFullscreen();
    }
    showControls(inst, true);
  }

  function togglePip(inst) {
    var v = inst.video;
    if (!v.requestPictureInPicture) return;
    if (doc.pictureInPictureElement) {
      doc.exitPictureInPicture().catch(function () {});
      return;
    }
    if (v.readyState < 2) return;
    v.requestPictureInPicture().catch(function () {});
  }

  // -------------------------------------------------------------------- UI sync
  function syncPlayBtn(inst) {
    var v = inst.video;
    var icon = (v.paused || v.ended) ? ICONS.play : ICONS.pause;
    var label = (v.paused || v.ended) ? 'O‘ynatish' : 'Pauza';
    inst.ui.playBtn.innerHTML = icon;
    inst.ui.playBtn.setAttribute('aria-label', label);
    inst.ui.big.innerHTML = ICONS.play;
    if (v.paused || v.ended) inst.root.classList.add('is-paused');
    else inst.root.classList.remove('is-paused');
  }

  function syncTime(inst, forced) {
    var v = inst.video;
    var dur = safeDuration(v);
    var cur = forced != null ? forced : (v.currentTime || 0);
    var ui = inst.ui;

    ui.cur.textContent = fmtTime(cur);
    if (dur) ui.dur.textContent = fmtTime(dur);
    var ratio = dur ? clamp(cur / dur, 0, 1) : 0;
    ui.seekPlay.style.width = (ratio * 100) + '%';
    ui.seekThumb.style.left = (ratio * 100) + '%';
    ui.seek.setAttribute('aria-valuemin', '0');
    ui.seek.setAttribute('aria-valuemax', String(Math.floor(dur)));
    ui.seek.setAttribute('aria-valuenow', String(Math.floor(cur)));
    ui.seek.setAttribute('aria-valuetext', fmtTime(cur) + ' / ' + fmtTime(dur));

    syncBuffer(inst);
  }

  function syncBuffer(inst) {
    var v = inst.video;
    var dur = safeDuration(v);
    if (!dur || !v.buffered || !v.buffered.length) return;
    var end = v.buffered.end(v.buffered.length - 1);
    inst.ui.seekBuf.style.width = (clamp(end / dur, 0, 1) * 100) + '%';
  }

  function syncDuration(inst) {
    var dur = safeDuration(inst.video);
    inst.ui.dur.textContent = fmtTime(dur);
    syncTime(inst);
  }

  function syncVolume(inst) {
    var v = inst.video;
    var ui = inst.ui;
    var muted = v.muted || v.volume <= 0;
    ui.muteBtn.innerHTML = muted ? ICONS.mute : ICONS.vol;
    ui.muteBtn.setAttribute('aria-label', muted ? 'Ovozni yoqish' : 'Ovozni o‘chirish');
    ui.volRange.value = muted ? 0 : String(v.volume);
  }

  function syncSpeed(inst) {
    var s = inst.video.playbackRate || 1;
    var disp = (Math.round(s * 100) / 100);
    inst.ui.speedLbl.textContent = disp % 1 === 0 ? disp + '×' : disp + '×';
    var items = inst.ui.speedMenu.querySelectorAll('[data-speed]');
    for (var i = 0; i < items.length; i++) {
      var val = parseFloat(items[i].getAttribute('data-speed'));
      var onItem = Math.abs(val - s) < 0.01;
      items[i].classList.toggle('on', onItem);
      items[i].setAttribute('aria-checked', onItem ? 'true' : 'false');
    }
  }

  function syncFullIcons(inst) {
    var d = doc;
    var isFull = !!(d.fullscreenElement || d.webkitFullscreenElement);
    inst.root.classList.toggle('is-fullscreen', isFull);
    inst.ui.fullBtn.innerHTML = isFull ? ICONS.exitFull : ICONS.full;
    inst.ui.fullBtn.setAttribute('aria-label', isFull ? 'To‘liq ekrandan chiqish' : 'To‘liq ekran');
    if (isFull) showControls(inst, true);
  }

  function setQualityLabel(inst, label) {
    inst.ui.qualityLbl.textContent = label;
    inst.ui.topTag.textContent = label;
    inst.ui.topTag.hidden = !label || label === 'Auto';
  }

  function buildQualityMenu(inst) {
    var menu = inst.ui.qualityMenu;
    var hls = inst.hls;
    var html = '<div class="uzp-menu-h">Sifat</div>'
      + '<button type="button" class="uzp-menu-item' + (!hls || hls.autoLevelEnabled ? ' on' : '') + '" role="menuitemradio" aria-checked="' + (!hls || hls.autoLevelEnabled ? 'true' : 'false') + '" data-level="-1">Auto</button>';

    if (hls && hls.levels && hls.levels.length > 1) {
      hls.levels.forEach(function (lv, i) {
        var h = lv.height || 0;
        var label = h ? (h + 'p') : ('Sifat ' + (i + 1));
        html += '<button type="button" class="uzp-menu-item" role="menuitemradio" aria-checked="false" data-level="' + i + '">' + esc(label) + '</button>';
      });
    }
    menu.innerHTML = html;
    syncQuality(inst);
  }

  function syncQuality(inst) {
    var hls = inst.hls;
    var label = 'Auto';
    if (hls && hls.levels && hls.levels.length) {
      if (!hls.autoLevelEnabled && hls.currentLevel >= 0) {
        var lv = hls.levels[hls.currentLevel];
        if (lv) label = lv.height ? (lv.height + 'p') : ('Sifat ' + (hls.currentLevel + 1));
      }
    }
    setQualityLabel(inst, label);

    var items = inst.ui.qualityMenu.querySelectorAll('[data-level]');
    for (var i = 0; i < items.length; i++) {
      var lvl = parseInt(items[i].getAttribute('data-level'), 10);
      var onItem = hls ? ((lvl === -1) ? !!hls.autoLevelEnabled : (!hls.autoLevelEnabled && lvl === hls.currentLevel)) : (lvl === -1);
      items[i].classList.toggle('on', onItem);
      items[i].setAttribute('aria-checked', onItem ? 'true' : 'false');
    }
  }

  function setQuality(inst, level) {
    var hls = inst.hls;
    if (!hls || !hls.levels || !hls.levels.length) { setQualityLabel(inst, 'Auto'); return; }
    if (level === -1) {
      hls.currentLevel = -1;
      hls.nextLevel = -1;
    } else if (level >= 0 && level < hls.levels.length) {
      hls.currentLevel = level;
    }
    syncQuality(inst);
  }

  // ---------------------------------------------------------------- controls state
  function isActive(inst) { return inst.root.classList.contains('is-active'); }

  function showControls(inst, force) {
    inst.root.classList.add('is-active');
    inst.root.classList.remove('is-idle');
    if (inst.hideTimer) { clearTimeout(inst.hideTimer); inst.hideTimer = null; }
    if (force || !inst.menuOpen) scheduleHide(inst);
  }

  function scheduleHide(inst) {
    if (inst.hideTimer) clearTimeout(inst.hideTimer);
    if (inst.destroyed || inst.menuOpen) return;
    if (inst.video.paused) return;
    inst.hideTimer = setTimeout(function () {
      inst.hideTimer = null;
      if (inst.destroyed || inst.menuOpen) return;
      if (inst.video.paused) return;
      inst.root.classList.remove('is-active');
      inst.root.classList.add('is-idle');
      closeMenus(inst, true);
    }, 3000);
  }

  function toggleMenu(inst, name) {
    var menu = name === 'speed' ? inst.ui.speedMenu : inst.ui.qualityMenu;
    var btn = name === 'speed' ? inst.ui.speedBtn : inst.ui.qualityBtn;
    var willOpen = menu.hidden;
    closeMenus(inst, true);
    if (willOpen) {
      menu.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      inst.menuOpen = true;
      inst.root.classList.add('is-menu');
      showControls(inst, true);
    }
  }

  function closeMenus(inst, silent) {
    if (!inst.ui) return;
    inst.ui.speedMenu.hidden = true;
    inst.ui.qualityMenu.hidden = true;
    inst.ui.speedBtn.setAttribute('aria-expanded', 'false');
    inst.ui.qualityBtn.setAttribute('aria-expanded', 'false');
    inst.menuOpen = false;
    inst.root.classList.remove('is-menu');
    if (!silent) scheduleHide(inst);
  }

  function showLoading(inst) {
    inst.root.classList.add('is-loading');
    inst.ui.loading.classList.remove('is-off');
  }
  function hideLoading(inst) {
    inst.root.classList.remove('is-loading');
    inst.ui.loading.classList.add('is-off');
  }

  function showError(inst, msg) {
    hideLoading(inst);
    inst.root.classList.add('is-blocked');
    inst.ui.errT.textContent = msg || 'Videoni yuklab bo‘lmadi.';
    inst.ui.err.hidden = false;
  }
  function hideError(inst) {
    inst.ui.err.hidden = true;
    inst.root.classList.remove('is-blocked');
  }

  function showVideoError(inst) {
    var code = inst.video.error ? inst.video.error.code : 0;
    var msg = code === 1 ? 'Video yuklash bekor qilindi.'
      : code === 2 ? 'Tarmoq xatosi: videoni yuklab bo‘lmadi.'
      : code === 3 ? 'Video fayli shikastlangan yoki o‘qib bo‘lmaydi.'
      : code === 4 ? 'Brauzer bu video formatini qo‘llab-quvvatlamaydi.'
      : 'Videoni yuklab bo‘lmadi. Qayta urinib ko‘ring.';
    showError(inst, msg);
  }

  function ripple(inst, left) {
    var elm = left ? inst.ui.rippleL : inst.ui.rippleR;
    elm.classList.remove('show');
    // Majburiy reflow - animatsiya qayta boshlanishi uchun.
    void elm.offsetWidth;
    elm.classList.add('show');
    setTimeout(function () { elm.classList.remove('show'); }, 700);
  }

  // --------------------------------------------------------------- resume/save
  function applyResume(inst) {
    if (inst.resumeApplied) return;
    inst.resumeApplied = true;
    var v = inst.video;
    var dur = safeDuration(v);
    if (!dur) return;

    var fromServer = Number(CFG.resumeAt) || 0;
    var fromLocal = parseFloat(lsGet(resumeKey())) || 0;
    var at = Math.max(fromServer, fromLocal);
    if (at > 5 && at < dur - 10) {
      try { v.currentTime = at; } catch (e) {}
    }
  }

  function saveLocal(inst) {
    var key = resumeKey();
    if (!key) return;
    var v = inst.video;
    var dur = safeDuration(v);
    var pos = Math.floor(v.currentTime || 0);
    if (!dur) return;
    if (pos >= dur - 10 || pos / dur >= 0.95) lsDel(key);
    else if (pos > 3) lsSet(key, pos);
  }

  function clearResume(inst) {
    var key = resumeKey();
    if (key) lsDel(key);
  }

  function saveProgress(inst, immediate) {
    saveLocal(inst);
    if (!CFG.loggedIn || !CFG.contentId) return;
    var v = inst.video;
    var dur = safeDuration(v);
    if (!dur) return;
    var pos = Math.floor(v.currentTime || 0);
    if (!immediate && pos <= 0) return;

    var body = new URLSearchParams();
    body.set('content_id', String(CFG.contentId));
    body.set('episode_id', String(CFG.episodeId || 0));
    body.set('position', String(pos));
    body.set('duration', String(Math.floor(dur)));

    try {
      fetch(withMe(apiUrl('/api/progress.php')), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        keepalive: !!immediate
      }).catch(function () {});
    } catch (e) {}
  }

  function saveDuration(inst) {
    if (inst.durationSaved || !CFG.contentId) return;
    var dur = safeDuration(inst.video);
    if (!dur) return;
    inst.durationSaved = true;
    var body = new URLSearchParams();
    body.set('content_id', String(CFG.contentId));
    body.set('episode_id', String(CFG.episodeId || 0));
    body.set('duration', String(Math.round(dur)));
    try {
      fetch(apiUrl('/api/duration.php'), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString()
      }).catch(function () {});
    } catch (e) {}
  }

  // --------------------------------------------------------------- next episode
  function maybeNext(inst) {
    var nx = CFG.next;
    if (!nx || !nx.id || typeof CFG.onNext !== 'function') return;
    dismissNext(inst);

    var toast = el('div', 'uzp-next',
      '<div class="uzp-next-tx">Keyingi qism<b>' + esc(nx.label || (nx.id + '-qism')) + '</b></div>'
      + '<button type="button" class="uzp-next-go">O‘tish</button>'
      + '<button type="button" class="uzp-next-x" aria-label="Bekor qilish">×</button>');
    inst.root.appendChild(toast);
    inst.nextToast = toast;

    var go = toast.querySelector('.uzp-next-go');
    var cx = toast.querySelector('.uzp-next-x');
    var left = 6;

    function nextNow() {
      dismissNext(inst);
      try { CFG.onNext(Number(nx.id)); } catch (e) {}
    }

    go.addEventListener('click', function (e) { e.stopPropagation(); nextNow(); });
    cx.addEventListener('click', function (e) { e.stopPropagation(); dismissNext(inst); });

    inst.toastTimer = setInterval(function () {
      left--;
      if (left <= 0) nextNow();
      else go.textContent = 'O‘tish (' + left + ')';
    }, 1000);
  }

  function dismissNext(inst) {
    if (inst.toastTimer) { clearInterval(inst.toastTimer); inst.toastTimer = null; }
    if (inst.nextToast) {
      if (inst.nextToast.parentNode) inst.nextToast.parentNode.removeChild(inst.nextToast);
      inst.nextToast = null;
    }
  }

  // -------------------------------------------------------------------- destroy
  function destroy(inst) {
    if (!inst || inst.destroyed) return;
    inst.destroyed = true;
    dismissNext(inst);

    if (inst.hideTimer) { clearTimeout(inst.hideTimer); inst.hideTimer = null; }
    if (inst.clickTimer) { clearTimeout(inst.clickTimer); inst.clickTimer = null; }

    try { if (inst.hls) inst.hls.destroy(); } catch (e) {}
    inst.hls = null;

    for (var i = 0; i < inst.listeners.length; i++) {
      try { inst.listeners[i](); } catch (e) {}
    }
    inst.listeners = [];

    try {
      var v = inst.video;
      v.pause();
      // Manbani bo'shatamiz: Telegram/HTTP oqimi fonda yuklanmasin.
      if (!inst.root.classList.contains('uzp-keep-src')) {
        v.removeAttribute('src');
        try { v.load(); } catch (e) {}
      }
    } catch (e) {}
  }

  function destroyAll() {
    for (var i = 0; i < instances.length; i++) destroy(instances[i]);
    instances = [];
  }

  // ================================================================== PUBLIC
  function mount(host, media) {
    if (!host) return null;
    var root = el('div', 'uzp');
    var v = doc.createElement('video');
    v.setAttribute('playsinline', '');
    v.setAttribute('webkit-playsinline', '');
    v.setAttribute('preload', CFG.autoplay ? 'auto' : 'metadata');
    v.setAttribute('crossorigin', 'anonymous');
    if (media && media.poster) v.setAttribute('poster', media.poster);
    root.appendChild(v);
    host.appendChild(root);
    return init(root, v, media || {}, false);
  }

  function attach(video, media) {
    if (!video) return null;
    var root = video.closest ? video.closest('.udp-player') : null;
    if (!root) root = video.parentElement;
    if (!root) return null;
    return init(root, video, media || {}, true);
  }

  function initAll(scope) {
    var root = (scope && scope.querySelectorAll) ? scope : doc;
    var nodes = root.querySelectorAll ? root.querySelectorAll('.udp-player[data-udp], .uzp') : [];
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.getAttribute('data-uzp-ready') === '1') continue;
      var v = n.querySelector('video');
      if (!v) continue;
      var media = {
        type: 'direct',
        src: v.getAttribute('src') || '',
        poster: v.getAttribute('poster') || ''
      };
      init(n, v, media, true);
    }
  }

  global.UzPlayer = {
    configure: configure,
    mount: mount,
    attach: attach,
    initAll: initAll,
    destroyAll: destroyAll,
    get instances() { return instances.slice(); },
    // Televizor pulti (assets/js/tv-watch.js) uchun tashqi boshqaruv.
    ctl: {
      toggle: function (i) { togglePlay(i); },
      play: function (i) { var pr = i.video.play(); if (pr && pr.catch) pr.catch(function () {}); },
      pause: function (i) { i.video.pause(); },
      seek: function (i, d) { seekBy(i, d); },
      show: function (i) { showControls(i, true); },
      hide: function (i) {
        if (i.menuOpen) closeMenus(i, true);
        if (i.hideTimer) { clearTimeout(i.hideTimer); i.hideTimer = null; }
        i.root.classList.remove('is-active');
        i.root.classList.add('is-idle');
      },
      closeMenus: function (i) { closeMenus(i, false); },
      isShown: function (i) { return isActive(i); }
    }
  };

  // `tg-stream.js` mosligi: u `global.UDP.initAll()` borligini tekshiradi.
  if (!global.UDP || !global.UDP.__uzp) {
    global.UDP = {
      __uzp: true,
      initAll: initAll,
      destroyAll: destroyAll
    };
  }
})(window);
