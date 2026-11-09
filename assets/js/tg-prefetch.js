/* ============================================================================
 * tg-prefetch.js — "issiq start": mashhur videolar metama'lumotini tayyorlash
 * ----------------------------------------------------------------------------
 * Muammo: foydalanuvchi katalogdan videoni bosganda, sayt avval Telegram'dan
 * hujjatni TOPIB (kanal/post), keyin birinchi baytlarni yuklaydi. Bu ~0.5-1.5s.
 *
 * Yechim: bosh sahifada sahifa bo'sh turganda mashhur videolar metama'lumoti
 * kichik guruhlar bilan olinadi. Video baytlari oldindan yuklanmaydi; foydalanuvchi
 * videoni bosgandagina oqim boshlanadi.
 *
 * CHEKLOVLAR (muhim, foydalanuvchi internetini yeb qo'ymaslik uchun):
 *   - `saveData` yoqilgan yoki 2G/slow-2g → UMUMAN ishlamaydi.
 *   - Har qanday tarmoqda faqat metama'lumot; video baytlari yuklanmaydi.
 *   - Bir sahifada ko'pi bilan 20 ta mashhur video, 4 tadan kichik batch.
 *   - Data Saver/2G da o'chadi; video o'ynayotgan paytda boshlanmaydi.
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
  var META_ITEMS = 20;
  var META_BATCH = 4;

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

  function loadList() {
    var url = (BASE || '') + '/api/hot.php?n=' + encodeURIComponent(String(META_ITEMS));
    return fetch(url, { credentials: 'omit' }).then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (j) {
      return (j && j.items) ? j.items : [];
    });
  }

  async function run() {
    // Faqat bosh sahifada: watch.php o'z qism ro'yxatini, boshqa sahifalar esa
    // o'z ishini boshqaradi. Dinamik katalog kartalariga bog'lanmaymiz.
    if (!document.getElementById('homeFeed')) return;

    var p = policy();
    if (!p.ok) return;

    var T;
    try { T = await waitForTgStream(20000); } catch (e) { return; }
    try { if (typeof T.hasSession === 'function' && !T.hasSession()) return; } catch (e) { return; }

    await waitIdle();
    if (videoBusy()) return;

    var items = [];
    try { items = await loadList(); } catch (e) { return; }

    // Ro'yxat ko'rishlar soni bo'yicha tartiblangan. Faqat metama'lumot
    // keshlanadi; batch ichidagi parallel Telegram so'rovlari 4 tadan oshmaydi.
    items = items.filter(function (it) {
      return it && it.channel && Number(it.post) > 0;
    }).slice(0, META_ITEMS);

    for (var i = 0; i < items.length; i += META_BATCH) {
      if (document.hidden || videoBusy()) break;
      try {
        await T.prefetchManyGram(items.slice(i, i + META_BATCH));
      } catch (e) { /* bitta batch xato bo'lsa — keyingisi davom etadi */ }
      if (i + META_BATCH < items.length) {
        await new Promise(function (r) { setTimeout(r, GAP); });
      }
    }
  }

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
