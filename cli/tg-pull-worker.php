<?php
// ============================================================================
// cli/tg-pull-worker.php - Telegram'dan video yuklab olish (CLI ishchi).
// ============================================================================
// api/tg-pull.php tomonidan ajratilgan jarayonda ishga tushiriladi. Holati
// storage/mtproto/job_<id>.json faylida: status= running|done|error,
// progress=0..100. API shu faylni o'qib admin panelga natijani beradi.
//
// Ishga tushirish (admin API avtomatik qiladi):
//   php cli/tg-pull-worker.php "<t.me url>" "<job id>"
// ============================================================================
error_reporting(E_ALL);
ini_set('display_errors', '1');

require __DIR__ . '/../includes/bootstrap.php';
require_once __DIR__ . '/../includes/TgPull.php';

$url = $argv[1] ?? '';
$job = $argv[2] ?? '';
if ($url === '' || $job === '') {
    fwrite(STDERR, "URL va JOB ID kerak\n");
    exit(1);
}

$stateFile = dirname(__DIR__) . '/storage/mtproto/job_' . preg_replace('/[^a-zA-Z0-9_-]/', '', $job) . '.json';

function jobSet($stateFile, $patch) {
    $cur = is_file($stateFile) ? json_decode((string) file_get_contents($stateFile), true) : [];
    if (!is_array($cur)) {
        $cur = [];
    }
    @file_put_contents($stateFile, json_encode(array_merge($cur, $patch), JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
    @chmod($stateFile, 0666);
}

jobSet($stateFile, [
    'status'   => 'running',
    'progress' => 0,
    'started'  => time(),
    'url'      => $url,
]);

$pull = new TgPull();
$res  = $pull->pull($url, function ($progress, $speed, $time) use ($stateFile) {
    jobSet($stateFile, [
        'progress' => (int) round((float) $progress),
        'speed'    => (float) ($speed ?? 0),
    ]);
});

if (empty($res['ok'])) {
    jobSet($stateFile, [
        'status' => 'error',
        'error'  => $res['error'] ?? 'Noma\'lum xato',
        'ended'  => time(),
    ]);
    exit(1);
}

jobSet($stateFile, [
    'status'    => 'done',
    'progress'  => 100,
    'ended'     => time(),
    'path'      => $res['path'] ?? null,
    'size'      => $res['size'] ?? null,
    'mime'      => $res['mime'] ?? null,
    'duration'  => $res['duration'] ?? null,
    'file_name' => $res['file_name'] ?? null,
    'message'   => $res['message'] ?? 'Yuklab olindi.',
]);
exit(0);