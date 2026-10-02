<?php
// ============================================================================
// Asosiy sahifa - kino / anime / multfilm katalogi
//
// DIQQAT: bu fayl "placeholder" holatidan tiklangan (assets/js/app.js va
// assets/css/style.css to'liq kino UI ga mo'ljallangan edi, lekin markup
// yo'q edi). Shuning uchun har bir id (#catChips, #modal, #playerVideo ...)
// app.js dagi selektorlar bilan ANIQ mos kelishi shart.
// ============================================================================
require_once __DIR__ . '/includes/bootstrap.php';

$user     = $auth->getCurrentUser();
$userId   = $user ? (int) $user['id'] : null;
$botName  = TELEGRAM_BOT_USERNAME;
$botUrl   = 'https://t.me/' . $botName;
$miniApp  = MINI_APP_URL;
$stats    = $catalog->getStats();

// Chuqur havola: /index.php?c=12&e=45 (yoki faqat e=45 — kontent avtomatik topiladi)
$initialContentId = (int) ($_GET['c'] ?? 0);
$initialEpisodeId = (int) ($_GET['e'] ?? 0);
if ($initialContentId <= 0 && $initialEpisodeId > 0) {
    $epRow = $catalog->getEpisode($initialEpisodeId);
    if ($epRow) {
        $initialContentId = (int) $epRow['content_id'];
    }
}

// --- Tarmoqqa chiqarish uchun sifatli ta'rif (Open Graph / Telegram preview)
$pageTitle = SITE_NAME;
$pageDesc  = 'Kino, anime va multfilmlar katalogi. Tomosha qiling, Telegram\'ga saqlang.';
$pageImage = '';
$pageUrl   = SITE_URL . '/index.php';
if ($initialContentId > 0 && $item = $catalog->getContent($initialContentId)) {
    $pageTitle = $item['title'] . ' — ' . SITE_NAME;
    $pageImage = Catalog::posterSrc($item['poster'] ?: '') ?: $item['banner_url'] ?: '';
    // og:image mutlaq manzil bo'lishi shart — relative API yo'lini to'ldiramiz
    if (strpos((string) $pageImage, 'api/tg-resolve.php') === 0) {
        $pageImage = SITE_URL . '/' . $pageImage;
    }
}
$pageImage = $pageImage && preg_match('#^https?://#i', $pageImage)
    ? $pageImage : '';
?>
<!DOCTYPE html>
<html lang="uz">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <title><?php echo htmlspecialchars($pageTitle, ENT_QUOTES); ?></title>
    <meta name="description" content="<?php echo htmlspecialchars($pageDesc, ENT_QUOTES); ?>">

    <!-- Telegram Mini App / tarmoqqa chiqarish -->
    <meta property="og:type" content="video.episode">
    <meta property="og:site_name" content="<?php echo htmlspecialchars(SITE_NAME, ENT_QUOTES); ?>">
    <meta property="og:title" content="<?php echo htmlspecialchars($pageTitle, ENT_QUOTES); ?>">
    <meta property="og:description" content="<?php echo htmlspecialchars($pageDesc, ENT_QUOTES); ?>">
    <?php if ($pageImage): ?>
    <meta property="og:image" content="<?php echo htmlspecialchars($pageImage, ENT_QUOTES); ?>">
    <meta name="twitter:card" content="summary_large_image">
    <?php endif; ?>
    <link rel="canonical" href="<?php echo htmlspecialchars($pageUrl, ENT_QUOTES); ?>">

    <link rel="stylesheet" href="assets/css/style.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/style.css') ?: 1; ?>">
    <link rel="stylesheet" href="assets/css/reels.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/reels.css') ?: 1; ?>">
    <link rel="stylesheet" href="assets/css/instagram.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/instagram.css') ?: 1; ?>">
    <link rel="stylesheet" href="assets/css/player.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/player.css') ?: 1; ?>">
<link rel="stylesheet" href="assets/css/tg-stream.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/tg-stream.css') ?: 1; ?>">
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

<!-- =====================================================================
     TELEGRAM KIRISH HIMOYASI
     ---------------------------------------------------------------------
     Kirish endi alohida sahifada (`tg-login.php`) va `nav.php` dagi
     guard orqali boshqariladi: kalit (auth_key) localStorage'da bo'lmasa,
     foydalanuvchi login sahifasiga yo'naltiriladi. Video baytlari esa
     Telegram CDN dan to'g'ridan-to'g'ri oqadi — serverga umuman tegmaydi.
     ================================================================== -->

<!-- Instagram uslubidagi navigatsiya (desktop yon panel / mobil pastki panel) -->
<?php $NAV_ACTIVE = 'home'; require __DIR__ . '/includes/nav.php'; ?>

<!-- ===================================================== Qidiruv + filtrlar -->
<div class="filters">
    <div class="search-box">
        <input id="searchInput" type="search" placeholder="Kino, anime, multfilm qidiring…" autocomplete="off">
        <button class="clear-btn" id="searchClear" hidden aria-label="Tozalash">✕</button>
    </div>
    <div class="chips" id="catChips"></div>
    <div class="chips" id="sortChips">
        <button class="chip active" data-sort="new">🆕 Yangi</button>
        <button class="chip" data-sort="popular">🔥 Mashhur</button>
        <button class="chip" data-sort="rating">⭐ Reyting</button>
        <button class="chip" data-sort="az">🔤 A–Z</button>
    </div>
</div>

<div class="loading" id="loading" hidden><span class="spinner"></span> Yuklanmoqda…</div>

<main>
    <!-- ================================================= Bosh sahifa -->
    <section id="homeView">
        <div class="row" id="continueRow" hidden>
            <h2 class="row-title">▶️ Davom etish</h2>
            <div class="grid" id="continueGrid"></div>
        </div>

        <div class="row">
            <h2 class="row-title">🔥 Trending</h2>
            <div class="grid" id="trendingGrid"></div>
        </div>

        <div class="row">
            <h2 class="row-title">🆕 Yangi qo‘shilganlar</h2>
            <div class="grid" id="newGrid"></div>
        </div>

        <div id="catRows"></div>

        <div class="more-wrap">
            <button class="btn-more" id="goCatalog">📚 Butun katalogni ko‘rish</button>
        </div>
    </section>

    <!-- ================================================= Ro'yxat -->
    <section id="listView" hidden>
        <h2 class="row-title" id="listTitle">Katalog</h2>
        <div class="grid" id="listGrid"></div>
        <div class="empty" id="listEmpty" hidden>Natija topilmadi. Boshqa so‘z bilan urinib ko‘ring.</div>
        <div class="more-wrap">
            <button class="btn-more" id="loadMore" hidden>Yana ko‘rsatish</button>
        </div>
    </section>
</main>

<footer class="foot">
    <p><?php echo htmlspecialchars(SITE_NAME); ?> · <?php echo (int) $stats['content']; ?> kontent ·
       <?php echo (int) $stats['episodes']; ?> qism</p>
    <p><a href="<?php echo htmlspecialchars($botUrl); ?>" target="_blank">@<?php echo htmlspecialchars($botName); ?></a></p>
</footer>

<!-- ===================================================== Modal (film/qism) -->
<div class="modal" id="modal" hidden>
    <div class="modal-backdrop" data-close></div>
    <div class="modal-box">
        <button class="modal-close" data-close aria-label="Yopish">✕</button>
        <div id="modalBody"></div>
    </div>
</div>

<!-- ===================================================== Trimmer modal -->
<div class="modal" id="trimModal" hidden>
    <div class="modal-backdrop" data-trim-close></div>
    <div class="modal-box">
        <button class="modal-close" data-trim-close aria-label="Yopish">✕</button>
        <div id="trimBody"></div>
    </div>
</div>

<script>
    // ---- PHP -> JS ko'prigi. app.js shu oynalarni o'qidi.
    window.APP = {
        base: <?php echo json_encode(rtrim(dirname($_SERVER['SCRIPT_NAME'] ?? '/'), '/\\')); ?>,
        userId: <?php echo $userId ? (int) $userId : 'null'; ?>,
        userName: <?php echo json_encode($user['first_name'] ?? null); ?>,
        botUsername: <?php echo json_encode($botName); ?>,
        botUrl: <?php echo json_encode($botUrl); ?>,
        miniApp: <?php echo json_encode($miniApp); ?>,
        isAdmin: <?php echo $auth->isAdmin() ? 'true' : 'false'; ?>,
        contentId: <?php echo $initialContentId; ?>,
        episodeId: <?php echo $initialEpisodeId; ?>,
        siteName: <?php echo json_encode(SITE_NAME); ?>,
        // Telegram CDN player uchun. Bu kalitlar FAQAT Telegram'ning
        // ommaviy API identifikatorlari (Telegram Web'ning o'zgartirmasdan
        // ishlatadigan raqamlari) — foydalanuvchi kaliti EMAS.
        tg: {
            apiId:   <?php echo (int) TG_API_ID; ?>,
            apiHash: <?php echo json_encode((string) TG_API_HASH); ?>
        },
        reels: { maxUploadMb: <?php echo (int) REEL_MAX_UPLOAD_MB; ?>, maxLengthSec: <?php echo (int) REEL_MAX_LENGTH; ?> }
    };
</script>
<script src="https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js"></script>
<script src="assets/js/player.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/player.js') ?: 1; ?>"></script>
<script src="assets/js/reels.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/reels.js') ?: 1; ?>"></script>
<script src="assets/js/tg-probe.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/tg-probe.js') ?: 1; ?>"></script>
<script src="assets/js/tg-stream.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/tg-stream.js') ?: 1; ?>"></script>
<script src="assets/js/app.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/app.js') ?: 1; ?>"></script>
<script>
    // Telegram CDN player — Service Worker'ni DARHOL o'rnatamiz.
    // (Birinchi ochilishda sahifa bir marta qayta yuklanadi — bu brauzer
    //  qoidasi: SW o'z sahifasini faqat keyingi yuklanishda boshqaradi.)
    // Film ochilganda kutib turmasligi uchun boshida qilamiz.
    if (window.TgStream) window.TgStream.init();

    // SESSIYA TEKSHIRUVI — kirish eshigi endi alohida sahifada
    // (`tg-login.php`) va `nav.php` dagi guard orqali boshqariladi.
    //
    // Bu yerda kalitni fonda JIM tekshiramiz: yaroqli bo'lsa yon panel
    // yashil bo'ladi; Telegram sessiyani bekor qilgan bo'lsa — login
    // sahifasiga qaytamiz (xuddi Telegram Web kabi).
    document.addEventListener('DOMContentLoaded', function () {
        if (window.TgStream && window.TgStream.hasSession()) {
            window.TgStream.verify().then(function () {
                document.documentElement.setAttribute('data-tg-ready', '1');
                window.dispatchEvent(new Event('wc:tgReady'));
            }).catch(function () {
                // Kalit bekor qilingan — login sahifasi qayta ochiladi.
                if (!window.TgStream.hasSession()) {
                    location.replace((window.APP && window.APP.base ? window.APP.base : '') + '/tg-login.php');
                }
            });
        }

        // "Butun katalogni ko'rish" - app.js ga alohida hodisa beriladi
        var b = document.getElementById('goCatalog');
        if (b) b.onclick = function () { window.dispatchEvent(new Event('wc:showCatalog')); };
    });
</script>
</body>
</html>
