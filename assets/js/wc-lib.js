/* ============================================================================
 * W CINEMA — MAHALLIY KUTUBXONA (localStorage)
 * ============================================================================
 * Saytga Telegram (MTProto) orqali kiriladi va serverda alohida hisob
 * bo'lmasa, "Kutubxona" (Saqlanganlar / Yoqqanlar / Tarix) shu brauzerda
 * saqlanadi. Bo'limlar Telegram akkaunt id'siga bog'lanadi (bo'lmasa —
 * anonim brauzer id). Serverga hech narsa yuborilmaydi.
 *
 *   WCLib.add('saved', item)     -> saqlanganlarga qo'shish
 *   WCLib.toggle('liked', item)  -> yoqtirishga o'tkazish
 *   WCLib.list('history')        -> ro'yxat
 *   WCLib.counts()               -> { saved, liked, history }
 * ========================================================================== */
(function (global) {
  'use strict';

  var CAP = 200;
  var KEY = 'wc_lib_v1';

  function anonId() {
    try {
      var a = localStorage.getItem('wc_anon_id');
      if (a && a.length >= 8) return a;
      a = (global.crypto && global.crypto.randomUUID)
        ? global.crypto.randomUUID()
        : ('anon-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10));
      localStorage.setItem('wc_anon_id', a);
      return a;
    } catch (e) { return 'anon'; }
  }

  // Telegram akkaunt id: avval saqlangan "me" yozuvi, keyin TgStream.
  function tgId() {
    try {
      var raw = localStorage.getItem('wc_tg_me_v1');
      if (raw) {
        var m = JSON.parse(raw);
        if (m && m.id) return String(m.id);
      }
    } catch (e) {}
    try {
      if (global.TgStream && typeof global.TgStream.me === 'function') {
        var m2 = global.TgStream.me();
        if (m2 && m2.id) return String(m2.id);
      }
    } catch (e) {}
    return '';
  }

  function owner() {
    var t = tgId();
    return t ? ('tg_' + t) : ('anon_' + anonId());
  }

  function readAll() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function writeAll(d) {
    try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {}
  }

  function bucket(which) {
    var all = readAll();
    var d = all[owner()];
    if (!d || typeof d !== 'object') d = {};
    if (!Array.isArray(d[which])) d[which] = [];
    return { all: all, d: d };
  }

  function list(which) {
    return bucket(which).d[which];
  }

  function normalize(item) {
    return {
      id: String(item.id != null ? item.id : ''),
      title: String(item.title || ''),
      poster: String(item.poster || ''),
      category: String(item.category || ''),
      year: item.year || '',
      at: Date.now()
    };
  }

  function has(which, id) {
    id = String(id);
    return list(which).some(function (x) { return String(x.id) === id; });
  }

  function add(which, item) {
    if (!item || item.id == null || item.id === '') return false;
    var b = bucket(which);
    var id = String(item.id);
    b.d[which] = b.d[which].filter(function (x) { return String(x.id) !== id; });
    b.d[which].unshift(normalize(item));
    if (b.d[which].length > CAP) b.d[which] = b.d[which].slice(0, CAP);
    b.all[owner()] = b.d;
    writeAll(b.all);
    return true;
  }

  function remove(which, id) {
    id = String(id);
    var b = bucket(which);
    b.d[which] = b.d[which].filter(function (x) { return String(x.id) !== id; });
    b.all[owner()] = b.d;
    writeAll(b.all);
    return true;
  }

  function toggle(which, item) {
    if (has(which, item.id)) { remove(which, item.id); return false; }
    add(which, item);
    return true;
  }

  function counts() {
    return {
      saved: list('saved').length,
      liked: list('liked').length,
      history: list('history').length
    };
  }

  function clear() {
    var all = readAll();
    delete all[owner()];
    writeAll(all);
  }

  // ---------------------------------------------------------------------------
  // VIDEO KADRI — YouTube uslubidagi muqova
  // ---------------------------------------------------------------------------
  // Poster qo'yilmagan videolar uchun karta fon rasmini brauzerning O'ZI
  // <video> elementidan oladi: kadr canvas'ga chizilib, kichik JPEG sifatida
  // shu brauzerda saqlanadi. Keyingi ochilishlarda karta darhol HAQIQIY kadr
  // bilan ko'rinadi (YouTube'dagi "video kadri = muqova" kabi).
  //
  //   WCLib.frames.get(id)              -> dataURL yoki ''
  //   WCLib.frames.save(id, dataURL)
  //   WCLib.frames.capture(videoEl, id) -> dataURL (o'zi saqlaydi)
  //   WCLib.frames.watch(hostEl, id, { onFrame }) -> tozalash funksiyasi
  // ---------------------------------------------------------------------------
  var FKEY = 'wc_frames_v1';
  var FMAX = 160;          // eng ko'p yozuv
  var FBYTES = 2400000;    // ~2.4 MB (localStorage odatda ~5 MB)

  // XOTIRA KESHI: kartalar ro'yxatida `get()` har bir karta uchun
  // chaqiriladi. Har safar localStorage'ni o'qib JSON.parse qilish
  // (yuzlab yozuv, ~MB) ro'yxatni sekinlashtirardi. Shuning uchun
  // obyekt bir marta o'qiladi va xotirada saqlanadi; yozuvlar uni
  // yangilab turadi.
  var F_CACHE = null;

  function framesRead() {
    if (F_CACHE) return F_CACHE;
    try { F_CACHE = JSON.parse(localStorage.getItem(FKEY) || '{}') || {}; }
    catch (e) { F_CACHE = {}; }
    return F_CACHE;
  }

  function framesWrite(d) {
    F_CACHE = d;
    try { localStorage.setItem(FKEY, JSON.stringify(d)); return; } catch (e) {}
    // Joy yetmasa — eng eski yarmini tashlab qayta urinamiz.
    try {
      var keys = Object.keys(d).sort(function (a, b) { return (d[a].t || 0) - (d[b].t || 0); });
      keys.slice(0, Math.ceil(keys.length / 2)).forEach(function (k) { delete d[k]; });
      localStorage.setItem(FKEY, JSON.stringify(d));
    } catch (e2) {}
  }

  function frameGet(id) {
    if (id === null || id === undefined || id === '') return '';
    var f = framesRead()[String(id)];
    return (f && typeof f.u === 'string') ? f.u : '';
  }

  function frameSave(id, url) {
    if (id === null || id === undefined || id === '' || !url || url.length < 8) return;
    var d = framesRead();
    d[String(id)] = { t: Date.now(), u: url };
    var keys = Object.keys(d);
    if (keys.length > FMAX) {
      keys.sort(function (a, b) { return (d[a].t || 0) - (d[b].t || 0); });
      keys.slice(0, keys.length - FMAX).forEach(function (k) { delete d[k]; });
    }
    // Umumiy hajm cheki — oshib ketsa eng eski yozuvlarni tashlaymiz.
    try {
      while (Object.keys(d).length > 8 && JSON.stringify(d).length > FBYTES) {
        var kk = Object.keys(d).sort(function (a, b) { return (d[a].t || 0) - (d[b].t || 0); });
        delete d[kk[0]];
      }
    } catch (e) {}
    framesWrite(d);
  }

  // <video> dan bitta kadr oladi. MSE `blob:` oqimlari uchun ham ishlaydi
  // (canvas "ifloslanmaydi"). Boshqa domendagi manbalar uchun brauzer
  // SecurityError beradi — o'shanda jimgina '' qaytadi.
  function frameCapture(video, id, opts) {
    try {
      if (!video || !video.videoWidth || !video.videoHeight) return '';
      if (video.readyState < 2) return '';
      opts = opts || {};
      var w = opts.width || 480;
      var h = Math.max(1, Math.round(w * video.videoHeight / video.videoWidth));
      var cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      var ctx = cv.getContext('2d');
      if (!ctx) return '';
      ctx.drawImage(video, 0, 0, w, h);
      var url = cv.toDataURL('image/jpeg', opts.quality || 0.62);
      if (url && url.length > 8) {
        if (id !== null && id !== undefined && id !== '') frameSave(id, url);
        return url;
      }
      return '';
    } catch (e) { return ''; }
  }

  // Host element ichidan <video> ni topib, oqim ulgurgach kadr oladi.
  // `onFrame(url)` bir marta chaqiriladi. Tozalash funksiyasi qaytadi.
  function frameWatch(host, id, opts) {
    opts = opts || {};
    var done = false, tries = 0, timer = null;
    function cleanup() { if (timer) { clearInterval(timer); timer = null; } }
    function attempt() {
      if (done) { cleanup(); return; }
      var v = (host && host.querySelector) ? host.querySelector('video') : null;
      if (v && v.readyState >= 2 && !v.seeking) {
        if (!opts.minTime || v.currentTime >= opts.minTime) {
          var url = frameCapture(v, id, opts);
          if (url) {
            done = true; cleanup();
            if (typeof opts.onFrame === 'function') { try { opts.onFrame(url); } catch (e) {} }
            return;
          }
        }
      }
      if (++tries > (opts.maxTries || 60)) cleanup();   // ~30 s dan keyin to'xtatamiz
    }
    timer = setInterval(attempt, opts.interval || 500);
    attempt();
    return cleanup;
  }

  global.WCLib = {
    owner: owner,
    list: list,
    has: has,
    add: add,
    remove: remove,
    toggle: toggle,
    counts: counts,
    clear: clear,
    frames: {
      get: frameGet,
      save: frameSave,
      capture: frameCapture,
      watch: frameWatch
    }
  };
})(window);
