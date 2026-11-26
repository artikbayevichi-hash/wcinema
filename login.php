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
    // Bot token / Widget hash tekshiruvi arzon emas: IP bo'yicha cheklaymiz.
    RateLimit::enforce('login-post-' . ($_SERVER['REMOTE_ADDR'] ?? ''), 30, 60);
    // Massiv kelib qolsa (soxtalashtirilgan forma) (string)/(int) cast'lari
    // PHP warning beradi va HTML chiqishini buzadi — oldindan filtrlaymiz.
    $str = static function ($key, $max = 2048) {
        $v = $_POST[$key] ?? '';
        if (!is_string($v)) return '';
        $v = trim($v);
        return function_exists('mb_substr') ? mb_substr($v, 0, $max) : substr($v, 0, $max);
    };
    $initData = $str('initData');

    if ($initData !== '') {
        $result = $auth->loginWithTelegram($initData);

        if ($result['success']) {
            header('Location: index.php');
            exit;
        } else {
            $error = $result['message'];
        }
    } else {
        // Telegram Login Widget (oauth.telegram.org) - oddiy brauzer
        $tgIdRaw = $_POST['tg_id'] ?? 0;
        $tgId = is_scalar($tgIdRaw) && is_numeric($tgIdRaw) ? (int) $tgIdRaw : 0;
        $tgHash = $str('tg_hash', 128);

        if ($tgId > 0 && $tgHash !== '') {
            $result = $auth->loginWithTelegramWidget([
                'id'         => $tgId,
                'first_name' => $str('tg_first_name', 128),
                'last_name'  => $str('tg_last_name', 128),
                'username'   => $str('tg_username', 128),
                'photo_url'  => $str('tg_photo_url', 512),
                'auth_date'  => $str('tg_auth_date', 32),
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
            background: #000000;
            color: #ffffff;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }

        .login-container {
            background: rgba(255, 255, 255, 0.04);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            padding: 40px;
            max-width: 400px;
            width: 100%;
            text-align: center;
            border: 1px solid rgba(255, 255, 255, 0.22);
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6);
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
            color: #ffffff;
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
            background: #ffffff;
            color: #000000;
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
            box-shadow: 0 10px 20px rgba(255, 255, 255, 0.3);
        }

        .telegram-btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
        }

        .bot-btn {
            background: rgba(255, 255, 255, 0.06);
            color: #ffffff;
            border: 1px solid rgba(255, 255, 255, 0.35);
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
            background: #ffffff;
            color: #000000;
            margin-bottom: 12px;
        }

        .login-status {
            background: rgba(255, 255, 255, 0.08);
            border: 1px solid rgba(255, 255, 255, 0.25);
            border-radius: 12px;
            padding: 14px;
            margin-bottom: 15px;
            font-size: 14px;
            color: #ffffff;
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
            background: rgba(255, 255, 255, 0.12);
            color: #ffffff;
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
        const LOGIN_HAD_ERROR = <?php echo json_encode(!empty($error)); ?>;
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
            // Telegram WebApp ichida - tasdiqlangan imzo bilan avtomatik kirish.
            // MUHIM: bitta urinish. Agar server xato qaytarsa, sahifa yana
            // initData bilan ochiladi va eski kod cheksiz submit qilaverardi.
            var AUTO_KEY = 'wc_login_auto_v1';
            var autoDone = false;
            try { autoDone = sessionStorage.getItem(AUTO_KEY) === '1'; } catch (e) {}
            if (!LOGIN_HAD_ERROR && !autoDone) {
                try { sessionStorage.setItem(AUTO_KEY, '1'); } catch (e) {}
                document.getElementById('initData').value = initData;
                btnText.innerHTML = '<span class="loading"></span> Avtorizatsiya...';
                telegramBtn.disabled = true;
                document.getElementById('loginForm').submit();
            } else {
                telegramBtn.disabled = false;
                btnText.textContent = '🔒 Qayta kirish';
                telegramBtn.onclick = function () {
                    try { sessionStorage.removeItem(AUTO_KEY); } catch (e) {}
                    document.getElementById('initData').value = initData;
                    document.getElementById('loginForm').submit();
                };
            }
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

            const startedAt = Date.now();
            let retries = 0;

            function startFlow() {
                const w = window.open(BOT_AUTH_URL, '_blank');
                if (!w) {
                    // Popup bloklangan — foydalanuvchini yo'qotib qo'ymaymiz.
                    statusHint.textContent = '';
                    const a = document.createElement('a');
                    a.href = BOT_AUTH_URL;
                    a.target = '_blank';
                    a.rel = 'noopener';
                    a.textContent = 'Botni ochish uchun bosing';
                    statusHint.appendChild(a);
                }
                botLoginBtn.disabled = true;
                botBtn.style.display = 'none';
                telegramBtn.style.display = 'none';
                loginStatus.style.display = 'block';
                poll();
            }

            function stop(msg, allowRetry) {
                stopped = true;
                if (msg) statusHint.textContent = msg;
                if (allowRetry) {
                    botLoginBtn.disabled = false;
                    botBtn.style.display = '';
                    botLoginBtn.textContent = '🔄 Qayta boshlash';
                    botLoginBtn.onclick = function () { location.reload(); };
                }
            }

            async function poll() {
                if (stopped) return;
                // 10 daqiqadan keyin navbatchi so'rovlarni to'xtatamiz: eski
                // token eskirganda sahifa butunlay "kutmoqda" holatida qolmasin.
                if (Date.now() - startedAt > 10 * 60 * 1000) {
                    stop('Vaqt tugadi. Qayta boshlash uchun tugmani bosing.', true);
                    return;
                }
                if (document.hidden) {
                    setTimeout(poll, 5000);   // yashirin tabda tez so'rov yo'q
                    return;
                }
                try {
                    const r = await fetch('check_login.php?token=' + encodeURIComponent(LOGIN_TOKEN)
                        + '&t=' + Date.now(), { credentials: 'same-origin', cache: 'no-store' });
                    const d = await r.json();
                    // Hisoblagich faqat KETMA-KET tarmoq xatolarini sanaydi.
                    // Ilgari har so'rovda oshib, keyin catch da yana oshardi —
                    // bitta uzilish 50 s dan keyin "Aloqa uzildi" berardi.
                    retries = 0;
                    if (d.done) {
                        stop();
                        statusHint.textContent = 'Tasdiqlandi! Saytga o\'tkazilmoqda...';
                        location.href = 'index.php';
                        return;
                    }
                    if (!d.pending) {
                        stop(d.message || 'Xatolik yuz berdi.', true);
                    }
                } catch (e) {
                    if (++retries > 20) {
                        stop('Aloqa uzildi. Qayta boshlash uchun tugmani bosing.', true);
                    }
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
