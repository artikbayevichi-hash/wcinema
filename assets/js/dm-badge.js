/* ==========================================================================
   dm-badge.js — sayt bo'ylab shaxsiy xabarlar (DM) badge'i

   Sarlavhadagi "Chat" havolasida o'qilmagan shaxsiy xabarlar sonini
   ko'rsatadi. Chat sahifasi ochiq bo'lmasa ham ishlaydi (butun sayt),
   shuning uchun foydalanuvchi xabarni qayerda bo'lsa ham ko'radi.

   Manba: api/dm.php?action=unread (server DM). Telegram MTProto emas.
   ========================================================================== */
(function () {
  'use strict';

  var BASE = (window.APP && window.APP.base) || '';
  var INTERVAL = 15000;

  function baseUrl(p) {
    if (!BASE) return p;
    return BASE.replace(/\/$/, '') + '/' + p.replace(/^\//, '');
  }

  function meRaw() {
    try { return localStorage.getItem('wc_tg_me_v1') || ''; } catch (e) { return ''; }
  }

  function setBadge(n) {
    n = Number(n) || 0;
    var ids = ['igChatBadge', 'igChatBadgeM'];
    for (var i = 0; i < ids.length; i++) {
      var b = document.getElementById(ids[i]);
      if (!b) continue;
      b.textContent = n > 99 ? '99+' : String(n);
      b.hidden = !(n > 0);
    }
  }

  function poll() {
    var qs = 'action=unread';
    var raw = meRaw();
    if (raw) qs += '&tg_me=' + encodeURIComponent(raw);
    fetch(baseUrl('api/dm.php?' + qs), {
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin'
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (d && typeof d.unread === 'number') setBadge(d.unread);
    }).catch(function () {});
  }

  function start() {
    poll();
    setInterval(poll, INTERVAL);
    // Sahifa ko'rinadigan bo'lganda darhol yangilaymiz (orqaga qaytganda).
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) poll();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();