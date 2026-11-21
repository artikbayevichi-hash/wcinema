<?php
// CLI-only guard — brauzerdan chaqirilishi mumkin emas (403).
if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('CLI only');
}
// ============================================================================
// cli/tg-poster-backfill.php — eski qismlarga Telegram posteri (faylsiz)
// ============================================================================
// Yangi videolar posterini `api/content-admin.php` avtomatik qo'yadi. Bu skript
// ESKI qismlar uchun ham shuni qiladi: `episodes.thumbnail` bo'sh bo'lsa, unga
// lokal `api/tg-thumb.php?ch=...&post=...` manzili yoziladi. Hech qanday rasm
// fayli yuklanmaydi; kadr Telegram hujjatidan olinadi.
//
// ISHLATISH:
//   C:\xampp\php\php.exe C:\xampp\htdocs\tele_uzdub\cli\tg-poster-backfill.php
//   ... --fetch     qo'shimcha: kadrlarni Telegram'dan oldindan olib keshga qo'yadi
//                   (tarmoq mavjud bo'lganda; sekin bo'lishi mumkin).
// ============================================================================
error_reporting(E_ALL & ~E_WARNING & ~E_NOTICE & ~E_DEPRECATED);
ini_set('display_errors', '0');
@set_time_limit(0);

require __DIR__ . '/../includes/bootstrap.php';

$db   = Database::getInstance();
$fetch = in_array('--fetch', $argv ?? [], true);

$rows = $db->fetchAll(
    "SELECT id, content_id, video_url FROM episodes
      WHERE video_url LIKE '%t.me%'
        AND (thumbnail IS NULL OR thumbnail = '')
      ORDER BY content_id, season, episode_number"
);

$done = 0;
$skipped = 0;
$contents = [];
foreach ($rows as $r) {
    $url = trim((string) ($r['video_url'] ?? ''));
    $poster = Catalog::telegramThumbPoster($url);
    if (!$poster) {
        $skipped++;
        continue;
    }
    $db->update('episodes', ['thumbnail' => $poster], 'id = ?', [(int) $r['id']]);
    $done++;
    $contents[(int) $r['content_id']] = true;

    if ($fetch) {
        try { TgMeta::fetchAndStore($url, 5); } catch (\Throwable $e) {}
    }
}

// Kontent posteri ham bo'sh bo'lsa — birinchi qismning posterini qo'yamiz.
$contentDone = 0;
foreach (array_keys($contents) as $cid) {
    $c = $db->fetchOne("SELECT poster FROM content WHERE id = ?", [$cid]);
    if (!$c || trim((string) ($c['poster'] ?? '')) !== '') {
        continue;
    }
    $ep = $db->fetchOne(
        "SELECT thumbnail FROM episodes
          WHERE content_id = ? AND thumbnail LIKE '%api/tg-thumb.php%'
          ORDER BY season, episode_number LIMIT 1",
        [$cid]
    );
    if ($ep && $db->update('content', ['poster' => (string) $ep['thumbnail']], 'id = ?', [$cid])) {
        $contentDone++;
    }
}

echo "Qismlarga poster yozildi: {$done}\n";
echo "O'tkazib yuborildi (t.me emas): {$skipped}\n";
echo "Kontent posteri to'ldirildi: {$contentDone}\n";
echo $fetch ? "Kadrlar Telegram'dan oldindan olindi (imkon qadar).\n"
            : "Kadrlar birinchi ko'rishda api/tg-thumb.php tomonidan olinadi.\n";
