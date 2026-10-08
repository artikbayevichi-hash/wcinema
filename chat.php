<?php
// ============================================================================
// chat.php - Instagram/Telegram uslubidagi chat
// ============================================================================
// Yuqorida 4 ta umumiy xona (Hammaga / Kino / Anime / Multfilm) - bir qatorda,
// teng o'lchamda. Pastida esa shaxsiy chatlar - vertikal ro'yxat.
//
// Xabarlar serverda saqlanmaydi:
//   * xonalar - Telegram forum-guruh mavzulari;
//   * shaxsiy chat - foydalanuvchilar o'rtasidagi Telegram DM.
// Barcha ish brauzerdagi MTProto sessiyasi orqali (assets/js/tg-chat.js).
// ============================================================================
require_once __DIR__ . '/includes/bootstrap.php';

$NAV_ACTIVE = 'chat';
?>
<!DOCTYPE html>
<html lang="uz">
<head>
    <link rel="icon" type="image/png" href="assets/img/favicon.png?v=<?php echo @filemtime(__DIR__ . '/assets/img/favicon.png') ?: 1; ?>">
    <link rel="apple-touch-icon" href="assets/img/apple-touch-icon.png?v=<?php echo @filemtime(__DIR__ . '/assets/img/apple-touch-icon.png') ?: 1; ?>">
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <title>Chat — <?php echo htmlspecialchars(SITE_NAME); ?></title>
    <link rel="stylesheet" href="assets/css/style.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/style.css') ?: 1; ?>">
    <link rel="stylesheet" href="assets/css/instagram.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/instagram.css') ?: 1; ?>">
    <link rel="stylesheet" href="assets/css/reels.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/reels.css') ?: 1; ?>">
    <link rel="stylesheet" href="assets/css/chat.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/chat.css') ?: 1; ?>">
    <link rel="stylesheet" href="assets/css/tg-format.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/tg-format.css') ?: 1; ?>">
    <link rel="stylesheet" href="assets/css/voice.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/voice.css') ?: 1; ?>">
    <?php require __DIR__ . '/includes/tv-head.php'; ?>
</head>
<body class="ig-shell chat-body">

<?php require __DIR__ . '/includes/nav.php'; ?>

<main class="ig-page chat-page">

    <!-- ============================ Ro'yxat ko'rinishi ============================ -->
    <div class="chat-listview" id="chatListView">
        <h1 class="ig-page-title">Chat</h1>

        <div class="chat-rooms" id="chatRooms">
            <div class="chat-room-skel"></div>
            <div class="chat-room-skel"></div>
            <div class="chat-room-skel"></div>
            <div class="chat-room-skel"></div>
        </div>

        <div class="chat-sec-h">Xabarlar</div>
        <div class="chat-contacts" id="chatContacts">
            <div class="chat-empty">Yuklanmoqda…</div>
        </div>
    </div>

    <!-- ============================ Suhbat ko'rinishi ============================ -->
    <section class="chat-thread" id="chatThread" hidden>
        <header class="chat-thead">
            <button class="chat-back" id="chatBack" type="button" aria-label="Orqaga">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>
            </button>
            <div class="chat-ttl" id="chatTitle"></div>
            <a class="chat-tg" id="chatOpenTg" href="#" target="_blank" rel="noopener" hidden aria-label="Telegram'da ochish">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 5h5v5"/><path d="M19 5l-8 8"/><path d="M19 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4"/></svg>
            </a>
        </header>

        <div class="chat-feed" id="chatFeed"></div>

        <div class="chat-picker" id="chatPicker" hidden></div>

        <form class="chat-composer" id="chatComposer" autocomplete="off">
            <?php /* Matn formatlash qo'llanishi (bold/italic/kod/havola/...).
                     Menyuning HTML'i `TgFormat.mountFmtMenu()` tomonidan JS da
                     yaratiladi (reels izohlari ham xuddi shuni ishlatadi). */ ?>
            <button type="button" class="chat-tool tg-fmt-btn" id="chatFmtBtn"
                    aria-label="Matn formatlash" aria-expanded="false"
                    title="Matn formatlash">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.2 9.6 6.4a1.5 1.5 0 0 1 2.8 0L18 19.2"/><path d="M6.1 14.4h7.8"/><path d="M20.4 20.4v-5.6h1.5a2.8 2.8 0 0 1 0 5.6z"/></svg>
            </button>
            <?php /* Telegram Desktop kabi: kompozitorning chapida BITTA tugma -
                    u emoji / stiker / GIF / rasm oynasini ochadi. */ ?>
            <button type="button" class="chat-tool" id="chatAttachBtn"
                    aria-label="Emoji, stiker, GIF va rasm" aria-expanded="false">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.6"/><path d="M8.6 14.2c.9 1.2 2.1 1.8 3.4 1.8s2.5-.6 3.4-1.8"/><path d="M9.2 10h.01M14.8 10h.01"/></svg>
            </button>
            <textarea id="chatInput" rows="1" placeholder="Xabar yozing…" maxlength="4000"></textarea>
            <?php /* Telegram Desktop kabi: matn YO'Q bo'lsa - MIKROFON,
                    matn yozilsa - o'sha tugma YUBORISH ga aylanadi.
                    Rasm/stiker/GIF chapdagi ifrit tugmasi orqali. */ ?>
            <button type="submit" class="chat-send" id="chatSend" data-mode="mic"
                    aria-label="Ovozli xabar" title="Ovozli xabar">
                <span class="tv-send-mic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2.6" width="6" height="11" rx="3"/><path d="M5.6 11.3a6.4 6.4 0 0 0 12.8 0"/><path d="M12 17.8v3.4M8.8 21.2h6.4"/></svg></span>
                <span class="tv-send-clip" hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.4 11.1 12 19.5a5 5 0 0 1-7.1-7.1l8.4-8.4a3.4 3.4 0 0 1 4.8 4.8l-8.3 8.3a1.8 1.8 0 0 1-2.5-2.5l7.6-7.6"/></svg></span>
                <span class="tv-send-ico" hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12l16-8-6 16-2.6-6.4L4 12z"/></svg></span>
            </button>
            <input type="file" id="chatPhoto" accept="image/*" hidden>
        </form>
    </section>
</main>

<div class="chat-toast" id="chatToast" hidden></div>

<script>
    window.APP = {
        base: <?php echo json_encode(rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/\\')); ?>,
        tg: {
            apiId:   <?php echo (int) TG_API_ID; ?>,
            apiHash: <?php echo json_encode((string) TG_API_HASH); ?>
        },
        tgCommentsChat: <?php echo json_encode((string) TG_COMMENTS_CHAT); ?>,
        tgCommentsUrl:  <?php echo json_encode((string) TG_COMMENTS_URL); ?>
    };
</script>
<script src="assets/js/tg-probe.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/tg-probe.js') ?: 1; ?>"></script>
<script src="assets/js/tg-stream.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/tg-stream.js') ?: 1; ?>"></script>
<script src="assets/vendor/lottie.min.js?v=<?php echo @filemtime(__DIR__ . '/assets/vendor/lottie.min.js') ?: 1; ?>"></script>
<script src="assets/js/tg-voice.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/tg-voice.js') ?: 1; ?>"></script>
<script src="assets/js/tg-format.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/tg-format.js') ?: 1; ?>"></script>
<script src="assets/js/tg-comments.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/tg-comments.js') ?: 1; ?>"></script>
<script src="assets/js/tg-emoji.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/tg-emoji.js') ?: 1; ?>"></script>
<script src="assets/js/tg-chat.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/tg-chat.js') ?: 1; ?>"></script>
<script>
    if (window.TgStream) {
        try { window.TgStream.init(); } catch (e) {}
        if (window.TgStream.warm) { try { window.TgStream.warm(); } catch (e) {} }
        if (window.TgStream.hasSession && window.TgStream.hasSession()) {
            // Kalit bekor qilingan bo'lsa — kirish sahifasiga qaytamiz
            // (index.php bilan bir xil mantiq).
            try {
                window.TgStream.verify().catch(function () {
                    if (!window.TgStream.hasSession()) {
                        location.replace((window.APP && window.APP.base ? window.APP.base : '') + '/tg-login.php');
                    }
                });
            } catch (e) {}
        }
    }
</script>
</body>
</html>
