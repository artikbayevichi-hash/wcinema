/* ============================================================================
 * tg-perf.js — video ochilish tezligini o'lchash (real foydalanuvchilarda)
 * ----------------------------------------------------------------------------
 * Nima uchun: "video sekin ochilyapti" degan shikoyatni tuzatish uchun avval
 * QAYERDA sekinligini bilish kerak. Bu skript 3 ta raqamni yuboradi:
 *
 *   ttfb        — tgfile so'rovi yuborilgandan birinchi bayt kelguncha
 *   canplay     — sahifa boshlangandan pleer "tayyor" degan paytgacha
 *   first_frame — sahifa boshlangandan birinchi kadr ko'ringuncha
 *
 * Ma'lumot `api/perf.php` ga `sendBeacon` bilan ketadi (sahifani bloklamaydi,
 * javob kutilmaydi). Har bir sahifada FAQAT BIR MARTA yuboriladi.
 *
 * Natijani ko'rish:  /api/perf.php?stats=1&key=<ADMIN_PANEL_KEY>
 *
 * Sozlash: `window.__WCPERF.url` — perf-head.php tomonidan beriladi.
 * O'chirish: `window.__WCPERF = {off:true}` yoki localStorage "wc_perf=0".
 * ========================================================================== */
(function (w) {
  'use strict';

  var CFG = w.__WCPERF || {};
  if (!CFG.url) return;
  if (CFG.off) return;
  try { if (localStorage.getItem('wc_perf') === '0') return; } catch (e) {}

  var sent = false;
  var canplayAt = 0;
  var ttfbMs = 0;
  var started = false;

  function pageName() {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('watch') >= 0) return 'watch';
    if (p.indexOf('reels') >= 0) return 'reels';
    if (p.indexOf('index') >= 0 || /\/$/.test(p)) return 'home';
    if (p.indexOf('profile') >= 0) return 'profile';
    return 'other';
  }

  function qid(name) {
    try {
      var v = new URLSearchParams(location.search).get(name);
      return v && /^\d+$/.test(v) ? Number(v) : 0;
    } catch (e) { return 0; }
  }

  // tgfile so'rovining TTFB'i — PerformanceResourceTiming dan.
  //
  // Service Worker javob bergan so'rovlar ham bu ro'yxatga tushadi. Ba'zi
  // brauzerlarda `responseStart` 0 bo'ladi (cross-origin/SW cheklovi) —
  // shunda 0 qoldiramiz, yolg'on raqam yozmaymiz.
  function tgfileTtfb() {
    try {
      var list = performance.getEntriesByType('resource') || [];
      var best = 0;
      for (var i = 0; i < list.length; i++) {
        var e = list[i];
        if (!e || !e.name || e.name.indexOf('tgfile') < 0) continue;
        var r = (e.responseStart || 0) - (e.requestStart || 0);
        if (r > 0 && r < 60000) best = Math.max(best, Math.round(r));
      }
      return best;
    } catch (e) { return 0; }
  }

  function netInfo() {
    var c = w.navigator && (w.navigator.connection || w.navigator.mozConnection || w.navigator.webkitConnection);
    return {
      net: c ? String(c.effectiveType || c.type || '') : '',
      save: c && c.saveData ? 1 : 0
    };
  }

  function send(errName) {
    if (sent) return;
    sent = true;
    var now = Math.round(performance.now());
    var ni = netInfo();
    var body = new URLSearchParams();
    body.set('page', pageName());
    body.set('content_id', String(qid('id') || qid('content_id')));
    body.set('episode_id', String(qid('e') || qid('episode')));
    body.set('ttfb', String(ttfbMs || tgfileTtfb()));
    body.set('canplay', String(canplayAt || 0));
    // `performance.now()` navigatsiya boshidan hisoblanadi — shuning uchun
    // `started0` ning o'zi "sahifa ochilgandan birinchi kadrgacha" bo'ladi.
    body.set('first_frame', String(started && started0 > 0 ? Math.round(started0) : 0));
    body.set('net', ni.net);
    body.set('save_data', String(ni.save));
    if (errName) body.set('err', errName);

    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(CFG.url, body);
      } else {
        fetch(CFG.url, { method: 'POST', body: body, keepalive: true, credentials: 'omit' });
      }
    } catch (e) { /* jim */ }
  }

  // `started0` — `playing` hodisasi paytidagi `performance.now()`.
  var started0 = 0;

  function onPlaying(e) {
    var v = e.target;
    if (!v || v.tagName !== 'VIDEO') return;
    started0 = performance.now();
    started = true;
    // Birinchi kadr paytida TTFB hali resurs ro'yxatiga tushmagan bo'lishi
    // mumkin — 400 ms kutib, yakuniy raqam bilan yuboramiz.
    setTimeout(function () { send(''); }, 400);
  }

  function onCanPlay(e) {
    if (e.target && e.target.tagName === 'VIDEO' && !canplayAt) {
      canplayAt = Math.round(performance.now());
    }
  }

  function onError(e) {
    var v = e.target;
    if (!v || v.tagName !== 'VIDEO') return;
    var code = (v.error && v.error.code) || 0;
    send('video_error_' + code);
  }

  function onWaiting() {
    if (!started) return;
    // Oqim uzilib qoldi — keyin yuboriladigan o'lchovga belgi qo'shamiz.
    if (!canplayAt) canplayAt = 0;
  }

  document.addEventListener('playing', onPlaying, true);
  document.addEventListener('canplay', onCanPlay, true);
  document.addEventListener('error', onError, true);
  document.addEventListener('waiting', onWaiting, true);

  // Sahifadan chiqishda hali yuborilmagan bo'lsa — kanni tekshirib yuboramiz.
  w.addEventListener('pagehide', function () {
    if (!sent && started) send('');
  }, { once: true });
})(window);
