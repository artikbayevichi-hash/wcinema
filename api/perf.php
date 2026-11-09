<?php
// ============================================================================
// api/perf.php — video ochilish tezligi metrikasi
// ----------------------------------------------------------------------------
// Ikki vazifa:
//   1) POST (beacon) — brauzerdan o'lchov qabul qilish. Autentifikatsiya YO'Q:
//      mehmon ham video ko'radi, uning o'lchovi ham kerak. Xavfsizlik uchun
//      maydonlar oq ro'yxat bilan cheklanadi va qiymatlar tekshiriladi.
//   2) GET ?stats=1&key=... — admin uchun p50/p95 hisoboti.
//
// Bu fayl ATAYIN yengil: to'liq bootstrap (Auth + Catalog + Reels) har bir
// beacon'da og'ir bo'lardi va o'lchovning o'zini sekinlashtirardi. Shuning
// uchun faqat config + Database.
//
// Sozlash: ADMIN_PANEL_KEY .env da bo'lishi kerak (statistika uchun).
// ============================================================================

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../includes/Database.php';

$db = Database::getInstance();

// Jadval yo'q bo'lsa (migratsiya hali ishga tushirilmagan) — jim 204.
// Beacon uchun bu MUHIM: xato qaytsa brauzer konsolida shovqin bo'ladi.
function perf_table_ready($db) {
    static $ready = null;
    if ($ready !== null) return $ready;
    try {
        $db->fetchOne("SELECT 1 FROM perf_events LIMIT 1");
        $ready = true;
    } catch (Throwable $e) {
        $ready = false;
    }
    return $ready;
}

$method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));

// ---------------------------------------------------------------- STATISTIKA
if ($method === 'GET' && isset($_GET['stats'])) {
    header('Content-Type: application/json; charset=utf-8');

    $key    = (string) ($_GET['key'] ?? '');
    $secret = defined('ADMIN_PANEL_KEY') ? (string) ADMIN_PANEL_KEY : (string) env_value('ADMIN_PANEL_KEY', '');
    if ($secret === '' || !hash_equals($secret, $key)) {
        http_response_code(403);
        echo json_encode(['success' => false, 'error' => 'Ruxsat yo\'q']);
        exit;
    }
    if (!perf_table_ready($db)) {
        echo json_encode(['success' => true, 'rows' => 0, 'note' => 'perf_events jadvali yo\'q']);
        exit;
    }

    $days = max(1, min(90, (int) ($_GET['days'] ?? 7)));
    $rows = $db->fetchAll(
        "SELECT page, net, ttfb_ms, first_frame_ms, canplay_ms, err
           FROM perf_events
          WHERE ts >= (NOW() - INTERVAL ? DAY)
          ORDER BY id DESC
          LIMIT 20000",
        [$days]
    );

    $pick = function ($arr) {
        if (!$arr) return null;
        sort($arr, SORT_NUMERIC);
        $n = count($arr);
        return [
            'n'    => $n,
            'p50'  => $arr[(int) floor($n * 0.50)] ?? null,
            'p90'  => $arr[(int) floor($n * 0.90)] ?? null,
            'p95'  => $arr[min($n - 1, (int) floor($n * 0.95))] ?? null,
            'max'  => $arr[$n - 1] ?? null,
            'avg'  => (int) round(array_sum($arr) / max(1, $n)),
        ];
    };

    $byPage = [];
    $ff = [];
    $ttfb = [];
    $cp = [];
    $errs = [];
    $net = [];
    foreach ($rows as $r) {
        $p = (string) $r['page'];
        $byPage[$p]['first_frame'][] = (int) $r['first_frame_ms'];
        if ((int) $r['ttfb_ms'] > 0)        $ttfb[] = (int) $r['ttfb_ms'];
        if ((int) $r['first_frame_ms'] > 0) $ff[]   = (int) $r['first_frame_ms'];
        if ((int) $r['canplay_ms'] > 0)     $cp[]   = (int) $r['canplay_ms'];
        if ((string) $r['err'] !== '')      $errs[(string) $r['err']] = ($errs[(string) $r['err']] ?? 0) + 1;
        $net[(string) $r['net']] = ($net[(string) $r['net']] ?? 0) + 1;
    }
    $pages = [];
    foreach ($byPage as $p => $v) {
        $pages[$p] = $pick($v['first_frame'] ?: []);
    }

    echo json_encode([
        'success'     => true,
        'days'        => $days,
        'rows'        => count($rows),
        'ttfb'        => $pick($ttfb),
        'first_frame' => $pick($ff),
        'canplay'     => $pick($cp),
        'by_page'     => $pages,
        'net'         => $net,
        'errors'      => $errs,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// ------------------------------------------------------------------- BEACON |
if ($method !== 'POST') {
    http_response_code(405);
    exit;
}

if (!perf_table_ready($db)) {
    http_response_code(204);
    exit;
}

// `sendBeacon` bilan `URLSearchParams` (text/plain) yoki JSON kelishi mumkin.
$raw = file_get_contents('php://input');
$in  = $_POST;
if (is_string($raw) && $raw !== '' && $raw[0] === '{') {
    $j = json_decode($raw, true);
    if (is_array($j)) $in = $j;
}

$num = function ($k, $max = 3600000) use ($in) {
    $v = $in[$k] ?? 0;
    if (!is_numeric($v)) return 0;
    $v = (int) round((float) $v);
    return max(0, min($max, $v));
};
$str = function ($k, $len = 40) use ($in) {
    $v = (string) ($in[$k] ?? '');
    $v = preg_replace('/[^\w\-\/\.:@]/u', '', $v);
    return substr($v, 0, $len);
};

$page = $str('page', 40);
if ($page === '') $page = 'other';

$err = $str('err', 120);

try {
    $db->insert('perf_events', [
        'page'           => $page,
        'content_id'     => min(2147483647, $num('content_id')),
        'episode_id'     => min(2147483647, $num('episode_id')),
        'doc_id'         => max(0, (int) ($in['doc_id'] ?? 0)),
        'net'            => $str('net', 16),
        'save_data'      => $num('save_data') ? 1 : 0,
        'ttfb_ms'        => $num('ttfb'),
        'first_frame_ms' => $num('first_frame'),
        'canplay_ms'     => $num('canplay'),
        'err'            => $err,
        'ua'             => substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 160),
    ]);
} catch (Throwable $e) {
    // Jim — beacon hech qachon sahifani bu zmaydi.
}

// 1% ehtimol bilan 30 kundan eski yozuvlarni tozalaymiz (cron shart emas).
if (random_int(1, 100) === 1) {
    try {
        $db->query("DELETE FROM perf_events WHERE ts < (NOW() - INTERVAL 30 DAY) LIMIT 5000");
    } catch (Throwable $e) { /* jim */ }
}

http_response_code(204);
