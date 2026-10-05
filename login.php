<?php
require_once __DIR__ . '/includes/bootstrap.php';

$auth = new Auth();

// Agar foydalanuvchi allaqachon login bo'lsa
if ($auth->isLoggedIn()) {
    header('Location: index.php');
    exit;
}

// Bot ro'yxatdan o'tgan foydalanuvchilarni tekshirish
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $initData = $_POST['initData'] ?? '';

    if (!empty($initData)) {
        $result = $auth->loginWithTelegram($initData);

        if ($result['success']) {
            header('Location: index.php');
            exit;
        } else {
            $error = $result['message'];
        }
    } else {
        // Telegram Login Widget (oauth.telegram.org) - oddiy brauzer
        $tgId = (int) ($_POST['tg_id'] ?? 0);
        $tgHash = $_POST['tg_hash'] ?? '';

        if ($tgId > 0 && $tgHash !== '') {
            $result = $auth->loginWithTelegramWidget([
                'id'         => $tgId,
                'first_name' => $_POST['tg_first_name'] ?? '',
                'last_name'  => $_POST['tg_last_name'] ?? '',
                'username'   => $_POST['tg_username'] ?? '',
                'photo_url'  => $_POST['tg_photo_url'] ?? '',
                'auth_date'  => $_POST['tg_auth_date'] ?? '',
                'hash'       => $tgHash,
            ]);

            if ($result['success']) {
                header('Location: index.php');
                exit;
            } else {
                $error = $result['message'];
            }
        }
    }
}

// =========================================================================
// BRAUZER login uchun tasdiqlash-token (bot orqali ishonchli yo'l):
//   login.php token yaratadi -> t.me/bot?start=auth_TOKEN tugmasi
//   -> bot chat'ni bog'laydi -> polling check_login.php orqali
//   tasdiqlashni ko'radi va avtomatik index.php ga o'tkazadi.
// =========================================================================
$loginToken = $_SESSION['login_token'] ?? '';
if (!preg_match('/^[a-f0-9]{48}$/', $loginToken)) {
    $loginToken = $auth->createLoginToken();
    $_SESSION['login_token'] = $loginToken;
}
$botAuthUrl = 'https://t.me/' . TELEGRAM_BOT_USERNAME . '?start=auth_' . $loginToken;
?>
<!DOCTYPE html>
<html lang="uz">
<head>
    <link rel="icon" type="image/png" href="assets/img/favicon.png?v=<?php echo @filemtime(__DIR__ . '/assets/img/favicon.png') ?: 1; ?>">
    <link rel="apple-touch-icon" href="assets/img/apple-touch-icon.png?v=<?php echo @filemtime(__DIR__ . '/assets/img/apple-touch-icon.png') ?: 1; ?>">
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>W CINEMA</title>
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
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }

        .login-container {
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            padding: 40px;
            max-width: 400px;
            width: 100%;
            text-align: center;
            border: 1px solid rgba(255, 255, 255, 0.2);
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
        }

        .logo {
            width: 96px;
            height: 96px;
            margin: 0 auto 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: transparent;
        }
        .logo img {
            width: 100%;
            height: 100%;
            object-fit: contain;
            display: block;
        }

        h1 {
            color: white;
            font-size: 28px;
            margin-bottom: 10px;
            font-weight: 700;
        }

        p {
            color: rgba(255, 255, 255, 0.8);
            margin-bottom: 30px;
            font-size: 16px;
        }

        .telegram-btn {
            background: linear-gradient(135deg, #0088cc 0%, #00a0dc 100%);
            color: white;
            border: none;
            padding: 15px 30px;
            border-radius: 12px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            width: 100%;
            margin-bottom: 15px;
            transition: transform 0.2s, box-shadow 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
        }

        .telegram-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 20px rgba(0, 136, 204, 0.3);
        }

        .telegram-btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
        }

        .bot-btn {
            background: rgba(255, 255, 255, 0.1);
            color: white;
            border: 1px solid rgba(255, 255, 255, 0.3);
            padding: 15px 30px;
            border-radius: 12px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            width: 100%;
            transition: transform 0.2s, background 0.2s;
        }

        .bot-btn:hover {
            transform: translateY(-2px);
            background: rgba(255, 255, 255, 0.2);
        }

        .tg-widget {
            margin-bottom: 15px;
            display: flex;
            justify-content: center;
        }

        .bot-login-btn {
            background: linear-gradient(135deg, #0088cc 0%, #00a0dc 100%);
            margin-bottom: 12px;
        }

        .login-status {
            background: rgba(255, 255, 255, 0.12);
            border: 1px solid rgba(255, 255, 255, 0.25);
            border-radius: 12px;
            padding: 14px;
            margin-bottom: 15px;
            font-size: 14px;
            color: #fff;
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .status-hint {
            margin-top: 6px;
            font-size: 12px;
            color: rgba(255, 255, 255, 0.65);
            line-height: 1.4;
        }

        .error {
            background: rgba(255, 0, 0, 0.2);
            color: white;
            padding: 10px;
            border-radius: 8px;
            margin-bottom: 20px;
            font-size: 14px;
        }

        .loading {
            display: inline-block;
            width: 20px;
            height: 20px;
            border: 2px solid rgba(255, 255, 255, 0.3);
            border-top-color: white;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <div class="login-container">
        <div class="logo"><picture><source srcset="assets/img/logo.webp?v=<?php echo @filemtime(__DIR__ . '/assets/img/logo.webp') ?: 1; ?>" type="image/webp"><img src="assets/img/logo.png?v=<?php echo @filemtime(__DIR__ . '/assets/img/logo.png') ?: 1; ?>" alt="W CINEMA"></picture></div>
        <h1>W CINEMA</h1>
        <p>Kino · Anime · Multfilm katalogi</p>

        <?php if (isset($error)): ?>
            <div class="error"><?php echo htmlspecialchars($error); ?></div>
        <?php endif; ?>

        <form id="loginForm" method="POST">
            <input type="hidden" name="initData" id="initData">
            <input type="hidden" name="tg_id" id="tgId">
            <input type="hidden" name="tg_first_name" id="tgFirstName">
            <input type="hidden" name="tg_last_name" id="tgLastName">
            <input type="hidden" name="tg_username" id="tgUsername">
            <input type="hidden" name="tg_photo_url" id="tgPhotoUrl">
            <input type="hidden" name="tg_auth_date" id="tgAuthDate">
            <input type="hidden" name="tg_hash" id="tgHash">
            <button type="submit" class="telegram-btn" id="telegramBtn">
                <span id="btnText">🔒 Kirish</span>
            </button>
        </form>

        <!-- Telegram Login Widget (domen @BotFather'da ro'yxatdan o'tkazilganda
             ko'rinadi; hozircha yashirin - widget "Bot domain invalid" ko'rsatadi) -->
        <div class="tg-widget" id="tgWidget" style="display:none">
            <script async src="https://telegram.org/js/telegram-widget.js?22"
                    data-telegram-login="<?php echo htmlspecialchars(TELEGRAM_BOT_USERNAME, ENT_QUOTES); ?>"
                    data-size="large"
                    data-radius="12"
                    data-onauth="onTelegramAuth"
                    data-request-access="write"></script>
        </div>

        <!-- Bot orqali kirish - eng ishonchli yo'l (har qanday brauzer/WebView'da ishlaydi) -->
        <button type="button" class="telegram-btn bot-login-btn" id="botLoginBtn">
            🤖 Kirish
        </button>
        <div class="login-status" id="loginStatus" style="display:none">
            <span class="loading"></span>
            <span id="statusTitle">Botda tasdiqlash kutilmoqda...</span>
            <div class="status-hint" id="statusHint">Tugmadan keyin botda <b>[Boshlash]</b> ni bosing va saytga qayting — sayt sizni avtomatik kiritadi.</div>
        </div>

        <button type="button" class="bot-btn" id="botBtn">
            🤖 Bot'ga o'tish
        </button>
    </div>

    <script>
        // Telegram Web App initialization
        const BOT_USERNAME = <?php echo json_encode(TELEGRAM_BOT_USERNAME); ?>;
        const BOT_URL = 'https://t.me/' + BOT_USERNAME;
        const LOGIN_TOKEN = <?php echo json_encode($loginToken); ?>;
        const BOT_AUTH_URL = <?php echo json_encode($botAuthUrl); ?>;
        const webApp = window.Telegram?.WebApp;

        const telegramBtn = document.getElementById('telegramBtn');
        const btnText = document.getElementById('btnText');
        const botBtn = document.getElementById('botBtn');

        if (webApp) {
            webApp.ready();
            webApp.expand();

            // Theme colors
            document.documentElement.style.setProperty('--tg-theme-bg-color', webApp.themeParams.bg_color || '#1a1a1a');
            document.documentElement.style.setProperty('--tg-theme-text-color', webApp.themeParams.text_color || '#ffffff');
        }

        // initData FAQAT Telegram ichida to'ldiriladi
        const initData = webApp?.initData || '';

        if (initData) {
            // Telegram WebApp ichida - tasdiqlangan imzo bilan avtomatik kirish
            document.getElementById('initData').value = initData;
            btnText.innerHTML = '<span class="loading"></span> Avtorizatsiya...';
            telegramBtn.disabled = true;
            document.getElementById('loginForm').submit();
        } else {
            // Oddiy brauzer - bot orqali tasdiqlash oqimi
            telegramBtn.style.display = 'none';
            initBotLogin();
        }

        // Bot orqali kirish: t.me/bot?start=auth_TOKEN tugmasi -> bot tasdiqlaydi
        // -> poll check_login.php -> avtomatik index.php ga o'tish
        function initBotLogin() {
            const loginStatus = document.getElementById('loginStatus');
            const statusHint = document.getElementById('statusHint');
            const botLoginBtn = document.getElementById('botLoginBtn');
            let stopped = false;

            function startFlow() {
                window.open(BOT_AUTH_URL, '_blank');
                botLoginBtn.disabled = true;
                botBtn.style.display = 'none';
                telegramBtn.style.display = 'none';
                loginStatus.style.display = 'block';
                poll();
            }

            function stop(msg) {
                stopped = true;
                if (msg) statusHint.textContent = msg;
            }

            async function poll() {
                if (stopped) return;
                try {
                    const r = await fetch('check_login.php?token=' + LOGIN_TOKEN + '&t=' + Date.now());
                    const d = await r.json();
                    if (d.done) {
                        stop();
                        statusHint.textContent = 'Tasdiqlandi! Saytga o\'tkazilmoqda...';
                        location.href = 'index.php';
                        return;
                    }
                    if (!d.pending) {
                        stop(d.message || 'Xatolik yuz berdi. Sahifani yangilang va qayta urining.');
                        botLoginBtn.disabled = false;
                    }
                } catch (e) {
                    // Tarmoq uzilgan - keyingi qadamda qayta urinamiz
                }
                if (!stopped) setTimeout(poll, 2500);
            }

            botLoginBtn.onclick = startFlow;
            botBtn.onclick = startFlow;
        }

        // Telegram Login Widget (oauth.telegram.org) callback
        // Brauzerda "Login with Telegram" bosilganda Telegram shu funksiyani chaqiradi
        function onTelegramAuth(user) {
            document.getElementById('tgId').value = user.id || '';
            document.getElementById('tgFirstName').value = user.first_name || '';
            document.getElementById('tgLastName').value = user.last_name || '';
            document.getElementById('tgUsername').value = user.username || '';
            document.getElementById('tgPhotoUrl').value = user.photo_url || '';
            document.getElementById('tgAuthDate').value = user.auth_date || '';
            document.getElementById('tgHash').value = user.hash || '';

            btnText.innerHTML = '<span class="loading"></span> Avtorizatsiya...';
            telegramBtn.disabled = true;
            document.getElementById('loginForm').submit();
        }
    </script>
</body>
</html>
