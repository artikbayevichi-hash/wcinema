<?php
// ============================================================================
// admin-panel.php — YANGI admin panel (SPA, yon menyu + tun/kun mavzusi)
// ============================================================================
// Eski sahifalar (admin.php, admin-content.php, admin-users.php,
// admin-notify.php) ZAXIRA sifatida saqlanib qolgan — pastdagi havola orqali.
//
// Kirish: admin-login.php (parol) → 30 kunlik imzolangan cookie.
// ============================================================================
require_once __DIR__ . '/includes/bootstrap.php';

// --- Chiqish --------------------------------------------------------------
if (isset($_GET['logout'])) {
    $auth->adminCookieClear();
    unset($_SESSION['wc_admin_ok']);
    header('Location: admin-login.php');
    exit;
}

if (!$auth->isAdmin()) {
    $here = (string) ($_SERVER['SCRIPT_NAME'] ?? '/admin-panel.php');
    header('Location: admin-login.php?next=' . rawurlencode($here));
    exit;
}

$base = rtrim(dirname((string) ($_SERVER['SCRIPT_NAME'] ?? '/')), '/\\');
$cssV = @filemtime(__DIR__ . '/assets/css/admin-panel.css') ?: 1;
$cssN = @filemtime(__DIR__ . '/assets/css/admin-neon.css') ?: 1;
$jsV  = @filemtime(__DIR__ . '/assets/js/admin-panel.js') ?: 1;
$jsC  = @filemtime(__DIR__ . '/assets/js/admin-content.js') ?: 1;
$logV = @filemtime(__DIR__ . '/assets/img/logo.png') ?: 1;
?>
<!DOCTYPE html>
<html lang="uz" data-theme="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <meta name="robots" content="noindex, nofollow">
    <title>Admin — <?php echo htmlspecialchars(SITE_NAME); ?></title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=Inter:wght@400;500;600&display=swap">
    <link rel="stylesheet" href="assets/css/admin-panel.css?v=<?php echo $cssV; ?>">
    <link rel="stylesheet" href="assets/css/admin-neon.css?v=<?php echo $cssN; ?>">
    <script>
        window.ADM = {
            base: <?php echo json_encode($base); ?>,
            name: <?php echo json_encode(SITE_NAME); ?>
        };
    </script>
</head>
<body>
<div class="adm">

    <aside class="side">
        <div class="brand">
            <img src="assets/img/logo.png?v=<?php echo $logV; ?>" alt="">
            <div>
                <b><?php echo htmlspecialchars(SITE_NAME); ?></b>
                <span>Admin panel</span>
            </div>
        </div>

        <button class="nav-item" data-view="dashboard"><span class="ic">📊</span> Boshqaruv</button>
        <button class="nav-item" data-view="content"><span class="ic">🎬</span> Kontent</button>
        <button class="nav-item" data-view="reels"><span class="ic">📱</span> Reels</button>
        <button class="nav-item" data-view="users"><span class="ic">👥</span> Foydalanuvchilar</button>
        <button class="nav-item" data-view="notify"><span class="ic">🔔</span> Bildirishnoma</button>
        <button class="nav-item" data-view="stats"><span class="ic">📈</span> Statistika</button>
        <button class="nav-item" data-view="settings"><span class="ic">⚙️</span> Sozlamalar</button>
        <button class="nav-item" data-view="logs"><span class="ic">🧾</span> Loglar</button>

        <div class="sp"></div>

        <div class="foot">
            <a class="nav-item" href="index.php"><span class="ic">🌐</span> Saytni ochish</a>
            <a class="nav-item" href="admin.php"><span class="ic">🗂</span> Eski panel</a>
            <a class="nav-item" href="admin-panel.php?logout=1" id="logoutLink"><span class="ic">🚪</span> Chiqish</a>
        </div>
    </aside>

    <main class="main">
        <div class="topbar">
            <button class="btn ghost menu-btn" id="menuBtn" type="button" aria-label="Menyu">☰</button>
            <div>
                <h1>Boshqaruv paneli</h1>
                <div class="sub"></div>
            </div>
            <div class="sp"></div>
            <button class="btn ghost" id="themeBtn" type="button">☀️ Kun</button>
        </div>

        <div id="view"><div class="empty">Yuklanmoqda…</div></div>
    </main>
</div>

<script src="assets/js/admin-content.js?v=<?php echo $jsC; ?>"></script>
<script src="assets/js/admin-panel.js?v=<?php echo $jsV; ?>"></script>
</body>
</html>
