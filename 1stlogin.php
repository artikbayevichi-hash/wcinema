<?php
// ============================================================================
// 1stlogin.php — W CINEMA kirish (splash) sahifasi
// ============================================================================
// QR/kirish ekranidan (tg-login.php) OLDIN ko'rsatiladi:
//   • W CINEMA haqida qisqa ma'lumot
//   • Markazda "Kirish" tugmasi -> tg-login.php (QR ro'yxatdan o'tish ekrani)
//
// Agar foydalanuvchi allaqachon kirgan bo'lsa (auth_key localStorage'da),
// sahifa darhol `next` manzilga o'tadi — splash ko'rinmaydi.
//
// Kalit (auth_key) faqat brauzer localStorage'ida qoladi; server uni ko'rmaydi.
// ============================================================================
require_once __DIR__ . '/includes/bootstrap.php';

$base = rtrim(dirname($_SERVER['SCRIPT_NAME'] ?? '/'), '/\\');

// `next` — FAQAT shu sayt ichidagi manzil (ochiq yo'naltirishni oldini olamiz).
$next = (string) ($_GET['next'] ?? '');
if ($next === '' || $next[0] !== '/' || strpos($next, '//') === 0
    || strpos($next, '\\') !== false || strpos($next, $base) !== 0) {
    $next = $base . '/index.php';
}

// QR/kirish ekraniga havola.
$loginHref = $base . '/tg-login.php?next=' . urlencode($next);

$logoWebpV = @filemtime(__DIR__ . '/assets/img/logo.webp') ?: 1;
$logoPngV  = @filemtime(__DIR__ . '/assets/img/logo.png') ?: 1;
$favV      = @filemtime(__DIR__ . '/assets/img/favicon.png') ?: 1;
$touchV    = @filemtime(__DIR__ . '/assets/img/apple-touch-icon.png') ?: 1;
$cssV      = @filemtime(__DIR__ . '/assets/css/tg-login.css') ?: 1;
$siteName  = SITE_NAME;
?>
<!DOCTYPE html>
<html lang="uz">
<head>
    <link rel="icon" type="image/png" href="<?php echo htmlspecialchars($base, ENT_QUOTES); ?>/assets/img/favicon.png?v=<?php echo $favV; ?>">
    <link rel="apple-touch-icon" href="<?php echo htmlspecialchars($base, ENT_QUOTES); ?>/assets/img/apple-touch-icon.png?v=<?php echo $touchV; ?>">
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="robots" content="noindex, nofollow">
    <title><?php echo htmlspecialchars($siteName, ENT_QUOTES); ?> — Kirish</title>
    <link rel="stylesheet" href="<?php echo htmlspecialchars($base, ENT_QUOTES); ?>/assets/css/tg-login.css?v=<?php echo $cssV; ?>">
    <script>
        // Mavzu (tun/kun) — birinchi kadrdanoq (miltillashsiz).
        try {
            if (localStorage.getItem('wc_tgl_theme') === 'day') {
                document.documentElement.classList.add('tgl-day');
            }
        } catch (e) {}
        // Allaqachon kirgan bo'lsa — to'g'ridan-to'g'ri `next`ga o'tamiz.
        try {
            var _k = localStorage.getItem('wc_mtproto_auth_v1');
            if (_k && _k.length > 20) {
                location.replace(<?php echo json_encode($next); ?>);
            }
        } catch (e) {}
    </script>
    <style>
        /* ---- W CINEMA splash (faqat shu sahifa) ---- */
        body.tgl-page { --fst-accent: #2aabee; }

        .fst-wrap {
            position: relative;
            z-index: 1;
            min-height: 100vh;
            min-height: 100dvh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 32px 20px;
            box-sizing: border-box;
        }
        .fst-card {
            width: 100%;
            max-width: 420px;
            text-align: center;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 18px;
        }
        .fst-logo {
            width: 96px; height: 96px;
            display: flex; align-items: center; justify-content: center;
            border-radius: 26px;
            background: rgba(var(--tgl-primary-rgb), .16);
            box-shadow: 0 18px 50px rgba(42, 171, 238, .22);
            animation: fstRise .5s ease both;
        }
        .fst-logo img { display: block; width: 68px; height: 68px; object-fit: contain; }
        .fst-title {
            margin: 0;
            font-size: 34px; font-weight: 800; letter-spacing: .5px;
            background: linear-gradient(90deg, #2aabee, #8774E1);
            -webkit-background-clip: text; background-clip: text;
            -webkit-text-fill-color: transparent; color: #2aabee;
            animation: fstRise .5s ease both .05s;
        }
        .fst-sub {
            margin: -6px 0 0;
            font-size: 14px; font-weight: 600; letter-spacing: 2px;
            text-transform: uppercase; color: var(--tgl-text2);
            animation: fstRise .5s ease both .1s;
        }
        .fst-lead {
            margin: 0;
            font-size: 15.5px; line-height: 1.55; color: var(--tgl-text2);
            max-width: 360px;
            animation: fstRise .5s ease both .15s;
        }
        .fst-feats {
            list-style: none; margin: 4px 0 0; padding: 0;
            width: 100%; max-width: 360px;
            display: flex; flex-direction: column; gap: 10px;
            text-align: left;
            animation: fstRise .5s ease both .2s;
        }
        .fst-feats li {
            display: flex; align-items: center; gap: 12px;
            font-size: 14.5px; color: var(--tgl-text);
            padding: 11px 14px;
            background: rgba(var(--tgl-primary-rgb), .08);
            border: 1px solid var(--tgl-border);
            border-radius: 13px;
        }
        .fst-dot {
            flex: 0 0 auto;
            width: 22px; height: 22px; border-radius: 50%;
            display: flex; align-items: center; justify-content: center;
            background: rgba(var(--tgl-primary-rgb), .2);
            color: var(--fst-accent);
        }
        .fst-dot svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
        .fst-enter {
            margin-top: 10px;
            display: inline-flex; align-items: center; justify-content: center; gap: 10px;
            width: 100%; max-width: 360px;
            padding: 16px 24px;
            border: 0; border-radius: 16px;
            font-size: 17px; font-weight: 800; font-family: inherit;
            color: #fff; text-decoration: none; cursor: pointer;
            background: linear-gradient(135deg, #2aabee, #1f8fd0);
            box-shadow: 0 14px 34px rgba(42, 171, 238, .38);
            transition: transform .14s ease, box-shadow .2s ease;
            animation: fstRise .5s ease both .25s;
        }
        .fst-enter:hover { transform: translateY(-2px); box-shadow: 0 18px 40px rgba(42, 171, 238, .5); }
        .fst-enter:active { transform: scale(.98); }
        .fst-enter svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
        .fst-note {
            margin: 2px 0 0;
            font-size: 12.5px; color: var(--tgl-text2);
            animation: fstRise .5s ease both .3s;
        }
        @keyframes fstRise {
            from { opacity: 0; transform: translateY(14px); }
            to   { opacity: 1; transform: translateY(0); }
        }
    </style>
</head>
<body class="tgl-page">

<div class="tgl-bg"><span class="tgl-blob b1"></span><span class="tgl-blob b2"></span><span class="tgl-blob b3"></span></div>

<button class="tgl-theme" id="fstTheme" type="button" aria-label="Mavzuni almashtirish">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path id="fstThemeIcon" d="M12 3v2M12 19v2M5 12H3M21 12h-2M6.3 6.3 4.9 4.9M19.1 19.1l-1.4-1.4M17.7 6.3l1.4-1.4M4.9 19.1l1.4-1.4"/><circle cx="12" cy="12" r="4"/></svg>
</button>

<main class="fst-wrap">
    <div class="fst-card">
        <div class="fst-logo">
            <picture>
                <source srcset="<?php echo htmlspecialchars($base, ENT_QUOTES); ?>/assets/img/logo.webp?v=<?php echo $logoWebpV; ?>" type="image/webp">
                <img src="<?php echo htmlspecialchars($base, ENT_QUOTES); ?>/assets/img/logo.png?v=<?php echo $logoPngV; ?>" alt="<?php echo htmlspecialchars($siteName, ENT_QUOTES); ?>" width="68" height="68">
            </picture>
        </div>

        <h1 class="fst-title"><?php echo htmlspecialchars($siteName, ENT_QUOTES); ?></h1>
        <div class="fst-sub">Onlayn kino dunyosi</div>

        <p class="fst-lead">
            <?php echo htmlspecialchars($siteName, ENT_QUOTES); ?> — kino, animelar va multfilmlarni
            brauzerda to'g'ridan-to'g'ri tomosha qilish uchun platforma.
            Kirish Telegram hisobi orqali amalga oshiriladi.
        </p>

        <ul class="fst-feats">
            <li>
                <span class="fst-dot"><svg viewBox="0 0 24 24"><path d="M4 5.5h16v13H4z"/><path d="M10 9.5l5 2.5-5 2.5z"/></svg></span>
                Kino, animelar va multfilmlar — bir joyda
            </li>
            <li>
                <span class="fst-dot"><svg viewBox="0 0 24 24"><path d="M12 3.5 19 6v5c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6z"/><path d="M9 12l2 2 4-4"/></svg></span>
                Telegram orqali xavfsiz va tezkor kirish
            </li>
        </ul>

        <a class="fst-enter" href="<?php echo htmlspecialchars($loginHref, ENT_QUOTES); ?>">
            Kirish
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13"/><path d="M12 5l7 7-7 7"/></svg>
        </a>

        <p class="fst-note">QR kod yoki telefon raqami orqali ro‘yxatdan o‘tish</p>
    </div>
</main>

<script>
    (function () {
        var btn = document.getElementById('fstTheme');
        if (!btn) return;
        btn.addEventListener('click', function () {
            var day = document.documentElement.classList.toggle('tgl-day');
            try { localStorage.setItem('wc_tgl_theme', day ? 'day' : 'night'); } catch (e) {}
        });
    })();
</script>

</body>
</html>
