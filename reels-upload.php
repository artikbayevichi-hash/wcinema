<?php
// ============================================================================
// reels-upload.php — kontent joylash (Reels · Rasm post · Uzun video)
// ----------------------------------------------------------------------------
// Oqim (Instagram uslubidagi bosqichli):
//   1) Format + fayl  — Reels (9:16) / Rasm post (1:1) / Uzun video (16:9)
//   2) Ko'rish         — preview va muqova (cover) kadrini tanlash
//   3) Beschak         — sarlavha, izoh, film bilan bog'lash
//   4) Yayinlash       — tasdiqlash + natija
//
// TEZLIK: fayl 1-bosqichda tanlanganda darhol serverga YUKLANADI
// (api/upload.php?stage=media → "staging"). Foydalanuvchi 2- va 3-bosqichda
// yozadi — shu vaqt ichida baytlar yo'ladi. 4-bosqichda faqat metadata
// yuboriladi (stage=publish) va server faylni Telegram kanalga joylaydi.
//
// Video serverda saqlanMAYdi — to'g'ridan-to'g'ri kanalga joylanadi.
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

// Bosqich sarlavhalari (Yuqoridagi indikator uchun).
$steps = [
    1 => 'Format',
    2 => "Ko'rish",
    3 => 'Beschak',
    4 => 'Yayinlash',
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
    <link rel="stylesheet" href="assets/css/style.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/style.css') ?: 1; ?>">
    <link rel="stylesheet" href="assets/css/reels.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/reels.css') ?: 1; ?>">
    <link rel="stylesheet" href="assets/css/upload.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/upload.css') ?: 1; ?>">
    <link rel="stylesheet" href="assets/css/instagram.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/instagram.css') ?: 1; ?>">
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
</head>
<body class="up-body ig-shell">

<!-- Navigatsiya -->
<?php $NAV_ACTIVE = 'upload'; require __DIR__ . '/includes/nav.php'; ?>

<header class="up-top">
    <a class="reels-back" href="reels.php" aria-label="Orqaga"><?php echo ig_svg('back'); ?></a>
    <div class="up-title">Yangi reels</div>
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

<!-- ==================== BOSQICH INDIKATORI ==================== -->
<nav class="up-steps" id="upSteps" aria-label="Bosqichlar">
    <?php foreach ($steps as $n => $label): ?>
    <div class="up-step<?php echo $n === 1 ? ' is-active' : ''; ?>" data-step="<?php echo (int) $n; ?>">
        <i class="up-step-bar"><b></b></i>
        <span class="up-step-label"><?php echo htmlspecialchars($label); ?></span>
    </div>
    <?php endforeach; ?>
</nav>

<form class="up-card up-steps-card" id="upForm" onsubmit="return false;">

    <!-- ===================== 1) FORMAT + FAYL ===================== -->
    <section class="up-panel" data-panel="1">
        <h2 class="up-panel-title">Qanday kontent yuklaysiz?</h2>
        <p class="up-panel-sub">Formatni tanlang — keyin faylni (yoki fayllarni) bering.</p>

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

        <div class="up-drop" id="upDrop" role="button" tabindex="0" aria-label="Video yoki rasm faylini tanlash">
            <div class="up-drop-icon">&#128225;</div>
            <div class="up-drop-text">Videoni tanlang yoki shu yerga tashlang</div>
            <div class="up-drop-hint">MP4 &middot; WEBM &middot; MOV &mdash; 50 MB gacha</div>
            <input type="file" id="upFile" accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov" hidden>
        </div>
        <div class="up-files" id="upFiles" hidden></div>
    </section>

    <!-- ===================== 2) KO'RISH (preview) ===================== -->
    <section class="up-panel" data-panel="2" hidden>
        <h2 class="up-panel-title">Ko&lsquo;rinishi</h2>
        <p class="up-panel-sub">Bu kadrlar reel&lsquo;da ko&lsquo;rinadi. Kerakli kadrni tanlang.</p>

        <div class="up-thumb" id="upThumb" hidden>
            <div class="up-thumb-frame" id="upThumbFrame" data-aspect="9:16">
                <img id="upThumbImg" alt="">
            </div>
            <div class="up-thumb-bar" id="upThumbTime" hidden>
                <input type="range" class="up-thumb-time" id="upThumbSeek"
                       min="0" max="10" step="0.1" value="0">
                <span class="up-thumb-val" id="upThumbVal">0:00</span>
            </div>
            <div class="up-thumb-head">
                <span class="up-thumb-title">Muqova kadrini suring</span>
                <button type="button" class="up-thumb-btn" id="upThumbRe">Qayta olish</button>
            </div>
        </div>

        <!-- Galereya uchun tanlangan rasm ko'rinishi -->
        <div class="up-strip" id="upStrip"></div>
    </section>

    <!-- ===================== 3) BESCHAK ===================== -->
    <section class="up-panel" data-panel="3" hidden>
        <h2 class="up-panel-title">Beschak</h2>
        <p class="up-panel-sub">Nima haqida? Sarlavha va izoh — ixtiyoriy, lekin tavsiya etamiz.</p>

        <label class="up-label" style="margin-top:0">
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
    </section>

    <!-- ===================== 4) YAYINLASH ===================== -->
    <section class="up-panel" data-panel="4" hidden>
        <h2 class="up-panel-title">Yayinlash</h2>
        <p class="up-panel-sub">Tayyor! Boshlash uchun &laquo;Yayinlash&laquo; ni bosing.</p>

        <div class="up-review" id="upReview"></div>

        <div class="up-progress" id="upProgress" hidden>
            <div class="up-progress-bar"><span id="upBar"></span></div>
            <div class="up-progress-text" id="upProgText"></div>
        </div>

        <div class="up-msg" id="upMsg" hidden></div>

        <p class="up-note" id="upNote">
            Video <b>serverda saqlanmaydi</b> &mdash; to&lsquo;g&lsquo;ridan-to&lsquo;g&lsquo;ri
            <b>kanalga</b> joylanadi va saytda o&lsquo;sha yerdan o&lsquo;ynaydi.
            Rasm postlari esa saytda saqlanadi.
        </p>
    </section>

    <!-- Yuklash holati — barcha bosqichlarda ko'rinadi (fayl 1-bosqichda
         yuboriladi, foydalanuvchi 2- va 3-bosqichda yozadi). -->
    <div class="up-stage" id="upStage" hidden>
        <div class="up-stage-bar"><span id="upStageBar"></span></div>
        <div class="up-stage-text" id="upStageText">Fayl tayyorlanmoqda…</div>
    </div>

</form>

<!-- ==================== PASTDAGI AMAL TUGMASI ==================== -->
<div class="up-actions" id="upActions">
    <button class="up-act-back" id="upBack" type="button" hidden>Orqaga</button>
    <button class="up-act-next" id="upNext" type="button">Keyingi</button>
</div>

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
