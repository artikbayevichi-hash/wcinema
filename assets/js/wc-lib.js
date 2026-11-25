/* ============================================================================
 * W CINEMA — MAHALLIY KUTUBXONA (localStorage)
 * ============================================================================
 * Saytga Telegram (MTProto) orqali kiriladi va serverda alohida hisob
 * bo'lsa, "Kutubxona" (Saqlanganlar / Yoqqanlar / Tarix) shu brauzerda
 * saqlanadi. Bo'limlar Telegram akkaunt id'siga bog'lanadi (bo'lmasa —
 * anonim brauzer id). O'zgarishlar kichik navbat bilan serverga ham
 * yoziladi (api/library-sync.php) va serverdagi holat qaytarib o'rnatiladi —
 * kesh tozalansa yoki boshqa qurilmaga o'tilsa ham kutubxona yo'qolmaydi.
 * Server javob bermasa (401 ham) mahalliy rejim jim davom etadi.
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
    schedulePush(which, id, Date.now(), false);
    return true;
  }

  function remove(which, id) {
    id = String(id);
    var b = bucket(which);
    b.d[which] = b.d[which].filter(function (x) { return String(x.id) !== id; });
    b.all[owner()] = b.d;
    writeAll(b.all);
    schedulePush(which, id, Date.now(), true);
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
    var d = all[owner()] || {};
    // O'chirish niyatini serverga ham yetkazamiz, aks holda keyingi
    // sinxronlashda kontent qaytadan paydo bo'lib qoladi.
    ['saved', 'liked'].forEach(function (b) {
      (Array.isArray(d[b]) ? d[b] : []).forEach(function (x) {
        if (x && x.id != null) schedulePush(b, x.id, Date.now(), true);
      });
    });
    delete all[owner()];
    writeAll(all);
  }

  // ---------------------------------------------------------------------------
  // SERVER SINXRONIZATSIYASI
  // ---------------------------------------------------------------------------
  // Mahalliy yozuvlar oldin bajariladi (UI darhol javob beradi), keyin kichik
  // navbat 700 ms ichida serverga yuboriladi. Server javobi bilan bucketlar
  // ustiga yoziladi; shu orada yangi o'zgarish bo'lsa navbat saqlanib qoladi.
  var SYNC_KEY = 'wc_lib_sync_v1';
  var syncTimer = null;
  var syncing = false;
  var applying = false;

  function syncRead() {
    try { return JSON.parse(localStorage.getItem(SYNC_KEY) || '{}') || {}; }
    catch (e) { return {}; }
  }
  function syncWrite(s) {
    try { localStorage.setItem(SYNC_KEY, JSON.stringify(s)); } catch (e) {}
  }
  function syncBase() {
    try {
      if (global.APP && global.APP.base) return String(global.APP.base).replace(/\/$/, '');
    } catch (e) {}
    try {
      if (global.WC_BASE) return String(global.WC_BASE).replace(/\/$/, '');
    } catch (e) {}
    return '';
  }
  function pairsToArray(pairs) {
    var out = [];
    if (!pairs) return out;
    Object.keys(pairs).forEach(function (id) {
      out.push({ id: id, at: Number(pairs[id]) || Date.now() });
    });
    return out.slice(0, CAP);
  }
  function queueHas(s) {
    return !!((s.pos && Object.keys(s.pos).some(function (b) {
      return s.pos[b] && Object.keys(s.pos[b]).length;
    })) || (s.rem && Object.keys(s.rem).some(function (b) {
      return s.rem[b] && Object.keys(s.rem[b]).length;
    })));
  }

  function schedulePush(which, id, at, removed) {
    if (applying || which === 'later' || id == null || id === '') return;
    var s = syncRead();
    // Navbat boshqa akkauntga tegishli bo'lsa — uni tashlaymiz.
    if (s.owner && s.owner !== owner()) s = {};
    s.owner = owner();
    s.pos = s.pos || {};
    s.rem = s.rem || {};
    var key = String(id);
    var target = removed ? s.rem : s.pos;
    var other = removed ? s.pos : s.rem;
    if (other[which]) delete other[which][key];   // oxirgi niyat g'alaba qozonadi
    target[which] = target[which] || {};
    target[which][key] = Number(at) || Date.now();
    syncWrite(s);
    scheduleSync();
  }

  function clearSent(sent) {
    var cur = syncRead();
    if (!cur || cur.owner !== sent.owner) return;
    ['liked', 'saved', 'history'].forEach(function (b) {
      if (!sent.pos || !sent.pos[b] || !cur.pos || !cur.pos[b]) return;
      Object.keys(sent.pos[b]).forEach(function (id) { delete cur.pos[b][id]; });
    });
    ['liked', 'saved'].forEach(function (b) {
      if (!sent.rem || !sent.rem[b] || !cur.rem || !cur.rem[b]) return;
      Object.keys(sent.rem[b]).forEach(function (id) { delete cur.rem[b][id]; });
    });
    syncWrite(cur);
  }

  function scheduleSync() {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(function () {
      syncTimer = null;
      syncNow();
    }, 700);
  }

  function applyRemote(d) {
    applying = true;
    try {
      var all = readAll();
      var cur = owner();
      if (!all[cur] || typeof all[cur] !== 'object') all[cur] = {};
      ['liked', 'saved', 'history'].forEach(function (b) {
        if (!Array.isArray(d[b])) return;
        var out = [];
        var seen = {};
        // Server ma'lumoti asosiy: sarlavha/poster/toifa ham shu yerda.
        d[b].forEach(function (x) {
          if (!x || x.id == null) return;
          var id = String(x.id);
          if (seen[id]) return;
          seen[id] = 1;
          out.push({
            id: id,
            title: String(x.title || ''),
            poster: String(x.poster || ''),
            category: String(x.category || ''),
            year: x.year || '',
            at: Number(x.at) || Date.now()
          });
        });
        // Serverda yo'q, lekin mahalliy mavjud yozuvlarni yo'q qilmaymiz.
        (Array.isArray(all[cur][b]) ? all[cur][b] : []).forEach(function (x) {
          if (!x || x.id == null) return;
          var id = String(x.id);
          if (seen[id]) return;
          seen[id] = 1;
          out.push(x);
        });
        all[cur][b] = out.slice(0, CAP);
      });
      writeAll(all);
    } finally {
      applying = false;
    }
    try { global.dispatchEvent(new Event('wc:library')); } catch (e) {}
    try { document.dispatchEvent(new Event('wc:watchState')); } catch (e) {}
  }

  function syncNow() {
    if (syncing) return;
    syncing = true;
    var sent = syncRead();
    var usePost = queueHas(sent);
    var url = syncBase() + '/api/library-sync.php';
    var me = '';
    try { me = localStorage.getItem('wc_tg_me_v1') || ''; } catch (e) {}
    if (me) {
      url += (url.indexOf('?') < 0 ? '?' : '&') + 'tg_me=' + encodeURIComponent(me);
    }
    var init = {
      method: usePost ? 'POST' : 'GET',
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
    };
    if (usePost) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify({
        liked: pairsToArray(sent.pos && sent.pos.liked),
        saved: pairsToArray(sent.pos && sent.pos.saved),
        history: pairsToArray(sent.pos && sent.pos.history),
        removed: {
          liked: pairsToArray(sent.rem && sent.rem.liked),
          saved: pairsToArray(sent.rem && sent.rem.saved)
        }
      });
    }

    function finish(ok) {
      if (ok) clearSent(sent);
      syncing = false;
      if (queueHas(syncRead())) scheduleSync();
    }
    if (typeof fetch !== 'function') { finish(false); return; }
    fetch(url, init).then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (d) {
      if (!d || !d.success) { finish(false); return; }
      applyRemote(d);
      finish(true);
    }).catch(function () { finish(false); });
  }

  // Anonim brauzerda yig'ilgan kutubxona Telegram akkauntiga kirganda
  // o'tib ketmasligi uchun bir marta ko'chiramiz (faqat anon -> tg).
  function migrateOwners() {
    var all = readAll();
    var cur = owner();
    if (cur.indexOf('tg_') !== 0) return;
    var keys = Object.keys(all).filter(function (k) { return k.indexOf('anon_') === 0; });
    if (!keys.length) return;
    if (!all[cur] || typeof all[cur] !== 'object') all[cur] = {};
    ['saved', 'liked', 'history', 'later'].forEach(function (b) {
      if (!Array.isArray(all[cur][b])) all[cur][b] = [];
      var byId = {};
      all[cur][b].forEach(function (x) {
        if (x && x.id != null) byId[String(x.id)] = x;
      });
      keys.forEach(function (k) {
        var src = all[k] && all[k][b];
        if (!Array.isArray(src)) return;
        src.forEach(function (x) {
          if (!x || x.id == null) return;
          var id = String(x.id);
          if (!byId[id] || Number(x.at || 0) > Number(byId[id].at || 0)) byId[id] = x;
        });
      });
      all[cur][b] = Object.keys(byId).map(function (id) { return byId[id]; }).slice(0, CAP);
    });
    keys.forEach(function (k) { delete all[k]; });
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
    sync: syncNow,
    frames: {
      get: frameGet,
      save: frameSave,
      capture: frameCapture,
      watch: frameWatch
    }
  };

  // Sahifa ochilganda: avval eski anon yozuvlarni akkauntga ko'chirib,
  // so'ng serverdagi holatni olib mahalliy kutubxonani yangilaymiz.
  try {
    migrateOwners();
    syncNow();
  } catch (e) {}
})(window);
