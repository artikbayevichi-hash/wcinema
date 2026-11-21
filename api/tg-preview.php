<?php
// ============================================================================
// api/tg-preview.php — video uchun tayyor qisqa preview manzili
// ----------------------------------------------------------------------------
// GET ?ch=wcinemauz&post=12
//   -> { success:true, ch:'<preview kanal>', p:<post>, size, mime, w, h, dur }
// Preview yo'q/sozlanmagan bo'lsa -> { success:true, preview:null }
//
// Faqat ko'rsatish ma'lumoti. Video baytlari BU YERDAN O'TMAYDI — brauzer
// ularni to'g'ridan-to'g'ri Telegram'dan oladi.
// ============================================================================

require_once __DIR__ . '/../includes/bootstrap.php';
require_once __DIR__ . '/../includes/TgPreview.php';

$ch   = strtolower(trim((string) input('ch', '', 64)));
$post = inputInt('post', 0);

if ($ch === '' || $post <= 0 || !preg_match('/^[A-Za-z0-9_]{1,64}$/', $ch)) {
    fail('ch va post kerak', 422);
}

$pv = TgPreview::get($ch, $post);
ok([
    'preview' => $pv,   // null bo'lishi mumkin — pleyer asl videoga o'tadi
]);
