<?php
// ============================================================================
// profile.php — YouTube/Instagram uslubidagi profil sahifasi
// ----------------------------------------------------------------------------
//   profile.php            → o'z profili
//   profile.php?user_id=N  → boshqa foydalanuvchi profili
//
// Sahifa "karkas" — ma'lumotni api/profile.php yuklaydi (assets/js/profile.js).
// Tarkiblar:
//   * avatar + ism + @username + bio + maxfiylik belgisi
//   * statistika: 3 asosiy ko'rsatkich + alohida kichik analitika bloki
//   * Highlight qator (eng mashhur kontent)
//   * yorliqlar: ikonkali Reels | Posts | Videos | Yoqqanlar | Saqlangan
//   * profilni tahrirlash modal (bio, ism, username, avatar)
//   * ulashish modali: havola nusxalash + QR (mahalliy SVG/CSS, CDN yo'q)
//   * boshqa profil: Kuzatish | Xabar | Ulashish; ⋯ menyuda blok/shikoyat/nusxalash
// ============================================================================
require_once __DIR__ . '/includes/bootstrap.php';

$viewUserId = (int) ($_GET['user_id'] ?? 0);
$meId       = $user ? (int) $user['id'] : null;
?>
<!DOCTYPE html>
<html lang="uz">
<head>
    <link rel="icon" type="image/png" href="assets/img/favicon.png?v=<?php echo @filemtime(__DIR__ . '/assets/img/favicon.png') ?: 1; ?>">
    <link rel="apple-touch-icon" href="assets/img/apple-touch-icon.png?v=<?php echo @filemtime(__DIR__ . '/assets/img/apple-touch-icon.png') ?: 1; ?>">
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <title>Profil &mdash; <?php echo htmlspecialchars(SITE_NAME); ?></title>
    <?php require __DIR__ . '/includes/perf-head.php'; ?>
    <meta name="description" content="Profil &mdash; <?php echo htmlspecialchars(SITE_NAME); ?>">
    <link rel="stylesheet" href="assets/css/style.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/style.css') ?: 1; ?>">
    <link rel="stylesheet" href="assets/css/profile.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/profile.css') ?: 1; ?>">
    <link rel="stylesheet" href="assets/css/instagram.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/instagram.css') ?: 1; ?>">
    <?php require __DIR__ . '/includes/tv-head.php'; ?>
    <!-- Telegram Web App &mdash; FAQAT Telegram ilovasi ichida kerak. Oddiy
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

<!-- Navigatsiya -->
<?php $NAV_ACTIVE = 'profile'; require __DIR__ . '/includes/nav.php'; ?>

<!-- ================================================= Yuqori panel -->
<header class="pf-top">
    <a class="pf-back" href="index.php" aria-label="Orqaga"><?php echo ig_svg('back'); ?></a>
    <div class="pf-title" id="pfTitle">Profil</div>
    <div class="pf-top-actions">
        <a class="pf-top-btn" href="settings.php" title="Sozlamalar" id="pfSettingsBtn" hidden><?php echo ig_svg('settings'); ?></a>
        <a class="pf-top-btn" href="reels-upload.php" title="Joylash" id="pfUploadBtn" hidden><?php echo ig_svg('plus'); ?></a>
        <a class="pf-top-btn" href="logout.php" title="Chiqish" id="pfLogoutBtn" hidden><?php echo ig_svg('logout'); ?></a>
        <!-- Faqat BOSHQA profilda ko'rinadi: blok/shikoyat/havola bu yerga ko'chirildi. -->
        <button type="button" class="pf-top-btn pf-more-btn" id="pfProfileMoreBtn"
                aria-label="Ko'proq" aria-haspopup="true" aria-expanded="false" hidden>&#8943;</button>
        <div class="pf-more-menu" id="pfProfileMoreMenu" role="menu" hidden>
            <button type="button" role="menuitem" data-more="copy">Havolani nusxalash</button>
            <button type="button" role="menuitem" data-more="block" id="pfMenuBlockBtn">Bloklash</button>
            <button type="button" role="menuitem" data-more="report">Shikoyat qilish</button>
        </div>
    </div>
</header>

<main class="pf-main">

    <!-- Profil kartasi -->
    <section class="pf-card">
        <div class="pf-header">
            <div class="pf-avatar" id="pfAvatar"></div>
            <div class="pf-head-info">
                <h1 class="pf-name" id="pfName">&hellip;</h1>
                <span class="pf-username" id="pfUsername">@&hellip;</span>
                <p class="pf-bio" id="pfBio"></p>
                <span class="pf-private" id="pfPrivateBadge" hidden>&#128274; Maxfiy</span>
                <span class="pf-private" id="pfBlockedBadge" hidden>Bloklangan</span>
            </div>
        </div>

        <!-- Instagram uslubi: asosiy qatorda FAQAT 3 ko'rsatkich. -->
        <div class="pf-stats" id="pfStats">
            <div class="pf-stat"><b data-k="reels">0</b><span>Reels / Postlar</span></div>
            <button type="button" class="pf-stat pf-stat-link" data-list="followers">
                <b data-k="followers">0</b><span>Kuzatuvchilar</span>
            </button>
            <button type="button" class="pf-stat pf-stat-link" data-list="following">
                <b data-k="following">0</b><span>Kuzatilayotgan</span>
            </button>
        </div>

        <!-- Analitika asosiy qatordan chiqarildi (yo'q qilinmadi). -->
        <div class="pf-analytics" id="pfAnalytics" aria-label="Analitika">
            <span class="pf-analytics-i">Ko'rishlar <b data-k="views">0</b></span>
            <span class="pf-analytics-i">Yoqtirishlar <b data-k="likes">0</b></span>
        </div>

        <div class="pf-actions" id="pfActions"></div>
    </section>

    <!-- Maxfiy profil ogohlantirishi -->
    <div class="pf-locked" id="pfLocked" hidden>
        <div class="pf-locked-ico">&#128274;</div>
        <div class="pf-locked-t">Bu profil maxfiy</div>
        <div class="pf-locked-s">
            Bu hisob faqat uni kuzatuvchilar ko‘ra oladi.
            Agar sizni kuzatmoqchimisangiz, «Kuzatish» tugmasini bosing.
        </div>
    </div>

    <!-- Highlight qator -->
    <section class="pf-highlight-wrap" id="pfHighlightsWrap" hidden>
        <div class="pf-sec-title">&#127894; Highlightlar</div>
        <div class="pf-highlights" id="pfHighlights"></div>
    </section>

    <!-- Yorliqlar -->
    <nav class="pf-tabs" id="pfTabs" aria-label="Profil bo'limlari">
        <button class="pf-tab active" data-tab="reels"><?php echo ig_svg('reels'); ?><span>Reels</span></button>
        <button class="pf-tab" data-tab="posts"><?php echo ig_svg('image'); ?><span>Posts</span></button>
        <button class="pf-tab" data-tab="videos"><?php echo ig_svg('film'); ?><span>Videos</span></button>
        <button class="pf-tab" data-tab="liked" data-self hidden><?php echo ig_svg('heart'); ?><span>Yoqqanlar</span></button>
        <button class="pf-tab" data-tab="saved" data-self hidden><?php echo ig_svg('bookmark'); ?><span>Saqlangan</span></button>
    </nav>

    <!-- Grid -->
    <div class="pf-grid" id="pfGrid"></div>
    <div class="pf-empty" id="pfEmpty" hidden></div>
    <div class="pf-more" id="pfMore" hidden><span class="spinner"></span></div>
</main>

<!-- Tahrirlash modali -->
<div class="pf-modal" id="pfModal" role="dialog" aria-modal="true" aria-labelledby="pfModalTitle" hidden>
    <div class="pf-modal-box">
        <h3 id="pfModalTitle"><?php echo ig_svg('edit'); ?> Profilni tahrirlash</h3>
        <form id="pfEditForm" autocomplete="off">
            <div class="pf-field pf-field-av">
                <label>Profil rasmi</label>
                <div class="pf-av-edit">
                    <span class="pf-av-preview" id="pfAvPreview">?</span>
                    <div class="pf-av-btns">
                        <label class="pf-btn ghost pf-av-pick" for="pfInAvatarFile"><?php echo ig_svg('camera'); ?> Rasm tanlash</label>
                        <input type="file" id="pfInAvatarFile" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
                        <button type="button" class="pf-btn ghost" id="pfAvRemove"><?php echo ig_svg('trash'); ?> O&#8217;chirish</button>
                    </div>
                </div>
            </div>

            <div class="pf-field">
                <label>Ism *</label>
                <input name="first_name" id="pfInName" maxlength="100" required>
            </div>

            <div class="pf-field">
                <label>Familiya</label>
                <input name="last_name" id="pfInLast" maxlength="100">
            </div>

            <div class="pf-field">
                <label>Username</label>
                <input name="username" id="pfInUser" maxlength="40" placeholder="@username">
            </div>

            <div class="pf-field">
                <label>Bio</label>
                <textarea name="bio" id="pfInBio" maxlength="500" rows="3" placeholder="O'zingiz haqingizda&hellip;"></textarea>
            </div>

            <div class="pf-modal-err" id="pfEditErr"></div>
            <div class="pf-modal-btns">
                <button type="button" class="pf-btn ghost" id="pfModalCancel">Bekor qilish</button>
                <button type="submit" class="pf-btn prim" id="pfModalSave"><?php echo ig_svg('check'); ?> Saqlash</button>
            </div>
        </form>
    </div>
</div>

<!-- Kuzatuvchilar / kuzatilayotganlar ro'yxati (Instagram uslubi) -->
<div class="pf-modal" id="pfListModal" role="dialog" aria-modal="true" aria-labelledby="pfListTitle" hidden>
    <div class="pf-modal-box pf-list-box">
        <div class="pf-list-head">
            <h3 id="pfListTitle">Kuzatuvchilar</h3>
            <button type="button" class="pf-list-x" id="pfListX" aria-label="Yopish">&times;</button>
        </div>
        <div class="pf-list-body" id="pfListBody"></div>
        <div class="pf-list-more" id="pfListMore" hidden><span class="spinner"></span></div>
    </div>
</div>

<!-- Profilni ulashish: havola + mahalliy SVG QR (tashqi kutubxona yo'q) -->
<div class="pf-modal" id="pfShareModal" role="dialog" aria-modal="true" aria-labelledby="pfShareTitle" hidden>
    <div class="pf-modal-box pf-share-box">
        <div class="pf-list-head">
            <h3 id="pfShareTitle">Profilni ulashish</h3>
            <button type="button" class="pf-list-x" id="pfShareX" aria-label="Yopish">&times;</button>
        </div>
        <div class="pf-share-body">
            <div class="pf-share-qr" id="pfShareQr" aria-label="Profil havolasi QR kodi"></div>
            <div class="pf-share-url" id="pfShareUrl"></div>
            <button type="button" class="pf-btn prim" id="pfShareCopy">Havolani nusxalash</button>
        </div>
    </div>
</div>

<div class="pf-toast" id="pfToast" hidden></div>

<script src="assets/js/wc-lib.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/wc-lib.js') ?: 1; ?>"></script>
<script>
    // tg-stream.js uchun (faqat localStorage'da akkaunt yo'q bo'lsa ulanadi).
    window.APP = window.APP || {
        base: <?php echo json_encode(rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/\\')); ?>,
        tg: {
            apiId:   <?php echo (int) TG_API_ID; ?>,
            apiHash: <?php echo json_encode((string) TG_API_HASH); ?>
        }
    };
    const PROFILE_VIEW_ID = <?php echo json_encode($viewUserId); ?>;
    const PROFILE_ME_ID   = <?php echo json_encode($meId); ?>;
    const SITE_NAME       = <?php echo json_encode(SITE_NAME); ?>;
    const APP_BOT         = <?php echo json_encode((string) TELEGRAM_BOT_USERNAME); ?>;
</script>
<script src="assets/js/tg-stream.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/tg-stream.js') ?: 1; ?>"></script>
<script src="assets/js/profile.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/profile.js') ?: 1; ?>"></script>
</body>
</html>
