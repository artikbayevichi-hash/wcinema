<?php
// ============================================================================
// admin-reels.php - reels moderatsiya paneli
// ============================================================================
// Kutilayotgan reels'larni tasdiqlash (status 1) yoki rad etish (status 2).
//
// Xavfsizlik: kirish $auth->requireAdmin() orqali tekshiriladi. Ro'yxat
// config.php dagi ADMIN_TELEGRAM_IDS dan olinadi - "premium" emas, chunki
// premium - to'lov qilgan mijoz, admin - boshqaruv huquqi.
// ============================================================================
require_once __DIR__ . '/includes/bootstrap.php';

// Admin kaliti bilan kirilmagan — kalit formasiga yo'naltiramiz.
if (!$auth->isAdmin()) {
    // To'liq yo'l (base bilan) — admin-login.php tekshirib, shu sahifaga qaytaradi.
    $here = (string) ($_SERVER['SCRIPT_NAME'] ?? '/admin-reels.php');
    header('Location: admin-login.php?next=' . rawurlencode($here));
    exit;
}
$denied = false;
$status = inputInt('status', 0);
if (!in_array($status, [0, 1, 2], true)) {
    $status = 0;
}
$pending = $reels->getPending(50, $status);
$counts  = [
    'pending'  => $reels->countPending(0),
    'approved' => $reels->countPending(1),
    'rejected' => $reels->countPending(2),
];
?>
<!DOCTYPE html>
<html lang="uz">
<head>
    <link rel="icon" type="image/png" href="assets/img/favicon.png?v=<?php echo @filemtime(__DIR__ . '/assets/img/favicon.png') ?: 1; ?>">
    <link rel="apple-touch-icon" href="assets/img/apple-touch-icon.png?v=<?php echo @filemtime(__DIR__ . '/assets/img/apple-touch-icon.png') ?: 1; ?>">
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <title>Moderatsiya — <?php echo htmlspecialchars(SITE_NAME); ?></title>
    <link rel="stylesheet" href="assets/css/style.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/style.css') ?: 1; ?>">
    <link rel="stylesheet" href="assets/css/reels.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/reels.css') ?: 1; ?>">
    <link rel="stylesheet" href="assets/css/instagram.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/instagram.css') ?: 1; ?>">
    <?php require __DIR__ . '/includes/tv-head.php'; ?>
</head>
<body class="adm-body ig-shell">

<!-- Instagram uslubidagi navigatsiya -->
<?php $NAV_ACTIVE = ''; require __DIR__ . '/includes/nav.php'; ?>

<?php if ($denied): ?>
    <div class="up-card" style="margin-top:60px;text-align:center">
        <div style="font-size:44px">🚫</div>
        <h1 style="font-size:19px;margin:10px 0 6px">Ruxsat yo'q</h1>
        <p style="color:var(--muted);font-size:13.5px;margin-bottom:18px">
            Bu sahifa faqat administratorlar uchun.
        </p>
        <a class="up-btn" href="index.php">Bosh sahifa</a>
    </div>
<?php else: ?>

<header class="up-top">
    <a class="reels-back" href="index.php" aria-label="Orqaga">←</a>
    <div class="up-title">Moderatsiya</div>
    <span style="width:34px"></span>
</header>

<nav class="adm-tabs">
    <button class="chip adm-tab active" onclick="location.href='admin-reels.php'">🎞 Reels</button>
    <button class="chip adm-tab" onclick="location.href='admin-content.php'">🎬 Kontent</button>
</nav>

<nav class="adm-tabs">
    <button class="chip adm-tab<?php echo $status === 0 ? ' active' : ''; ?>"
            onclick="location.href='?status=0'">
        ⏳ Kutilmoqda <span class="adm-n"><?php echo (int) $counts['pending']; ?></span>
    </button>
    <button class="chip adm-tab<?php echo $status === 1 ? ' active' : ''; ?>"
            onclick="location.href='?status=1'">
        ✅ Tasdiqlangan <span class="adm-n"><?php echo (int) $counts['approved']; ?></span>
    </button>
    <button class="chip adm-tab<?php echo $status === 2 ? ' active' : ''; ?>"
            onclick="location.href='?status=2'">
        ❌ Rad etilgan <span class="adm-n"><?php echo (int) $counts['rejected']; ?></span>
    </button>
</nav>

<div class="adm-msg" id="admMsg" hidden></div>

<?php if (!$pending): ?>
    <div class="up-card" style="text-align:center;color:var(--muted)">
        <?php echo $status === 0 ? '🎉 Kutilayotgan reel yo‘q' : 'Bo‘sh'; ?>
    </div>
<?php endif; ?>

<?php foreach ($pending as $r): ?>
<div class="adm-card s<?php echo (int) $r['status']; ?>" id="rc_<?php echo (int) $r['id']; ?>">

    <div class="adm-top">
        <?php if (!empty($r['author']['avatar'])): ?>
            <img class="adm-av" src="<?php echo htmlspecialchars($r['author']['avatar']); ?>" alt="">
        <?php else: ?>
            <div class="adm-av"><?php echo htmlspecialchars(mb_substr($r['author']['name'] ?? '?', 0, 1)); ?></div>
        <?php endif; ?>
        <div class="adm-who">
            <div class="adm-name"><?php echo htmlspecialchars($r['author']['name']); ?></div>
            <div class="adm-when">
                <?php echo htmlspecialchars(date('d.m.Y H:i', strtotime($r['created_at']))); ?>
                · <?php echo (int) $r['views']; ?> 👁 · <?php echo (int) $r['likes']; ?> ❤️
            </div>
        </div>
        <span class="adm-kind <?php echo esc($r['kind']); ?>">
            <?php echo $r['kind'] === 'clip' ? '✂️ Bo‘lak' : '⬆️ Yuklangan'; ?>
        </span>
    </div>

    <div class="adm-title"><?php echo htmlspecialchars($r['title']); ?></div>

    <?php if ($r['description']): ?>
        <div style="font-size:12.5px;color:var(--muted);line-height:1.5"><?php echo htmlspecialchars($r['description']); ?></div>
    <?php endif; ?>

    <?php if ($r['kind'] === 'clip' && $r['source']): ?>
        <div class="adm-clip">
            Manba: <b><?php echo htmlspecialchars($r['source']['title']); ?></b>
            <?php if ($r['source']['episode_no']): ?>
                · <?php echo (int) $r['source']['episode_no']; ?>-qism
            <?php endif; ?>
            <br>
            Bo‘lak: <b><?php echo Reels::fmtTime($r['playback']['start'] ?? 0); ?></b>
            → <b><?php echo Reels::fmtTime((($r['playback']['start'] ?? 0) + $r['duration'])); ?></b>
            (<?php echo (int) $r['duration']; ?> soniya)
        </div>
    <?php else: ?>
        <div class="adm-clip">
            📹 Yuklangan fayl · <?php echo (int) $r['duration']; ?> soniya
        </div>
    <?php endif; ?>

    <?php if ((int) $r['status'] === 2): ?>
        <div class="adm-clip" style="color:#ff9a9a">
            Rad etish sababi: <?php echo htmlspecialchars($r['reject_reason'] ?: '—'); ?>
        </div>
    <?php endif; ?>

    <?php if ($r['cta']): ?>
        <a class="reels-cta" style="margin-top:8px" href="<?php echo htmlspecialchars($r['cta']['url']); ?>">
            <?php echo htmlspecialchars($r['cta']['label']); ?>
        </a>
    <?php endif; ?>

    <?php if ((int) $r['status'] !== 1): ?>
    <div class="adm-reject">
        <textarea id="rj_<?php echo (int) $r['id']; ?>" rows="2" maxlength="255"
                  placeholder="Rad etish sababi (muallifga yuboriladi)"></textarea>
    </div>
    <?php endif; ?>

    <div class="adm-actions">
        <?php if ((int) $r['status'] !== 1): ?>
        <button class="adm-btn ok" data-act="1" data-id="<?php echo (int) $r['id']; ?>">✅ Tasdiqlash</button>
        <?php endif; ?>
        <?php if ((int) $r['status'] !== 2): ?>
        <button class="adm-btn no" data-act="2" data-id="<?php echo (int) $r['id']; ?>">❌ Rad etish</button>
        <?php endif; ?>
        <button class="adm-btn del" data-act="del" data-id="<?php echo (int) $r['id']; ?>">🗑 O'chirish</button>
    </div>
</div>
<?php endforeach; ?>

<script>
document.addEventListener('click', async function (e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id  = btn.dataset.id;
    const act = btn.dataset.act;

    if (act === 'del' && !confirm('Butunlay o‘chirilsinmi? Bu amalni qaytarib bo‘lmaydi.')) return;

    const body = new URLSearchParams({ id: id, action: 'moderate' });
    if (act === '1') {
        body.set('status', '1');
    } else if (act === '2') {
        const reason = (document.getElementById('rj_' + id) || {}).value || '';
        if (!reason.trim()) {
            if (!confirm('Sababsiz rad etilsinmi? (foydalanuvchi “Sabab ko‘rsatilmagan” deb ko‘radi)')) return;
        }
        body.set('status', '2');
        body.set('reason', reason);
    } else {
        body.set('action', 'delete');
    }

    btn.disabled = true;
    const card = document.getElementById('rc_' + id);
    if (card) card.style.opacity = '.5';

    try {
        const res = await fetch('api/reel-moderate.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            credentials: 'same-origin',
            body: body
        });
        const d = await res.json();
        if (!d.success) throw new Error(d.message || ('Xato ' + res.status));
        // Sahifani to'liq yangilash - hisoblar (kutilmoqda soni) ham yangilanadi
        setTimeout(() => location.reload(), 400);
    } catch (err) {
        btn.disabled = false;
        if (card) card.style.opacity = '1';
        const m = document.getElementById('admMsg');
        m.hidden = false;
        m.className = 'adm-msg err';
        m.textContent = err.message;
        m.scrollIntoView({ behavior: 'smooth' });
    }
});
</script>
<?php endif; ?>
</body>
</html>
