<?php
// ============================================================================
// admin-feedback.php — foydalanuvchi taklif/shikoyatlarini o'qish va javob yozish
// ============================================================================
// "Email" uslubi: chapda murojaatlar ro'yxati, o'ngda tanlangan xabar va javob
// matni. Javob yuborilganda api/admin-feedback.php foydalanuvchiga sayt ichida
// bildirishnoma ham yozadi (Notifications::add type=reply).
// ============================================================================
require_once __DIR__ . '/includes/bootstrap.php';

if (!$auth->isAdmin()) {
    $here = (string) ($_SERVER['SCRIPT_NAME'] ?? '/admin-feedback.php');
    header('Location: admin-login.php?next=' . rawurlencode($here));
    exit;
}
?>
<!DOCTYPE html>
<html lang="uz">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <meta name="robots" content="noindex, nofollow">
    <title>Murojaatlar — Admin</title>
    <link rel="stylesheet" href="assets/css/admin.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/admin.css') ?: 1; ?>">
    <link rel="stylesheet" href="assets/css/admin-feedback.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/admin-feedback.css') ?: 1; ?>">
</head>
<body>
<div class="wrap">

    <div class="top">
        <img src="assets/img/logo.png" alt="">
        <div>
            <h1>Taklif va shikoyatlar</h1>
            <div class="sub">Foydalanuvchilar bilan yozishmalar</div>
        </div>
        <div class="sp"></div>
        <a class="btn ghost" href="admin.php">← Panel</a>
        <a class="btn ghost" href="admin.php?logout=1">Chiqish</a>
    </div>

    <div class="fb-admin-tools">
        <select id="fbStatus" aria-label="Holat">
            <option value="all">Hammasi</option>
            <option value="open">Javob kutilyapti</option>
            <option value="answered">Javob berildi</option>
            <option value="closed">Yopildi</option>
        </select>
        <input type="search" id="fbSearch" placeholder="Matn, username yoki ism bo‘yicha qidirish" maxlength="120">
        <span class="muted" id="fbCount"></span>
    </div>

    <div class="fb-admin-grid">
        <div class="fb-admin-list panel" id="fbAdminList">
            <div class="fb-admin-empty">Yuklanmoqda…</div>
        </div>
        <div class="fb-admin-thread panel" id="fbAdminThread">
            <div class="fb-admin-empty">Chapdan bir murojaat tanlang.</div>
        </div>
    </div>

    <div class="note">
        Javob yuborilgach foydalanuvchiga sayt ichida bildirishnoma ketadi: u qo‘ng‘iroqchada
        ko‘rib, <b>Murojaatlarim</b> sahifasida to‘liq matnni o‘qiydi.
    </div>
</div>

<script>
(function () {
  var listEl = document.getElementById('fbAdminList');
  var threadEl = document.getElementById('fbAdminThread');
  var statusEl = document.getElementById('fbStatus');
  var searchEl = document.getElementById('fbSearch');
  var countEl = document.getElementById('fbCount');
  var current = null;
  var timer = null;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function when(s) {
    var d = new Date(String(s || '').replace(' ', 'T'));
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('uz-UZ', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  function name(x) {
    return [x.first_name, x.last_name].filter(Boolean).join(' ')
      || (x.username ? '@' + x.username : ('#' + x.user_id));
  }
  function api(path, qs) {
    var init = { headers: { 'X-Requested-With': 'XMLHttpRequest' }, credentials: 'same-origin' };
    if (qs) {
      init.method = 'POST';
      init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      init.body = qs;
    }
    return fetch(path, init).then(function (r) { return r.json(); });
  }

  function renderList(items) {
    if (!items.length) {
      listEl.innerHTML = '<div class="fb-admin-empty">Murojaat topilmadi.</div>';
      return;
    }
    listEl.innerHTML = items.map(function (x) {
      var state = x.admin_reply ? 'javob berildi' : (x.status === 'closed' ? 'yopildi' : 'kutilyapti');
      return '<button type="button" class="fb-admin-row'
        + (x.status === 'open' ? ' is-open' : '') + (current === x.id ? ' on' : '') + '" data-id="' + esc(x.id) + '">'
        + '<span class="fb-admin-row-h"><b>' + esc(name(x)) + '</b><span>' + esc(when(x.created_at)) + '</span></span>'
        + '<span class="fb-admin-row-kind">' + (x.type === 'complaint' ? 'Shikoyat' : 'Taklif') + ' · <i>' + esc(state) + '</i></span>'
        + '<span class="fb-admin-row-text">' + esc(x.message) + '</span>'
        + '</button>';
    }).join('');
  }

  function renderThread(x) {
    if (!x) {
      threadEl.innerHTML = '<div class="fb-admin-empty">Chapdan bir murojaat tanlang.</div>';
      return;
    }
    var who = name(x) + (x.username ? ' · @' + esc(x.username) : '')
      + (x.telegram_user_id ? ' · TG ' + esc(x.telegram_user_id) : '');
    var html = '<div class="fb-admin-th-h">'
      +   '<div><b>' + esc(who) + '</b><span>' + esc(when(x.created_at)) + '</span></div>'
      +   '<span class="fb-admin-tag">' + esc(x.type === 'complaint' ? 'Shikoyat' : 'Taklif') + '</span>'
      + '</div>'
      + '<div class="fb-admin-msg">' + esc(x.message) + '</div>';
    if (x.admin_reply) {
      html += '<div class="fb-admin-reply"><b>Admin javobi</b> <span>' + esc(when(x.replied_at)) + '</span>'
        +   '<div>' + esc(x.admin_reply) + '</div></div>';
    }
    html += '<div class="fb-admin-compose">'
      +   '<textarea id="fbReply" maxlength="1000" placeholder="Javobingizni yozing…"></textarea>'
      +   '<div class="fb-admin-actions">'
      +     '<button type="button" class="btn" id="fbSend">Javob yuborish</button>'
      +     '<button type="button" class="btn ghost" id="fbClose">Yopish</button>'
      +     '<button type="button" class="btn ghost" id="fbDelete">O‘chirish</button>'
      +   '</div>'
      + '</div>';
    threadEl.innerHTML = html;

    document.getElementById('fbSend').onclick = function () {
      var v = document.getElementById('fbReply').value.trim();
      if (v.length < 2) { alert('Javob matni juda qisqa'); return; }
      api('api/admin-feedback.php', 'action=reply&id=' + x.id + '&reply=' + encodeURIComponent(v))
        .then(function (r) {
          if (!r.success) { alert(r.message || 'Yuborilmadi'); return; }
          load();
        }).catch(function () { alert('Tarmoq xatosi'); });
    };
    document.getElementById('fbClose').onclick = function () {
      api('api/admin-feedback.php', 'action=close&id=' + x.id).then(load);
    };
    document.getElementById('fbDelete').onclick = function () {
      if (!confirm('Bu murojaatni o‘chirishga ishonchingiz komilmi?')) return;
      api('api/admin-feedback.php', 'action=delete&id=' + x.id).then(function () {
        current = null;
        renderThread(null);
        load();
      });
    };
  }

  function load() {
    var qs = 'action=list&limit=100&status=' + encodeURIComponent(statusEl.value)
      + '&q=' + encodeURIComponent(searchEl.value.trim());
    api('api/admin-feedback.php?' + qs).then(function (d) {
      var items = (d && d.items) || [];
      countEl.textContent = 'Jami: ' + ((d && d.total) || 0);
      renderList(items);
      var keep = current ? items.filter(function (x) { return x.id === current; })[0] : null;
      if (keep) renderThread(keep);
      else if (!current) renderThread(null);
    }).catch(function () {
      listEl.innerHTML = '<div class="fb-admin-empty">Yuklab bo‘lmadi</div>';
    });
  }

  listEl.addEventListener('click', function (e) {
    var btn = e.target.closest('.fb-admin-row');
    if (!btn) return;
    current = Number(btn.dataset.id) || null;
    Array.prototype.forEach.call(listEl.querySelectorAll('.fb-admin-row'), function (b) {
      b.classList.toggle('on', b === btn);
    });
    api('api/admin-feedback.php?action=list&limit=100&q=' + encodeURIComponent(searchEl.value.trim())).then(function (d) {
      var x = ((d && d.items) || []).filter(function (i) { return i.id === current; })[0];
      if (x) renderThread(x);
    });
  });

  statusEl.addEventListener('change', load);
  searchEl.addEventListener('input', function () {
    clearTimeout(timer);
    timer = setTimeout(load, 250);
  });

  load();
})();
</script>
</body>
</html>
