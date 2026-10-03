<?php
// ============================================================================
// reels-upload.php - reelsni Telegram kanal orqali joylash
// ============================================================================
// DIQQAT: bu sahifada FAYL TANLASH YO'Q. Video serverga yuklanmaydi.
//
// Oqim:
//   1) Foydalanuvchi sarlavha/izoh yozadi va (ixtiyoriy) qaysi filmdan
//      olinganini nom yoki ID bo'yicha qidirib tanlaydi.
//   2) "Telegram orqali yuborish" bosiladi -> api/reel-intent.php token
//      yaratadi va botga deep-link qaytaradi.
//   3) Foydalanuvchi botga o'tib videoni yuboradi. Bot uni REELS kanaliga
//      joylaydi. Sayt faqat havolani saqlaydi.
//
// Shunday qilib butun og'irlik Telegram'da qoladi - serverda video
// fayli ham, poster ham saqlanmaydi.
// ============================================================================
require_once __DIR__ . '/includes/bootstrap.php';

$user   = $auth->getCurrentUser();
$userId = $user ? (int) $user['id'] : null;
$stats  = $userId ? $reels->authorStats($userId) : null;

$channelReady = (REELS_CHANNEL !== '');
$botName      = TELEGRAM_BOT_USERNAME;
?>
<!DOCTYPE html>
<html lang="uz">
<head>
    <link rel="icon" type="image/png" href="assets/img/favicon.png?v=<?php echo @filemtime(__DIR__ . '/assets/img/favicon.png') ?: 1; ?>">
    <link rel="apple-touch-icon" href="assets/img/apple-touch-icon.png?v=<?php echo @filemtime(__DIR__ . '/assets/img/apple-touch-icon.png') ?: 1; ?>">
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <title>Reels yuklash — <?php echo htmlspecialchars(SITE_NAME); ?></title>
    <link rel="stylesheet" href="assets/css/style.css">
    <link rel="stylesheet" href="assets/css/reels.css">
    <link rel="stylesheet" href="assets/css/instagram.css">
    <!-- Telegram Web App — FAQAT Telegram ilovasi ichida kerak. Oddiy
         tashrifchida bu so'rov muvaffaqiyatsiz bo'lib, sahifani
         sekinlashtiradi. Shu uchun shartli yuklanadi. -->
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

<!-- Instagram uslubidagi navigatsiya -->
<?php $NAV_ACTIVE = 'upload'; require __DIR__ . '/includes/nav.php'; ?>

<header class="up-top">
    <a class="reels-back" href="reels.php" aria-label="Orqaga">←</a>
    <div class="up-title">Reels joylash</div>
    <span style="width:34px"></span>
</header>

<?php if (!$channelReady): ?>
<!-- ================= Reels kanali sozlanmagan ================= -->
<div class="up-card">
    <div class="up-drop" style="cursor:default">
        <div class="up-drop-icon">🔧</div>
        <div class="up-drop-text">Reels kanali hali sozlanmagan</div>
        <div class="up-drop-hint">
            Administrator <code>.env</code> faylida <code>REELS_CHANNEL</code> ni
            ko'rsatishi va botni kanalga admin qilib qo'shishi kerak.
        </div>
    </div>
</div>
<?php else: ?>

<form class="up-card" id="upForm" onsubmit="return false;">

    <!-- ============================ Maydonlar ============================ -->
    <label class="up-label">
        Sarlavha
        <input type="text" id="upTitle" maxlength="200"
               placeholder="Masalan: Anime finali — hayajonli" autocomplete="off">
    </label>

    <label class="up-label">
        Izoh <span style="color:var(--muted)">(ixtiyoriy)</span>
        <textarea id="upDesc" rows="3" maxlength="500"
                  placeholder="Qisqa izoh…"></textarea>
    </label>

    <!-- ==================== Qaysi filmdan? (ixtiyoriy) ==================== -->
    <label class="up-label">
        Qaysi filmdan? <span style="color:var(--muted)">(ixtiyoriy)</span>
        <div class="src-pick" id="srcPick">
            <input type="text" id="srcSearch"
                   placeholder="Kino / anime / multfilm nomi yoki ID…"
                   autocomplete="off">
            <div class="src-results" id="srcResults" hidden></div>
        </div>
        <div class="src-chip" id="srcChip" hidden></div>
        <input type="hidden" id="upContentId" value="">
    </label>

    <div class="up-msg" id="upMsg" hidden></div>

    <button class="up-btn" id="upSubmit" type="submit">📨 Telegram orqali yuborish</button>

    <p class="up-note">
        Video <b>Telegram</b>ga yuklanadi (serverga emas). Tugmani bosing —
        <b>@<?php echo htmlspecialchars($botName); ?></b> boti ochiladi,
        videoni yuboring. Reel avtomatik kanalga joylanadi va shu yerda paydo bo'ladi.
    </p>
</form>

<?php endif; ?>

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
(function () {
    const form    = document.getElementById('upForm');
    if (!form) return;                       // kanal sozlanmagan

    const search  = document.getElementById('srcSearch');
    const results = document.getElementById('srcResults');
    const chip    = document.getElementById('srcChip');
    const cidEl   = document.getElementById('upContentId');
    const title   = document.getElementById('upTitle');
    const desc    = document.getElementById('upDesc');
    const msg     = document.getElementById('upMsg');
    const submit  = document.getElementById('upSubmit');

    const esc = (s) => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    function showMsg(t, kind) {
        msg.hidden = false;
        msg.textContent = t;
        msg.className = 'up-msg ' + (kind || '');
    }

    // ---------------------------------------------------- qidiruv
    let timer = null;
    let picked = null;

    function clearPick() {
        picked = null;
        cidEl.value = '';
        chip.hidden = true;
        chip.innerHTML = '';
    }

    function pick(item) {
        picked = item;
        cidEl.value = item.id;
        results.hidden = true;
        if (title && !title.value.trim()) title.value = item.title || '';
        chip.hidden = false;
        chip.innerHTML = '📺 ' + esc(item.title)
            + (item.category ? ' · ' + esc(item.category) : '')
            + ' <button type="button" title="Olib tashlash">✕</button>';
        chip.querySelector('button').addEventListener('click', () => {
            clearPick();
            search.value = '';
            search.focus();
        });
    }

    async function doSearch(q) {
        results.hidden = false;
        results.innerHTML = '<div class="empty">Qidirilmoqda…</div>';
        try {
            const res = await fetch('api/catalog.php?q=' + encodeURIComponent(q) + '&per_page=8', {
                headers: { 'X-Requested-With': 'XMLHttpRequest' },
                credentials: 'same-origin'
            });
            const d = await res.json();
            const items = (d && d.items) || [];
            if (!items.length) {
                results.innerHTML = '<div class="empty">Topilmadi — bo‘sh qoldirsangiz ham bo‘ladi</div>';
                return;
            }
            results.innerHTML = items.map((it, i) => `
                <button type="button" data-i="${i}">
                    ${it.poster ? `<img src="${esc(it.poster)}" alt="">` : '<img alt="">'}
                    <span>
                        <span class="t">${esc(it.title)}</span>
                        <span class="s">#${it.id}${it.category ? ' · ' + esc(it.category) : ''}${it.year ? ' · ' + it.year : ''}</span>
                    </span>
                </button>`).join('');
            results.querySelectorAll('button[data-i]').forEach((b) => {
                b.addEventListener('click', () => pick(items[Number(b.dataset.i)]));
            });
        } catch (e) {
            results.innerHTML = '<div class="empty">Qidiruvda xatolik</div>';
        }
    }

    if (search) {
        search.addEventListener('input', () => {
            clearTimeout(timer);
            const q = search.value.trim();
            if (q.length < 1) { results.hidden = true; return; }
            timer = setTimeout(() => doSearch(q), 250);
        });
        search.addEventListener('focus', () => {
            if (search.value.trim().length >= 1 && (!picked)) doSearch(search.value.trim());
        });
    }
    document.addEventListener('click', (e) => {
        if (results && !e.target.closest('#srcPick')) results.hidden = true;
    });

    // ---------------------------------------------------- yuborish
    form.addEventListener('submit', async function (ev) {
        ev.preventDefault();
        submit.disabled = true;
        submit.textContent = '⏳ Tayyorlanmoqda…';
        showMsg('Reel tayyorlanmoqda…', '');

        const fd = new FormData();
        fd.append('title', title ? title.value : '');
        fd.append('description', desc ? desc.value : '');
        fd.append('content_id', cidEl.value || '');
        try {
            const me = localStorage.getItem('wc_tg_me_v1');
            if (me) fd.append('tg_me', me);
        } catch (e) {}

        try {
            const res = await fetch('api/reel-intent.php', { method: 'POST', body: fd });
            const d = await res.json();
            if (!res.ok || !d.success || !d.bot_link) {
                throw new Error(d.message || ('Xato ' + res.status));
            }
            showMsg('✅ ' + (d.message || 'Botga o‘tasiz…'), 'ok');
            submit.textContent = '✅ Telegram ochilmoqda…';
            // Botni ochamiz - foydalanuvchi videoni shu yerda yuboradi.
            setTimeout(() => { location.href = d.bot_link; }, 700);
        } catch (e) {
            submit.disabled = false;
            submit.textContent = '📨 Telegram orqali yuborish';
            showMsg('❌ ' + e.message, 'err');
        }
    });
})();
</script>

</body>
</html>
