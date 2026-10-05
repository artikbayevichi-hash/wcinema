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

// Eski chuqur havola: /index.php?c=12&e=45 (yoki faqat e=45 — kontent avtomatik
// topiladi). Videolar endi alohida `watch.php` sahifasida ochiladi, shuning
// uchun bu havola shu yerga yo'naltiriladi (serverda, JS dan tezroq).
// `ep=` ham qabul qilinadi (watch.php bilan bir xil).
if ((int) ($_GET['c'] ?? 0) > 0 || (int) ($_GET['e'] ?? $_GET['ep'] ?? 0) > 0) {
    $cId = (int) ($_GET['c'] ?? 0);
    $eId = (int) ($_GET['e'] ?? $_GET['ep'] ?? 0);
    if ($cId <= 0 && $eId > 0) {
        $epRow = $catalog->getEpisode($eId);
        if (!$epRow) {
            // `e=` qism ID'si emas, 1-fasl qism raqami bo'lishi mumkin.
            $epRow = $catalog->getEpisodeByNumber($eId);
        }
        if ($epRow) {
            $cId = (int) $epRow['content_id'];
        }
    }
    if ($cId > 0) {
        header('Location: watch.php?c=' . $cId . ($eId > 0 ? '&e=' . $eId : ''), true, 302);
        exit;
    }
}

// --- Tarmoqqa chiqarish uchun sifatli ta'rif (Open Graph / Telegram preview)
$pageTitle = SITE_NAME;
$pageDesc  = 'Kino, anime va multfilmlar katalogi. Tomosha qiling va saqlang.';
$pageImage = '';
$pageUrl   = SITE_URL . '/index.php';
// DIQQAT: kontentga xos `og:image` endi bu yerda yo'q - `?c=` bilan kelgan
// so'rovlar yuqorida `watch.php` ga yo'naltiriladi, u o'z meta-taglarini
// o'zi qo'yadi. (Sahifa `?c=` siz ochilganda hech qanday video havolasi
// yo'q demak - katalog uchun umumiy ta'rif to'g'ri.)
$pageImage = $pageImage && preg_match('#^https?://#i', $pageImage)
    ? $pageImage : '';
?>
<!DOCTYPE html>
<html lang="uz">
<head>
    <link rel="icon" type="image/png" href="assets/img/favicon.png?v=<?php echo @filemtime(__DIR__ . '/assets/img/favicon.png') ?: 1; ?>">
    <link rel="apple-touch-icon" href="assets/img/apple-touch-icon.png?v=<?php echo @filemtime(__DIR__ . '/assets/img/apple-touch-icon.png') ?: 1; ?>">
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

<!-- Filtr paneli olib tashlandi: qidiruv chap paneldagi "Qidiruv" tugmasi orqali
     alohida oynada ochiladi (includes/nav.php #igSearch). -->

<div class="loading" id="loading" hidden><span class="spinner"></span></div>

<main>
    <!-- ================================================= Bosh sahifa -->
    <section id="homeView">
        <div class="row" id="continueRow" hidden>
            <h2 class="row-title">Davom etish</h2>
            <div class="grid" id="continueGrid"></div>
        </div>

        <div class="row">
            <h2 class="row-title">Trending</h2>
            <div class="grid" id="trendingGrid"></div>
        </div>

        <div class="row">
            <h2 class="row-title">Yangi qo‘shilganlar</h2>
            <div class="grid" id="newGrid"></div>
        </div>

        <div id="catRows"></div>

        <div class="more-wrap">
            <button class="btn-more" id="goCatalog">Butun katalogni ko‘rish</button>
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

<!-- "Davom etish" (o'ng pastda) — oxirgi ko'rilgan kontentni davom ettirish.
     app.js tomonidan mahalliy kutubxona (WCLib) yoki server "continue"
     ro'yxatidan to'ldiriladi. Yopilsa, o'sha element uchun yashiriladi. -->
<div class="cont-float" id="continueFloat" hidden>
    <a class="cont-float-link" id="contFloatLink" href="#">
        <span class="cont-float-poster" id="contFloatPoster"></span>
        <span class="cont-float-body">
            <span class="cont-float-label">Davom etish</span>
            <span class="cont-float-title" id="contFloatTitle"></span>
        </span>
    </a>
    <button class="cont-float-x" id="contFloatClose" type="button" aria-label="Yopish">&times;</button>
</div>

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
        // Videolar endi `watch.php` sahifasida ochiladi, shuning uchun bu
        // sahifada `?c=`/`?e=` bo'lmaydi (yuqorida `watch.php` ga yo'naltiriladi).
        contentId: 0,
        episodeId: 0,
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
<!--
  OLIB TASHLANGAN: tashqi hls.js CDN skripti (cdn.jsdelivr.net/npm/hls.js@1)

  Nima uchun: bu UCHINCHI TOMON CDN'iga sinhron so'rov edi - 620 KB va
  o'lchovda 0.9-1.4 soniya (TLS handshake'ning o'zi 0.4-0.95 s). Sinhron
  skript `DOMContentLoaded` ni ushlab turadi, `app.js` va `player.js` esa
  aynan shu hodisada ishga tushadi. Ya'ni butun katalog interfeysi
  jsdelivr javobini kutardi - hatto foydalanuvchi HLS umuman ko'rmasa ham.

  Yo'qotish yo'q: `player.js` dagi `startHls()` hls.js'ni O'ZI lazy yuklaydi
  (`if (!window.Hls)` -> shu CDN manzilidan), faqat haqiqatan `.m3u8` manba
  ochilganda. Narx esa kamayadi: 620 KB har sahifa ko'rishidan -> faqat birinchi
  HLS ijrosiga.
-->
<script src="assets/js/player.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/player.js') ?: 1; ?>"></script>
<!--
  OLIB TASHLANGAN: assets/js/reels.js

  Nima uchun: u `getElementById('reelsTrack')` natijasi bo'lmasa darhol
  `return` qiladi. Bu sahifada `#reelsTrack` YO'Q, shuning uchun fayl
  yuklanib bo'lgach hech narsa qilmasdi - 12 KB (gzip) va parse vaqti
  bekor sarflanardi.
-->
<script src="assets/js/tg-probe.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/tg-probe.js') ?: 1; ?>"></script>
<script src="assets/js/tg-stream.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/tg-stream.js') ?: 1; ?>"></script>
<script src="assets/js/wc-lib.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/wc-lib.js') ?: 1; ?>"></script>
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

        // Hover-preview uchun Service Worker'ni oldindan tayyorlaymiz
        // (reload qilmaydi): sichqoncha ustiga kelganda video kutmasin.
        if (window.TgStream && window.TgStream.warm) window.TgStream.warm();

        // "Butun katalogni ko'rish" - app.js ga alohida hodisa beriladi
        var b = document.getElementById('goCatalog');
        if (b) b.onclick = function () { window.dispatchEvent(new Event('wc:showCatalog')); };
    });
</script>
</body>
</html>
