<?php
/**
 * Mini App sozlash bo'yicha qo'llanma.
 *
 * Bu PHP fayl bo'lib, joriy SITE_URL ni ko'rsatadi. Tunnel ishlab
 * turgan bo'lsa, ko'rsatilgan URL darhol to'g'ri bo'ladi - qo'lda
 * tahrirlash kerak emas.
 */
require_once __DIR__ . '/config.php';

$miniAppUrl = MINI_APP_URL;
$isLocal    = strpos($miniAppUrl, 'localhost') !== false
           || strpos($miniAppUrl, '127.0.0.1') !== false;
$schemeOk   = substr($miniAppUrl, 0, 8) === 'https://';
$botLink    = 'https://t.me/' . TELEGRAM_BOT_USERNAME;
?>
<!DOCTYPE html>
<html lang="uz">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Mini App Sozlash - W CINEMA</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #1a1a1a;
            color: #fff;
            padding: 20px;
            line-height: 1.6;
        }

        .container {
            max-width: 700px;
            margin: 0 auto;
        }

        h1 {
            text-align: center;
            margin-bottom: 30px;
            font-size: 26px;
        }

        .step {
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 14px;
            padding: 20px;
            margin-bottom: 18px;
        }

        .step-number {
            display: inline-block;
            background: #2AABEE;
            color: #fff;
            width: 30px;
            height: 30px;
            line-height: 30px;
            text-align: center;
            border-radius: 50%;
            font-weight: bold;
            margin-bottom: 10px;
        }

        .step-title {
            font-size: 18px;
            font-weight: bold;
            margin-bottom: 10px;
        }

        .step-content p {
            margin-bottom: 10px;
            color: rgba(255,255,255,0.85);
            font-size: 15px;
        }

        .code {
            background: rgba(0,0,0,0.45);
            padding: 14px;
            border-radius: 10px;
            font-family: 'Courier New', monospace;
            font-size: 14px;
            margin: 12px 0;
            word-break: break-all;
            color: #7ee787;
            border: 1px solid rgba(255,255,255,0.1);
        }

        .code a { color: #7ee787; }

        ul {
            padding-left: 22px;
            margin-bottom: 10px;
            color: rgba(255,255,255,0.85);
            font-size: 15px;
        }

        li { margin-bottom: 6px; }

        .warning {
            background: rgba(255,193,7,0.12);
            border-left: 4px solid #FFC107;
            padding: 12px 14px;
            border-radius: 8px;
            margin-top: 12px;
            font-size: 14px;
            color: rgba(255,255,255,0.9);
        }

        .success {
            background: rgba(76,175,80,0.12);
            border-left: 4px solid #4CAF50;
            padding: 16px;
            border-radius: 8px;
            margin-top: 20px;
            font-size: 15px;
        }

        .danger {
            background: rgba(244,67,54,0.12);
            border-left: 4px solid #f44336;
            padding: 12px 14px;
            border-radius: 8px;
            margin-top: 12px;
            font-size: 14px;
        }

        .status {
            border-radius: 10px;
            padding: 14px 16px;
            margin-bottom: 20px;
            font-size: 15px;
            border-left: 4px solid;
        }

        .status.ok   { background: rgba(76,175,80,0.12);  border-color: #4CAF50; }
        .status.warn { background: rgba(255,193,7,0.12);  border-color: #FFC107; }
        .status.bad  { background: rgba(244,67,54,0.12);  border-color: #f44336; }

        .button {
            display: block;
            text-align: center;
            background: #2AABEE;
            color: #fff;
            text-decoration: none;
            padding: 14px;
            border-radius: 12px;
            font-weight: bold;
            margin-top: 20px;
        }

        .button.secondary {
            background: rgba(255,255,255,0.1);
            border: 1px solid rgba(255,255,255,0.25);
        }

        .button:hover { opacity: 0.9; }
    </style>
</head>
<body>
<div class="container">
    <h1>🎬 Telegram Mini App Sozlash</h1>

    <!-- Joriy holat -->
    <?php if ($isLocal): ?>
        <div class="status bad">
            ⚠️ <b>Hozir sayt localhost'da.</b><br>
            Telegram Mini App <b>faqat HTTPS</b> manzilda ishlaydi. Avval
            <code>start-tunnel.bat</code> faylini ishga tushiring va yangi
            manzilni shu yerga kiriting.
        </div>
    <?php elseif (!$schemeOk): ?>
        <div class="status warn">
            ⚠️ <b>Manzil HTTP orqali berilgan.</b> Mini App faqat <b>HTTPS</b>
            talab qiladi.
        </div>
    <?php else: ?>
        <div class="status ok">
            ✅ <b>Tunnel ishlab turibdi.</b> Quyidagi URL'ni BotFather'da
            ishlatishingiz mumkin.
        </div>
    <?php endif; ?>

    <div class="step">
        <div class="step-number">1</div>
        <div class="step-title">BotFather'da Mini App yaratish</div>
        <div class="step-content">
            <p>Telegram'da <b>@BotFather</b> botini oching va unga yuboring:</p>
            <div class="code">/newapp</div>
            <ul>
                <li>Bot nomi: <b>W CINEMA</b></li>
                <li>Short name: <b>w_cinema</b></li>
                <li>Photo: ixtiyoriy</li>
            </ul>
        </div>
    </div>

    <div class="step">
        <div class="step-number">2</div>
        <div class="step-title">Web App URL</div>
        <div class="step-content">
            <p>BotFather <b>Menu Button</b> so'raydi. Quyidagi URL'ni kiriting:</p>
            <div class="code"><?php echo htmlspecialchars($miniAppUrl); ?></div>
            <p>BotFather'da <b>/setmenubutton</b> buyrug'i orqali ham
               o'zgartirishingiz mumkin.</p>
            <div class="warning">
                ⚠️ Tunnel har qayta ishga tushganda yangi manzil beradi.
                Eskirgan manzil ishlamaydi — bu holda <code>start-tunnel.bat</code>
                ni qayta ishga tushirib, yangisini shu yerga kiriting.
            </div>
        </div>
    </div>

    <div class="step">
        <div class="step-number">3</div>
        <div class="step-title">Bot command'lari (ixtiyoriy)</div>
        <div class="step-content">
            <p>@BotFather ga <b>/setcommands</b> yuboring:</p>
            <div class="code">start - Botni ishga tushirish
help - Yordam
videos - Videolarni ko'rish
upload - Video yuklash</div>
        </div>
    </div>

    <div class="step">
        <div class="step-number">4</div>
        <div class="step-title">4-qadam uchun /start shart</div>
        <div class="step-content">
            <p>Videoni Telegram'ga yuborish ishlashi uchun har bir foydalanuvchi
               avval botga <code>/start</code> yuborishi kerak. Aks holda
               Telegram "bot can't initiate conversation" beradi va sayt
               <code>428 need_start</code> qaytaradi — bu normal holat, UI
               foydalanuvchiga bot linkini ko'rsatadi.</p>
        </div>
    </div>

    <div class="step">
        <div class="step-number">5</div>
        <div class="step-title">Test qilish</div>
        <div class="step-content">
            <p>Botni Telegram'da oching, <code>/start</code> yuboring va
               menyusidagi tugmadan Mini App'ni oching.</p>
        </div>
    </div>

    <div class="danger">
        <b>ngrok Free rejasi ishlamaydi.</b> U har bir brauzer so'roviga
        ogohlantirish sahifasi (ERR_NGROK_6024) qo'yadi — hatto API so'rovlari
        ham HTML qaytaradi, shuning uchun Mini App yuklanmaydi. Loyihaning
        <code>start-tunnel.bat</code> fayli Cloudflare tunnelidan foydalanadi,
        u bu muammoni yo'q qiladi.
    </div>

    <a href="<?php echo htmlspecialchars(MINI_APP_URL); ?>" class="button">
        🔐 Login sahifasini ochish
    </a>
    <a href="<?php echo htmlspecialchars($botLink); ?>" class="button secondary" target="_blank">
        🤖 @<?php echo htmlspecialchars(TELEGRAM_BOT_USERNAME); ?> botini ochish
    </a>
</div>
</body>
</html>
