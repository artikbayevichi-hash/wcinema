<?php
// ============================================================================
// api/tg-pull.php - Telegram'dan video yuklab olish (faqat ADMIN)
// ============================================================================
// POST url=...  -> ishchi jarayonni ishga tushiradi, job id qaytaradi.
// GET  ?job=..  -> yuklanish holati: {status, progress, path, size, ...}
//
// Yuklanish ASOSIY so'rovda bajarilmaydi - alohida CLI jarayonida (worker)
// ishlaydi, shunda uzun (10+ daqiqa) yuklanishda server so'rovi o'lib ketmaydi.
// ============================================================================
require_once __DIR__ . '/../includes/bootstrap.php';
require_once __DIR__ . '/../includes/TgPull.php';

requireAdmin();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET' && isset($_GET['job'])) {
    $sj = preg_replace('/[^a-zA-Z0-9_-]/', '', (string) $_GET['job']);
    if ($sj === '') {
        fail('Job id kerak', 400);
    }
    $stateFile = dirname(__DIR__) . '/storage/mtproto/job_' . $sj . '.json';
    if (!is_file($stateFile)) {
        fail('Bunday ish topilmadi (yoki eskirgan)', 404);
    }
    $row = json_decode((string) file_get_contents($stateFile), true);
    if (!is_array($row)) {
        fail('Job fayli buzilgan', 500);
    }
    ok(['job' => $sj] + $row);
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    fail('POST kerak', 405);
}

$url = input('url', '', 2000);
if ($url === '' || !preg_match('#(?:^|[/.])(t\.me|telegram\.me)(?:/|$)#i', $url)) {
    fail('Havola t.me/telegram.me bo\'lishi kerak', 400);
}

if (!TgPull::libraryReady()) {
    fail('MadelineProto o\'rnatilmagan: cli/tg-pull-worker.php ni qo\'lda "php cli/tg-pull-worker.php" bilan ishga tushirish mumkin. Composer kerak: composer require danog/madelineproto', 503);
}
if (!TgPull::credentialsReady()) {
    fail('Avval .env ga yozing: ' . implode(', ', TgPull::missingConfig())
        . '  —  my.telegram.org → API development tools → Create application (2 daqiqa).', 503);
}

$jobId  = substr(md5($url), 0, 10) . '_' . time();
$stateFile = dirname(__DIR__) . '/storage/mtproto/job_' . $jobId . '.json';
file_put_contents($stateFile, json_encode(['status' => 'starting', 'progress' => 0], JSON_UNESCAPED_UNICODE));
@chmod($stateFile, 0666);

// --- ishchi jarayonni ajratib ishga tushiramiz ----------------------------
$phpBin  = PHP_CLI_BIN;   // Apache ostida PHP_BINARY noto'g'ri bo'ladi — config dan
$worker  = escapeshellarg(dirname(__DIR__) . '/cli/tg-pull-worker.php');
$urlArg  = escapeshellarg($url);
$jobArg  = escapeshellarg($jobId);

if (stripos(PHP_OS_FAMILY, 'win') === 0) {
    // Windows: "start /B" - yangi oyna ochmaydi, ish fonida yuradi
    $cmd = 'start /B "" ' . escapeshellarg($phpBin) . ' ' . $worker . ' ' . $urlArg . ' ' . $jobArg . ' > NUL 2>&1';
    @pclose(@popen($cmd, 'r'));
} else {
    $cmd = escapeshellarg($phpBin) . ' ' . $worker . ' ' . $urlArg . ' ' . $jobArg . ' > /dev/null 2>&1 &';
    @exec($cmd);
}

ok([
    'job'  => $jobId,
    'status' => 'starting',
    'message' => 'Yuklab olish boshlandi. Hajmi katta bo\'lsa bir necha daqiqa ketadi.',
]);