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

  global.WCLib = {
    owner: owner,
    list: list,
    has: has,
    add: add,
    remove: remove,
    toggle: toggle,
    counts: counts,
    clear: clear
  };
})(window);
