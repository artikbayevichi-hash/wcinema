<?php
// ============================================================================
// api/admin-stats.php - admin panel uchun statistika (JSON)
// ============================================================================
//   GET ?days=14
//   -> { ok, days:[...], users:[...], views:[...], reels:[...],
//        top:[{id,title,views}], totals:{...} }
// ============================================================================
require_once __DIR__ . '/../includes/bootstrap.php';

if (!$auth->isAdmin()) {
    Auth::fail('Faqat admin', 403);
}

$days = (int) (inputInt('days', 14));
if ($days < 7)  { $days = 7; }
if ($days > 60) { $days = 60; }

$db = Database::getInstance();

// Kunlar ro'yxati (bo'sh kunlar ham 0 bo'lib chiqadi).
$labels = [];
$idx    = [];
$start  = new DateTime('-' . ($days - 1) . ' days');
for ($i = 0; $i < $days; $i++) {
    $d = (clone $start)->modify('+' . $i . ' day')->format('Y-m-d');
    $labels[] = $d;
    $idx[$d] = $i;
}

$series = function ($sql, $col = 'n') use ($db, $labels, $idx) {
    $out = array_fill(0, count($labels), 0);
    try {
        foreach ($db->fetchAll($sql) as $r) {
            $d = (string) $r['d'];
            if (isset($idx[$d])) {
                $out[$idx[$d]] = (int) $r[$col];
            }
        }
    } catch (Throwable $e) { /* jadval yo'q bo'lishi mumkin */ }
    return $out;
};

$since = $labels[0] . ' 00:00:00';

$users = $series(
    "SELECT DATE(created_at) AS d, COUNT(*) AS n
       FROM users
      WHERE created_at >= '$since'
      GROUP BY DATE(created_at)"
);

$views = $series(
    "SELECT DATE(watched_at) AS d, COUNT(*) AS n
       FROM watch_history
      WHERE watched_at >= '$since'
      GROUP BY DATE(watched_at)"
);

$reels = $series(
    "SELECT DATE(created_at) AS d, COUNT(*) AS n
       FROM reels
      WHERE created_at >= '$since'
      GROUP BY DATE(created_at)"
);

$top = [];
try {
    $top = $db->fetchAll(
        "SELECT id, title, COALESCE(views,0) AS views
           FROM content
          ORDER BY views DESC, id DESC
          LIMIT 5"
    );
} catch (Throwable $e) { $top = []; }

$totalUsers   = (int) ($db->fetchOne("SELECT COUNT(*) n FROM users")['n'] ?? 0);
$totalViews   = (int) ($db->fetchOne("SELECT COALESCE(SUM(views),0) v FROM content")['v'] ?? 0);
$totalContent = (int) ($db->fetchOne("SELECT COUNT(*) n FROM content")['n'] ?? 0);
$pendingReels = (int) ($db->fetchOne("SELECT COUNT(*) n FROM reels WHERE status = 0")['n'] ?? 0);

Auth::ok([
    'days'   => $labels,
    'users'  => $users,
    'views'  => $views,
    'reels'  => $reels,
    'top'    => array_map(function ($r) {
        return [
            'id'    => (int) $r['id'],
            'title' => (string) $r['title'],
            'views' => (int) $r['views'],
        ];
    }, $top ?: []),
    'totals' => [
        'users'   => $totalUsers,
        'views'   => $totalViews,
        'content' => $totalContent,
        'pending' => $pendingReels,
    ],
]);
