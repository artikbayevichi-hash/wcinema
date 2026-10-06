<?php
// ============================================================================
// saved.php - Instagram uslubidagi "Saqlanganlar" (watchlist) sahifasi
// ============================================================================
// Saqlangan kontent - 3 ustunli kvadrat grid (Instagram profili kabi).
// Har bir karta bosilganda watch.php?c=ID (film/qism) ochiladi.
//
// Kirish talab qilinadi.
// ============================================================================
require_once __DIR__ . '/includes/bootstrap.php';

$user   = $auth->getCurrentUser();
$userId = $user ? (int) $user['id'] : null;

if (!$userId) {
    // PHP hisobi yo'q (faqat Telegram/MTProto) — mahalliy kutubxonaga o'tamiz.
    header('Location: profile.php?tab=saved');
    exit;
}

$items = $catalog->getWatchlist($userId, 200);
?>
<!DOCTYPE html>
<html lang="uz">
<head>
    <link rel="icon" type="image/png" href="assets/img/favicon.png?v=<?php echo @filemtime(__DIR__ . '/assets/img/favicon.png') ?: 1; ?>">
    <link rel="apple-touch-icon" href="assets/img/apple-touch-icon.png?v=<?php echo @filemtime(__DIR__ . '/assets/img/apple-touch-icon.png') ?: 1; ?>">
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <title>Saqlanganlar — <?php echo htmlspecialchars(SITE_NAME); ?></title>
    <link rel="stylesheet" href="assets/css/style.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/style.css') ?: 1; ?>">
    <link rel="stylesheet" href="assets/css/instagram.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/instagram.css') ?: 1; ?>">
    <?php require __DIR__ . '/includes/tv-head.php'; ?>
    <!-- Telegram Web App — FAQAT Telegram ilovasi ichida kerak. Oddiy
         tashrifchida bu so'rov muvaffaqiyatsiz bo'lib, sahifani
         sekinlashtiradi. Shuning uchun shartli yuklanadi. -->
    <script>
    (function () {
      if (!/Telegram/i.test(navigator.userAgent)
          && !/tgWebAppData/.test(location.href)) return;
      var s = document.createElement('script');
      s.src = 'https://telegram.org/js/telegram-web-app.js';
      document.head.appendChild(s);          // async EMAS: app.js dan oldin
    })();
    </script>
</head>
<body class="ig-shell">

<!-- Instagram uslubidagi navigatsiya -->
<?php $NAV_ACTIVE = 'saved'; require __DIR__ . '/includes/nav.php'; ?>

<main class="sv-wrap">
    <h1 class="ig-page-title">🔖 Saqlanganlar</h1>
    <p class="ig-page-sub"><?php echo count($items); ?> ta saqlangan kontent</p>

    <?php if (!$items): ?>
        <div class="ntf-row" style="justify-content:center;text-align:center;padding:44px 16px;color:var(--muted)">
            <div>
                <div style="font-size:42px;margin-bottom:10px">📌</div>
                Saqlanganlar bo'sh — katalogdan film qo'shing!<br>
                <a href="index.php" style="color:var(--accent);font-weight:600">Katalogga o'tish</a>
            </div>
        </div>
    <?php else: ?>
        <div class="sv-grid">
            <?php foreach ($items as $c): ?>
                <a class="sv-cell" href="watch.php?c=<?php echo (int) $c['id']; ?>"
                   title="<?php echo esc($c['title'] ?? ''); ?>">
                    <div class="sv-media">
                        <?php if (!empty($c['poster'])): ?>
                            <img loading="lazy" src="<?php echo esc(Catalog::posterSrc($c['poster'] ?? '')); ?>" alt="">
                        <?php else: ?>
                            <div class="sv-ph">🎬</div>
                        <?php endif; ?>
                        <div class="sv-cap">
                            <?php echo esc(mb_substr($c['title'] ?? '', 0, 24)); ?>
                        </div>
                    </div>
                </a>
            <?php endforeach; ?>
        </div>
    <?php endif; ?>
</main>

</body>
</html>
