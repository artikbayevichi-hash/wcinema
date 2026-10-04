<?php
// ============================================================================
// notifications.php - Instagram uslubidagi bildirishnomalar (to'liq sahifa)
// ============================================================================
// Ro'yxat brauzerda `api/notifications.php` dan yuklanadi, chunki saytga
// kirish PHP sessiyasi orqali emas, brauzerdagi MTProto (`tg_me`) orqali
// amalga oshiriladi. Server tomonda `tg_me` bo'lmasa - bo'sh ko'rinadi.
//
// Guruhlash ("Ali va yana 3 kishi yoqtirdi"), ikonkalar va o'qilgan holati
// `assets/js/notifications.js` (window.WCNtf) orqali chiziladi.
// ============================================================================
require_once __DIR__ . '/includes/bootstrap.php';

$NAV_ACTIVE = 'notifications';
?>
<!DOCTYPE html>
<html lang="uz">
<head>
    <link rel="icon" type="image/png" href="assets/img/favicon.png?v=<?php echo @filemtime(__DIR__ . '/assets/img/favicon.png') ?: 1; ?>">
    <link rel="apple-touch-icon" href="assets/img/apple-touch-icon.png?v=<?php echo @filemtime(__DIR__ . '/assets/img/apple-touch-icon.png') ?: 1; ?>">
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <title>Bildirishnomalar — <?php echo htmlspecialchars(SITE_NAME); ?></title>
    <link rel="stylesheet" href="assets/css/style.css">
    <link rel="stylesheet" href="assets/css/instagram.css">
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

<!-- Instagram uslubidagi navigatsiya (bildirishnoma paneli ham shu yerda) -->
<?php require __DIR__ . '/includes/nav.php'; ?>

<main class="ig-page">
    <h1 class="ig-page-title">Bildirishnomalar</h1>

    <div class="ig-ntf-page" id="ntfFeed">
        <div class="ig-ntf-empty">Yuklanmoqda…</div>
    </div>
</main>

<script>
(function () {
    function boot() {
        var W    = window.WCNtf;
        var feed = document.getElementById('ntfFeed');
        if (!W || !feed) return;

        W.apiGet('api/notifications.php?action=list&limit=50').then(function (d) {
            var items = (d && d.items) || [];
            if (!items.length) {
                feed.innerHTML = '<div class="ig-ntf-empty">Hozircha bildirishnomalar yo‘q.<br>Reels yuklang va layk/izohlarni kuzating.</div>';
                W.setBadge(0);
                return;
            }
            feed.innerHTML = items.map(W.rowHtml).join('');
            W.setBadge(0);
            W.apiPost('action=read_all').catch(function () {});
        }).catch(function () {
            feed.innerHTML = '<div class="ig-ntf-empty">Yuklab bo‘lmadi</div>';
        });
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
</script>

</body>
</html>
