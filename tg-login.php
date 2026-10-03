<?php
// ============================================================================
// tg-login.php — Telegram uslubidagi kirish sahifasi
// ============================================================================
// Saytga kirishdan OLDIN ko'rsatiladi. Ikki yo'l:
//   1) QR skanerlash (darhol ko'rinadi)
//   2) Telefon raqami (mamlakat tanlagichi) -> kod -> (bo'lsa) 2FA parol
//
// Kalit (auth_key) faqat brauzer localStorage'ida qoladi. Server ham,
// bu PHP sahifa ham kalitni ham, parolni ham ko'rmaydi — hamma mantiq
// brauzerda (`tg-stream.js`).
//
// Kalit yaroqli bo'lsa (foydalanuvchi allaqachon kirgan) — darhol `next`
// manzilga o'tadi: login sahifasi qayta ko'rinmaydi.
// ============================================================================
require_once __DIR__ . '/includes/bootstrap.php';

$base = rtrim(dirname($_SERVER['SCRIPT_NAME'] ?? '/'), '/\\');

// `next` — FAQAT shu sayt ichidagi manzil (ochiq yo'naltirishni oldini olamiz).
$next = (string) ($_GET['next'] ?? '');
if ($next === '' || $next[0] !== '/' || strpos($next, '//') === 0
    || strpos($next, '\\') !== false || strpos($next, $base) !== 0) {
    $next = $base . '/index.php';
}
?>
<!DOCTYPE html>
<html lang="uz">
<head>
    <link rel="icon" type="image/png" href="assets/img/favicon.png?v=<?php echo @filemtime(__DIR__ . '/assets/img/favicon.png') ?: 1; ?>">
    <link rel="apple-touch-icon" href="assets/img/apple-touch-icon.png?v=<?php echo @filemtime(__DIR__ . '/assets/img/apple-touch-icon.png') ?: 1; ?>">
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="robots" content="noindex, nofollow">
    <title>Kirish — <?php echo htmlspecialchars(SITE_NAME, ENT_QUOTES); ?></title>
    <link rel="stylesheet" href="<?php echo htmlspecialchars($base, ENT_QUOTES); ?>/assets/css/tg-stream.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/tg-stream.css') ?: 1; ?>">
    <link rel="stylesheet" href="<?php echo htmlspecialchars($base, ENT_QUOTES); ?>/assets/css/tg-login.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/tg-login.css') ?: 1; ?>">
    <script>
        // Mavzuni birinchi kadrdanoq qo'llaymiz (miltillashsiz). Standart — tun.
        try {
            if (localStorage.getItem('wc_tgl_theme') === 'day') {
                document.documentElement.classList.add('tgl-day');
            }
        } catch (e) {}
    </script>
</head>
<body class="tgl-page">

<div id="tgLogin" class="tgl-root"></div>

<noscript>
    <div class="tgl-noscript">Kirish uchun brauzerda JavaScript yoqilgan bo‘lishi kerak.</div>
</noscript>

<script>
    // PHP -> JS ko'prigi (tg-stream.js APP.base va APP.tg ni o'qiydi).
    window.APP = {
        base: <?php echo json_encode($base); ?>,
        logoV: <?php echo @filemtime(__DIR__ . '/assets/img/logo.png') ?: 1; ?>,
        siteName: <?php echo json_encode(SITE_NAME); ?>,
        tg: {
            apiId:   <?php echo (int) TG_API_ID; ?>,
            apiHash: <?php echo json_encode((string) TG_API_HASH); ?>
        }
    };
    window.TG_LOGIN_NEXT = <?php echo json_encode($next); ?>;
</script>
<script src="<?php echo htmlspecialchars($base, ENT_QUOTES); ?>/assets/js/tg-countries.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/tg-countries.js') ?: 1; ?>"></script>
<script src="<?php echo htmlspecialchars($base, ENT_QUOTES); ?>/assets/js/tg-stream.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/tg-stream.js') ?: 1; ?>"></script>
<script src="<?php echo htmlspecialchars($base, ENT_QUOTES); ?>/assets/js/tg-login.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/tg-login.js') ?: 1; ?>"></script>
<script>
    document.addEventListener('DOMContentLoaded', function () {
        var node = document.getElementById('tgLogin');
        if (!node || !window.TgLogin) return;
        window.TgLogin.mount(node, {
            next: window.TG_LOGIN_NEXT || (window.APP.base + '/index.php'),
            onSuccess: function (to) {
                // `to` — tekshirilgan nisbiy/absolyut yo'l. Yangi sahifaga o'tamiz.
                location.replace(to || (window.APP.base + '/index.php'));
            }
        });
    });
</script>

</body>
</html>
