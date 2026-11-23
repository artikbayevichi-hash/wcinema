/* ==========================================================================
   badge-poll.js — bitta so'rov, barcha badge'lar

   Oldin ikkita mustaqil poller bor edi (notifications 30 s + dm 15 s).
   Endi bitta `api/badges.php` so'rovi va AQLLI rejim:

     * sahifa ochilganda — 1 marta;
     * foydalanuvchi harakat qilganda (bosish/klaviatura/skrit) — 20 s dan
       keyin kamida 1 marta (brauzer keshidan, serverga chiqmaydi);
     * video o'ynayotganda — 4 daqiqada 1 marta (tomoshabin ko'p bo'lsa,
       deyarli hech qanday so'rov yo'q);
     * tab yopiq/fonda — UMUMAN so'rov yo'q (ping ham yo'q, foydalanuvchi
       "yoq" degani shu); qaytib kelganda darhol yangilanadi;
     * ochilgan boshqa tablarga natija BroadcastChannel orqali tarqatiladi.

   Natija: millionlab odam video ko'rayotganda badge so'rovlari ~0 ga tushadi.
   ========================================================================== */
(function (global) {
  'use strict';

  var MIN_GAP   = 20000;   // ikki so'rov orasidagi minimal vaqt (kesh bilan mos)
  var IDLE_MS   = 45000;   // video yo'q: kamdan-kam tekshiramiz
  var PLAY_MS   = 240000;  // video o'ynayapti: deyarli so'rov yo'q
  var JITTER    = 4000;    // barcha brauzerlar bir vaqtda urmasligi uchun

  var subs = [];
  var state = null;
  var lastAt = 0;
  var pending = null;
  var timer = null;
  var started = false;
  var bc = null;

  try {
    if ('BroadcastChannel' in global) bc = new global.BroadcastChannel('wc-badges');
  } catch (e) { bc = null; }

  function base() {
    return ((global.APP && global.APP.base) || '').replace(/\/$/, '');
  }
  function endpoint(fresh) {
    return base() + '/api/badges.php' + (fresh ? '?r=' + Date.now() : '');
  }
  function emit() {
    for (var i = 0; i < subs.length; i++) {
      try { subs[i](state); } catch (e) {}
    }
  }
  function apply(d, fromBus) {
    if (!d || typeof d !== 'object') return;
    state = {
      unread: Number(d.unread) || 0,
      dm: Number(d.dm) || 0,
      recent: Array.isArray(d.recent) ? d.recent : []
    };
    lastAt = Date.now();
    emit();
    if (bc && !fromBus) {
      try { bc.postMessage(state); } catch (e) {}
    }
  }

  function playingVideo() {
    var list = document.querySelectorAll('video');
    for (var i = 0; i < list.length; i++) {
      var v = list[i];
      if (!v.paused && !v.ended && v.readyState > 0
          && (v.offsetWidth || v.offsetHeight || v.getClientRects().length)) {
        return true;
      }
    }
    return false;
  }

  function fetchBadges(fresh) {
    if (pending) return pending;
    if (!fresh && state && Date.now() - lastAt < MIN_GAP) {
      return Promise.resolve(state);
    }
    lastAt = Date.now();
    pending = fetch(endpoint(!!fresh), {
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin',
      cache: fresh ? 'no-store' : 'default'
    }).then(function (r) { return r.json(); })
      .then(function (d) { apply(d, false); return state; })
      .catch(function () { return state; })
      .then(function (v) { pending = null; return v; });
    return pending;
  }

  function schedule() {
    if (timer) { clearTimeout(timer); timer = null; }
    // FONDA SO'ROV YO'Q. `visibilitychange` da qayta boshlaymiz.
    if (document.hidden) return;
    var delay = (playingVideo() ? PLAY_MS : IDLE_MS) + Math.random() * JITTER;
    timer = setTimeout(function () {
      timer = null;
      fetchBadges(false).then(schedule);
    }, delay);
  }

  function onActivity() {
    if (document.hidden) return;
    if (Date.now() - lastAt >= MIN_GAP) fetchBadges(false);
  }

  function start() {
    if (started) return;
    started = true;

    if (bc) {
      bc.onmessage = function (e) {
        apply(e.data, true);
        schedule();
      };
    }
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        if (timer) { clearTimeout(timer); timer = null; }
      } else {
        fetchBadges(false).then(schedule);
      }
    });
    global.addEventListener('focus', function () {
      if (document.hidden) return;
      fetchBadges(false).then(schedule);
    });
    ['pointerdown', 'keydown', 'wheel'].forEach(function (ev) {
      document.addEventListener(ev, onActivity, { passive: true });
    });
    // Izoh yozish / xabar yuborish kabi harakatlardan keyin darhol yangilash.
    global.addEventListener('wc:ntf', function () { fetchBadges(true); });
    global.addEventListener('wc:dm', function () { fetchBadges(true); });

    // PRERENDER/FON: dastlabki so'rov ham yo'q. Speculation Rules sahifani
    // fonda tayyorlaganda document.hidden bo'ladi — u yerda DB so'rovi ketmasin.
    // Faqat foydalanuvchi sahifani ko'rganda (visibilitychange) olamiz.
    if (document.hidden) return;
    fetchBadges(false).then(schedule);
  }

  global.WCBadges = {
    start: start,
    state: function () { return state; },
    subscribe: function (fn) {
      subs.push(fn);
      if (state) { try { fn(state); } catch (e) {} }
      return function () {
        var i = subs.indexOf(fn);
        if (i >= 0) subs.splice(i, 1);
      };
    },
    refresh: function () { return fetchBadges(true); },
    invalidate: function () { return fetchBadges(true); }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})(window);
