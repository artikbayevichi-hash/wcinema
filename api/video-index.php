<?php
// ============================================================================
// api/video-index.php — birinchi tomoshabin topgan MP4 indeks o'rnini saqlash
// ============================================================================
//
// POST {doc, size, ch, post, moov:{inHead:true}|{start,len}, kf?:[[t,off]], dur?}
// GET  ?doc=<id>&size=<bayt>  -> saqlangan xarita (diagnostika/SPA uchun)
//
// Bu — KONTENT darajasidagi ma'lumot: foydalanuvchi, sessiya, cookie, IP
// hech qachon qabul qilinmaydi va saqlanmaydi. `file_reference` ham Yo'Q.
// Video baytlari bu yerdan O'TMAYDI — faqat bir necha yuz bayt koordinata.
// ============================================================================

require_once __DIR__ . '/../includes/bootstrap.php';
require_once __DIR__ . '/../includes/ServerTiming.php';
require_once __DIR__ . '/../includes/VideoIndex.php';
require_once __DIR__ . '/../includes/StreamBootstrap.php';

ServerTiming::init('wc-index', 'video index save');
ob_start();

function indexOut($data, $status = 200)
{
    while (ob_get_level() > 0) { @ob_end_clean(); }
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

$method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));

// ------------------------------------------------------------------- o'qish
if ($method === 'GET') {
    $doc  = (string) input('doc', '', 40);
    $size = inputInt('size', 0);
    $row  = VideoIndex::get($doc, $size);
    indexOut([
        'success' => is_array($row),
        'ok'      => is_array($row),
        'index'   => $row,
    ], is_array($row) ? 200 : 404);
}

if ($method !== 'POST') {
    indexOut(['success' => false, 'error' => 'POST kerak'], 405);
}

$raw = (string) file_get_contents('php://input');
if (strlen($raw) > 512 * 1024) {
    indexOut(['success' => false, 'error' => 'Juda katta'], 413);
}
$data = json_decode($raw, true);
if (!is_array($data)) $data = $_POST;

$doc  = (string) ($data['doc'] ?? '');
$size = (int) ($data['size'] ?? 0);
$ch   = (string) ($data['ch'] ?? ($data['channel'] ?? ''));
$post = (int) ($data['post'] ?? 0);

if (!preg_match('/^[0-9]{1,20}$/', $doc) || $size < 1024 * 1024
    || $size > 4 * 1024 * 1024 * 1024) {
    indexOut(['success' => false, 'error' => 'Noto\'g\'ri doc/size'], 400);
}

// Faqat katalogdagi video bo'lishi mumkin. Bu soxtа yozuvlarning oldini oladi.
if (!VideoIndex::known($ch, $post, $doc, $size)) {
    indexOut(['success' => false, 'error' => 'Topilmadi'], 404);
}

$saved = VideoIndex::put($doc, $size, $data);

// `boot` yozuvi 6 soat keshda turadi — yangi indeksni darhol ko'rsatish
// uchun faqat shu videoning boot keshini o'chiramiz (qurish keyingi ochilishda).
if ($saved) {
    try {
        StreamBootstrap::forgetBoot($ch, $post);
    } catch (Throwable $e) {
        // indeks saqlandi, boot keyinroq o'zini yangilaydi
    }
}

indexOut([
    'success' => $saved,
    'ok'      => $saved,
    'saved'   => $saved,
], $saved ? 200 : 400);
