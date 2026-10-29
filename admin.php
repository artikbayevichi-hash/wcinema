<?php
// ============================================================================
// admin.php - ADMIN PANEL (boshqaruv markazi)
// ============================================================================
// Kirish: admin-login.php orqali ADMIN_PANEL_KEY bilan (bir marta).
// Keyin 30 kun davomida imzolangan cookie (wc_adm) ishlaydi.
//
// Bo'limlar: statistika + grafik, kontent, reels, foydalanuvchilar,
// bildirishnoma.
// ============================================================================
require_once __DIR__ . '/includes/bootstrap.php';

// --- Chiqish --------------------------------------------------------------
if (isset($_GET['logout'])) {
    $auth->adminCookieClear();
    unset($_SESSION['wc_admin_ok']);
    header('Location: admin-login.php');
    exit;
}

// --- Himoya ---------------------------------------------------------------
if (!$auth->isAdmin()) {
    $here = (string) ($_SERVER['SCRIPT_NAME'] ?? '/admin.php');
    header('Location: admin-login.php?next=' . rawurlencode($here));
    exit;
}

// --- Statistika -----------------------------------------------------------
$db  = Database::getInstance();
$one = function ($sql, $fallback = 0) use ($db) {
    try {
        $r = $db->fetchOne($sql);
        return $r ? (int) array_values($r)[0] : $fallback;
    } catch (Throwable $e) {
        return $fallback;
    }
};

$nContent   = $one("SELECT COUNT(*) FROM content");
$nEpisodes  = $one("SELECT COUNT(*) FROM episodes");
$nUsers     = $one("SELECT COUNT(*) FROM users");
$nViews     = $one("SELECT COALESCE(SUM(views),0) FROM content");
$nPending   = $one("SELECT COUNT(*) FROM reels WHERE status = 0");
$nReels     = $one("SELECT COUNT(*) FROM reels");
$nToday     = $one("SELECT COUNT(*) FROM users WHERE DATE(created_at) = CURDATE()");

// Tez qo'shish formasi uchun kategoriyalar
$cats = [];
try {
    $cats = $db->fetchAll("SELECT id, name FROM categories ORDER BY sort_order, id");
} catch (Throwable $e) {
    $cats = [];
}
?>
<!DOCTYPE html>
<html lang="uz">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <meta name="robots" content="noindex, nofollow">
    <title>Admin panel — <?php echo htmlspecialchars(SITE_NAME); ?></title>
    <link rel="stylesheet" href="assets/css/admin.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/admin.css') ?: 1; ?>">
</head>
<body>
<div class="wrap">

    <div class="top">
        <picture>
            <source srcset="assets/img/logo.webp" type="image/webp">
            <img src="assets/img/logo.png" alt="">
        </picture>
        <div>
            <h1>Admin panel</h1>
            <div class="sub"><?php echo htmlspecialchars(SITE_NAME); ?></div>
        </div>
        <div class="sp"></div>
        <a class="btn ghost" href="index.php">Saytni ochish</a>
        <a class="btn ghost" href="admin.php?logout=1">Chiqish</a>
    </div>

    <div class="grid">
        <div class="stat"><b><?php echo number_format($nContent, 0, '.', ' '); ?></b><span>Kontent</span></div>
        <div class="stat"><b><?php echo number_format($nEpisodes, 0, '.', ' '); ?></b><span>Qismlar</span></div>
        <div class="stat"><b><?php echo number_format($nUsers, 0, '.', ' '); ?></b><span>Foydalanuvchilar (+<?php echo (int) $nToday; ?> bugun)</span></div>
        <div class="stat"><b><?php echo number_format($nViews, 0, '.', ' '); ?></b><span>Ko'rishlar</span></div>
        <div class="stat<?php echo $nPending > 0 ? ' warn' : ''; ?>"><b><?php echo (int) $nPending; ?></b><span>Kutayotgan reels</span></div>
        <div class="stat"><b><?php echo number_format($nReels, 0, '.', ' '); ?></b><span>Reels (jami)</span></div>
    </div>

    <div class="cards">
        <a class="card" href="admin-content.php">
            <span class="ic">🎬</span>
            <h2>Kontent boshqaruvi</h2>
            <p>Film/anime/multfilm · qismlar · Telegram havola · poster</p>
        </a>
        <a class="card" href="admin-reels.php">
            <span class="ic">📱</span>
            <h2>Reels moderatsiyasi</h2>
            <p>Tasdiqlash · rad etish · o'chirish<?php echo $nPending > 0 ? ' · ' . (int) $nPending . ' ta kutmoqda' : ''; ?></p>
        </a>
        <a class="card" href="admin-users.php">
            <span class="ic">👥</span>
            <h2>Foydalanuvchilar</h2>
            <p>Qidiruv · premium berish · ban / unban</p>
        </a>
        <a class="card" href="admin-notify.php">
            <span class="ic">🔔</span>
            <h2>Bildirishnoma</h2>
            <p>Sayt ichi + Telegram orqali xabar yuborish</p>
        </a>
    </div>

    <div class="panel" style="margin-top:18px">
        <h2 style="font-size:16px;margin:0 0 4px">🎬 Tez qo‘shish — Telegram havola bilan</h2>
        <p class="muted" style="margin:0 0 14px">
            Nom + <code>t.me</code> havola → film darhol katalogda. Qismlar, poster va tavsifni
            keyin “Kontent boshqaruvi” da tahrirlaysiz.
        </p>

        <form id="quickAdd" autocomplete="off">
            <div class="row2">
                <div class="field">
                    <label>Nomi *</label>
                    <input name="title" required maxlength="255" placeholder="Masalan: Interstellar">
                </div>
                <div class="field">
                    <label>Kategoriya *</label>
                    <select name="category_id" required>
                        <?php foreach ($cats as $c): ?>
                            <option value="<?php echo (int) $c['id']; ?>"><?php echo htmlspecialchars((string) $c['name']); ?></option>
                        <?php endforeach; ?>
                    </select>
                </div>
            </div>

            <div class="field">
                <label>Telegram havola * <span class="muted">(t.me/kanal/post)</span></label>
                <input name="first_episode_url" id="qaUrl" required
                       placeholder="https://t.me/wcinemauz/123" inputmode="url">
            </div>

            <div class="row2">
                <div class="field">
                    <label>Turi</label>
                    <select name="is_series" id="qaSeries">
                        <option value="0">Kino / multfilm</option>
                        <option value="1">Serial / anime (qismlar keyin)</option>
                    </select>
                </div>
                <div class="field">
                    <label>Davomiyligi (daqiqa)</label>
                    <input name="first_episode_duration" type="number" min="0" max="600" placeholder="120">
                </div>
            </div>

            <button class="btn" type="submit" id="qaBtn">Qo‘shish</button>
            <span id="qaMsg" class="muted" style="margin-left:10px"></span>
        </form>
    </div>

    <div class="panel" style="margin-top:18px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
            <h2 style="font-size:16px;margin:0">Statistika — oxirgi 14 kun</h2>
            <div class="sp" style="flex:1"></div>
            <span class="muted">▮ yangi foydalanuvchilar · — ko'rishlar</span>
        </div>
        <canvas id="stChart" height="170" style="width:100%;display:block"></canvas>
        <div id="stTop" class="muted" style="margin-top:12px"></div>
    </div>

    <div class="note">
        Kirish 30 kun amal qiladi (imzolangan <code>wc_adm</code> cookie).
        Kalitni almashtirish uchun <code>.env</code> dagi <code>ADMIN_PANEL_KEY</code> ni o'zgartiring — barcha qurilmalar chiqadi.
    </div>
</div>

<script>
(function () {
    var cv = document.getElementById('stChart');
    if (!cv || !cv.getContext) return;
    var ctx = cv.getContext('2d');

    function fit() {
        var dpr = window.devicePixelRatio || 1;
        var w = cv.clientWidth || 800;
        var h = 170;
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        return { w: w, h: h };
    }

    function draw(data) {
        var size = fit();
        var w = size.w, h = size.h;
        var padL = 34, padR = 10, padT = 10, padB = 22;
        var iw = w - padL - padR, ih = h - padT - padB;

        var users = data.users || [], views = data.views || [], days = data.days || [];
        var maxU = Math.max.apply(null, users.concat([1]));
        var maxV = Math.max.apply(null, views.concat([1]));
        var n = days.length || 1;
        var step = iw / n;

        ctx.clearRect(0, 0, w, h);

        // grid
        ctx.strokeStyle = 'rgba(255,255,255,.07)';
        ctx.lineWidth = 1;
        for (var g = 0; g <= 3; g++) {
            var y = padT + ih * g / 3;
            ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
        }

        // bars: users
        for (var i = 0; i < n; i++) {
            var bh = (users[i] / maxU) * ih;
            var x = padL + i * step + step * 0.22;
            var bw = step * 0.56;
            ctx.fillStyle = 'rgba(106,92,255,.75)';
            ctx.beginPath();
            ctx.roundRect ? ctx.roundRect(x, padT + ih - bh, bw, bh, 3)
                          : ctx.rect(x, padT + ih - bh, bw, bh);
            ctx.fill();
        }

        // line: views
        ctx.strokeStyle = 'rgba(70,211,154,.95)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (var j = 0; j < n; j++) {
            var vx = padL + j * step + step / 2;
            var vy = padT + ih - (views[j] / maxV) * ih;
            if (j === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
        }
        ctx.stroke();

        // dots
        ctx.fillStyle = 'rgba(70,211,154,1)';
        for (var k = 0; k < n; k++) {
            var dx = padL + k * step + step / 2;
            var dy = padT + ih - (views[k] / maxV) * ih;
            ctx.beginPath(); ctx.arc(dx, dy, 2.2, 0, Math.PI * 2); ctx.fill();
        }

        // labels (har 3-kun)
        ctx.fillStyle = 'rgba(155,147,173,.9)';
        ctx.font = '10px ui-monospace, Consolas, monospace';
        ctx.textAlign = 'center';
        for (var t = 0; t < n; t += 3) {
            var lx = padL + t * step + step / 2;
            var lbl = (days[t] || '').slice(5);
            ctx.fillText(lbl, lx, h - 6);
        }
    }

    fetch('api/admin-stats.php?days=14', { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
            if (!d || !d.success) return;
            draw(d);
            if (d.top && d.top.length) {
                var lines = d.top.map(function (t, i) {
                    return (i + 1) + '. ' + t.title + ' — ' + t.views + ' ko\'rish';
                });
                document.getElementById('stTop').textContent = 'Eng ko\'p ko\'rilgan: ' + lines.join(' · ');
            }
        })
        .catch(function () { /* grafik ixtiyoriy */ });

    window.addEventListener('resize', function () {
        fetch('api/admin-stats.php?days=14', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (d) { if (d && d.success) draw(d); })
            .catch(function () {});
    });
})();
</script>

<script>
/* Tez qo'shish — api/content-admin.php ga `create_content` yuboradi. */
(function () {
    var form = document.getElementById('quickAdd');
    if (!form) return;

    var btn  = document.getElementById('qaBtn');
    var msg  = document.getElementById('qaMsg');
    var url  = document.getElementById('qaUrl');
    var ser  = document.getElementById('qaSeries');

    // Serialda video keyin qo'shiladi — havolani majburiy qilmaymiz.
    function syncReq() {
        url.required = ser.value !== '1';
    }
    ser.addEventListener('change', syncReq);
    syncReq();

    form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        msg.textContent = 'Yuborilmoqda…';
        btn.disabled = true;

        var fd = new FormData(form);
        fd.append('action', 'create_content');

        fetch('api/content-admin.php', {
            method: 'POST',
            body: fd,
            credentials: 'same-origin'
        })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (d && d.success) {
                    msg.textContent = '✅ Qo‘shildi (ID ' + d.id + ') — tahrirlashga o‘tilmoqda…';
                    form.reset();
                    setTimeout(function () {
                        location.href = 'admin-content.php';
                    }, 900);
                } else {
                    msg.textContent = '⚠️ ' + ((d && d.message) || 'Xatolik');
                }
            })
            .catch(function () {
                msg.textContent = '⚠️ Tarmoq xatosi — qayta urinib ko‘ring';
            })
            .finally(function () {
                btn.disabled = false;
            });
    });
})();
</script>
</body>
</html>
