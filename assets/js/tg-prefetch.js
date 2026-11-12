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
  var META_ITEMS = 24;
  var META_BATCH = 20;             // server batch: bitta so'rovda 20 ta hujjat

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
        if (w.TgStream && (typeof w.TgStream.prefetchMany === 'function'
            || typeof w.TgStream.prefetchManyGram === 'function')) return res(w.TgStream);
        if (Date.now() - t0 > timeoutMs) return rej(new Error('no TgStream'));
        setTimeout(poll, 400);
      })();
    });
  }

  // Server keshi isitish (`api/tg-doc.php?warm=1`) 2026-11-12 da OLIB
  // TASHLANDI: bot sessiyasi bergan `file_reference` foydalanuvchi akkauntida
  // ishlamaydi, ya'ni bu isitish pleerga foyda bermasdi — faqat serverda
  // bekorga Telegram RPC ishlatardi.

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

    await waitIdle();
    if (videoBusy()) return;

    // 1) SERVER keshini isitish OLIB TASHLANDI (2026-11-12).
    //
    // Nima uchun: server (bot sessiyasi, MadelineProto) bergan
    // `file_reference` foydalanuvchining O'Z akkauntida ishlamaydi —
    // Telegram uni `FILE_REFERENCE_INVALID` bilan rad etadi. Ya'ni bu kesh
    // pleerga hech qanday foyda bermasdi, faqat har 10 daqiqada serverda
    // bekorga Telegram RPC ishga tushirardi. Metama'lumot endi faqat
    // foydalanuvchining O'Z sessiyasi bilan (3-qadam) olinadi.

    var items = [];
    try { items = await loadList(); } catch (e) { return; }

    // Ro'yxat ko'rishlar soni bo'yicha tartiblangan. Faqat metama'lumot
    // keshlanadi; video baytlari yuklanmaydi.
    items = items.filter(function (it) {
      return it && it.channel && Number(it.post) > 0;
    }).slice(0, META_ITEMS);
    if (!items.length) return;

    // 2) Server meta yo'li (`prefetchMany`) 2026-11-12 dan O'CHIRILGAN —
    //    doim 0 qaytaradi (bot `file_reference` foydalanuvchi akkauntida
    //    ishlamaydi). Chaqiruv API mosligi uchun qoldirilgan.
    var got = 0;
    if (typeof T.prefetchMany === 'function') {
      try { got = await T.prefetchMany(items); } catch (e) { got = 0; }
    }

    // 3) ASOSIY yo'l: foydalanuvchining O'Z sessiyasi (GramJS). Telegram
    //    aynan shu sessiyaga tegishli `file_reference` beradi — shuning
    //    uchun faqat shu yo'l ishonchli ishlaydi.
    if (got >= items.length) return;
    try { if (typeof T.hasSession === 'function' && !T.hasSession()) return; } catch (e) { return; }
    if (typeof T.prefetchManyGram !== 'function') return;

    // Allaqachon keshlangan yozuvlarni `prefetchManyGram` o'zi tashlab
    // yuboradi, shuning uchun ro'yxatni qayta filtrlamaymiz.
    var rest = items;
    for (var i = 0; i < rest.length; i += META_BATCH) {
      if (document.hidden || videoBusy()) break;
      try {
        await T.prefetchManyGram(rest.slice(i, i + META_BATCH));
      } catch (e) { /* bitta batch xato bo'lsa — keyingisi davom etadi */ }
      if (i + META_BATCH < rest.length) {
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
