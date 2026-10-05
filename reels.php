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
    <link rel="icon" type="image/png" href="assets/img/favicon.png?v=<?php echo @filemtime(__DIR__ . '/assets/img/favicon.png') ?: 1; ?>">
    <link rel="apple-touch-icon" href="assets/img/apple-touch-icon.png?v=<?php echo @filemtime(__DIR__ . '/assets/img/apple-touch-icon.png') ?: 1; ?>">
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, user-scalable=no">
    <title>Reels — <?php echo htmlspecialchars(SITE_NAME); ?></title>
    <meta name="description" content="Qisqa vertikal videolar — <?php echo htmlspecialchars(SITE_NAME); ?>">
    <link rel="stylesheet" href="assets/css/style.css">
    <link rel="stylesheet" href="assets/css/reels.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/reels.css') ?: 1; ?>">
    <link rel="stylesheet" href="assets/css/tg-format.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/tg-format.css') ?: 1; ?>">
    <link rel="stylesheet" href="assets/css/instagram.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/instagram.css') ?: 1; ?>">
    <link rel="stylesheet" href="assets/css/voice.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/voice.css') ?: 1; ?>">
    <!-- Telegram CDN player uslublari. Usiz .tgs/.udp-player karkasi
         uslubsiz qolib, video noto'g'ri o'lchamda chiqadi. -->
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
<body class="reels-body ig-shell">

<!-- Instagram uslubidagi navigatsiya (reels uchun: desktop yon panel / mobil pastki panel) -->
<?php $NAV_ACTIVE = 'reels'; require __DIR__ . '/includes/nav.php'; ?>

<header class="reels-top">
    <a class="reels-back" href="index.php" aria-label="Orqaga">←</a>
    <span class="reels-headtitle">Reels</span>
    <a class="reels-back" href="reels-upload.php" aria-label="Yuklash">＋</a>
</header>

<!-- ============================== Oqim (vertikal) ============================== -->
<div class="reels-track" id="reelsTrack">
    <div class="reels-loading">
        <span class="spinner"></span>
    </div>
</div>

<!-- Instagram-uslubidagi oldingi/keyingi strelkalari (faqat katta ekranda) -->
<button class="reels-nav reels-nav-up" id="reelsPrev" type="button" aria-label="Oldingi reel">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
</button>
<button class="reels-nav reels-nav-down" id="reelsNext" type="button" aria-label="Keyingi reel">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
</button>

<!-- ============================== Yuklash tugmasi ============================== -->
<a class="reels-fab" id="reelsFab" href="reels-upload.php" title="Reels yuklash">＋</a>

<!-- ============================== "More" (⋯) amallar menyusi ============================== -->
<div class="reels-menu" id="reelMenu" hidden>
    <div class="reels-menu-backdrop" data-menu-close></div>
    <div class="reels-menu-sheet" role="dialog" aria-label="Amallar">
        <div class="reels-menu-body" id="reelMenuBody"></div>
    </div>
</div>


<!-- ============================== Reyting paneli ============================== -->
<div class="reels-modal" id="authorsModal" hidden>
    <div class="reels-modal-backdrop" data-close-authors></div>
    <div class="reels-modal-box">
        <button class="reels-modal-x" data-close-authors aria-label="Yopish">✕</button>
        <h2 class="reels-modal-title">🏆 Top Authors</h2>
        <div id="authorsList" class="authors-list"></div>
    </div>
</div>

<!-- ============================== Izohlar paneli ============================== -->
<div class="reels-modal reels-comments-modal" id="commentsModal" hidden>
    <div class="reels-modal-backdrop" data-close-comments></div>
    <div class="reels-comments-box" role="dialog" aria-label="Izohlar">
        <div class="reels-comments-head">
            <h2 class="reels-comments-title">Izohlar <span id="commentsCount"></span></h2>
            <button class="reels-modal-x" data-close-comments aria-label="Yopish">✕</button>
        </div>
        <div class="reels-comments-list" id="commentsList"></div>

        <!-- Telegram vositalari paneli: stiker / GIF / rasm / @ belgilash.
             Izohlar Telegram guruhida saqlanadi (tg-comments.js).
             Chat kabi: kompozitorda BITTA "biriktirish" tugmasi bor, u shu
             panelni ochadi (ichida tablar). -->
        <div class="reels-c-picker" id="cPicker" hidden>
            <div class="reels-c-picker-tabs" id="cPickerTabs">
                <button type="button" class="reels-c-picker-tab on" data-mode="sticker" title="Stiker">Stiker</button>
                <button type="button" class="reels-c-picker-tab" data-mode="gif" title="GIF">GIF</button>
                <button type="button" class="reels-c-picker-tab" data-mode="photo" title="Rasm">Rasm</button>
                <button type="button" class="reels-c-picker-tab" data-mode="mention" title="Belgilash">@</button>
                <button type="button" class="reels-c-picker-x" id="cPickerX" aria-label="Yopish">&times;</button>
            </div>
            <div class="reels-c-picker-panel" id="cPickerPanel"></div>
        </div>

        <div class="reels-c-replybar" id="cReplyBar" hidden>
            <span class="reels-c-replybar-av" id="cReplyAv"></span>
            <span class="reels-c-replybar-txt" id="cReplyTxt"></span>
            <button type="button" class="reels-c-replybar-x" id="cReplyCancel" aria-label="Bekor qilish">✕</button>
        </div>

        <?php /* Izoh kompozitori — chat kompozitori bilan BIR XIL ko'rinadi:
                 chapda "Aa" (formatlash) + bitta "biriktirish" tugmasi,
                 keyin o'sadigan <textarea>, o'ngda doira yuborish/mikrofon. */ ?>
        <form class="reels-comments-form" id="commentForm" autocomplete="off">
            <button type="button" class="reels-c-tool tg-fmt-btn" id="cFmtBtn"
                    aria-label="Matn formatlash" aria-expanded="false" title="Matn formatlash">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.2 9.6 6.4a1.5 1.5 0 0 1 2.8 0L18 19.2"/><path d="M6.1 14.4h7.8"/><path d="M20.4 20.4v-5.6h1.5a2.8 2.8 0 0 1 0 5.6z"/></svg>
            </button>
            <button type="button" class="reels-c-tool" id="cAttachBtn"
                    aria-label="Stiker, GIF, rasm va belgilash" aria-expanded="false" title="Stiker, GIF, rasm">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.6"/><path d="M8.6 14.2c.9 1.2 2.1 1.8 3.4 1.8s2.5-.6 3.4-1.8"/><path d="M9.2 10h.01M14.8 10h.01"/></svg>
            </button>
            <textarea class="reels-comments-input" id="commentInput" rows="1"
                      maxlength="1000" placeholder="Izoh yozing…" aria-label="Izoh"></textarea>
            <a class="reels-c-tool reels-c-tool-tg" id="cOpenTg" href="#" target="_blank" rel="noopener" title="Suhbatni ochish" aria-label="Suhbatni ochish" hidden>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 3 3 10.5l6 2.2L11.2 20 21 3z"/><path d="m9 12.7 12-9.7"/></svg>
            </a>
            <!-- Telegram uslubida: matn yo'q -> mikrofon, matn bor -> yuborish -->
            <button class="reels-comments-send" id="commentSend" type="submit" data-mode="mic"
                    aria-label="Ovozli xabar" title="Ovozli xabar">
                <span class="tv-send-mic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2.6" width="6" height="11" rx="3"/><path d="M5.6 11.3a6.4 6.4 0 0 0 12.8 0"/><path d="M12 17.8v3.4M8.8 21.2h6.4"/></svg></span>
                <span class="tv-send-clip" hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.4 11.1 12 19.5a5 5 0 0 1-7.1-7.1l8.4-8.4a3.4 3.4 0 0 1 4.8 4.8l-8.3 8.3a1.8 1.8 0 0 1-2.5-2.5l7.6-7.6"/></svg></span>
                <span class="tv-send-ico" hidden><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3.5 11.15 19.9 4.3a.55.55 0 0 1 .72.7l-7 15.6a.55.55 0 0 1-1 .05l-2-5.6-5.55-1.95a.55.55 0 0 1-.07-.99z"/></svg></span>
            </button>
            <input type="file" id="cPhoto" accept="image/*" hidden>
        </form>
    </div>
</div>

<!-- ============================ @username tanlash ============================ -->
<div class="reels-modal reels-username-modal" id="usernameModal" hidden>
    <div class="reels-modal-backdrop" data-close-uname></div>
    <div class="reels-uname-box" role="dialog" aria-label="@username">
        <h3 class="reels-uname-title">@username tanlang</h3>
        <p class="reels-uname-desc">Izohlarda boshqalar sizni shu nom bilan ko‘radi va sizni belgilashi mumkin.</p>
        <div class="reels-uname-row">
            <span class="reels-uname-at">@</span>
            <input class="reels-uname-input" id="unameInput" type="text" placeholder="username"
                   maxlength="32" autocapitalize="off" autocomplete="off" spellcheck="false">
        </div>
        <div class="reels-uname-err" id="unameErr" hidden></div>
        <button type="button" class="reels-uname-save" id="unameSave">Saqlash</button>
    </div>
</div>

<!-- ============================== Toast (qisqa xabar) ============================== -->
<div class="reels-toast" id="reelToast" hidden></div>

<script>
    // tg-stream.js uchun (Telegram kanalidagi reelslarni o'ynatish).
    window.APP = window.APP || {
        base: <?php echo json_encode(rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/\\')); ?>,
        tg: {
            apiId:   <?php echo (int) TG_API_ID; ?>,
            apiHash: <?php echo json_encode((string) TG_API_HASH); ?>
        },
        // Reels izohlari Telegram forum-guruhda saqlanadi (tg-comments.js).
        tgCommentsChat: <?php echo json_encode((string) TG_COMMENTS_CHAT); ?>,
        tgCommentsUrl:  <?php echo json_encode((string) TG_COMMENTS_URL); ?>,
        // `lottie.min.js` (298 KB) manzili. Bu sahifada skript teg sifatida
        // YUKLANMAYDI — `tg-comments.js` uni faqat birinchi `.tgs` (animatsiyali)
        // stiker topilganda `ensureLottie()` orqali yuklaydi. Izohlarda `.tgs`
        // stiker bo'lsa, shu zahoti yuklanadi; bo'lmasa umuman yuklanmaydi.
        tgLottie: <?php echo json_encode('assets/vendor/lottie.min.js?v=' . (@filemtime(__DIR__ . '/assets/vendor/lottie.min.js') ?: 1)); ?>
    };
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
<!-- ============================================================================
     SCRIPT YUKLASH TARTIBI (tezlik uchun muhim)

     DIQQAT: bu sahifada `tg-probe.js` (28 KB) va `lottie.min.js` (298 KB)
     KERAK EMAS va avval boshqalan (render-blocking) yuklanardi:

       * tg-probe.js  -> faqat `chat.php` da ishlatiladi (build/test-* da)
       * lottie.min.js -> `chat.php` da skript teg sifatida yuklanadi; bu
                         sahifada esa `tg-comments.js` uni FAQAT birinchi
                         `.tgs` (animatsiyali stiker) topilganda
                         `ensureLottie()` orqali yuklaydi (APP.tgLottie).
                         DIQQAT: shu "lazy load" ishlamay qolsa, izohlardagi
                         stiker animatsiyasiz bo'lib, `.reels-c-media`ning
                         `min-height: 96px` + shimmer foni ko'rinib qoladi.

     Ikkalasi ham jami ~326 KB ni tejab beradi. `defer` esa qolgan
     skriptlarni parallel yuklab, birinchi bo'lish chizishni kechiktirmaydi.

     MUHIM: `reels.js` va `tg-stream.js` OCHILISHI kiritilgan bo'lishi shart -
     ular boshqalar bilan tartibga bog'liq (`window.TgStream` `reels.js` dan
     oldin tayyor bo'lishi kerak).
     ========================================================================= -->
<script src="assets/js/tv-mode.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/tv-mode.js') ?: 1; ?>" defer></script>
<script src="assets/js/notifications.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/notifications.js') ?: 1; ?>" defer></script>
<script src="assets/js/tg-stream.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/tg-stream.js') ?: 1; ?>" defer></script>
<script src="assets/js/tg-voice.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/tg-voice.js') ?: 1; ?>" defer></script>
<script src="assets/js/tg-format.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/tg-format.js') ?: 1; ?>" defer></script>
<script src="assets/js/tg-comments.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/tg-comments.js') ?: 1; ?>" defer></script>
<script src="assets/js/reels.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/reels.js') ?: 1; ?>" defer></script>
<script>
    // Kanal postidan oqim uchun Service Worker'ni tayyorlaymiz.
    //
    // MUHIM: faqat `init()` YETMAYDI — u SW'ni o'rnatadi, lekin sahifani
    // boshqarishini KUTMAYDI. Agar SW tayyor bo'lmasa, birinchi reel
    // bosilganda `ensureWorker()` ishga tushib 6 soniyagacha kutadi (yora
    // sahifani bir marta qayta yuklaydi) — bu "video ochilmayapti" degan
    // taassurot beradi. `warm()` buni oldini oladi (reload qilmasdan).
    //
    // DIQQAT: yuqoridagi skriptlar `defer` bilan yuklanadi - ular HALI
    // ishga tushmagan bo'lishi mumkin. Shuning uchun bu blok
    // `DOMContentLoaded` dan keyin ishga tushadi va `TgStream`ni
    // KUTMAYDI (u kech kelsa, `reels.js` o'z ishini qiladi).
    function wcWarmUp() {
        if (window.TgStream) {
            try { window.TgStream.init(); } catch (e) {}
            if (window.TgStream.warm) {
                try { window.TgStream.warm(); } catch (e) {}
            }
            // GramJS + mavjud Telegram sessiyasini fonda isitamiz: birinchi
            // reel bosilganda klient allaqachon ulangan bo'ladi.
            if (window.TgStream.hasSession && window.TgStream.hasSession()) {
                try { window.TgStream.verify().catch(function () {}); } catch (e) {}
            }
            return;
        }
        // `defer` skript hali kelmagan bo'lishi mumkin - biroz kutamiz
        // (birdan ortiqcha emas: faqat 20 ms, keyin butunlay tashlab ketamiz).
        if ((window.__wcWarmTries || 0) < 40) {
            window.__wcWarmTries = (window.__wcWarmTries || 0) + 1;
            setTimeout(wcWarmUp, 25);
        }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', wcWarmUp);
    } else {
        wcWarmUp();
    }
</script>
</body>
</html>
