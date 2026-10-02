<?php
// ============================================================================
// notifications.php - Instagram uslubidagi bildirishnomalar
// ============================================================================
//   * "Yoqtirishlar" - reelslarimga tushgan yoqtirishlar (reel_likes -> reels)
//   * "Reelslarim holati" - kutilmoqda / tasdiqlandi / rad etildi (admin qarori)
//
// Kirish talab qilinadi: mehmon login.php ga yo'naltiriladi.
// ============================================================================
require_once __DIR__ . '/includes/bootstrap.php';

$user   = $auth->getCurrentUser();
$userId = $user ? (int) $user['id'] : null;

if (!$userId) {
    header('Location: login.php');
    exit;
}

$db    = Database::getInstance();
$likes = $db->fetchAll(
    "SELECT l.created_at                  AS at,
            r.id            AS reel_id,
            r.title         AS reel_title,
            u.id            AS who_id,
            u.first_name    AS who,
            u.username      AS who_u,
            u.avatar        AS who_av
     FROM reel_likes l
     JOIN reels r ON r.id = l.reel_id AND r.user_id = ?
     JOIN users u ON u.id = l.user_id
     ORDER BY l.created_at DESC
     LIMIT 40",
    [(int) $userId]
);

$myReels = $db->fetchAll(
    "SELECT id, title, status, reject_reason, updated_at
     FROM reels WHERE user_id = ?
     ORDER BY updated_at DESC
     LIMIT 20",
    [(int) $userId]
);

/**
 * MySQL datetime -> "hozirgina / N daqiqa oldin / sana".
 */
function ig_time_ago($dt) {
    $t = strtotime((string) $dt);
    if (!$t) { return ''; }
    $diff = time() - $t;
    if ($diff < 60)          { return 'hozirgina'; }
    if ($diff < 3600)        { return floor($diff / 60) . ' daqiqa oldin'; }
    if ($diff < 86400)       { return floor($diff / 3600) . ' soat oldin'; }
    if ($diff < 172800)      { return 'kecha'; }
    return date('d.m.Y', $t);
}

function ig_ntf_avatar(array $u) {
    if (!empty($u['who_av'])) {
        return '<img src="' . esc($u['who_av']) . '" alt="">';
    }
    $ch = mb_strtoupper(mb_substr($u['who'] ?? '?', 0, 1)) ?: '?';
    return esc($ch);
}
?>
<!DOCTYPE html>
<html lang="uz">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <title>Bildirishnomalar — <?php echo htmlspecialchars(SITE_NAME); ?></title>
    <link rel="stylesheet" href="assets/css/style.css">
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
<body class="ig-shell">

<!-- Instagram uslubidagi navigatsiya -->
<?php $NAV_ACTIVE = 'notifications'; require __DIR__ . '/includes/nav.php'; ?>

<main class="ig-page">
    <h1 class="ig-page-title">🔔 Bildirishnomalar</h1>

    <?php if (!$likes && !$myReels): ?>
        <div class="ntf-row" style="justify-content:center;text-align:center;padding:40px 16px;color:var(--muted)">
            <div>
                <div style="font-size:42px;margin-bottom:10px">🔕</div>
                Hozircha bildirishnomalar yo'q.<br>
                Reels yuklang va yoqtirishlarni kuzating!
            </div>
        </div>
    <?php endif; ?>

    <?php if ($likes): ?>
        <div class="ntf-group-title">❤️ Yoqtirishlar</div>
        <?php foreach ($likes as $l): ?>
            <div class="ntf-row">
                <a class="ntf-avatar" href="profile.php?user_id=<?php echo (int) $l['who_id']; ?>"><?php echo ig_ntf_avatar($l); ?></a>
                <div class="ntf-body">
                    <div class="ntf-text">
                        <b><?php echo esc($l['who'] ?: 'Kimdir'); ?></b>
                        reelsingizni yoqtirdi:
                        <a href="reels.php?reel=<?php echo (int) $l['reel_id']; ?>"
                           style="color:var(--accent);font-weight:600">
                            <?php echo esc($l['reel_title'] ?: '#' . $l['reel_id']); ?>
                        </a>
                    </div>
                    <div class="ntf-time"><?php echo esc(ig_time_ago($l['at'])); ?></div>
                </div>
                <span class="ntf-emoji">❤️</span>
            </div>
        <?php endforeach; ?>
    <?php endif; ?>

    <?php if ($myReels): ?>
        <div class="ntf-group-title">🎬 Reelslarim holati</div>
        <?php foreach ($myReels as $r):
            $st = (int) $r['status'];
            $badge = $st === 1 ? '✅ Tasdiqlandi' : ($st === 2 ? '❌ Rad etildi' : '⏳ Kutilmoqda');
            $color = $st === 1 ? 'var(--ok)' : ($st === 2 ? 'var(--accent-2)' : 'var(--gold)');
        ?>
            <div class="ntf-row">
                <a class="ntf-avatar" href="reels.php?reel=<?php echo (int) $r['id']; ?>">
                    🎬
                </a>
                <div class="ntf-body">
                    <div class="ntf-text">
                        <a href="reels.php?reel=<?php echo (int) $r['id']; ?>" style="font-weight:600">
                            <?php echo esc($r['title'] ?: '#' . $r['id']); ?>
                        </a>
                        <span style="color:<?php echo $color; ?>;font-weight:700"> · <?php echo $badge; ?></span>
                    </div>
                    <?php if ($st === 2 && $r['reject_reason']): ?>
                        <div class="ntf-time" style="color:var(--accent-2)">Sabab: <?php echo esc($r['reject_reason']); ?></div>
                    <?php endif; ?>
                    <div class="ntf-time"><?php echo esc(ig_time_ago($r['updated_at'])); ?></div>
                </div>
            </div>
        <?php endforeach; ?>
    <?php endif; ?>
</main>

</body>
</html>