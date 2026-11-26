/* ============================================================================
   app-shell.js - App Shell / PJAX router
   ----------------------------------------------------------------------------
   Maqsad: `index.php` / `watch.php` / `reels.php` orasida yurishda hujjat
   QAYTA YUKLANMAYDI. Shu tufayli:

     * `tg-stream.js` dagi MTProto Web Worker va issiq WebSocket tirik qoladi;
     * Service Worker (`tg-cdn-worker.js`) va uning 206 kesh zanjiri uzilmaydi;
     * CSS/JS qayta parse qilinmaydi (faqat sahifaga xos skriptlar qayta
       ishga tushadi).

   Sahifa shartnomasi:
     <div id="wc-page" data-wc-page="home|watch|reels"> ... </div>
     - faqat shu blok almashadi (head/nav/footer saqlanadi);
     - ichidagi skriptlar DOM tartibida qayta ishga tushadi;
     - `PERSIST_RE` dagi kutubxonalar (`tg-stream`, `tg-mtproto`, `player`,
       `wc-lib`, `tg-comments` yordamchilari ...) bir marta yuklanadi va
       QAYTA ishga tushirilmaydi (aks holda ikkinchi MTProto klient ochilib
       `AUTH_KEY_DUPLICATED` bo'lardi);
     - sahifa modullari (`app.js`, `watch.js`, `reels.js`, `tg-comments.js`,
       `tv-watch.js`, `watch-ambient.js`) HAR safar yangi `<script>` elementi
       bilan qayta ishga tushadi — IIFE yangi closure oladi.

   Scope: nav'dan keyingi inline `<script>WCApp.beginPage()</script>` sahifa
   listener/taymer/observerlarini qayd etadi va keyingi o'tishda tozalaydi.
   Nav darajasidagi skriptlar (`tv-mode`, `badge-poll`, `notifications`,
   `tg-persist`) `DOMContentLoaded` capture bosqichida scope'siz ishlaydi —
   ularning keep-alive taymerlari sahifa bilan o'chmaydi.

   O'chirish:
     localStorage.setItem('wc_spa', '0'); location.reload();
   ============================================================================ */
(function (global) {
  'use strict';

  var doc = global.document;
  if (!doc) return;

  var FLAG = 'wc_spa';
  var PAGE_SEL = '#wc-page';
  var SCRIPT_TYPE = 'text/wc-page-script';
  var CACHE_TTL = 15000;          // ms; qaytishda bir zumda ochilish uchun
  var CSS_WAIT = 1600;            // ms; yangi CSS kelishini kutish chegarasi

  // Shell o'z taymerlarini NATIVE funksiyalar bilan yuritadi. Sabab: sahifa
  // moduli ishlayotganda `Scope` `window.setTimeout/setInterval` ni patch
  // qiladi va unmount'da hammasini tozalaydi. Progress bar / script timeout
  // esa sahifadan uzoqroq yashashi kerak.
  var _setTimeout = global.setTimeout ? global.setTimeout.bind(global) : null;
  var _clearTimeout = global.clearTimeout ? global.clearTimeout.bind(global) : null;
  var _setInterval = global.setInterval ? global.setInterval.bind(global) : null;
  var _clearInterval = global.clearInterval ? global.clearInterval.bind(global) : null;
  var _raf = global.requestAnimationFrame ? global.requestAnimationFrame.bind(global) : null;

  // Bir marta yuklanadigan kutubxonalar. Bular `#wc-page` ichida ham uchraydi,
  // lekin har navigatsiyada QAYTA ishga tushirilmaydi — aks holda
  // `tg-stream.js` ikkinchi klient ochib `AUTH_KEY_DUPLICATED` berardi.
  var PERSIST_RE = /(?:^|\/)(?:tg-mtproto-worker|tg-mtproto|tg-stream|stream-bootstrap|tg-probe|wc-lib|player|tg-gateway|tg-voice|tg-format|tg-emoji|prefetch-hover|tg-notify-prompt|lottie\.min)\.js$/i;

  var supported = !!(global.history && global.history.pushState
    && global.fetch && global.Promise && global.DOMParser
    && global.URL && global.AbortController);

  var enabled = supported;
  try {
    if (global.localStorage.getItem(FLAG) === '0') enabled = false;
  } catch (e) {}

  // ------------------------------------------------------------------ holat
  var navGen = 0;
  var navAbort = null;
  var activeScope = null;
  var currentPage = '';
  var currentUrl = location.href;
  var inFlight = null;            // bitta navigatsiya bir vaqtda
  var hoverTimer = 0;
  var hoverUrl = '';
  var scrollTimer = 0;
  var prefetching = Object.create(null);
  var cache = Object.create(null);   // url -> { t, html }
  var loadedSrc = Object.create(null); // pathname -> true (kutubxonalar)
  var bootDone = false;

  function now() { return Date.now ? Date.now() : new Date().getTime(); }

  function abs(href, baseUrl) {
    try { return new URL(String(href || ''), baseUrl || location.href).href; }
    catch (e) { return String(href || ''); }
  }

  function urlOf(u) { try { return new URL(u, location.href); } catch (e) { return null; } }

  /** `window.APP.base` (masalan `/tele_uzdub`) — trailing slash'siz. */
  function basePath() {
    try {
      var b = (global.APP && global.APP.base) || '';
      if (!b) return '';
      return new URL(b, location.href).pathname.replace(/\/+$/, '');
    } catch (e) { return ''; }
  }

  /** Qaysi SPA sahifa? `null` — bu sahifa shell ichida ochilmaydi. */
  function routeOf(u) {
    u = urlOf(u);
    if (!u) return null;
    if (u.protocol !== location.protocol || u.host !== location.host) return null;
    var p = u.pathname.replace(/\/+$/, '');
    var base = basePath();
    if (p === '' || p === base || /\/index\.php$/i.test(p)) return 'home';
    if (/\/watch\.php$/i.test(p)) return 'watch';
    if (/\/reels\.php$/i.test(p)) return 'reels';
    if (/\/profile\.php$/i.test(p)) return 'profile';
    if (/\/settings\.php$/i.test(p)) return 'settings';
    if (/\/history\.php$/i.test(p)) return 'history';
    if (/\/saved\.php$/i.test(p)) return 'saved';
    if (/\/watch-later\.php$/i.test(p)) return 'later';
    if (/\/chat\.php$/i.test(p)) return 'chat';
    return null;
  }

  function pageKeyOf(url) {
    var p = routeOf(url);
    if (p) return p;
    var el = doc.querySelector(PAGE_SEL);
    return el ? String(el.getAttribute('data-wc-page') || '') : '';
  }

  function setAttr(name, value) {
    try {
      if (value === null || value === undefined || value === '') doc.documentElement.removeAttribute(name);
      else doc.documentElement.setAttribute(name, value);
    } catch (e) {}
  }

  // ==========================================================================
  // 1. PAGE SCOPE
  // --------------------------------------------------------------------------
  // Sahifa moduli ishga tushganda uning `window`/`document` listenerlari,
  // taymerlari va observerlari yozib olinadi. Keyingi sahifaga o'tishda
  // hammasi tozalanadi — eski `watch.js` / `reels.js` "arvoh" bo'lib
  // qolmaydi (aks holda har o'tishda handlerlar ko'payib ketardi).
  // ==========================================================================
  function Scope() {
    this.listeners = [];   // [target, type, fn, opts]
    this.timers = [];      // { kind, id }
    this.observers = [];
    this.cleanups = [];
    this.patched = false;
    this.dead = false;
    this.prev = null;
  }

  Scope.prototype.onCleanup = function (fn) {
    if (typeof fn === 'function') this.cleanups.push(fn);
  };

  Scope.prototype.begin = function () {
    if (this.patched || this.dead) return;
    this.patched = true;

    var self = this;
    var winAdd = global.addEventListener;
    var winRem = global.removeEventListener;
    var docAdd = doc.addEventListener;
    var docRem = doc.removeEventListener;
    this.prev = {
      winAdd: winAdd, winRem: winRem, docAdd: docAdd, docRem: docRem,
      setTimeout: global.setTimeout, clearTimeout: global.clearTimeout,
      setInterval: global.setInterval, clearInterval: global.clearInterval,
      raf: global.requestAnimationFrame, caf: global.cancelAnimationFrame,
      observers: {}
    };

    function watch(target, add, type, fn, opts) {
      if (tracking() && typeof fn === 'function') self.listeners.push([target, type, fn, opts]);
      return add;
    }

    /** Kuzatish kerakmi? Doimiy kutubxona (`tg-stream.js`, `player.js`, ...)
     *  o'zining MODUL darajasidagi listener/taymerlarini ro'yxatdan
     *  o'tkazayotganda -- yo'q: ular sahifadan uzoq yashaydi. Buni
     *  `document.currentScript` orqali aniqlaymiz (skript sinxron
     *  bajarilayotganda mavjud). Inline skript va async callback'lar
     *  (`currentScript === null`) kuzatiladi. */
    function tracking() {
      if (self.dead) return false;
      var cs = doc.currentScript;
      if (!cs) return true;
      var src = cs.getAttribute && cs.getAttribute('src');
      if (!src) return true;
      return !isPersistent(src, location.href);
    }

    global.addEventListener = function (type, fn, opts) {
      watch(global, winAdd, type, fn, opts);
      return winAdd.call(global, type, fn, opts);
    };
    global.removeEventListener = function (type, fn, opts) {
      for (var i = self.listeners.length - 1; i >= 0; i--) {
        var l = self.listeners[i];
        if (l[0] === global && l[1] === type && l[2] === fn) self.listeners.splice(i, 1);
      }
      return winRem.call(global, type, fn, opts);
    };
    doc.addEventListener = function (type, fn, opts) {
      watch(doc, docAdd, type, fn, opts);
      return docAdd.call(doc, type, fn, opts);
    };
    doc.removeEventListener = function (type, fn, opts) {
      for (var i = self.listeners.length - 1; i >= 0; i--) {
        var l = self.listeners[i];
        if (l[0] === doc && l[1] === type && l[2] === fn) self.listeners.splice(i, 1);
      }
      return docRem.call(doc, type, fn, opts);
    };

    // --- taymerlar ---
    if (global.setTimeout) {
      global.setTimeout = function (fn, ms) {
        var args = Array.prototype.slice.call(arguments, 2);
        var rec = { kind: 'timeout', id: 0 };
        var wrapped = function () {
          self._forget(rec);
          if (typeof fn === 'function') return fn.apply(global, args);
        };
        rec.id = self.prev.setTimeout.call(global, wrapped, ms);
        if (tracking()) self.timers.push(rec);
        return rec.id;
      };
    }
    if (global.clearTimeout) {
      global.clearTimeout = function (id) {
        self._forgetId(id);
        return self.prev.clearTimeout.call(global, id);
      };
    }
    if (global.setInterval) {
      global.setInterval = function (fn, ms) {
        var args = Array.prototype.slice.call(arguments, 2);
        var rec = { kind: 'interval', id: 0 };
        var wrapped = function () { if (!self.dead && typeof fn === 'function') return fn.apply(global, args); };
        rec.id = self.prev.setInterval.call(global, wrapped, ms);
        if (tracking()) self.timers.push(rec);
        return rec.id;
      };
    }
    if (global.clearInterval) {
      global.clearInterval = function (id) {
        self._forgetId(id);
        return self.prev.clearInterval.call(global, id);
      };
    }
    if (global.requestAnimationFrame) {
      global.requestAnimationFrame = function (fn) {
        var rec = { kind: 'raf', id: 0 };
        rec.id = self.prev.raf.call(global, function (t) {
          self._forget(rec);
          if (!self.dead && typeof fn === 'function') return fn(t);
        });
        if (tracking()) self.timers.push(rec);
        return rec.id;
      };
      global.cancelAnimationFrame = function (id) {
        self._forgetId(id);
        return self.prev.caf.call(global, id);
      };
    }

    // --- observerlar ---
    ['MutationObserver', 'IntersectionObserver', 'ResizeObserver'].forEach(function (name) {
      var Orig = global[name];
      if (typeof Orig !== 'function') return;
      self.prev.observers[name] = Orig;
      function Wrapped(cb, opts) {
        var inst = new Orig(cb, opts);
        if (tracking()) self.observers.push(inst);
        return inst;
      }
      Wrapped.prototype = Orig.prototype;
      try { global[name] = Wrapped; } catch (e) { /* ba'zi brauzerlarda read-only */ }
    });
  };

  Scope.prototype._forget = function (rec) {
    var i = this.timers.indexOf(rec);
    if (i >= 0) this.timers.splice(i, 1);
  };

  Scope.prototype._forgetId = function (id) {
    for (var i = this.timers.length - 1; i >= 0; i--) {
      if (this.timers[i].id === id) this.timers.splice(i, 1);
    }
  };

  /** Vaqtincha patch'larni yechish (shell o'z resurslarini yozib olmasin). */
  Scope.prototype.suspend = function () {
    if (!this.patched) return;
    this.patched = false;
    var p = this.prev;
    global.addEventListener = p.winAdd;
    global.removeEventListener = p.winRem;
    doc.addEventListener = p.docAdd;
    doc.removeEventListener = p.docRem;
    global.setTimeout = p.setTimeout;
    global.clearTimeout = p.clearTimeout;
    global.setInterval = p.setInterval;
    global.clearInterval = p.clearInterval;
    if (p.raf) global.requestAnimationFrame = p.raf;
    if (p.caf) global.cancelAnimationFrame = p.caf;
    Object.keys(p.observers).forEach(function (name) {
      try { global[name] = p.observers[name]; } catch (e) {}
    });
  };

  Scope.prototype.destroy = function () {
    if (this.dead) return;
    this.dead = true;
    this.suspend();

    for (var i = this.cleanups.length - 1; i >= 0; i--) {
      try { this.cleanups[i](); } catch (e) {}
    }
    for (var j = 0; j < this.listeners.length; j++) {
      var l = this.listeners[j];
      try { l[0].removeEventListener(l[1], l[2], l[3]); } catch (e) {}
    }
    for (var k = 0; k < this.timers.length; k++) {
      var rec = this.timers[k];
      try {
        if (rec.kind === 'interval') this.prev.clearInterval.call(global, rec.id);
        else if (rec.kind === 'raf') this.prev.caf.call(global, rec.id);
        else this.prev.clearTimeout.call(global, rec.id);
      } catch (e) {}
    }
    for (var o = 0; o < this.observers.length; o++) {
      try { this.observers[o].disconnect(); } catch (e) {}
    }
    this.listeners.length = 0;
    this.timers.length = 0;
    this.observers.length = 0;
    this.cleanups.length = 0;
  };

  function startScope() {
    if (activeScope && !activeScope.dead) activeScope.destroy();
    activeScope = new Scope();
    activeScope.begin();
    return activeScope;
  }

  // ==========================================================================
  // 2. YUKLASH INDIKATORI
  // ==========================================================================
  var progressEl = null;
  var progressTimer = 0;

  function progressStart() {
    if (!progressEl) {
      progressEl = doc.createElement('div');
      progressEl.id = 'wcProgress';
      progressEl.setAttribute('aria-hidden', 'true');
      progressEl.style.cssText = 'position:fixed;left:0;top:0;height:2px;width:0;'
        + 'background:#ff0033;z-index:2147483647;pointer-events:none;'
        + 'transition:width .18s ease,opacity .3s ease;opacity:1;'
        + 'box-shadow:0 0 8px rgba(255,0,51,.55)';
      (doc.body || doc.documentElement).appendChild(progressEl);
    }
    try { progressEl.style.opacity = '1'; progressEl.style.width = '8%'; } catch (e) {}
    var step = 1;
    if (_clearInterval) _clearInterval(progressTimer);
    progressTimer = _setInterval(function () {
      try {
        step++;
        var w = Math.min(72, 8 + step * 7);
        progressEl.style.width = w + '%';
      } catch (e) {}
      if (step > 10) _clearInterval(progressTimer);
    }, 160);
  }

  function progressDone() {
    if (_clearInterval) _clearInterval(progressTimer);
    if (!progressEl) return;
    try {
      progressEl.style.width = '100%';
      _setTimeout(function () {
        try { progressEl.style.opacity = '0'; } catch (e) {}
        _setTimeout(function () {
          try {
            progressEl.style.width = '0';
            progressEl.style.opacity = '1';
          } catch (e) {}
        }, 320);
      }, 140);
    } catch (e) {}
  }

  // ==========================================================================
  // 3. KESH / PREFETCH
  // ==========================================================================
  function cacheGet(url) {
    var c = cache[url];
    if (!c) return null;
    if (now() - c.t > CACHE_TTL) { delete cache[url]; return null; }
    return c.html;
  }

  function cachePut(url, html) {
    cache[url] = { t: now(), html: html };
    var keys = Object.keys(cache);
    if (keys.length > 6) {
      keys.sort(function (a, b) { return (cache[a].t || 0) - (cache[b].t || 0); });
      for (var i = 0; i < keys.length - 6; i++) delete cache[keys[i]];
    }
  }

  function clearCache() { cache = Object.create(null); }

  function fetchPage(url, opts) {
    opts = opts || {};
    if (!opts.noCache) {
      var c = cacheGet(url);
      if (c) return Promise.resolve({ html: c, url: url, cached: true });
    }
    if (prefetching[url]) return prefetching[url];

    var ctrl = new AbortController();
    if (opts.signal) {
      if (opts.signal.aborted) ctrl.abort();
      else opts.signal.addEventListener('abort', function () { ctrl.abort(); });
    }
    // Server javob bermay qolsa, SPA doimiy "navigating" holatida qotib
    // qolmasligi kerak: 12 s dan keyin abort qilamiz va caller to'liq
    // sahifa yuklashga o'tadi.
    var timeoutId = global.setTimeout(function () { ctrl.abort(); }, 12000);
    var p = fetch(url, {
      method: 'GET',
      credentials: 'same-origin',
      redirect: 'follow',
      headers: {
        'X-WC-PJAX': '1',
        'Accept': 'text/html,application/xhtml+xml'
      },
      signal: ctrl.signal
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var ct = String(res.headers.get('content-type') || '');
      if (ct && ct.indexOf('text/html') === -1) throw new Error('not html');
      // Server boshqa sahifaga (masalan login) yo'naltirgan bo'lsa — keshlamaymiz.
      if (res.url && !routeOf(res.url)) throw new Error('redirect');
      return res.text().then(function (html) {
        // `#wc-page` bo'lmasa bu SPA sahifasi emas (xato/redirect nusxasi).
        if (html.indexOf('id="wc-page"') === -1 && html.indexOf("id='wc-page'") === -1) {
          throw new Error('no spa page');
        }
        cachePut(url, html);
        return { html: html, url: res.url || url, cached: false };
      });
    }).then(function (out) {
      global.clearTimeout(timeoutId);
      delete prefetching[url];
      return out;
    }, function (err) {
      global.clearTimeout(timeoutId);
      delete prefetching[url];
      throw err;
    });
    prefetching[url] = p;
    return p;
  }

  function prefetch(url) {
    if (!enabled || !supported || !routeOf(url)) return;
    var u = abs(url, location.href);
    if (u === currentUrl) return;
    if (cacheGet(u)) return;
    if (prefetching[u]) return;
    if (hoverTimer && _clearTimeout) { _clearTimeout(hoverTimer); hoverTimer = 0; }
    // Past prioritet: bo'sh vaqtda, lekin foydalanuvchi bosishidan oldin.
    try {
      if (global.navigator && global.navigator.connection && global.navigator.connection.saveData) return;
    } catch (e) {}
    fetchPage(u).catch(function () {});
  }

  // ==========================================================================
  // 4. HEAD / BODY / NAV SINXRONIZATSIYASI
  // ==========================================================================
  function cssKey(href, baseUrl) {
    var u = urlOf(abs(href, baseUrl));
    return u ? u.pathname : String(href || '');
  }

  function syncStyles(newDoc, baseUrl) {
    var links = newDoc.querySelectorAll('link[rel~="stylesheet"][href]');
    var waits = [];
    for (var i = 0; i < links.length; i++) {
      var link = links[i];
      var href = abs(link.getAttribute('href'), baseUrl);
      var key = cssKey(href, baseUrl);
      if (!key) continue;
      var exists = false;
      var have = doc.head.querySelectorAll('link[rel~="stylesheet"][href]');
      for (var j = 0; j < have.length; j++) {
        if (cssKey(have[j].getAttribute('href'), location.href) === key) { exists = true; break; }
      }
      if (exists) continue;

      var add = doc.createElement('link');
      add.rel = 'stylesheet';
      add.href = href;
      if (link.media) add.media = link.media;
      add.setAttribute('data-wc-css', '1');
      waits.push(new Promise(function (resolve) {
        var done = false;
        function fin() { if (done) return; done = true; resolve(); }
        add.onload = fin;
        add.onerror = fin;
        _setTimeout(fin, CSS_WAIT);
      }));
      doc.head.appendChild(add);
    }
    return waits.length ? Promise.all(waits) : Promise.resolve();
  }

  /** `settings.php` / ro'yxat sahifalaridagi inline `<style>` ham keladi.
   *  `syncStyles()` faqat `<link>`larni qo'shadi, shuning uchun bunisi alohida. */
  function syncInlineStyles(newDoc) {
    // Faqat biz belgilagan stillar o'chiriladi; nav / tv-head stillari qoladi.
    var old = doc.head.querySelectorAll('style[data-wc-style]');
    for (var k = 0; k < old.length; k++) {
      if (old[k].parentNode) old[k].parentNode.removeChild(old[k]);
    }
    var add = newDoc.querySelectorAll('head style[data-wc-style]');
    if (!add || !add.length) return;
    for (var i = 0; i < add.length; i++) {
      var css = add[i].textContent || '';
      if (!css.replace(/^\s+|\s+$/g, '')) continue;
      var s = doc.createElement('style');
      s.textContent = css;
      s.setAttribute('data-wc-style', '1');
      doc.head.appendChild(s);
    }
  }

  function setMeta(selector, value) {
    if (value === null || value === undefined) return;
    var el = doc.head.querySelector(selector);
    if (!el) {
      if (!value) return;
      el = doc.createElement('meta');
      if (selector.indexOf('property=') >= 0) {
        var m = /property="([^"]+)"/.exec(selector);
        if (m) el.setAttribute('property', m[1]);
      } else {
        var n = /name="([^"]+)"/.exec(selector);
        if (n) el.setAttribute('name', n[1]);
      }
      doc.head.appendChild(el);
    }
    el.setAttribute('content', value);
  }

  /** `watch.php` head'idagi HLS/pleer sozlamalari soft-nav'da ham yangilanadi.
   *  Aks holda katalogdan watch.php ga o'tganda `watch.js` eski (yoki
   *  umuman yo'q) `__WC_HLS_MODE` ni o'qiydi. Faqat `data-wc-config` li
   *  skriptlar qayta bajariladi — SW registration / metrika qayta ishlamaydi. */
  function syncHeadConfig(newDoc) {
    var stale = ['__WC_HLS_MODE', '__WC_HLS_FALLBACK_MS', '__WC_HLS_URL'];
    for (var i = 0; i < stale.length; i++) {
      try { delete global[stale[i]]; } catch (e) { global[stale[i]] = undefined; }
    }
    var cfg = newDoc.querySelectorAll('head script[data-wc-config]');
    for (var j = 0; j < cfg.length; j++) {
      try { execInline(cfg[j]); } catch (e) {}
    }
  }

  // Shell (nav) darajasidagi skriptlar `<body>` ga qo'yadigan runtime klasslar.
  // Ular sahifa bilan almashmasligi kerak: `syncHead()` yangi hujjatdan
  // `body.className` ni ko'chirganda ularni saqlab qolamiz.
  var BODY_KEEP = { 'tv-mode': 1 };

  function syncHead(newDoc, baseUrl) {
    if (newDoc.title) doc.title = newDoc.title;
    syncHeadConfig(newDoc);

    var d = newDoc.querySelector('meta[name="description"]');
    if (d) setMeta('meta[name="description"]', d.getAttribute('content') || '');
    ['og:title', 'og:description', 'og:url', 'og:image'].forEach(function (p) {
      var s = newDoc.querySelector('meta[property="' + p + '"]');
      if (s) setMeta('meta[property="' + p + '"]', s.getAttribute('content') || '');
    });

    var can = newDoc.querySelector('link[rel="canonical"]');
    if (can) {
      var href = abs(can.getAttribute('href') || '', baseUrl);
      var cur = doc.head.querySelector('link[rel="canonical"]');
      if (!cur) { cur = doc.createElement('link'); cur.rel = 'canonical'; doc.head.appendChild(cur); }
      cur.href = href;
    }

    var body = newDoc.body;
    if (body) {
      var cls = body.getAttribute('class');
      if (cls !== null) {
        var list = String(cls).split(/\s+/).filter(Boolean);
        Object.keys(BODY_KEEP).forEach(function (keep) {
          if (doc.body.classList && doc.body.classList.contains(keep) && list.indexOf(keep) === -1) {
            list.push(keep);
          }
        });
        doc.body.className = list.join(' ');
      }
      // body'dagi data-* (masalan `data-tg-ready`) — shell ichidagilarni saqlab qolamiz.
      Array.prototype.forEach.call(body.attributes, function (a) {
        if (a.name.indexOf('data-') === 0) {
          try { doc.body.setAttribute(a.name, a.value); } catch (e) {}
        }
      });
      // Eski sahifaga tegishli `data-wc-list` kabi atributlar qolmasin.
      var keepData = { 'data-tg-ready': 1 };
      Array.prototype.forEach.call(Array.prototype.slice.call(doc.body.attributes), function (a) {
        if (a.name.indexOf('data-') !== 0 || keepData[a.name]) return;
        if (body.hasAttribute && body.hasAttribute(a.name)) return;
        try { doc.body.removeAttribute(a.name); } catch (e) {}
      });
    }
    try { doc.body.style.overflow = ''; } catch (e) {}
  }

  function navLinks(root) {
    return root.querySelectorAll('.yt-mast a[href], .ig-side a[href], .ig-mobar a[href], .ig-tabbar a[href]');
  }

  function syncNav(newDoc, baseUrl) {
    var wanted = Object.create(null);
    var links = navLinks(newDoc);
    for (var i = 0; i < links.length; i++) {
      if (/\bactive\b/.test(String(links[i].className || ''))) {
        wanted[abs(links[i].getAttribute('href'), baseUrl)] = 1;
      }
    }
    var cur = navLinks(doc);
    for (var j = 0; j < cur.length; j++) {
      var a = cur[j];
      var on = !!wanted[abs(a.getAttribute('href'), location.href)];
      if (on) {
        if (!/\bactive\b/.test(a.className)) a.className = (a.className ? a.className + ' ' : '') + 'active';
        a.setAttribute('aria-current', 'page');
      } else {
        a.className = String(a.className || '').replace(/\s*\bactive\b/g, '').replace(/^\s+|\s+$/g, '');
        a.removeAttribute('aria-current');
      }
    }
  }

  // ==========================================================================
  // 5. SAHIFA SKRIPTLARI
  // ==========================================================================
  function pathKey(src, baseUrl) {
    var u = urlOf(abs(src, baseUrl));
    return u ? u.pathname : String(src || '');
  }

  function markInitialScripts() {
    var all = doc.getElementsByTagName('script');
    for (var i = 0; i < all.length; i++) {
      var s = all[i];
      if (String(s.getAttribute('type') || '').toLowerCase() === SCRIPT_TYPE) continue;
      if (s.src) loadedSrc[pathKey(s.src, location.href)] = 1;
    }
  }

  function execInline(srcEl) {
    var s = doc.createElement('script');
    s.textContent = srcEl.textContent;
    if (srcEl.getAttribute('data-wc-src')) s.setAttribute('data-wc-src', srcEl.getAttribute('data-wc-src'));
    doc.head.appendChild(s);
  }

  function loadExternal(src, baseUrl, timeout) {
    var href = abs(src, baseUrl);
    var key = pathKey(href, baseUrl);
    if (!key) return Promise.resolve();
    if (loadedSrc[key]) return Promise.resolve();
    loadedSrc[key] = 1;
    return new Promise(function (resolve, reject) {
      var s = doc.createElement('script');
      var done = false;
      s.src = href;
      s.async = false;
      function fin(ok, err) {
        if (done) return;
        done = true;
        if (ok) resolve(); else reject(err || new Error('script ' + href));
      }
      s.onload = function () { fin(true); };
      s.onerror = function () { fin(false, new Error('script yuklanmadi: ' + href)); };
      _setTimeout(function () { fin(false, new Error('script timeout: ' + href)); }, timeout || 20000);
      doc.head.appendChild(s);
    });
  }

  /** Bu skript bir marta yuklanadigan kutubxona mi? */
  function isPersistent(src, baseUrl) {
    var key = pathKey(src, baseUrl);
    return !!key && PERSIST_RE.test(key);
  }

  /** `#wc-page` ichidagi skriptlarni DOM tartibida ishga tushirish.
   *
   *  - kutubxonalar (`PERSIST_RE`) — faqat hali yuklanmagan bo'lsa;
   *  - sahifa modullari (app.js / watch.js / reels.js ...) — HAR safar yangi
   *    `<script>` elementi bilan (IIFE yangi closure oladi);
   *  - inline skriptlar — har safar (ular `window.APP`, `window.WATCH` kabi
   *    sahifa ma'lumotlarini qayta o'rnatadi).
   */
  function runScripts(list, baseUrl, gen) {
    var i = 0;

    function next() {
      if (gen !== navGen) return Promise.resolve();
      if (i >= list.length) return Promise.resolve();
      var el = list[i++];
      var type = String(el.getAttribute('type') || '').toLowerCase();

      // JSON-LD / shablon / boshqa ma'lumot bloklari — tegmaymiz.
      if (type && type !== SCRIPT_TYPE && type !== 'text/javascript'
        && type !== 'application/javascript' && type !== 'module') {
        return next();
      }

      if (el.getAttribute('src')) {
        var src = el.getAttribute('src');
        if (isPersistent(src, baseUrl)) {
          return loadExternal(src, baseUrl).then(next);
        }
        // Sahifa moduli: har navigatsiyada qayta ishga tushadi. Brauzer
        // keshidan keladi, ya'ni tarmoq xarajati deyarli yo'q.
        return new Promise(function (resolve, reject) {
          var s = doc.createElement('script');
          var done = false;
          s.src = abs(src, baseUrl);
          s.async = false;
          function fin(ok, err) {
            if (done) return;
            done = true;
            if (ok) resolve(); else reject(err);
          }
          s.onload = function () { fin(true); };
          s.onerror = function () { fin(false, new Error('page script: ' + s.src)); };
          _setTimeout(function () { fin(false, new Error('page script timeout: ' + s.src)); }, 20000);
          doc.head.appendChild(s);
        }).then(next);
      }

      // Inline skript.
      try { execInline(el); } catch (e) {}
      return next();
    }

    return next();
  }

  // ==========================================================================
  // 6. SAHIFANI ALMASHTIRISH
  // ==========================================================================
  function pauseMedia() {
    try {
      if (global.TgStream) {
        if (global.TgStream.release) global.TgStream.release();
        else if (global.TgStream.stop) global.TgStream.stop();
      }
    } catch (e) {}
    try { if (global.TGComments && global.TGComments.dispose) global.TGComments.dispose(); } catch (e) {}
    try { if (global.UDP && global.UDP.destroyAll) global.UDP.destroyAll(); } catch (e) {}
    try { if (global.UzPlayer && global.UzPlayer.destroyAll) global.UzPlayer.destroyAll(); } catch (e) {}

    var media = doc.querySelectorAll('#wc-page video, #wc-page audio');
    for (var i = 0; i < media.length; i++) {
      var m = media[i];
      try { m.pause(); } catch (e) {}
      try { if (m.srcObject) m.srcObject = null; } catch (e) {}
      try { m.removeAttribute('src'); } catch (e) {}
      var srcs = m.querySelectorAll('source');
      for (var j = 0; j < srcs.length; j++) { try { srcs[j].removeAttribute('src'); } catch (e) {} }
      try { m.load(); } catch (e) {}
    }
  }

  function dispatch(name, detail) {
    try {
      doc.dispatchEvent(new CustomEvent(name, { detail: detail || {}, bubbles: true }));
    } catch (e) {
      try {
        var ev = doc.createEvent('CustomEvent');
        ev.initCustomEvent(name, true, false, detail || {});
        doc.dispatchEvent(ev);
      } catch (e2) {}
    }
  }

  /** URL/history holatini sahifa skriptlaridan OLDIN yangilaydi: `watch.js`
   *  `location.search` dan qism raqamini, `app.js` esa `?cat=` filtrini
   *  o'qiydi — ular yangi manzilni ko'rishi shart. */
  function commitUrl(targetUrl, opts, page) {
    currentUrl = targetUrl;

    if (!opts.pop) {
      try {
        var st = { wc: 1, page: page, y: 0 };
        if (opts.replace) history.replaceState(st, '', targetUrl);
        else history.pushState(st, '', targetUrl);
      } catch (e) {}
    } else {
      try {
        var st = history.state || {};
        if (!st.wc) history.replaceState({ wc: 1, page: page, y: 0 }, '', targetUrl);
      } catch (e) {}
    }
  }

  function finishNav(targetUrl, opts, page) {
    var y = (opts.pop && typeof opts.scrollY === 'number') ? opts.scrollY : 0;
    var hash = '';
    try { hash = urlOf(targetUrl).hash || ''; } catch (e) {}

    function done() {
      var hashEl = null;
      if (hash && hash.length > 1) {
        try { hashEl = doc.getElementById(decodeURIComponent(hash.slice(1))); } catch (e) {}
      }
      if (hashEl && typeof hashEl.scrollIntoView === 'function') {
        try { hashEl.scrollIntoView(); } catch (e) {}
      } else {
        try { global.scrollTo(0, y); } catch (e) {}
      }
      var p = doc.querySelector(PAGE_SEL);
      if (p && p.focus) {
        try { p.focus({ preventScroll: true }); } catch (e) { try { p.focus(); } catch (e2) {} }
      }
      progressDone();
      dispatch('wc:navigate', { page: page, url: targetUrl });
    }

    if (_raf) _raf(done); else _setTimeout(done, 0);
  }

  function applyPage(data, targetUrl, opts) {
    var gen = navGen;
    var newDoc;
    try { newDoc = new DOMParser().parseFromString(data.html, 'text/html'); }
    catch (e) { return Promise.reject(e); }

    var newPage = newDoc.querySelector(PAGE_SEL);
    if (!newPage) throw new Error('SPA sahifa belgisi topilmadi');

    var baseUrl = data.url || targetUrl;
    var page = String(newPage.getAttribute('data-wc-page') || routeOf(targetUrl) || '');

    syncInlineStyles(newDoc);
    return syncStyles(newDoc, baseUrl).then(function () {
      if (gen !== navGen) return;

      var oldPage = doc.querySelector(PAGE_SEL);
      if (!oldPage) throw new Error('Joriy SPA sahifa yo\'q');

      // Eski sahifa resurslarini to'xtatamiz.
      dispatch('wc:pageunmount', { page: currentPage, url: currentUrl });
      if (activeScope) { activeScope.destroy(); activeScope = null; }
      pauseMedia();

      syncHead(newDoc, baseUrl);
      syncNav(newDoc, baseUrl);

      var imported = doc.importNode(newPage, true);
      imported.setAttribute('tabindex', '-1');

      // Skriptlarni DOM'dan chiqaramiz. `importNode` bilan qo'shilganda
      // ular avtomatik bajarilib qolishi mumkin — keyin biz ularni qo'lda,
      // DOM tartibida ishga tushiramiz (aks holda ikki marta bajarilardi).
      var allScripts = Array.prototype.slice.call(imported.querySelectorAll('script'));
      var scripts = [];
      for (var si = 0; si < allScripts.length; si++) {
        var sc = allScripts[si];
        var t = String(sc.getAttribute('type') || '').toLowerCase();
        // `wcServerData` / JSON-LD — bajarilmaydi, lekin DOM'da qolishi shart.
        var isData = t && t !== SCRIPT_TYPE && t !== 'text/javascript'
          && t !== 'application/javascript' && t !== 'module';
        if (isData) continue;
        scripts.push(sc);
        if (sc.parentNode) sc.parentNode.removeChild(sc);
      }

      oldPage.replaceWith(imported);
      currentPage = page;
      setAttr('data-wc-page', page);

      // MUHIM: manzilni skriptlardan oldin yangilaymiz.
      commitUrl(targetUrl, opts, page);

      var scope = startScope();
      dispatch('wc:pagemount', { page: page, url: targetUrl, scope: scope });

      return runScripts(scripts, baseUrl, gen).then(function () {
        if (gen !== navGen) return;
        dispatch('wc:pageafter', { page: page, url: targetUrl });
        finishNav(targetUrl, opts, page);
      });
    });
  }

  // ==========================================================================
  // 7. NAVIGATSIYA
  // ==========================================================================
  function navigate(url, opts) {
    opts = opts || {};
    var target;
    try { target = new URL(url, location.href).href; } catch (e) { return; }

    if (!enabled || !supported || !routeOf(target)) {
      if (opts.replace) location.replace(target);
      else location.href = target;
      return;
    }

    // Sahifa ichidagi anker (bir xil hujjat) — brauzerga qoldiramiz.
    // `pop` da `location.href` ALLAQACHON yangi manzil, shuning uchun bu
    // tekshiruv faqat bosish (push) uchun amal qiladi.
    if (!opts.pop && (target === location.href
      || (target.split('#')[0] === location.href.split('#')[0] && opts.hashOnly))) {
      return;
    }

    var gen = ++navGen;
    if (navAbort) { try { navAbort.abort(); } catch (e) {} }
    var ctrl = new AbortController();
    navAbort = ctrl;

    // Eski scope'ni "uxlatamiz": progress va fetch shell resurslari
    // oldingi sahifa hisobiga yozilib qolmasin.
    if (activeScope) activeScope.suspend();

    // Joriy sahifa scroll holatini saqlaymiz.
    try {
      var st = Object.assign({}, history.state || {}, { wc: 1, page: currentPage, y: Math.round(global.pageYOffset || 0) });
      history.replaceState(st, '', location.href);
    } catch (e) {}

    progressStart();
    setAttr('data-wc-navigating', pageKeyOf(target));

    var isPop = !!opts.pop;
    fetchPage(target, { signal: ctrl.signal, noCache: !!opts.noCache }).then(function (data) {
      if (gen !== navGen) return;
      if (data.url && data.url !== target) {
        // Server boshqa manzilga yo'naltirdi (masalan login) — to'liq yuklaymiz.
        if (!routeOf(data.url)) throw new Error('redirect');
      }
      return applyPage(data, target, { pop: isPop, scrollY: opts.scrollY, replace: !!opts.replace });
    }).then(function () {
      if (gen !== navGen) return;
      navAbort = null;
      setAttr('data-wc-navigating', '');
    }).catch(function (err) {
      if (gen !== navGen) return;
      if (err && err.name === 'AbortError') return;
      navAbort = null;
      setAttr('data-wc-navigating', '');
      progressDone();
      // Eng xavfsiz zaxira: oddiy to'liq yuklash.
      location.href = target;
    });
  }

  // ==========================================================================
  // 8. HODISALAR
  // ==========================================================================
  function onClick(e) {
    if (!enabled || !supported) return;
    if (e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    if (a.hasAttribute('data-no-spa') || a.hasAttribute('download')) return;
    if (a.hasAttribute('data-nav-search')) return;
    if (a.target && a.target !== '_self') return;
    var rel = String(a.getAttribute('rel') || '');
    if (/\bexternal\b/.test(rel)) return;

    var href = a.getAttribute('href') || '';
    if (!href || href.charAt(0) === '#' || /^(mailto:|tel:|javascript:|blob:|data:)/i.test(href)) return;

    var target = abs(a.href, location.href);
    var u = urlOf(target);
    if (!u || u.protocol !== location.protocol || u.host !== location.host) return;
    if (!routeOf(target)) return;

    // Bir xil sahifa + faqat hash — brauzerga qoldiramiz.
    if (u.pathname === location.pathname && u.search === location.search && u.hash) return;
    // Aynan shu manzil: qayta yuklashning hojati yo'q (worker saqlanadi).
    if (target.split('#')[0] === location.href.split('#')[0]) {
      e.preventDefault();
      return;
    }

    e.preventDefault();
    navigate(target, { push: true });
  }

  function onOver(e) {
    if (!enabled || !supported) return;
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || a.hasAttribute('data-no-spa') || a.hasAttribute('data-nav-search')) return;
    if (a.target && a.target !== '_self') return;
    var href = a.getAttribute('href') || '';
    if (!href || href.charAt(0) === '#' || /^(mailto:|tel:|javascript:)/i.test(href)) return;
    var target = abs(a.href, location.href);
    if (!routeOf(target)) return;
    if (target === hoverUrl) return;
    hoverUrl = target;
    if (hoverTimer && _clearTimeout) _clearTimeout(hoverTimer);
    hoverTimer = _setTimeout(function () { prefetch(target); }, 140);
  }

  function onOut(e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    if (hoverTimer && _clearTimeout) _clearTimeout(hoverTimer);
    hoverTimer = 0;
    hoverUrl = '';
  }

  /** Joriy sahifa `watch.php` bo'lib, faqat `e` (qism) o'zgarganmi?
   *  Bunday holatda sahifani qayta chizmaymiz — `watch.js` qismni o'zi
   *  almashtiradi (`wc:watchpop` hodisasi orqali). */
  function watchEpisodePop(target) {
    if (currentPage !== 'watch') return false;
    var a = urlOf(currentUrl);
    var b = urlOf(target);
    if (!a || !b) return false;
    if (routeOf(target) !== 'watch') return false;
    if (a.pathname !== b.pathname) return false;
    if (a.searchParams.get('c') !== b.searchParams.get('c')) return false;
    var be = b.searchParams.get('e');
    if (!be) return false;                       // `e` yo'q -> oddiy soft-nav
    return a.searchParams.get('e') !== be;
  }

  function onPop(e) {
    if (!enabled || !supported) return;
    var target = location.href;
    if (!routeOf(target)) {
      location.reload();
      return;
    }
    var st = e.state || {};
    var y = typeof st.y === 'number' ? st.y : undefined;

    if (watchEpisodePop(target)) {
      // Qism almashinuvi: URL allaqachon brauzer tomonidan o'zgargan.
      currentUrl = target;
      try {
        var saved = Object.assign({}, history.state || {}, {
          wc: 1, page: 'watch', y: Math.round(global.pageYOffset || 0)
        });
        history.replaceState(saved, '', target);
      } catch (e2) {}
      dispatch('wc:watchpop', { url: target });
      return;
    }

    navigate(target, { pop: true, scrollY: y, noCache: false });
  }

  function onScroll() {
    if (scrollTimer) return;
    scrollTimer = _setTimeout(function () {
      scrollTimer = 0;
      if (!enabled || !supported || !bootDone) return;
      try {
        var st = Object.assign({}, history.state || {}, { wc: 1, page: currentPage, y: Math.round(global.pageYOffset || 0) });
        history.replaceState(st, '', location.href);
      } catch (e) {}
    }, 260);
  }

  // ==========================================================================
  // 9. ISHGA TUSHISH
  // ==========================================================================

  // Sahifa moduli `history.pushState` qilsa (masalan `watch.js` qismni
  // almashtirsa), `currentUrl` ham yangilanadi — aks holda keyingi
  // back/forward noto'g'ri yo'nalishga olib boradi.
  var _pushState = global.history && global.history.pushState;
  var _replaceState = global.history && global.history.replaceState;
  if (_pushState) {
    global.history.pushState = function (state, title, url) {
      var r = _pushState.apply(global.history, arguments);
      try { if (url) currentUrl = abs(url, location.href); } catch (e) {}
      return r;
    };
  }
  if (_replaceState) {
    global.history.replaceState = function (state, title, url) {
      var r = _replaceState.apply(global.history, arguments);
      try { if (url) currentUrl = abs(url, location.href); } catch (e) {}
      return r;
    };
  }

  /** `fn` ni scope'ga yozmasdan bajaradi. Doimiy kutubxonalar (`tg-stream.js`
   *  keep-alive taymeri, `tg-persist.php`) uchun: ular sahifa bilan birga
   *  o'chib ketmasligi kerak. */
  function untracked(fn) {
    if (typeof fn !== 'function') return undefined;
    if (!activeScope || activeScope.dead || !activeScope.patched) return fn();
    var s = activeScope;
    s.suspend();
    try {
      return fn();
    } finally {
      if (activeScope === s && !s.dead) s.begin();
    }
  }

  /** Sahifa skriptlaridan OLDIN chaqiriladi (PHP sahifasidagi inline
   *  `<script>WCApp.beginPage()</script>`). Shu tufayli sahifa modulining
   *  barcha listener/taymer/observer'lari qayd etiladi va keyingi
   *  navigatsiyada tozalanadi. */
  function beginPage() {
    if (!enabled || !supported || bootDone) return;
    if (activeScope && !activeScope.dead) return;
    var pageEl = doc.querySelector(PAGE_SEL);
    if (!pageEl) return;
    currentPage = String(pageEl.getAttribute('data-wc-page') || '');
    activeScope = new Scope();
    activeScope.begin();
  }

  // Shell listenerlari Scope hisobiga yozilmasligi kerak: ular butun
  // hujjat umri davomida ishlaydi. Shuning uchun native qo'shuvchilardan
  // foydalanamiz.
  function rawDocAdd(type, fn, opts) {
    var add = (activeScope && activeScope.prev && activeScope.prev.docAdd) || doc.addEventListener;
    try { add.call(doc, type, fn, opts); } catch (e) {}
  }
  function rawWinAdd(type, fn, opts) {
    var add = (activeScope && activeScope.prev && activeScope.prev.winAdd) || global.addEventListener;
    try { add.call(global, type, fn, opts); } catch (e) {}
  }

  function boot() {
    if (bootDone) return;
    bootDone = true;

    // `shellDomReady()` scope'ni vaqtincha o'chirgan edi (nav darajasidagi
    // skriptlar kuzatilmasin). Sahifa modullari `DOMContentLoaded` ni
    // BIZDAN KEYIN ro'yxatdan o'tkazgan — ular uchun kuzatuvni qaytaramiz.
    if (activeScope && !activeScope.dead && !activeScope.patched) activeScope.begin();

    markInitialScripts();

    var pageEl = doc.querySelector(PAGE_SEL);
    if (pageEl) {
      currentPage = String(pageEl.getAttribute('data-wc-page') || '');
      pageEl.setAttribute('tabindex', '-1');
      // `beginPage()` allaqachon scope ochgan bo'lsa — uni saqlaymiz:
      // sahifa skriptlari shu scope ostida ishlagan.
      if (!activeScope) {
        activeScope = new Scope();
        activeScope.begin();
      }
      setAttr('data-wc-shell', '1');
      setAttr('data-wc-page', currentPage);
      try {
        if (!history.state || !history.state.wc) {
          history.replaceState({ wc: 1, page: currentPage, y: Math.round(global.pageYOffset || 0) }, '', location.href);
        }
      } catch (e) {}
      dispatch('wc:pagemount', { page: currentPage, url: location.href, scope: activeScope });
    } else {
      setAttr('data-wc-shell', '0');
    }

    if (enabled && supported && pageEl) {
      rawDocAdd('click', onClick, false);
      rawDocAdd('pointerover', onOver, { passive: true });
      rawDocAdd('pointerout', onOut, { passive: true });
      rawWinAdd('popstate', onPop);
      rawWinAdd('scroll', onScroll, { passive: true });
      try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; } catch (e) {}
    }
  }

  // --- ommaviy API -----------------------------------------------------------
  global.WCApp = {
    __core: true,
    version: 1,
    isEnabled: function () { return !!(enabled && supported); },
    page: function () { return currentPage; },
    beginPage: beginPage,
    untracked: untracked,
    navigate: navigate,
    prefetch: prefetch,
    clearCache: clearCache,
    scope: function () { return activeScope; },
    // Diagnostika: `TgStream.boshqarish.ulanish()` bilan birga ishlatiladi.
    state: function () {
      return {
        enabled: !!(enabled && supported),
        page: currentPage,
        url: currentUrl,
        route: routeOf(location.href),
        scope: !!activeScope,
        cached: Object.keys(cache).length
      };
    },
    // Testlar / boshqa modullar uchun: sahifa skriptini qayta ishga tushirish.
    remount: function () {
      if (!activeScope) return Promise.resolve();
      var pageEl = doc.querySelector(PAGE_SEL);
      if (!pageEl) return Promise.resolve();
      dispatch('wc:pageunmount', { page: currentPage, url: currentUrl });
      activeScope.destroy();
      activeScope = new Scope();
      activeScope.begin();
      dispatch('wc:pagemount', { page: currentPage, url: currentUrl, scope: activeScope });
      return Promise.resolve();
    }
  };

  // `DOMContentLoaded` window CAPTURE bosqichida — hujjatdagi barcha
  // listenerlardan oldin ishlaydi. Nav darajasidagi skriptlar (`tv-mode`,
  // `badge-poll`, `notifications`, `dm-badge`, `site-banner`, `tg-persist`)
  // o'z boot'larini shu paytda bajaradi: ular scope'ga YOZILMAYDI, aks holda
  // birinchi SPA o'tishida ularning taymerlari o'chib qolardi.
  // `boot()` (hujjat listeneri, sahifa modullaridan oldin ro'yxatdan o'tgan)
  // esa kuzatuvni qayta yoqadi — `watch.js` / `reels.js` kabi modullar
  // kuzatilaveradi.
  function shellDomReady() {
    if (activeScope && !activeScope.dead && activeScope.patched) activeScope.suspend();
  }
  if (doc.readyState === 'loading') {
    global.addEventListener('DOMContentLoaded', shellDomReady, true);
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})(window);
