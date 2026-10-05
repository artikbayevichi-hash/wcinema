<?php
// ============================================================================
// admin-login.php - admin panelga KALIT (parol) orqali kirish
// ============================================================================
// Sayt brauzerdagi MTProto orqali ishlaganda serverda PHP sessiyasi
// bo'lmaydi, shuning uchun admin panelni bot-login orqali ham ochib
// bo'lmaydi. Bu sahifa config'dagi ADMIN_PANEL_KEY ni tekshiradi va
// to'g'ri bo'lsa sessiyaga bayroq qo'yadi (kalit o'zi saqlanmaydi).
//
// .env:  ADMIN_PANEL_KEY="uzun-tasodifiy-satr"
// ============================================================================
require_once __DIR__ . '/includes/bootstrap.php';

$base = rtrim(dirname($_SERVER['SCRIPT_NAME'] ?? '/'), '/\\');

// `next` — FAQAT shu sayt ichidagi manzil (ochiq yo'naltirishni oldini olamiz).
$next = (string) ($_GET['next'] ?? $_POST['next'] ?? '');
if ($next === '' || $next[0] !== '/' || strpos($next, '//') === 0
    || strpos($next, '\\') !== false || strpos($next, $base) !== 0) {
    $next = $base . '/admin-content.php';
}

$error = '';
$noKey = (ADMIN_PANEL_KEY === '');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    if ($auth->adminKeyLogin((string) ($_POST['key'] ?? ''))) {
        header('Location: ' . $next);
        exit;
    }
    $error = 'Kalit noto‘g‘ri. Qayta urinib ko‘ring.';
}
?>
<!DOCTYPE html>
<html lang="uz">
<head>
    <link rel="icon" type="image/png" href="assets/img/favicon.png?v=<?php echo @filemtime(__DIR__ . '/assets/img/favicon.png') ?: 1; ?>">
    <link rel="apple-touch-icon" href="assets/img/apple-touch-icon.png?v=<?php echo @filemtime(__DIR__ . '/assets/img/apple-touch-icon.png') ?: 1; ?>">
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <meta name="robots" content="noindex, nofollow">
    <title>Admin kirish — <?php echo htmlspecialchars(SITE_NAME); ?></title>
    <style>
        * { box-sizing: border-box; }
        body {
            margin: 0; min-height: 100vh;
            display: flex; align-items: center; justify-content: center;
            padding: 20px;
            background: #0f0d15; color: #eae6f2;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        .adm-key {
            width: min(380px, 100%);
            background: #17141f;
            border: 1px solid #2c2739;
            border-radius: 18px;
            padding: 28px 24px;
            text-align: center;
        }
        .adm-key img { width: 64px; height: 64px; object-fit: contain; }
        .adm-key h1 { font-size: 20px; margin: 12px 0 4px; }
        .adm-key p { color: #9b93ad; font-size: 13.5px; margin: 0 0 18px; line-height: 1.45; }
        .adm-key input {
            width: 100%; padding: 12px 13px; font-size: 15px;
            border: 1px solid #2c2739; border-radius: 11px;
            background: #0f0d15; color: #eae6f2; outline: none;
        }
        .adm-key input:focus { border-color: #6a5cff; }
        .adm-key button {
            width: 100%; margin-top: 12px; padding: 12px;
            font-size: 15px; font-weight: 700; cursor: pointer;
            border: none; border-radius: 11px;
            background: linear-gradient(135deg, #6a5cff, #9b4dff); color: #fff;
        }
        .adm-key button:hover { filter: brightness(1.08); }
        .adm-err {
            margin-top: 12px; padding: 10px;
            background: rgba(255, 90, 90, .14);
            border: 1px solid rgba(255, 90, 90, .35);
            border-radius: 10px; color: #ff9e9e; font-size: 13px;
        }
        .adm-note { margin-top: 16px; font-size: 11.5px; color: #6f6880; line-height: 1.5; }
        .adm-note code { color: #b7aef0; }
    </style>
</head>
<body>
    <form class="adm-key" method="POST" action="admin-login.php?next=<?php echo urlencode($next); ?>">
        <picture><source srcset="assets/img/logo.webp?v=<?php echo @filemtime(__DIR__ . '/assets/img/logo.webp') ?: 1; ?>" type="image/webp"><img src="assets/img/logo.png?v=<?php echo @filemtime(__DIR__ . '/assets/img/logo.png') ?: 1; ?>" alt="W CINEMA"></picture>
        <h1>Admin panel</h1>
        <p>Davom etish uchun admin kalitini kiriting.</p>
        <input type="hidden" name="next" value="<?php echo htmlspecialchars($next, ENT_QUOTES); ?>">
        <input type="password" name="key" autocomplete="current-password" autofocus
               placeholder="Admin kaliti" <?php echo $noKey ? 'disabled' : ''; ?>>
        <button type="submit" <?php echo $noKey ? 'disabled style="opacity:.5;cursor:not-allowed"' : ''; ?>>Kirish</button>
        <?php if ($error): ?><div class="adm-err"><?php echo htmlspecialchars($error); ?></div><?php endif; ?>
        <?php if ($noKey): ?>
            <div class="adm-err">Kalit o‘rnatilmagan. <code>.env</code> fayliga <code>ADMIN_PANEL_KEY=...</code> qo‘shing.</div>
        <?php endif; ?>
        <div class="adm-note">
            Kalit <code>.env</code> dagi <code>ADMIN_PANEL_KEY</code> bilan bir xil bo‘lishi kerak.
            <a href="index.php" style="color:#b7aef0">Bosh sahifa</a>
        </div>
    </form>
</body>
</html>
