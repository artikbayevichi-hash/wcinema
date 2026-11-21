<?php
// CLI-only guard — brauzerdan chaqirilishi mumkin emas (403).
if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('CLI only');
}
// ============================================================================
// cli/tg-meta-backfill.php — barcha videolar metama'lumotini BAZAGA to'ldirish
// ----------------------------------------------------------------------------
// Admin qo'shgan videolar (episodes) va reels ichidagi hamma `t.me` havolalari
// Telegram'dan yechilib, `telegram_meta` jadvaliga yoziladi.
//
// ISHLATISH:
//   C:\xampp\php\php.exe C:\xampp\htdocs\tele_uzdub\cli\tg-meta-backfill.php
//   php cli/tg-meta-backfill.php --force     # eski yozuvlarni ham yangilash
//
// Xavfsiz: video baytlari yuklanmaydi — faqat ~300 bayt metama'lumot olinadi.
// Bot kanalga a'zo/admin bo'lishi kerak (TgPull session settings).
// ============================================================================

require_once __DIR__ . '/../includes/bootstrap.php';
require_once __DIR__ . '/../includes/TgMeta.php';

TgMeta::ensure();
$force = in_array('--force', array_slice($argv, 1), true);
$db = Database::getInstance();

// 1) Katalogdagi hamma Telegram havolalari (episodes + reels).
$pairs = [];
foreach (['episodes', 'reels'] as $tbl) {
    $rows = $db->fetchAll(
        "SELECT video_url FROM `{$tbl}` WHERE video_url LIKE '%t.me%' LIMIT 5000"
    );
    foreach ($rows as $r) {
        $ref = TgMeta::parseUrl($r['video_url'] ?? '');
        if (!$ref) continue;
        $pairs[$ref['channel'] . '/' . $ref['post']] = [
            'ch' => $ref['channel'], 'post' => $ref['post'],
        ];
    }
}

if (!$pairs) {
    echo "Telegram havolasi topilmadi.\n";
    exit(0);
}

// 2) Bazada allaqachon bor va yangi bo'lganlarini o'tkazamiz.
$need = [];
foreach ($pairs as $key => $p) {
    $m = TgMeta::get($p['ch'], $p['post']);
    if (!$force && $m && (time() - (int) ($m['t'] ?? 0)) < 3600) {
        continue;   // 1 soatdan yangi — qayta olmaymiz
    }
    $need[] = $p;
}

echo "Jami video: " . count($pairs) . " | yangilash kerak: " . count($need) . "\n";
if (!$need) {
    echo "Hammasi bazada yangi.\n";
    exit(0);
}

// 3) 100 tadan guruhlash: bitta sessiya, kanal boshiga bitta RPC.
$done = 0;
foreach (array_chunk($need, 100) as $batch) {
    $n = TgMeta::fetchManyAndStore($batch, 300);
    $done += $n;
    echo "Saqlandi: {$n}/" . count($batch) . " (jami {$done})\n";
}

// 4) Yakuniy holat.
$ok = (int) ($db->fetchOne("SELECT COUNT(*) AS n FROM `telegram_meta` WHERE `status`='ok'")['n'] ?? 0);
$er = (int) ($db->fetchOne("SELECT COUNT(*) AS n FROM `telegram_meta` WHERE `status`='error'")['n'] ?? 0);
$pe = (int) ($db->fetchOne("SELECT COUNT(*) AS n FROM `telegram_meta` WHERE `status`='pending'")['n'] ?? 0);
echo "Bazada: ok={$ok}, error={$er}, pending={$pe}\n";
