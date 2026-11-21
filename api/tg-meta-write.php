<?php
// ============================================================================
// api/tg-meta-write.php — foydalanuvchi sessiyasi yechgan Telegram havolasini
// bazaga qayta yozish (source='gram')
// ============================================================================
//
// NIMA UCHUN:
//   Brauzer GramJS bilan hujjatni yechganda uning `file_reference` qiymati
//   tomoshabbin O'Z akkauntida ishlaydi. Bu havolani bazaga yozib qo'ysak,
//   keyingi ochilishda `api/tg-doc.php` uni darhol beradi va GramJS bundle'ini
//   yuklash shart bo'lmaydi.
//
// XAVFSIZLIK:
//   • Faqat saytga login bo'lgan foydalanuvchi yozishi mumkin;
//   • faqat katalogda bor (kanal, post) juftligi qabul qilinadi;
//   • hujjat ID'si bot yozuvidagi bilan bir xil bo'lishi shart;
//   • `fr` qattiq base64 formatida va oqilona uzunlikda bo'lishi kerak.
//   Bularni `TgMeta::saveGram()` tekshiradi.
//
// Video baytlari BU YERDAN O'TMAYDI — faqat ~200 bayt metama'lumot.
// ============================================================================

require_once __DIR__ . '/../includes/bootstrap.php';
require_once __DIR__ . '/../includes/TgMeta.php';

ob_start();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    while (ob_get_level() > 0) { @ob_end_clean(); }
    http_response_code(405);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['success' => false, 'error' => 'POST kerak']);
    exit;
}

// Telegram (tweb) orqali kirgan tomoshabin PHP sessiyasiga ega bo'lmasligi
// mumkin — `wc_cs` cookie orqali ham ruxsat beramiz.
$viewerId = clientUserId();
if (!($viewerId > 0)) {
    while (ob_get_level() > 0) { @ob_end_clean(); }
    http_response_code(401);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['success' => false, 'error' => 'Avval tizimga kiring']);
    exit;
}

// JSON body yoki oddiy POST — ikkalasini ham qabul qilamiz.
$raw = file_get_contents('php://input');
$data = json_decode($raw, true);
if (!is_array($data)) {
    $data = $_POST;
}

$ch   = (string) ($data['ch'] ?? ($data['channel'] ?? ''));
$post = (int) ($data['post'] ?? 0);
$out  = [
    'id'   => (string) ($data['id'] ?? ''),
    'ah'   => (string) ($data['ah'] ?? ''),
    'fr'   => (string) ($data['fr'] ?? ''),
    'dc'   => (int) ($data['dc'] ?? 0),
    'size' => (int) ($data['size'] ?? 0),
    'mime' => (string) ($data['mime'] ?? ''),
    'fn'   => (string) ($data['fn'] ?? ''),
    'w'    => (int) ($data['w'] ?? 0),
    'h'    => (int) ($data['h'] ?? 0),
    'dur'  => (int) ($data['dur'] ?? 0),
];

$saved = TgMeta::saveGram($ch, $post, $out);

while (ob_get_level() > 0) { @ob_end_clean(); }
header('Content-Type: application/json; charset=utf-8');
http_response_code($saved ? 200 : 400);
echo json_encode([
    'success' => $saved,
    'ok'      => $saved,
    'saved'   => $saved,
    'source'  => 'gram',
]);
