<?php
// ============================================================================
// profile.php - Instagram uslubidagi profil sahifasi
// ============================================================================
//   profile.php            -> o'z profili (login kerak)
//   profile.php?user_id=N  -> boshqa foydalanuvchi profili (oddiy ko'rish)
//
// Sahifa "karkas" - ma'lumotni api/profile.php yuklaydi (assets/js/profile.js).
// Tarkiblar (Instagram'ga o'xshash):
//   * avatar + ism + @username + bio
//   * statistika: Reels | Ko'rishlar | Yoqtirishlar
//   * Highlight qator (eng mashhur reels)
//   * yorliqlar: Reels (grid) | Yoqqanlar | Saqlangan
//   * profilni tahrirlash modal (bio, ism, username, avatar)
// ============================================================================
require_once __DIR__ . '/includes/bootstrap.php';

$viewUserId = (int) ($_GET['user_id'] ?? 0);
$meId       = $user ? (int) $user['id'] : null;

// O'z profilini so'ragan bo'lsa va login qilmagan bo'lsa - login'ga yuboramiz
if ($viewUserId <= 0 && !$meId) {
    header('Location: login.php');
    exit;
}
?>
<!DOCTYPE html>
<html lang="uz">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, user-scalable=no">
    <title>Profil — <?php echo htmlspecialchars(SITE_NAME); ?></title>
    <meta name="description" content="Profil — <?php echo htmlspecialchars(SITE_NAME); ?>">
    <link rel="stylesheet" href="assets/css/style.css">
    <link rel="stylesheet" href="assets/css/profile.css">
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
<body class="profile-body ig-shell">

<!-- Instagram uslubidagi navigatsiya -->
<?php $NAV_ACTIVE = 'profile'; require __DIR__ . '/includes/nav.php'; ?>

<!-- ================================================= Yuqori panel -->
<header class="pf-top">
    <a class="pf-back" href="index.php" aria-label="Orqaga">←</a>
    <div class="pf-title" id="pfTitle">Profil</div>
    <div class="pf-top-actions">
        <a class="pf-top-btn" href="reels-upload.php" title="Reels yuklash" id="pfUploadBtn" hidden>＋</a>
        <a class="pf-top-btn" href="logout.php" title="Chiqish" id="pfLogoutBtn" hidden>⏻</a>
    </div>
</header>

<main class="pf-main">

    <!-- Profil kartasi -->
    <section class="pf-card">
        <div class="pf-header">
            <div class="pf-avatar" id="pfAvatar"></div>
            <div class="pf-head-info">
                <h1 class="pf-name" id="pfName">…</h1>
                <span class="pf-username" id="pfUsername">@…</span>
                <p class="pf-bio" id="pfBio"></p>
            </div>
        </div>

        <div class="pf-stats" id="pfStats">
            <div class="pf-stat"><b data-k="reels">0</b><span>Reels</span></div>
            <div class="pf-stat"><b data-k="views">0</b><span>Ko'rishlar</span></div>
            <div class="pf-stat"><b data-k="likes">0</b><span>Yoqtirishlar</span></div>
        </div>

        <div class="pf-actions" id="pfActions"></div>
    </section>

    <!-- Highlight qator (Instagram'dagi kabi) -->
    <section class="pf-highlight-wrap" id="pfHighlightsWrap" hidden>
        <div class="pf-sec-title">⭐ Highlightlar</div>
        <div class="pf-highlights" id="pfHighlights"></div>
    </section>

    <!-- Yorliqlar -->
    <nav class="pf-tabs" id="pfTabs">
        <button class="pf-tab active" data-tab="reels">Reels</button>
        <button class="pf-tab" data-tab="liked" data-self hidden>Yoqqanlar</button>
        <button class="pf-tab" data-tab="saved" data-self hidden>Saqlangan</button>
    </nav>

    <!-- Grid -->
    <div class="pf-grid" id="pfGrid"></div>
    <div class="pf-empty" id="pfEmpty" hidden></div>
    <div class="pf-more" id="pfMore" hidden><span class="spinner"></span></div>
</main>

<!-- Tahrirlash modali -->
<div class="pf-modal" id="pfModal" hidden>
    <div class="pf-modal-box">
        <h3>✏️ Profilni tahrirlash</h3>
        <form id="pfEditForm" autocomplete="off">
            <label>Ism *</label>
            <input name="first_name" id="pfInName" maxlength="50" required>

            <label>Familiya</label>
            <input name="last_name" id="pfInLast" maxlength="50">

            <label>Username</label>
            <input name="username" id="pfInUser" maxlength="40" placeholder="@username">

            <label>Avatar URL</label>
            <input name="avatar" id="pfInAvatar" maxlength="500" placeholder="https://… (ixtiyoriy)">

            <label>Bio</label>
            <textarea name="bio" id="pfInBio" maxlength="300" rows="3" placeholder="O'zingiz haqingizda…"></textarea>

            <div class="pf-modal-err" id="pfEditErr"></div>
            <div class="pf-modal-btns">
                <button type="button" class="pf-btn ghost" id="pfModalCancel">Bekor qilish</button>
                <button type="submit" class="pf-btn prim" id="pfModalSave">💾 Saqlash</button>
            </div>
        </form>
    </div>
</div>

<div class="pf-toast" id="pfToast" hidden></div>

<script>
    const PROFILE_VIEW_ID = <?php echo json_encode($viewUserId); ?>;
    const PROFILE_ME_ID   = <?php echo json_encode($meId); ?>;
    const SITE_NAME       = <?php echo json_encode(SITE_NAME); ?>;
</script>
<script src="assets/js/profile.js"></script>
</body>
</html>