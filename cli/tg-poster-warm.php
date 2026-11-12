<?php
// CLI-only guard — brauzerdan chaqirilishi mumkin emas (403).
if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('CLI only');
}
// ============================================================================
// cli/tg-poster-warm.php — poster CDN manzillarini oldindan "isitish"
// ----------------------------------------------------------------------------
// NIMA UCHUN:
//   Posterlar bazada `https://t.me/<kanal>/<post>` ko'rinishida saqlanadi.
//   Har bir rasm `api/tg-resolve.php?mode=img` orqali 302 qilib Telegram CDN
//   manziliga aylantiriladi. Sovuq keshda bu ~1.5 s (t.me embed sahifasi),
//   keyin 6 soat keshlanadi.
//
//   Bu skript katalogdagi BARCHA posterlarni bir marta yechib, keshni
//   doim issiq tutadi. Natijada foydalanuvchi sahifani ochganda poster
//   DARHOL keladi va t.me'ga bir vaqtda o'nlab so'rov ketmaydi.
//
// QANDAY ISHLATILADI (cron, har 4 soatda — kesh TTL 6 soat):
//   0 */4 * * * /usr/bin/php /path/to/cli/tg-poster-warm.php >/dev/null 2>&1
//
// Windows (Task Scheduler):
//   C:\xampp\php\php.exe C:\xampp\htdocs\tele_uzdub\cli\tg-poster-warm.php
//
// XAVFSIZLIK: faqat `published` kontent (qoralama/arxiv isitilmaydi).
// ============================================================================
error_reporting(E_ALL & ~E_WARNING & ~E_NOTICE & ~E_DEPRECATED);
ini_set('display_errors', '0');
@set_time_limit(0);

require __DIR__ . '/../includes/bootstrap.php';

$db = Database::getInstance();

$urls = [];
$rows = $db->fetchAll(
    "SELECT poster FROM content
      WHERE status = 'published' AND poster LIKE '%t.me/%'"
);
foreach ($rows as $r) {
    $u = trim((string) ($r['poster'] ?? ''));
    if ($u !== '') {
        $urls[$u] = true;
    }
}

// Reels posterlari ham t.me havolasi bo'lishi mumkin.
$rows = $db->fetchAll(
    "SELECT poster FROM reels WHERE poster LIKE '%t.me/%' ORDER BY id DESC LIMIT 200"
);
foreach ($rows as $r) {
    $u = trim((string) ($r['poster'] ?? ''));
    if ($u !== '') {
        $urls[$u] = true;
    }
}

$total = count($urls);
if ($total === 0) {
    echo "Posterlar yo'q (t.me havolali).\n";
    exit(0);
}

$resolver = new TgResolve();
$ok = 0;
$fail = 0;
$t0 = microtime(true);

foreach (array_keys($urls) as $u) {
    $t = microtime(true);
    $img = $resolver->image($u);
    $ms = (int) round((microtime(true) - $t) * 1000);
    if (is_string($img) && preg_match('#^https?://#i', $img)) {
        $ok++;
        echo "OK   {$ms}ms  {$u}\n";
    } else {
        $fail++;
        echo "FAIL {$ms}ms  {$u}\n";
    }
}

$all = (int) round((microtime(true) - $t0) * 1000);
echo "---\n";
echo "Jami: {$total}  OK: {$ok}  FAIL: {$fail}  vaqt: {$all}ms\n";
