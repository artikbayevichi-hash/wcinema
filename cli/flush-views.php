<?php
// CLI-only guard — brauzerdan chaqirilishi mumkin emas (403).
if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('CLI only');
}
// ============================================================================
// cli/flush-views.php — yig'ilgan ko'rishlar sonini bazaga yozadi
// ============================================================================
// `ViewCounter` ko'rishlar sonini daqiqada bir marta yig'ib yangilaydi, lekin
// bu faqat saytga so'rov kelganda sodir bo'ladi. Kechasi trafik bo'lmasa,
// `content.views` eski holicha qolib ketishi mumkin.
//
// Bu skript cron/systemd timer orqali har daqiqada ishga tushadi va
// kutilayotgan yozuvlarni MAJBURAN yozadi.
//
//   php cli/flush-views.php            # bir marta yozadi
//   php cli/flush-views.php --dry-run  # faqat nechta kutayotganini aytadi
// ============================================================================
error_reporting(E_ALL);
ini_set('display_errors', '1');

require __DIR__ . '/../config.php';
require_once __DIR__ . '/../includes/Database.php';
require_once __DIR__ . '/../includes/ViewCounter.php';

$dry = in_array('--dry-run', $argv ?? [], true);
$pending = ViewCounter::pendingCount();

if ($dry) {
    echo 'Kutilmoqda: ' . $pending . " kontent\n";
    exit(0);
}
if ($pending === 0) {
    exit(0);
}

$done = ViewCounter::flushIfDue(true);
echo '[' . date('Y-m-d H:i:s') . '] views flush: ' . $done . '/' . $pending . " yangilandi\n";
