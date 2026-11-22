<?php
// ============================================================================
// feedback.php — foydalanuvchining o'z murojaatlari va admin javoblari
// ============================================================================
// Bildirishnomadagi havolalar shu sahifaga olib keladi: javob matni to'liq
// ko'rinadi. Ro'yxat api/feedback.php dan olinadi (foydalanuvchi faqat o'zinikini
// ko'radi). Chap paneldagi "Taklif / shikoyat" oynasidan ham shu yerga o'tish
// mumkin.
// ============================================================================
require_once __DIR__ . '/includes/bootstrap.php';

$NAV_ACTIVE = 'feedback';
?>
<!DOCTYPE html>
<html lang="uz">
<head>
    <link rel="icon" type="image/png" href="assets/img/favicon.png?v=<?php echo @filemtime(__DIR__ . '/assets/img/favicon.png') ?: 1; ?>">
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <title>Murojaatlarim — <?php echo htmlspecialchars(SITE_NAME); ?></title>
    <link rel="stylesheet" href="assets/css/style.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/style.css') ?: 1; ?>">
    <link rel="stylesheet" href="assets/css/instagram.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/instagram.css') ?: 1; ?>">
    <?php require __DIR__ . '/includes/tv-head.php'; ?>
    <script>
    (function () {
      if (!/Telegram/i.test(navigator.userAgent)
          && !/tgWebAppData/.test(location.href)) return;
      var s = document.createElement('script');
      s.src = 'https://telegram.org/js/telegram-web-app.js';
      document.head.appendChild(s);
    })();
    </script>
</head>
<body class="ig-shell">

<?php require __DIR__ . '/includes/nav.php'; ?>

<main class="ig-page">
    <h1 class="ig-page-title">Murojaatlarim</h1>
    <p class="fb-lead">Taklif va shikoyatlaringizni shu yerda yuborishingiz, admin javoblarini ko‘rishingiz mumkin.</p>
    <div class="fb-list" id="fbFeed">
        <div class="ig-ntf-empty">Yuklanmoqda…</div>
    </div>
</main>

<script>
(function () {
  var feed = document.getElementById('fbFeed');
  if (!feed) return;

  var esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };
  var when = function (s) {
    var d = new Date(String(s || '').replace(' ', 'T'));
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('uz-UZ', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  };
  var post = function (qs) {
    return fetch('api/feedback.php', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest'
      },
      credentials: 'same-origin',
      body: qs
    }).then(function (r) { return r.json(); });
  };

  fetch('api/feedback.php?action=list&limit=50', {
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
    credentials: 'same-origin'
  }).then(function (r) { return r.json(); }).then(function (d) {
    var items = (d && d.items) || [];
    if (!items.length) {
      feed.innerHTML = '<div class="ig-ntf-empty">Hozircha murojaat yo‘q. '
        + 'Chap paneldagi <b>Taklif / shikoyat</b> tugmasidan yozib yuboring.</div>';
      return;
    }
    feed.innerHTML = items.map(function (x) {
      var kind = x.type === 'complaint' ? 'Shikoyat' : 'Taklif';
      var badge = x.admin_reply ? 'Javob berildi' : (x.status === 'closed' ? 'Yopildi' : 'Kutilyapti');
      var body = '<div class="fb-item-h">'
        +   '<span class="fb-kind ' + (x.type === 'complaint' ? 'is-complaint' : '') + '">' + esc(kind) + '</span>'
        +   '<span class="fb-state">' + esc(badge) + '</span>'
        +   '<span class="fb-when">' + esc(when(x.created_at)) + '</span>'
        + '</div>'
        + '<div class="fb-text">' + esc(x.message) + '</div>';
      if (x.admin_reply) {
        body += '<div class="fb-reply">'
          +   '<div class="fb-reply-h">Admin javobi <span>' + esc(when(x.replied_at)) + '</span></div>'
          +   '<div class="fb-reply-text">' + esc(x.admin_reply) + '</div>'
          + '</div>';
      }
      return '<article class="fb-item' + (x.admin_reply && !x.read_at ? ' is-new' : '') + '" data-id="' + esc(x.id) + '">'
        + body + '</article>';
    }).join('');

    items.forEach(function (x) {
      if (x.admin_reply && !x.read_at) {
        post('action=read&id=' + encodeURIComponent(x.id)).catch(function () {});
      }
    });
  }).catch(function () {
    feed.innerHTML = '<div class="ig-ntf-empty">Yuklab bo‘lmadi</div>';
  });
})();
</script>

</body>
</html>
