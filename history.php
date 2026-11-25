<?php
// ============================================================================
// history.php — "Tarix" (YouTube uslubidagi RO'YXAT)
// ============================================================================
// Ko'rish tarixi: server (watch_history + watch_progress, yoki wc_cs cookie
// orqali kirgan MTProto hisobi) VA brauzer kutubxonasi (WCLib) BIR sahifada
// birlashtiriladi. MTProto foydalanuvchilari endi profile.php?tab=history ga
// yo'naltirilmaydi.
//
// Fayl oqimiga tegmaymiz — faqat ro'yxat/kartochka UI.
// ============================================================================
require_once __DIR__ . '/includes/bootstrap.php';

// clientUserId() ham PHP sessiyasini, ham imzolangan `wc_cs` cookieni ko'radi.
$viewerId = (int) clientUserId();

// --- Serverdagi tarix (qism va progress ma'lumoti bilan) -------------------
$serverItems = [];
if ($viewerId > 0) {
    $db = Database::getInstance();
    $rows = $db->fetchAll(
        "SELECT h.content_id, h.episode_id, UNIX_TIMESTAMP(h.watched_at) * 1000 AS at,
                c.title, c.poster, c.description, c.release_year,
                cat.name AS category_name, cat.slug AS category_slug,
                COALESCE(wp.position_seconds, wp0.position_seconds) AS position_seconds,
                COALESCE(wp.duration_seconds, wp0.duration_seconds) AS duration_seconds,
                e.season, e.episode_number, e.title AS episode_title, e.duration AS episode_duration
         FROM watch_history h
         JOIN content c ON c.id = h.content_id AND c.status = 'published'
         LEFT JOIN categories cat ON cat.id = c.category_id
         LEFT JOIN watch_progress wp ON wp.user_id = h.user_id
              AND wp.content_id = h.content_id AND wp.episode_id = h.episode_id
         LEFT JOIN watch_progress wp0 ON wp0.user_id = h.user_id
              AND wp0.content_id = h.content_id AND wp0.episode_id = 0
         LEFT JOIN episodes e ON e.id = h.episode_id
         WHERE h.user_id = ?
         ORDER BY h.watched_at DESC
         LIMIT 200",
        [$viewerId]
    );

    foreach ($rows as $r) {
        $dur = (int) ($r['duration_seconds'] ?? 0);
        if ($dur <= 0) { $dur = (int) ($r['episode_duration'] ?? 0); }

        $ep = '';
        if ((int) ($r['episode_id'] ?? 0) > 0) {
            $bits = [];
            if ((int) ($r['season'] ?? 0) > 0) { $bits[] = (int) $r['season'] . '-fasl'; }
            if ((int) ($r['episode_number'] ?? 0) > 0) { $bits[] = (int) $r['episode_number'] . '-qism'; }
            if (!empty($r['episode_title'])) { $bits[] = (string) $r['episode_title']; }
            $ep = implode(' · ', $bits);
        }

        $serverItems[] = [
            'type'      => 'content',
            'id'        => (int) $r['content_id'],
            'episode_id'=> (int) ($r['episode_id'] ?? 0),
            'title'     => (string) ($r['title'] ?? ''),
            'poster'    => Catalog::resolvePoster(
                $r['poster'] ?? '',
                $r['title'] ?? '',
                $r['category_slug'] ?? '',
                $r['category_name'] ?? ''
            ),
            'category'  => (string) ($r['category_name'] ?? ''),
            'year'      => (string) ($r['release_year'] ?? ''),
            'desc'      => mb_substr(strip_tags((string) ($r['description'] ?? '')), 0, 160),
            'episode'   => $ep,
            'duration'  => $dur,
            'position'  => (int) ($r['position_seconds'] ?? 0),
            'at'        => (int) $r['at'],
        ];
    }
}

$serverJson = json_encode($serverItems, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
    | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);
if (!is_string($serverJson)) { $serverJson = '[]'; }
?>
<!DOCTYPE html>
<html lang="uz">
<head>
    <link rel="icon" type="image/png" href="assets/img/favicon.png?v=<?php echo @filemtime(__DIR__ . '/assets/img/favicon.png') ?: 1; ?>">
    <link rel="apple-touch-icon" href="assets/img/apple-touch-icon.png?v=<?php echo @filemtime(__DIR__ . '/assets/img/apple-touch-icon.png') ?: 1; ?>">
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <title>Tarix &mdash; <?php echo htmlspecialchars(SITE_NAME); ?></title>
    <link rel="stylesheet" href="assets/css/style.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/style.css') ?: 1; ?>">
    <link rel="stylesheet" href="assets/css/instagram.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/instagram.css') ?: 1; ?>">
    <?php require __DIR__ . '/includes/tv-head.php'; ?>
    <style>
    /* YouTube uslubidagi ro'yxat — faqat oq/qora palette. CSS fayliga tegmaymiz. */
    .wcl-wrap { max-width: 980px; margin: 0 auto; padding: 4px 4px 24px; }
    .wcl-head { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin:2px 0 12px; }
    .wcl-head h1 { font-size:20px; font-weight:800; margin:0; }
    .wcl-count { font-size:13px; color:var(--muted); }
    .wcl-tools { display:flex; gap:8px; flex-wrap:wrap; margin:0 0 14px; }
    .wcl-btn {
        display:inline-flex; align-items:center; gap:6px;
        padding:8px 12px; border:1px solid var(--line); border-radius:999px;
        background:var(--card); color:var(--text);
        font:600 12px/1 inherit; cursor:pointer; white-space:nowrap;
    }
    .wcl-btn:hover { background:var(--card-2); }
    .wcl-btn.on { background:var(--text); color:var(--bg); border-color:var(--text); }
    .wcl-search {
        flex:1 1 200px; min-width:150px;
        padding:9px 12px; border:1px solid var(--line); border-radius:999px;
        background:var(--card); color:var(--text); font:13px inherit;
    }
    .wcl-search::placeholder { color:var(--muted); }
    .wcl-group {
        margin:18px 2px 9px; font-size:12px; font-weight:800;
        text-transform:uppercase; letter-spacing:.6px; color:var(--muted);
    }
    .wcl-row {
        display:flex; align-items:flex-start; gap:12px;
        padding:10px; margin-bottom:8px;
        border:1px solid var(--line); border-radius:12px; background:var(--card);
    }
    .wcl-row:hover { background:var(--card-2); }
    .wcl-thumb {
        position:relative; flex:0 0 180px; aspect-ratio:16/9;
        border-radius:8px; overflow:hidden; background:#000;
        text-decoration:none; color:var(--text);
    }
    .wcl-thumb img, .wcl-ph {
        width:100%; height:100%; object-fit:cover; display:flex;
        align-items:center; justify-content:center; font-size:26px; color:var(--muted);
    }
    .wcl-ph[hidden] { display:none; }
    .wcl-dur {
        position:absolute; right:5px; bottom:5px; padding:1px 5px;
        border-radius:4px; background:rgba(0,0,0,.84); color:#fff;
        font:600 11px/1.5 inherit;
    }
    .wcl-prog {
        position:absolute; left:0; right:0; bottom:0; height:4px;
        background:rgba(255,255,255,.25);
    }
    .wcl-prog i { display:block; height:100%; background:#fff; }
    .wcl-body { flex:1; min-width:0; text-decoration:none; color:var(--text); }
    .wcl-title { font-size:15px; font-weight:700; line-height:1.35; margin-bottom:3px; }
    .wcl-meta { font-size:12px; color:var(--muted); margin-bottom:4px; }
    .wcl-desc {
        font-size:12px; color:var(--muted); line-height:1.4;
        display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;
    }
    .wcl-x {
        flex:0 0 auto; width:30px; height:30px; border:1px solid var(--line);
        border-radius:50%; background:transparent; color:var(--muted);
        font-size:14px; cursor:pointer;
    }
    .wcl-x:hover { background:var(--text); color:var(--bg); border-color:var(--text); }
    .wcl-empty {
        padding:40px 16px; text-align:center; color:var(--muted);
        border:1px solid var(--line); border-radius:12px; background:var(--card);
    }
    .wcl-empty[hidden] { display:none; }
    .wcl-note { font-size:11px; color:var(--muted); margin:-4px 0 12px; }
    @media (max-width:600px) {
        .wcl-thumb { flex-basis:136px; }
        .wcl-title { font-size:14px; }
    }
    </style>
    <!-- Telegram Web App — FAQAT Telegram ilovasi ichida kerak. -->
    <script>
    (function () {
      if (!/Telegram/i.test(navigator.userAgent)
          && !/tgWebAppData/.test(location.href)) return;
      var s = document.createElement('script');
      s.src = 'https://telegram.org/js/telegram-web-app.js';
      document.head.appendChild(s);
    })();
    </script>
</head>
<body class="ig-shell" data-wc-list="history">

<?php $NAV_ACTIVE = 'history'; require __DIR__ . '/includes/nav.php'; ?>

<main class="wcl-wrap">
    <div class="wcl-head">
        <h1>&#128336; Tarix</h1>
        <span class="wcl-count" id="wcCount"></span>
    </div>

    <div class="wcl-tools">
        <input class="wcl-search" id="wcSearch" type="search" placeholder="Tarixda qidirish…"
               aria-label="Tarixda qidirish" autocomplete="off">
        <button type="button" class="wcl-btn" id="wcPlayAll">&#9654; Hammasini ijro etish</button>
        <button type="button" class="wcl-btn" id="wcShuffle">&#10227; Arallashtirish</button>
        <button type="button" class="wcl-btn" id="wcPause">&#10074;&#10074; Tarixni to'xtatib turish</button>
        <button type="button" class="wcl-btn" id="wcClear">Butun tarixni tozalash</button>
    </div>
    <p class="wcl-note">
        O'chirish va to'xtatib turish faqat shu brauzerda saqlanadi: tarixni yozib olish
        oqimiga tegmaymiz, shuning uchun eski yozuvlar serverda qolishi mumkin.
    </p>

    <div id="wcList"></div>
    <div class="wcl-empty" id="wcEmpty" hidden>
        <div style="font-size:40px;margin-bottom:8px">&#128336;</div>
        Tarix bo'sh — biror filmni ko'rishni boshlang.<br>
        <a href="index.php" style="color:var(--text);font-weight:700;text-decoration:underline">Katalogga o'tish</a>
    </div>
</main>

<script id="wcServerData" type="application/json"><?php echo $serverJson; ?></script>
<script src="assets/js/wc-lib.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/wc-lib.js') ?: 1; ?>"></script>
<script src="assets/js/wc-list.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/wc-list.js') ?: 1; ?>"></script>
</body>
</html>
