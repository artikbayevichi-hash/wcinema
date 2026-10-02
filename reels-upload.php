<?php
// ============================================================================
// reels-upload.php - qisqa video yuklash
// ============================================================================
// Yuklangan reel avtomatik "kutilmoqda" (status 0) holatiga tushadi va
// admin tasdiqlashidan keyin oqimda ko'rinadi.
//
// DIQQAT: bu sahifa kirish talab qiladi. Mehmon uchun "Telegram orqali
// kiring" ko'rsatiladi (404 emas) - chunki Telegram Mini App ichida
// foydalanuvchi har doim login bo'lishi kerak.
// ============================================================================
require_once __DIR__ . '/includes/bootstrap.php';

$user   = $auth->getCurrentUser();
$userId = $user ? (int) $user['id'] : null;
$stats  = $userId ? $reels->authorStats($userId) : null;
// Haqiqiy chegakichisi (config va php.ini dan)
$maxMb  = (int) REEL_EFFECTIVE_MAX_UPLOAD_MB;
?>
<!DOCTYPE html>
<html lang="uz">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <title>Reels yuklash — <?php echo htmlspecialchars(SITE_NAME); ?></title>
    <link rel="stylesheet" href="assets/css/style.css">
    <link rel="stylesheet" href="assets/css/reels.css">
    <link rel="stylesheet" href="assets/css/instagram.css">
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
<body class="up-body ig-shell">

<!-- Instagram uslubidagi navigatsiya -->
<?php $NAV_ACTIVE = 'upload'; require __DIR__ . '/includes/nav.php'; ?>

<header class="up-top">
    <a class="reels-back" href="reels.php" aria-label="Orqaga">←</a>
    <div class="up-title">Reels yuklash</div>
    <span style="width:34px"></span>
</header>

<?php if (!$userId): ?>
    <div class="up-card">
        <div style="font-size:40px">🔐</div>
        <h1 style="font-size:19px;margin:10px 0 6px">Kirish kerak</h1>
        <p style="color:var(--muted);font-size:13.5px;margin-bottom:18px">
            Reels yuklash uchun Telegram orqali kiring.
        </p>
        <a class="up-btn" href="login.php">Telegram orqali kiring</a>
    </div>
<?php else: ?>

<form class="up-card" id="upForm" enctype="multipart/form-data">

    <!-- ============================ Fayl tanlash ============================ -->
    <label class="up-drop" id="upDrop">
        <input type="file" name="video" id="upFile" accept="video/mp4,video/webm,video/quicktime" hidden>
        <div class="up-drop-icon" id="upDropIcon">🎬</div>
        <div class="up-drop-text" id="upDropText">Video tanlang yoki shu yerga tashlang</div>
        <div class="up-drop-hint">MP4 / WebM / MOV · ko'pi bilan <?php echo $maxMb; ?> MB</div>
    </label>

    <!-- Video ichidan kadr ko'rsatish -->
    <video id="upPreview" class="up-preview" hidden playsinline muted loop></video>

    <!-- ============================ Maydonlar ============================ -->
    <label class="up-label">
        Sarlavha
        <input type="text" name="title" id="upTitle" maxlength="200"
               placeholder="Masalan: Anime finali — hayajonli" autocomplete="off">
    </label>

    <label class="up-label">
        Izoh <span style="color:var(--muted)">(ixtiyoriy)</span>
        <textarea name="description" id="upDesc" rows="3" maxlength="500"
                  placeholder="Qisqa izoh…"></textarea>
    </label>

    <div class="up-progress" id="upProgress" hidden>
        <div class="up-progress-bar"><span id="upProgressFill"></span></div>
        <div class="up-progress-text" id="upProgressText">Yuklanmoqda…</div>
    </div>

    <div class="up-msg" id="upMsg" hidden></div>

    <button class="up-btn" id="upSubmit" type="submit">Yuborish</button>

    <p class="up-note">
        <?php if (REELS_REQUIRE_APPROVAL): ?>
        ⏳ Yuborilgan reel avval admin tomonidan ko'rib chiqiladi.
        Tasdiqlangandan keyin u oqimda ko'rinadi.
        <?php else: ?>
        Reel darhol oqimda ko'rinadi.
        <?php endif; ?>
    </p>
</form>

<!-- ============================ Mening statistika ============================ -->
<?php if ($stats && $stats['total'] > 0): ?>
<div class="up-card up-stats">
    <h2 style="font-size:15px;margin-bottom:12px">📊 Mening reelslarim</h2>
    <div class="up-stats-grid">
        <div class="up-stat"><b><?php echo (int) $stats['approved']; ?></b><span>Tasdiqlangan</span></div>
        <div class="up-stat"><b><?php echo (int) $stats['pending']; ?></b><span>Kutilmoqda</span></div>
        <div class="up-stat"><b><?php echo (int) $stats['views']; ?></b><span>Ko'rish</span></div>
        <div class="up-stat"><b><?php echo (int) $stats['likes']; ?></b><span>Yoqish</span></div>
    </div>
    <?php if ($stats['rejected'] > 0): ?>
    <p class="up-note" style="margin-top:12px">
        ⚠️ Rad etilgan: <?php echo (int) $stats['rejected']; ?> ta
    </p>
    <?php endif; ?>
</div>
<?php endif; ?>

<script>
// --- fayl tanlangach ko'rsatish + hajm tekshiruvi
(function () {
    const file    = document.getElementById('upFile');
    const drop    = document.getElementById('upDrop');
    const preview = document.getElementById('upPreview');
    const icon    = document.getElementById('upDropIcon');
    const text    = document.getElementById('upDropText');
    const form    = document.getElementById('upForm');
    const msg     = document.getElementById('upMsg');
    const prog    = document.getElementById('upProgress');
    const fill    = document.getElementById('upProgressFill');
    const ptext   = document.getElementById('upProgressText');
    const submit  = document.getElementById('upSubmit');
    const title   = document.getElementById('upTitle');

    const MAX = <?php echo $maxMb; ?>;
    const MAXLEN = <?php echo (int) REEL_MAX_LENGTH; ?>;

    function showMsg(t, kind) {
        msg.hidden = false;
        msg.textContent = t;
        msg.className = 'up-msg ' + (kind || '');
    }

    function setFile(f) {
        if (!f) return;
        if (f.size > MAX * 1024 * 1024) {
            showMsg('Fayl katta: ' + (f.size / 1048576).toFixed(1) + ' MB (max ' + MAX + ' MB)', 'err');
            file.value = '';
            return;
        }
        msg.hidden = true;
        text.textContent = f.name;
        icon.textContent = '✅';
        drop.classList.add('has');

        if (preview.src) URL.revokeObjectURL(preview.src);
        preview.src = URL.createObjectURL(f);
        preview.hidden = false;

        // Sarlavhani fayl nomidan to'ldiramiz (agar bo'sa)
        if (!title.value) {
            title.value = f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 200);
        }
    }

    file.addEventListener('change', () => setFile(file.files[0]));

    ['dragenter', 'dragover'].forEach(e => drop.addEventListener(e, ev => {
        ev.preventDefault(); drop.classList.add('over');
    }));
    ['dragleave', 'drop'].forEach(e => drop.addEventListener(e, ev => {
        ev.preventDefault(); drop.classList.remove('over');
    }));
    drop.addEventListener('drop', ev => {
        const f = ev.dataTransfer?.files?.[0];
        if (f) { file.files = ev.dataTransfer.files; setFile(f); }
    });

    // --- uzunlikni tekshirish (video o'qilgach)
    preview.addEventListener('loadedmetadata', () => {
        const d = preview.duration;
        if (isFinite(d) && d > MAXLEN) {
            showMsg('Video ' + d.toFixed(0) + ' soniya, lekin ko‘pi bilan ' + MAXLEN + ' soniya', 'err');
        }
    });

    // --- yuborish
    form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        if (!file.files[0]) { showMsg('Avval video tanlang', 'err'); return; }

        submit.disabled = true;
        submit.textContent = '⏳ Yuborilmoqda…';
        prog.hidden = false;
        fill.style.width = '0%';

        // XMLHttpRequest (Fetch API yuklash progress'ini bermaydi)
        const xhr = new XMLHttpRequest();
        xhr.open('POST', 'api/reel-upload.php');
        xhr.upload.onprogress = function (e) {
            if (e.lengthComputable) {
                const pct = Math.round(e.loaded / e.total * 100);
                fill.style.width = pct + '%';
                ptext.textContent = pct + '%';
            }
        };
        xhr.onload = function () {
            let d = {};
            try { d = JSON.parse(xhr.responseText); } catch (e) {}
            submit.disabled = false;
            submit.textContent = 'Yuborish';
            if (xhr.status >= 200 && xhr.status < 300 && d.success) {
                showMsg(d.message || 'Yuborildi!', 'ok');
                ptext.textContent = 'Tayyor';
                fill.style.width = '100%';
                setTimeout(() => { location.href = 'reels.php'; }, 1400);
            } else {
                prog.hidden = true;
                submit.disabled = false;
                showMsg(d.message || ('Xato ' + xhr.status), 'err');
            }
        };
        xhr.onerror = function () {
            prog.hidden = true;
            submit.disabled = false;
            submit.textContent = 'Yuborish';
            showMsg('Tarmoq uzildi', 'err');
        };
        xhr.send(new FormData(form));
    });
})();
</script>
<?php endif; ?>

</body>
</html>
