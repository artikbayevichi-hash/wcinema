<?php
// ============================================================================
// reels.php - qisqa vertikal videolar oqimi
// ============================================================================
// To'liq ekranni egallagan, vertikal (9:16) oqim. Bir reel bir ekranga
// sig'adi; boshqaruv barmoq va klaviatura bilan ishlaydi.
//
// Oqim ma'lumotini reels.js yuklaydi (api/reels.php) - bu sahifa faqat
// "qatqon" (karkas). Shu sabab yangi reel qo'shilsa ham sahifani
// o'zgartirish shart emas.
// ============================================================================
require_once __DIR__ . '/includes/bootstrap.php';

$user   = $auth->getCurrentUser();
$userId = $user ? (int) $user['id'] : null;

// Chuqur havola: /reels.php?reel=15  -> to'g'ridan-to'g'ri shu reelni ochadi
$openReel = (int) ($_GET['reel'] ?? 0);
$myStats  = $userId ? $reels->authorStats($userId) : null;
?>
<!DOCTYPE html>
<html lang="uz">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, user-scalable=no">
    <title>Reels — <?php echo htmlspecialchars(SITE_NAME); ?></title>
    <meta name="description" content="Qisqa vertikal videolar — <?php echo htmlspecialchars(SITE_NAME); ?>">
    <link rel="stylesheet" href="assets/css/style.css">
    <link rel="stylesheet" href="assets/css/reels.css">
    <link rel="stylesheet" href="assets/css/instagram.css">
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
<body class="reels-body ig-shell">

<!-- Instagram uslubidagi navigatsiya (reels uchun: desktop yon panel / mobil pastki panel) -->
<?php $NAV_ACTIVE = 'reels'; require __DIR__ . '/includes/nav.php'; ?>

<header class="reels-top">
    <a class="reels-back" href="index.php" aria-label="Orqaga">←</a>
    <div class="reels-tabs" id="reelsTabs">
        <button class="reels-tab active" data-sort="new">🆕 Yangi</button>
        <button class="reels-tab" data-sort="top">🔥 Top</button>
        <?php if ($userId): ?>
        <button class="reels-tab" data-sort="mine">👤 Mening</button>
        <?php endif; ?>
    </div>
    <?php if ($userId): ?>
    <a class="reels-back" href="reels-upload.php" aria-label="Yuklash">＋</a>
    <?php else: ?>
    <a class="reels-back" href="login.php" aria-label="Kirish">🔐</a>
    <?php endif; ?>
</header>

<!-- ============================== Oqim (vertikal) ============================== -->
<div class="reels-track" id="reelsTrack">
    <div class="reels-loading">
        <span class="spinner"></span> Yuklanmoqda…
    </div>
</div>

<!-- ============================ Yon panel (ma'lumot) ============================ -->
<aside class="reels-side" id="reelsSide">
    <button class="reels-side-toggle" id="reelsSideToggle" aria-label="Ma’lumot">⋯</button>
    <div class="reels-side-body" id="reelsSideBody"></div>
</aside>

<!-- ============================== Yuklash tugmasi ============================== -->
<?php if ($userId): ?>
<a class="reels-fab" href="reels-upload.php" title="Reels yuklash">＋</a>
<?php endif; ?>

<!-- ============================== Reyting paneli ============================== -->
<div class="reels-modal" id="authorsModal" hidden>
    <div class="reels-modal-backdrop" data-close-authors></div>
    <div class="reels-modal-box">
        <button class="reels-modal-x" data-close-authors aria-label="Yopish">✕</button>
        <h2 class="reels-modal-title">🏆 Top Authors</h2>
        <div id="authorsList" class="authors-list"></div>
    </div>
</div>

<script>
    window.REELS = {
        userId: <?php echo $userId ? (int) $userId : 'null'; ?>,
        userName: <?php echo json_encode($user['first_name'] ?? null); ?>,
        openReel: <?php echo $openReel; ?>,
        myStats: <?php echo json_encode($myStats); ?>,
        siteName: <?php echo json_encode(SITE_NAME); ?>,
        maxUploadMb: <?php echo (int) REEL_MAX_UPLOAD_MB; ?>,
        maxLength: <?php echo (int) REEL_MAX_LENGTH; ?>,
        requireApproval: <?php echo REELS_REQUIRE_APPROVAL ? 'true' : 'false'; ?>,
        isAdmin: <?php echo $auth->isAdmin() ? 'true' : 'false'; ?>
    };
</script>
<script src="assets/js/reels.js"></script>
</body>
</html>
