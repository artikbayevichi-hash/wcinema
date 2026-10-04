<?php
// ============================================================================
// reels-upload.php — kontent joylash (Reels · Rasm post · Uzun video)
// ----------------------------------------------------------------------------
// Oqim:
//   1) Foydalanuvchi formatni tanlaydi (Reels 9:16 / Rasm post 1:1 /
//      Uzun video 16:9), fayl(lar)ni tanlaydi.
//   2) THUMBNAIL klientda yaratiladi (canvas) — serverda ffmpeg yo'q.
//   3) api/upload.php faylni qabul qiladi:
//        · video → to'g'ridan-to'g'ri kanalga (serverda saqlanmaydi)
//        · rasm  → serverga (uploads/posts/) saqlanadi (galereya uchun)
// ============================================================================
require_once __DIR__ . '/includes/bootstrap.php';

$user   = $auth->getCurrentUser();
$userId = $user ? (int) $user['id'] : null;
$stats  = $userId ? $reels->authorStats($userId) : null;

$channelReady = (REELS_CHANNEL !== '');

// Limitlar — Uploader::create() bilan bir xil (server tekshiruvi ham bor).
$limits = [
    'reel'  => ['name' => 'Reels',      'ratio' => '9:16', 'maxMb' => 50,  'icon' => "\u{1F4E5}", 'max' => 1],
    'post'  => ['name' => 'Rasm post',  'ratio' => '1:1',  'maxMb' => 12,  'icon' => "\u{1F5BC}", 'max' => 10],
    'video' => ['name' => 'Uzun video', 'ratio' => '16:9', 'maxMb' => 200, 'icon' => "\u{1F4FA}", 'max' => 1],
];
?>
<!DOCTYPE html>
<html lang="uz">
<head>
    <link rel="icon" type="image/png" href="assets/img/favicon.png?v=<?php echo @filemtime(__DIR__ . '/assets/img/favicon.png') ?: 1; ?>">
    <link rel="apple-touch-icon" href="assets/img/apple-touch-icon.png?v=<?php echo @filemtime(__DIR__ . '/assets/img/apple-touch-icon.png') ?: 1; ?>">
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <title>Joylash &mdash; <?php echo htmlspecialchars(SITE_NAME); ?></title>
    <link rel="stylesheet" href="assets/css/style.css">
    <link rel="stylesheet" href="assets/css/reels.css">
    <link rel="stylesheet" href="assets/css/upload.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/upload.css') ?: 1; ?>">
    <link rel="stylesheet" href="assets/css/instagram.css">
    <?php require __DIR__ . '/includes/tv-head.php'; ?>
    <!-- Telegram Web App &mdash; FAQAT Telegram ilovasi ichida kerak. -->
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
        .src-pick { position: relative; }
        .src-results {
            position: absolute; z-index: 40; left: 0; right: 0;
            top: calc(100% + 4px);
            background: #12151d; border: 1px solid #262b38; border-radius: 10px;
            max-height: 290px; overflow: auto;
            box-shadow: 0 12px 30px rgba(0,0,0,.55);
        }
        .src-results button {
            display: flex; gap: 10px; align-items: center;
            width: 100%; padding: 8px 10px; background: none; border: 0;
            color: #e7ebf3; text-align: left; cursor: pointer;
        }
        .src-results button:hover { background: #1c2130; }
        .src-results img {
            width: 34px; height: 48px; object-fit: cover;
            border-radius: 6px; background: #0b0d13; flex-shrink: 0;
        }
        .src-results .t { font-size: 13px; font-weight: 600; }
        .src-results .s { font-size: 11px; color: #8b95a8; }
        .src-results .empty { padding: 12px; color: #8b95a8; font-size: 12.5px; }
        .src-chip {
            display: inline-flex; align-items: center; gap: 8px;
            margin-top: 8px; padding: 6px 11px; border-radius: 999px;
            background: #1c2130; font-size: 13px;
        }
        .src-chip button {
            background: none; border: 0; color: #ff9a9a;
            cursor: pointer; font-size: 15px; line-height: 1;
        }
    </style>
</head>
<body class="up-body ig-shell">

<!-- Navigatsiya -->
<?php $NAV_ACTIVE = 'upload'; require __DIR__ . '/includes/nav.php'; ?>

<header class="up-top">
    <a class="reels-back" href="reels.php" aria-label="Orqaga">&larr;</a>
    <div class="up-title">Joylash</div>
    <span style="width:34px"></span>
</header>

<?php if (!$channelReady): ?>
<!-- ==================== Kanal sozlanmagan ==================== -->
<div class="up-card">
    <div class="up-drop" style="cursor:default">
        <div class="up-drop-icon">&#9888;</div>
        <div class="up-drop-text">Video kanali sozlanmagan</div>
        <div class="up-drop-hint">
            Administrator <code>.env</code> faylida <code>REELS_CHANNEL</code> ni
            ko&lsquo;rsatishi va botni kanalga admin qilib qo&lsquo;shishi kerak.
            Rasm postlari shu kanalga bog&lsquo;liq emas &mdash; ular ishlaydi.
        </div>
    </div>
</div>
<?php else: ?>

<form class="up-card" id="upForm" onsubmit="return false;">

    <!-- ============================== FORMAT ============================== -->
    <label class="up-label" style="margin-top:0">Format</label>
    <div class="up-formats" id="upFormats" role="group" aria-label="Format tanlang">
        <?php foreach ($limits as $fid => $f): ?>
        <button type="button" class="up-format" data-format="<?php echo $fid; ?>"
                aria-pressed="<?php echo $fid === 'reel' ? 'true' : 'false'; ?>">
            <span class="up-format-ico"><?php echo $f['icon']; ?></span>
            <span class="up-format-name"><?php echo htmlspecialchars($f['name']); ?></span>
            <span class="up-format-ratio"><?php echo $f['ratio']; ?></span>
        </button>
        <?php endforeach; ?>
    </div>

    <!-- ============================ FAYL ============================ -->
    <div class="up-drop" id="upDrop">
        <div class="up-drop-icon">&#128225;</div>
        <div class="up-drop-text">Videoni tanlang yoki shu yerga tashlang</div>
        <div class="up-drop-hint">MP4 &middot; WEBM &middot; MOV &mdash; 50 MB gacha</div>
        <input type="file" id="upFile" accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov" hidden>
    </div>
    <div class="up-files" id="upFiles" hidden></div>

    <!-- Galereya uchun tanlangan rasm ko'rinishi -->
    <div class="up-strip" id="upStrip"></div>

    <!-- ========================= THUMBNAIL ========================= -->
    <div class="up-thumb" id="upThumb" hidden>
        <div class="up-thumb-head">
            <span class="up-thumb-title">Preview (thumbnail)</span>
            <button type="button" class="up-thumb-btn" id="upThumbRe">Qayta olish</button>
        </div>
        <div class="up-thumb-frame" id="upThumbFrame" data-aspect="9:16">
            <img id="upThumbImg" alt="">
        </div>
        <div class="up-thumb-bar" id="upThumbTime" hidden>
            <input type="range" class="up-thumb-time" id="upThumbSeek"
                   min="0" max="10" step="0.1" value="0">
            <span class="up-thumb-val" id="upThumbVal">0:00</span>
        </div>
    </div>

    <!-- ============================ MAYDONLAR ============================ -->
    <label class="up-label">
        Sarlavha
        <input type="text" id="upTitle" maxlength="200"
               placeholder="Masalan: Anime finali &mdash; hayajonli" autocomplete="off">
    </label>

    <label class="up-label">
        Izoh <span style="color:var(--muted)">(ixtiyoriy)</span>
        <textarea id="upDesc" rows="3" maxlength="500"
                  placeholder="Qisqa izoh&hellip;"></textarea>
    </label>

    <!-- ==================== Qaysi filmdan? (ixtiyoriy) ==================== -->
    <label class="up-label">
        Qaysi filmdan? <span style="color:var(--muted)">(ixtiyoriy)</span>
        <div class="src-pick" id="srcPick">
            <input type="text" id="srcSearch"
                   placeholder="Kino / anime / multfilm nomi yoki ID&hellip;"
                   autocomplete="off">
            <div class="src-results" id="srcResults" hidden></div>
        </div>
        <div class="src-chip" id="srcChip" hidden></div>
        <input type="hidden" id="upContentId" value="">
    </label>

    <div class="up-progress" id="upProgress" hidden>
        <div class="up-progress-bar"><span id="upBar"></span></div>
        <div class="up-progress-text" id="upProgText"></div>
    </div>

    <div class="up-msg" id="upMsg" hidden></div>

    <button class="up-btn" id="upSubmit" type="submit">Yuklash</button>

    <p class="up-note" id="upNote">
        Video <b>serverda saqlanmaydi</b> &mdash; to&lsquo;g&lsquo;ridan-to&lsquo;g&lsquo;ri
        <b>kanalga</b> joylanadi va saytda o&lsquo;sha yerdan o&lsquo;ynaydi.
        Rasm postlari esa saytda saqlanadi.
    </p>
</form>

<?php endif; ?>

<!-- ============================ Mening statistika ============================ -->
<?php if ($stats && $stats['total'] > 0): ?>
<div class="up-card up-stats">
    <h2 style="font-size:15px;margin-bottom:12px">&#128202; Mening kontentim</h2>
    <div class="up-stats-grid">
        <div class="up-stat"><b><?php echo (int) $stats['approved']; ?></b><span>Tasdiqlangan</span></div>
        <div class="up-stat"><b><?php echo (int) $stats['pending']; ?></b><span>Kutilmoqda</span></div>
        <div class="up-stat"><b><?php echo (int) $stats['views']; ?></b><span>Ko&lsquo;rish</span></div>
        <div class="up-stat"><b><?php echo (int) $stats['likes']; ?></b><span>Yoqish</span></div>
    </div>
    <?php if ($stats['rejected'] > 0): ?>
    <p class="up-note" style="margin-top:12px">
        &#10060; Rad etilgan: <?php echo (int) $stats['rejected']; ?> ta
    </p>
    <?php endif; ?>
</div>
<?php endif; ?>

<script src="assets/js/upload-page.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/upload-page.js') ?: 1; ?>"></script>

</body>
</html>