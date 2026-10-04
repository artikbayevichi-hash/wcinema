<?php
// ============================================================================
// settings.php — Foydalanuvchi sozlamalari
// ----------------------------------------------------------------------------
// Bo'limlar:
//   1) Account Privacy  — profil ochiq/maxfiy, faollik ko'rinishi
//   2) Block Users       — qidirish, bloklash, blokdan chiqarish
//   3) Profile Edit      — ism, familiya, username, bio, avatar
// ============================================================================
require_once __DIR__ . '/includes/bootstrap.php';

$user   = $auth->getCurrentUser();
$userId = $user ? (int) $user['id'] : null;
?>
<!DOCTYPE html>
<html lang="uz">
<head>
    <link rel="icon" type="image/png" href="assets/img/favicon.png?v=<?php echo @filemtime(__DIR__ . '/assets/img/favicon.png') ?: 1; ?>">
    <link rel="apple-touch-icon" href="assets/img/apple-touch-icon.png?v=<?php echo @filemtime(__DIR__ . '/assets/img/apple-touch-icon.png') ?: 1; ?>">
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <title>Sozlamalar &mdash; <?php echo htmlspecialchars(SITE_NAME); ?></title>
    <link rel="stylesheet" href="assets/css/style.css">
    <link rel="stylesheet" href="assets/css/instagram.css">
    <link rel="stylesheet" href="assets/css/settings.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/settings.css') ?: 1; ?>">
    <?php require __DIR__ . '/includes/tv-head.php'; ?>
</head>
<body class="st-body ig-shell">

<?php $NAV_ACTIVE = 'profile'; require __DIR__ . '/includes/nav.php'; ?>

<header class="st-top">
    <a class="st-back" href="profile.php" aria-label="Orqaga">&larr;</a>
    <div class="st-title">Sozlamalar</div>
</header>

<main class="st-main">

    <!-- ========================= 1) ACCOUNT PRIVACY ========================= -->
    <section class="st-sec">
        <div class="st-sec-head">Account Privacy</div>
        <div class="st-card">

            <label class="st-row" for="stPrivate">
                <span class="st-row-ico">&#128274;</span>
                <span class="st-row-body">
                    <span class="st-row-t">Maxfiy hisob
                        <span class="st-priv" id="stPrivBadge" hidden>MAXFIY</span>
                    </span>
                    <span class="st-row-s" id="stPrivateHint">Hamma profilni ko‘ra oladi.</span>
                </span>
                <input type="checkbox" class="st-switch" id="stPrivate">
            </label>

            <label class="st-row" for="stActivity">
                <span class="st-row-ico">&#128101;</span>
                <span class="st-row-body">
                    <span class="st-row-t">Faollikni ko‘rsatish</span>
                    <span class="st-row-s">Yoqtirish va kuzatish — kim yozganini boshqalar ko‘radi.</span>
                </span>
                <input type="checkbox" class="st-switch" id="stActivity">
            </label>

        </div>
    </section>

    <!-- ========================== 2) BLOCK USERS =========================== -->
    <section class="st-sec">
        <div class="st-sec-head">
            Bloklanganlar <b id="stBlockCount"></b>
        </div>
        <div class="st-card">

            <div class="st-search">
                <input type="text" id="stSearch" autocomplete="off"
                       placeholder="Foydalanuvchini qidirish va bloklash&hellip;">
                <div class="st-res" id="stSearchRes" hidden></div>
            </div>

            <div class="st-blocked-list" id="stBlockList"></div>
        </div>
    </section>

    <!-- ========================= 3) PROFILE EDIT =========================== -->
    <section class="st-sec">
        <div class="st-sec-head">Profilni tahrirlash</div>
        <div class="st-card">
            <form class="st-form" id="stForm" autocomplete="off">
                <div class="st-field">
                    <label class="st-label" for="stName">Ism <span style="color:var(--accent-2)">*</span></label>
                    <input class="st-input" id="stName" maxlength="100" required>
                </div>
                <div class="st-field">
                    <label class="st-label" for="stLast">Familiya</label>
                    <input class="st-input" id="stLast" maxlength="100">
                </div>
                <div class="st-field">
                    <label class="st-label" for="stUser">Username</label>
                    <input class="st-input" id="stUser" maxlength="40" placeholder="@username">
                </div>
                <div class="st-field">
                    <label class="st-label" for="stAvatar">Avatar URL</label>
                    <input class="st-input" id="stAvatar" maxlength="500"
                           placeholder="https://&hellip; (ixtiyoriy)">
                </div>
                <div class="st-field">
                    <label class="st-label" for="stBio">
                        Bio <span class="st-count" id="stBioCount">0 / 500</span>
                    </label>
                    <textarea class="st-textarea" id="stBio" rows="3" maxlength="500"
                              placeholder="O‘zingiz haqingizda&hellip;"></textarea>
                </div>
                <button class="st-btn" id="stSaveBtn" type="submit">Saqlash</button>
            </form>
        </div>
    </section>

    <div class="st-msg" id="stMsg" hidden></div>

</main>

<div class="st-toast" id="stToast" hidden></div>

<script src="assets/js/settings.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/settings.js') ?: 1; ?>"></script>

</body>
</html>