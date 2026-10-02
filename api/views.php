<?php
// ============================================================================
// UNIKAL ko'rish (YouTube uslubi): bitta odam = bitta ko'rish.
// ----------------------------------------------------------------------------
// Ilgari bu endpoint har chaqiruvda `content.views` ni +1 qilardi —
// ya'ni bir odam videoni 4 marta ochsa, 4 ko'rish bo'lib ko'rinardi.
//
// Endi viewer_key bo'yicha `content_views` ga bir marta yoziladi va
// `content.views` = COUNT(*) qilib qayta hisoblanadi. Bir odam necha
// marta ko'rmasin — faqat 1 marta sanaladi.
//
// MUHIM: server MTProto auth_key'ni KO'RMAYDI (u faqat brauzer
// localStorage'ida). Shu sabab brauzer o'zini tanishtiradi:
//   - PHP hisobi bo'lsa  -> u:<users.id>       (ustuvor)
//   - Telegram id bo'lsa -> tg:<telegram_id>   (MTProto, brauzerdan)
//   - aks holda          -> anon:<brauzer uuid>
// Bu "yumshoq" tizim: maqsad — takroriy ko'rishlarni birlashtirish,
// kontentni himoyalash emas.
// ============================================================================
require_once __DIR__ . '/../includes/bootstrap.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    fail('POST so\'raladi', 405);
}

$contentId = contentIdInput();
if ($contentId <= 0) {
    fail('content id kerak');
}
if (!$catalog->getContent($contentId)) {
    fail('Kontent topilmadi', 404);
}

// viewer_key ni aniqlaymiz: PHP hisobi -> Telegram id -> anonim brauzer.
$viewerKey = '';
if ($userId) {
    $viewerKey = 'u:' . (int) $userId;
} else {
    $tgId = input('tg_id', '', 20);
    if ($tgId !== '' && ctype_digit($tgId) && $tgId !== '0') {
        $viewerKey = 'tg:' . $tgId;
    } else {
        $anon = strtolower(input('anon', '', 64));
        if (preg_match('/^[a-z0-9-]{8,64}$/', $anon)) {
            $viewerKey = 'anon:' . $anon;
        }
    }
}

if ($viewerKey === '') {
    fail('viewer aniqlanmadi');
}

$result = $catalog->addUniqueView($contentId, $viewerKey);
if (!$result['success']) {
    fail($result['message'] ?? 'Ko\'rish sanalmadi');
}

Auth::ok([
    'views'   => (int) $result['views'],
    'counted' => true,
]);
