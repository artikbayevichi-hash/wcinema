/* ============================================================================
 * tg-prefetch.js — "issiq start": BARCHA videolar havolasini yangilaydi
 * ----------------------------------------------------------------------------
 * Muammo: `file_reference` vaqt o'tishi bilan eskiradi. Eski havola bilan
 * video ochilganda Telegram rad etadi va kod `api/tg-doc.php?fresh=1` bilan
 * 5–8 s kutadi (ikki marta) — foydalanuvchi ~30 s kutib qoladi.
 *
 * Yechim: saytga kirganda (har 30 daqiqada bir marta) BARCHA videolarning
 * kanal/post juftligini olib, havolani foydalanuvchining O'Z sessiyasi
 * (GramJS) bilan yangilab, lokal keshga yozamiz. Video bosilganda yangi
 * havola tayyor bo'ladi — sekin `fresh=1` umuman chaqirilmaydi.
 *
 * CHEKLOVLAR (foydalanuvchi internetini yeb qo'ymaslik uchun):
 *   - `saveData` yoqilgan yoki 2G/slow-2g → UMUMAN ishlamaydi.
 *   - Faqat metama'lumot (~200 bayt/video); VIDEO BAYTLARI yuklanmaydi.
 *   - 20 tadan batch, orasida 500 ms tanaffus; video o'ynasa to'xtaydi.
 *   - Serverga faqat eng ko'p ko'rilgan 40 tasining havolasi yoziladi;
 *     qolganlari brauzerning o'z keshida saqlanadi.
 *
 * O'chirish: localStorage.setItem('wc_prefetch','0')
 *            yoki window.__WCPF = {off:true}
 * ========================================================================== */
(function (w) {
  'use strict';

  var CFG = w.__WCPF || {};
  if (CFG.off) return;
  try {
    if (localStorage.getItem('wc_prefetch') === '0') return;
  } catch (e) { return; }

  var BASE = (w.APP && w.APP.base) || '';
  var GAP  = 500;                  // batchlar orasidagi tanaffus
  var META_ITEMS = 60;             // zaxira ro'yxat (video-refs.php ishlamasa)
  var META_BATCH = 20;             // bitta Telegram RPC ga 20 ta post
  var REFRESH_GAP_MS = 30 * 60 * 1000;  // saytga kirishda har 30 daqiqada
  var WRITEBACK = 40;              // serverga yoziladigan eng ko'p yozuv

  var api = w.WCPrefetch = { last: null, running: false };

  function conn() {
    return w.navigator && (w.navigator.connection || w.navigator.mozConnection || w.navigator.webkitConnection) || null;
  }

  function policy() {
    var c = conn();
    var save = !!(c && c.saveData);
    var et   = c ? String(c.effectiveType || '') : '';
    if (save) return { ok: false };
    if (et === 'slow-2g' || et === '2g') return { ok: false };
    return { ok: true };
  }

  function videoBusy() {
    var vids = document.querySelectorAll('video');
    for (var i = 0; i < vids.length; i++) {
      if (!vids[i].paused && !vids[i].ended) return true;
    }
    return false;
  }

  function waitIdle() {
    return new Promise(function (res) {
      if ('requestIdleCallback' in w) {
        w.requestIdleCallback(function () { res(); }, { timeout: 4000 });
      } else {
        setTimeout(res, 1500);
      }
    });
  }

  function waitForTgStream(timeoutMs) {
    return new Promise(function (res, rej) {
      var t0 = Date.now();
      (function poll() {
        if (w.TgStream && typeof w.TgStream.prefetchManyGram === 'function') return res(w.TgStream);
        if (Date.now() - t0 > timeoutMs) return rej(new Error('no TgStream'));
        setTimeout(poll, 400);
      })();
    });
  }

  // BARCHA videolar: {ch, p} juftliklari. Bitta kichik, 10 daqiqa keshli JSON.
  // Endpoint ishlamasa — eski "eng ko'p ko'rilgan 60 ta" ro'yxatiga qaytamiz.
  async function loadList() {
    try {
      var r = await fetch((BASE || '') + '/api/video-refs.php', { credentials: 'omit' });
      if (r.ok) {
        var d = await r.json();
        if (d && d.success && d.items && d.items.length) {
          return d.items.map(function (x) {
            return { channel: String(x.ch || '').replace(/^@/, ''), post: Number(x.p || 0) };
          }).filter(function (x) { return x.channel && x.post > 0; });
        }
      }
    } catch (e) { /* zaxira ro'yxatga o'tamiz */ }

    var r2 = await fetch((BASE || '') + '/api/hot.php?n=' + META_ITEMS, { credentials: 'omit' });
    if (!r2.ok) return [];
    var j = await r2.json();
    return (j && j.items ? j.items : []).filter(function (it) {
      return it && it.channel && Number(it.post) > 0;
    }).slice(0, META_ITEMS);
  }

  // ------------------------------------------------------------------------
  // "DAVOM ETTIRISH": foydalanuvchi oxirgi ko'rgan video eng ehtimoliy
  // qayta bosiladigan video. Faqat SHU BITTA videoning boshi (2–4 MB)
  // tayyorlanadi — minglab foydalanuvchida ham Telegram'ga yuk deyarli yo'q.
  // ------------------------------------------------------------------------
  function lastWatched() {
    try {
      var all = JSON.parse(localStorage.getItem('wc_lib_v1') || '{}') || {};
      var best = null;
      for (var k in all) {
        if (!Object.prototype.hasOwnProperty.call(all, k)) continue;
        var arr = all[k] && all[k].history;
        if (!arr || !arr.length) continue;
        for (var i = 0; i < arr.length; i++) {
          var it = arr[i];
          if (!it || !it.id) continue;
          if (!best || (Number(it.at) || 0) > (Number(best.at) || 0)) best = it;
        }
      }
      return best;
    } catch (e) { return null; }
  }

  async function warmContinue(T) {
    try {
      if (sessionStorage.getItem('wc_cw_done') === '1') return;
      sessionStorage.setItem('wc_cw_done', '1');
    } catch (e) { /* private mode */ }
    var it = lastWatched();
    if (!it) return;
    try {
      var r = await fetch((BASE || '') + '/api/prefetch-context.php?c=' + encodeURIComponent(String(it.id)),
        { credentials: 'same-origin' });
      if (!r.ok) return;
      var d = await r.json();
      if (!d || !d.success || !d.telegram || !d.channel || !Number(d.post)) return;
      if (document.hidden || videoBusy()) return;
      var opts = { channel: d.channel, post: Number(d.post), url: d.url || '' };
      try { if (typeof T.prefetch === 'function') await T.prefetch(opts); } catch (e) {}
      try { if (typeof T.warmMedia === 'function') T.warmMedia(opts); } catch (e) {}
    } catch (e) { /* jim */ }
  }

  async function run() {
    if (api.running) return api.last;
    api.running = true;
    try {
      var p = policy();
      if (!p.ok || document.hidden) return null;

      var T;
      try { T = await waitForTgStream(20000); } catch (e) { return null; }

      await waitIdle();
      if (document.hidden || videoBusy()) return null;

      // 0) "Davom ettirish" — faqat bitta video, eng katta ehtimol bilan.
      await warmContinue(T);
      if (document.hidden || videoBusy()) return null;

      // 1) BARCHA videolar havolasini yangilash (30 daqiqada bir marta).
      var last = 0;
      try { last = Number(localStorage.getItem('wc_refs_at') || 0) || 0; } catch (e) {}
      if (Date.now() - last < REFRESH_GAP_MS) return api.last;

      // Server keshini isitish (`prefetchMany`, bot sessiyasi) o'chirilgan:
      // bot havolasi tomoshabbin akkauntida ishlamaydi. Faqat GramJS.
      if (typeof T.hasSession === 'function' && !T.hasSession()) return null;
      if (typeof T.prefetchManyGram !== 'function') return null;

      var items = await loadList();
      if (!items.length) return null;

      var done = 0, wbLeft = WRITEBACK;
      for (var i = 0; i < items.length; i += META_BATCH) {
        if (document.hidden || videoBusy()) break;
        var batch = items.slice(i, i + META_BATCH);
        try {
          var n = await T.prefetchManyGram(batch, { refresh: true, writeback: wbLeft });
          n = Number(n) || 0;
          done += n;
          wbLeft = Math.max(0, wbLeft - n);
        } catch (e) { /* bitta batch xato bo'lsa — keyingisi davom etadi */ }
        if (i + META_BATCH < items.length) {
          await new Promise(function (r) { setTimeout(r, GAP); });
        }
      }

      try { localStorage.setItem('wc_refs_at', String(Date.now())); } catch (e) {}
      api.last = { at: Date.now(), items: items.length, refreshed: done };
      return api.last;
    } finally {
      api.running = false;
    }
  }

  api.run = run;
  api.status = function () { return api.last; };

  function start() {
    // `load` dan keyin — sahifaning asosiy ishlari tugagach.
    if (document.readyState === 'complete') {
      setTimeout(run, 1500);
    } else {
      w.addEventListener('load', function () { setTimeout(run, 1500); }, { once: true });
    }
  }

  start();
})(window);
