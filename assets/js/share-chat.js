/* ==========================================================================
 * share-chat.js - "Suhbatga yuborish" oynasi (reel/kino -> shaxsiy chat)
 * --------------------------------------------------------------------------
 * Vazifa: foydalanuvchi reel yoki kinoni tanlagan suhbatdoshiga YUBORADI.
 * Avval faqat havola nusxalanardi (navigator.share / clipboard) - endi esa
 * `api/dm.php?action=share` orqali video karta xabar sifatida ketadi va
 * qabul qiluvchi uni chat ichida o'ynata oladi (`tg-chat.js`).
 *
 * Foydalanish:
 *   window.TgShare.open({
 *     title, poster, duration, type, id, episode,
 *     channel, post, url, deep, link, onSent
 *   });
 *
 * Oyna boshqa sahifalarda (masalan `reels.php`) ham ishlashi uchun CSS
 * modulning o'zi tomonidan bir marta in'ektsiya qilinadi.
 * ========================================================================== */
(function (global) {
  'use strict';

  var BASE = (global.APP && global.APP.base) || '';
  var CSS_ID = 'tgShareChatCss';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function tgMeRaw() {
    try { var v = localStorage.getItem('wc_tg_me_v1'); if (v) return v; } catch (e) {}
    try {
      if (global.TgStream && typeof global.TgStream.me === 'function') {
        var m = global.TgStream.me();
        if (m && m.id) {
          return JSON.stringify({
            id: String(m.id),
            firstName: m.firstName || '',
            lastName: m.lastName || '',
            username: m.username || ''
          });
        }
      }
    } catch (e) {}
    return '';
  }

  function withMe(url) {
    var raw = tgMeRaw();
    if (!raw) return url;
    return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'tg_me=' + encodeURIComponent(raw);
  }

  function ensureCss() {
    if (document.getElementById(CSS_ID)) return;
    var st = document.createElement('style');
    st.id = CSS_ID;
    st.textContent = [
      '.sharec-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:90}',
      '.sharec-sheet{position:fixed;left:50%;bottom:0;transform:translateX(-50%);width:min(480px,100%);max-height:78vh;'
        + 'background:var(--card,#15181e);color:var(--text,#e9edf2);border-radius:16px 16px 0 0;z-index:91;'
        + 'display:flex;flex-direction:column;padding:8px 0 12px;box-shadow:0 -8px 40px rgba(0,0,0,.5)}',
      '.sharec-head{display:flex;align-items:center;justify-content:space-between;padding:6px 16px 10px}',
      '.sharec-head b{font-size:15px}',
      '.sharec-x{border:0;background:transparent;color:inherit;font-size:16px;cursor:pointer;width:34px;height:34px;border-radius:50%}',
      '.sharec-x:hover{background:rgba(255,255,255,.08)}',
      '.sharec-sub{padding:2px 16px 8px;font-size:12px;opacity:.65}',
      '.sharec-list{overflow-y:auto;padding:0 8px}',
      '.sharec-c{display:flex;align-items:center;gap:10px;width:100%;border:0;background:transparent;color:inherit;'
        + 'padding:9px 10px;border-radius:10px;cursor:pointer;text-align:left;font-size:14px}',
      '.sharec-c:hover{background:rgba(255,255,255,.08)}',
      '.sharec-c.busy{opacity:.5;pointer-events:none}',
      '.sharec-av{width:40px;height:40px;border-radius:50%;overflow:hidden;flex:0 0 auto;background:#2a2f38;'
        + 'display:flex;align-items:center;justify-content:center;font-weight:700}',
      '.sharec-av img{width:100%;height:100%;object-fit:cover;display:block}',
      '.sharec-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.sharec-empty{padding:26px 16px;text-align:center;opacity:.7;font-size:13px}',
      '.sharec-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:rgba(0,0,0,.86);color:#fff;'
        + 'padding:9px 16px;border-radius:10px;font-size:13px;z-index:99}'
    ].join('');
    document.head.appendChild(st);
  }

  function toast(msg) {
    var t = document.querySelector('.sharec-toast');
    if (t) t.remove();
    t = document.createElement('div');
    t.className = 'sharec-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.remove(); }, 2600);
  }

  function loadContacts() {
    return fetch(withMe(BASE + '/api/chat.php?action=contacts'), {
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    }).then(function (r) { return r.json(); }).then(function (d) {
      return (d && d.contacts) || [];
    });
  }

  function sendShare(peerId, opts) {
    var p = new URLSearchParams();
    p.set('action', 'share');
    p.set('peer_id', String(peerId));
    ['title', 'poster', 'duration', 'type', 'id', 'episode', 'channel', 'post', 'url', 'deep', 'link']
      .forEach(function (k) {
        var v = opts[k];
        if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
      });
    var raw = tgMeRaw();
    if (raw) p.set('tg_me', raw);
    return fetch(BASE + '/api/dm.php', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: p.toString()
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || d.success === false || !d.message) {
        throw new Error((d && d.message) || 'Yuborilmadi');
      }
      return d;
    });
  }

  function open(opts) {
    opts = opts || {};
    ensureCss();

    var host = document.createElement('div');
    host.innerHTML =
      '<div class="sharec-backdrop"></div>'
      + '<div class="sharec-sheet" role="dialog" aria-modal="true" aria-label="Suhbatga yuborish">'
      +   '<div class="sharec-head"><b>Suhbatga yuborish</b>'
      +     '<button class="sharec-x" type="button" aria-label="Yopish">&#10005;</button></div>'
      +   '<div class="sharec-sub">Suhbatdoshni tanlang</div>'
      + '<div class="sharec-list"><div class="sharec-empty">Yuklanmoqda…</div></div>'
      + '</div>';
    var backdrop = host.querySelector('.sharec-backdrop');
    var sheet = host.querySelector('.sharec-sheet');
    var list = host.querySelector('.sharec-list');
    document.body.appendChild(host);

    function close() {
      if (host.parentNode) host.parentNode.removeChild(host);
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    host.querySelector('.sharec-x').onclick = close;
    host.querySelector('.sharec-backdrop').onclick = close;

    loadContacts().then(function (items) {
      if (!items.length) {
        list.innerHTML = '<div class="sharec-empty">Hozircha suhbat yo\u2018q.<br>'
          + 'Chat sahifasida yozib boshlang \u2014 keyin bu yerda chiqadi.</div>';
        return;
      }
      list.innerHTML = items.map(function (u) {
        var nm = (((u.first_name || '') + ' ' + (u.last_name || ''))
          .replace(/\s+/g, ' ').trim()) || u.username || 'Foydalanuvchi';
        var img = u.avatar ? '<img src="' + esc(u.avatar) + '" alt="" onerror="this.remove()">' : '';
        return '<button type="button" class="sharec-c" data-peer="' + esc(String(u.id)) + '">'
          + '<span class="sharec-av">' + esc(nm.charAt(0).toUpperCase()) + img + '</span>'
          + '<span class="sharec-name">' + esc(nm) + '</span></button>';
      }).join('');
    }).catch(function () {
      list.innerHTML = '<div class="sharec-empty">Suhbatlarni yuklab bo\u2018lmadi</div>';
    });

    list.onclick = function (ev) {
      var b = ev.target.closest && ev.target.closest('.sharec-c');
      if (!b) return;
      var peerId = parseInt(b.getAttribute('data-peer'), 10) || 0;
      if (!peerId) return;
      b.classList.add('busy');
      sendShare(peerId, opts).then(function () {
        toast('\u2705 Yuborildi');
        if (typeof opts.onSent === 'function') {
          try { opts.onSent(peerId); } catch (e) {}
        }
        close();
      }).catch(function (e) {
        b.classList.remove('busy');
        toast('Yuborilmadi: ' + (e && e.message ? e.message : 'xatolik'));
      });
    };
  }

  global.TgShare = { open: open };
})(window);