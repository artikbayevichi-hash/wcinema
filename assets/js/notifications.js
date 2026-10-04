/* ==========================================================================
   W CINEMA - Bildirishnomalar (Instagram uslubida)
   ==========================================================================
   Chap paneldagi va mobil paneldagi "qo'ng'iroq" tugmasiga:
     * o'qilmaganlar soni (badge) qo'yadi;
     * bosilganda flyout panel ochib, guruhlangan bildirishnomalarni
       ko'rsatadi (server tomonda "Ali va yana 3 kishi yoqtirdi" ko'rinishida
       tayyorlanadi).
   Ma'lumot `api/notifications.php` dan olinadi. Foydalanuvchi `tg_me`
   (localStorage wc_tg_me_v1) orqali aniqlanadi - reels.js bilan bir xil.
   ========================================================================== */
(function (global) {
  'use strict';

  var PANEL = document.getElementById('igNtf');
  if (!PANEL) return;

  var BODY  = document.getElementById('igNtfBody');
  var MARK  = document.getElementById('igNtfMarkAll');
  var CLOSE = document.getElementById('igNtfClose');

  var BASE  = (global.APP && global.APP.base) || '';
  var meKey = 'wc_tg_me_v1';
  var count = 0;

  // ------------------------------------------------------------- yordamchilar
  function base(path) {
    if (!BASE) return path;
    return BASE.replace(/\/$/, '') + '/' + String(path).replace(/^\//, '');
  }
  function me() {
    try { return localStorage.getItem(meKey) || ''; } catch (e) { return ''; }
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function withMeQS(path) {
    var m = me();
    if (!m) return path;
    return path + (path.indexOf('?') >= 0 ? '&' : '?') + 'tg_me=' + encodeURIComponent(m);
  }
  function apiGet(path) {
    return fetch(base(withMeQS(path)), {
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin'
    }).then(function (r) { return r.json(); });
  }
  function apiPost(qs) {
    var p = new URLSearchParams(qs);
    var m = me();
    if (m) p.set('tg_me', m);
    return fetch(base('api/notifications.php'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest'
      },
      credentials: 'same-origin',
      body: p.toString()
    }).then(function (r) { return r.json(); });
  }

  function timeAgo(ts) {
    if (!ts) return '';
    var d = new Date(String(ts).replace(' ', 'T'));
    if (isNaN(d.getTime())) return '';
    var diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60)    return 'hozir';
    if (diff < 3600)  return Math.floor(diff / 60) + ' daqiqa oldin';
    if (diff < 86400) return Math.floor(diff / 3600) + ' soat oldin';
    if (diff < 172800) return 'kecha';
    if (diff < 604800) return Math.floor(diff / 86400) + ' kun oldin';
    return d.toLocaleDateString();
  }

  // ------------------------------------------------------------- ikonkalar
  var SVG = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"';
  var ICONS = {
    like:    '<svg ' + SVG + '><path d="M12 20.5C7.8 17.7 3 13.9 3 9.2 3 6.3 5.2 4.5 7.5 4.5c1.6 0 3 .9 4.5 2.7 1.5-1.8 2.9-2.7 4.5-2.7 2.3 0 4.5 1.8 4.5 4.7 0 4.7-4.8 8.5-9 11.3z"/></svg>',
    comment: '<svg ' + SVG + '><path d="M21 11.5a8 8 0 0 1-8 8H8l-4 3v-6.5a8 8 0 0 1 8-8h1a8 8 0 0 1 8 8z"/></svg>',
    reply:   '<svg ' + SVG + '><path d="M9 17 4 12l5-5"/><path d="M4 12h10a6 6 0 0 1 6 6v1"/></svg>',
    mention: '<svg ' + SVG + '><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.9 7.9"/></svg>',
    follow:  '<svg ' + SVG + '><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M19 8v6M16 11h6"/></svg>',
    repost:  '<svg ' + SVG + '><path d="m17 2 4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
    status:  '<svg ' + SVG + '><path d="M12 3 4 6v6c0 5 3.4 8.3 8 9 4.6-.7 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/></svg>',
    system:  '<svg ' + SVG + '><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
    login:   '<svg ' + SVG + '><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
    video:   '<svg ' + SVG + '><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/></svg>'
  };

  // ----------------------------------------------------------------- badge
  function bells() {
    return document.querySelectorAll(
      'a.ig-item[href$="notifications.php"], a.ig-mobar-btn[href$="notifications.php"]'
    );
  }
  function setBadge(n) {
    var prev = count;
    count = Number(n) || 0;
    Array.prototype.forEach.call(bells(), function (a) {
      var host = a.querySelector('.ig-ico') || a;
      var b = host.querySelector('.ig-ntf-badge');
      if (!b) {
        b = document.createElement('span');
        b.className = 'ig-ntf-badge';
        host.appendChild(b);
      }
      b.hidden = !count;
      b.textContent = count > 99 ? '99+' : String(count);
      // Faqat yangi (ko'paygan) bildirishnomada qo'ng'iroq "silkinsin";
      // sahifada o'qib bo'lganda takror silkinmasin.
      if (count > prev) {
        a.classList.remove('has-ntf');
        void a.offsetWidth;            // animatsiyani qayta ishga tushirish
        a.classList.add('has-ntf');
        setTimeout(function () { a.classList.remove('has-ntf'); }, 900);
      }
    });
  }
  function refreshCount() {
    apiGet('api/notifications.php?action=count').then(function (d) {
      if (d && typeof d.unread !== 'undefined') setBadge(d.unread);
    }).catch(function () {});
  }

  // ---------------------------------------------------------------- render
  function avatarHtml(item) {
    var a = (item.actors && item.actors[0]) || null;
    if (a && a.avatar) {
      return '<img src="' + esc(a.avatar) + '" alt="" referrerpolicy="no-referrer">';
    }
    var ch = '';
    if (a) ch = (a.name || a.username || '').charAt(0);
    return '<span class="ig-ntf-ph">' + esc((ch || '?').toUpperCase()) + '</span>';
  }
  function rowHtml(item) {
    var t = item.text || '';
    var detail = '';
    // `login` bildirishnomasi qayerdan kirilganini ko'rsatadi (IP/UA).
    if (item.message && ['comment', 'reply', 'mention', 'login'].indexOf(item.type) >= 0) {
      detail = '<span class="ig-ntf-detail">' + esc(item.message) + '</span>';
    }
    var thumb = item.reel_poster
      ? '<span class="ig-ntf-thumb"><img src="' + esc(item.reel_poster) + '" alt="" referrerpolicy="no-referrer" onerror="this.remove()"></span>'
      : '';
    var ico = ICONS[item.type] || ICONS.system;
    return '<a class="ig-ntf-row' + (item.is_read ? '' : ' unread') + '" href="' + esc(item.url || '#') + '" data-id="' + (item.id || 0) + '">'
      + '<span class="ig-ntf-av">' + avatarHtml(item)
      + '<span class="ig-ntf-type type-' + esc(item.type) + '">' + ico + '</span></span>'
      + '<span class="ig-ntf-main"><span class="ig-ntf-text">' + esc(t) + detail + '</span>'
      + '<span class="ig-ntf-time">' + esc(timeAgo(item.at)) + '</span></span>'
      + thumb
      + '</a>';
  }

  function fetchList() {
    if (!BODY) return;
    BODY.innerHTML = '<div class="ig-ntf-empty">Yuklanmoqda…</div>';
    apiGet('api/notifications.php?action=list&limit=30').then(function (d) {
      var items = (d && d.items) || [];
      if (!items.length) {
        BODY.innerHTML = '<div class="ig-ntf-empty">Hozircha bildirishnomalar yo‘q</div>';
        setBadge(0);
        return;
      }
      BODY.innerHTML = items.map(rowHtml).join('');
      // Ko'rsatilgach serverda o'qilgan deb belgilaymiz (badge o'chadi,
      // lekin shu ko'rinishda "unread" belgisi saqlanib turadi).
      var hadUnread = items.some(function (i) { return !i.is_read; });
      if (hadUnread) clearUnread();
      else setBadge(0);
    }).catch(function () {
      BODY.innerHTML = '<div class="ig-ntf-empty">Yuklab bo‘lmadi</div>';
    });
  }

  function clearUnread() {
    setBadge(0);
    apiPost('action=read_all').catch(function () {});
  }

  // ----------------------------------------------------------------- panel
  function open() {
    if (!PANEL.hidden) return;
    PANEL.hidden = false;
    try { document.body.style.overflow = 'hidden'; } catch (e) {}
    fetchList();
  }
  function close() {
    PANEL.hidden = true;
    try { document.body.style.overflow = ''; } catch (e) {}
  }

  function bindBells() {
    Array.prototype.forEach.call(bells(), function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        if (PANEL.hidden) open(); else close();
      });
    });
  }

  // --------------------------------------------------------------- start
  function init() {
    bindBells();
    setBadge(0);
    refreshCount();

    if (CLOSE) CLOSE.addEventListener('click', close);
    if (MARK) MARK.addEventListener('click', function () {
      Array.prototype.forEach.call(BODY.querySelectorAll('.ig-ntf-row'), function (r) {
        r.classList.remove('unread');
      });
      clearUnread();
    });
    PANEL.addEventListener('click', function (e) {
      if (e.target === PANEL) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !PANEL.hidden) close();
    });
    if (BODY) BODY.addEventListener('click', function (e) {
      var row = e.target.closest ? e.target.closest('.ig-ntf-row') : null;
      if (!row) return;
      row.classList.remove('unread');
      var id = row.getAttribute('data-id');
      if (id) apiPost('action=read&id=' + encodeURIComponent(id)).catch(function () {});
    });

    // Live yangilanish: sahifa ko'rinib turganda davriy ravishda tekshiramiz.
    setInterval(function () {
      if (document.visibilityState === 'visible') refreshCount();
    }, 30000);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') refreshCount();
    });
    window.addEventListener('focus', refreshCount);
    // Izoh yozilgach (tg-comments.js) darhol yangilash uchun hodisa.
    window.addEventListener('wc:ntf', refreshCount);
  }

  // Boshqa sahifalar (masalan, notifications.php to'liq sahifasi) uchun.
  global.WCNtf = {
    apiGet: apiGet,
    apiPost: apiPost,
    rowHtml: rowHtml,
    timeAgo: timeAgo,
    setBadge: setBadge,
    refresh: refreshCount
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
