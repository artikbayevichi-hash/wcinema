<?php
// ============================================================================
// stream.php - bizning serverimizdagi videolarni Range/206 bilan oqitish
// ============================================================================
// Faqat uploads/ papkasidagi fayllarni beradi. Maxfiy ma'lumot (bot token,
// ichki yo'llar) chiqmaydi. Diqqat: bu Telegram CDN emas - trafik bizda.
require_once __DIR__ . '/../includes/bootstrap.php';

$id  = inputInt('id');
$ep  = inputInt('episode');
$reel = inputInt('reel');

// ---------------------------------------------------------------------------
// Manbani aniqlash
//
// DIQQAT: reels alohida qatlam. Sababi: reel yuklangan fayl bo'lishi
// mumkin, lekin uni "katalog" orqali olib bo'lmaydi - u episodes
// jadvalida yo'q. Shu sabab bir xil Range/206 oqimini ikkala manba
// uchun ham ishlatish uchun avval relativ YO'L topiladi, keyin
// umumiy oqitish qismi ishga tushadi.
// ---------------------------------------------------------------------------
if ($reel > 0) {
    // --- Reels
    $own = $reels->getOwnerAndStatus($reel);
    if (!$own) {
        http_response_code(404);
        exit('Reels topilmadi');
    }
    // Kutilayotgan/rad etilgan reelni tashqariga bermaymiz. Aks holda kimdir
    // tasdiqni bekor qilgandan keyin ham faylni yuklab olib, "rad etilgan"
    // kontentni tarqatishi mumkin bo'lardi. Muallif va admin o'z
    // reelsini ko'ra oladi (muharrirlash/tekshirish uchun).
    $isOwner = $userId && (int) $own['user_id'] === (int) $userId;
    if ((int) $own['status'] !== 1 && !$isOwner && !$auth->isAdmin()) {
        http_response_code(403);
        exit('Reels hali tasdiqlanmagan');
    }

    $urlPath = $reels->getFilePath($reel);
    if (!$urlPath) {
        http_response_code(404);
        exit('Video fayli topilmadi');
    }
    $urlPath = '/' . ltrim($urlPath, '/');
} else {
    // --- Katalog
    // Katalogdan olamiz (server yo'lini foydalanuvchiga chiqarmaymiz)
    if ($ep > 0) {
        $item = $catalog->getEpisode($ep);
    } else {
        $item = $catalog->getContent($id);
    }

    if (!$item) {
        http_response_code(404);
        exit('Video topilmadi');
    }

    // Faqat mahalliy fayl bo'lgan kontentni oqitamiz (faqat file turi)
    $playback = $catalog->getPlayback($item);
    if ($playback['type'] !== 'file' || empty($playback['url'])) {
        http_response_code(400);
        exit('Bu video serverimizda emas');
    }

    // url dan relative yo'lni olamiz
    $urlPath = parse_url($playback['url'], PHP_URL_PATH) ?? '';
}

// SITE_URL ni olib tashlab, uploads/ ni topamiz
$basePath = parse_url(SITE_URL, PHP_URL_PATH) ?? '';   // masalan /tele_uzdub
if ($basePath !== '' && strpos($urlPath, $basePath) === 0) {
    $urlPath = substr($urlPath, strlen($basePath));
}
$urlPath = ltrim($urlPath, '/');

// uploads/ papkasidan chiqib, .. ga chiqishga urinishni bloklaymiz
$uploadsRoot = realpath(UPLOAD_DIR);
if (!$uploadsRoot) {
    http_response_code(404);
    exit('Uploads papkasi topilmadi');
}
$full = realpath(__DIR__ . '/../' . $urlPath);

if (!$full || strpos($full, $uploadsRoot) !== 0 || !is_file($full)) {
    http_response_code(404);
    exit('Fayl topilmadi');
}

$size = (int) filesize($full);
$mime = Catalog::mimeFromFile($full);

// ---------------------------------------------------------------- Range (206)
$range = $_SERVER['HTTP_RANGE'] ?? '';

header('Content-Type: ' . $mime);
header('Accept-Ranges: bytes');
header('Cache-Control: private, max-age=3600');

if ($range === '' || !preg_match('/bytes=(\d*)-(\d*)/', $range, $m)) {
    // To'liq fayl
    header('Content-Length: ' . $size);
    header('Content-Disposition: inline; filename="' . basename($full) . '"');
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'HEAD') {
        exit;
    }
    readfile($full);
    exit;
}

$startRaw = $m[1];
$endRaw   = $m[2];

if ($startRaw === '' && $endRaw === '') {
    header('Content-Length: ' . $size);
    readfile($full);
    exit;
}

if ($startRaw === '') {
    // Suffix: bytes=-500  -> oxirgi 500 bayt
    $len  = (int) $endRaw;
    $start = max(0, $size - $len);
    $end   = $size - 1;
} else {
    $start = (int) $startRaw;
    $end   = $endRaw === '' ? $size - 1 : (int) $endRaw;
}

if ($start > $end || $start >= $size) {
    http_response_code(416);
    header('Content-Range: bytes */' . $size);
    exit('Range not satisfiable');
}

if ($end >= $size) {
    $end = $size - 1;
}

$length = $end - $start + 1;

http_response_code(206);
header('Content-Range: bytes ' . $start . '-' . $end . '/' . $size);
header('Content-Length: ' . $length);

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'HEAD') {
    exit;
}

$fp = fopen($full, 'rb');
fseek($fp, $start);
$remaining = $length;

while ($remaining > 0 && !feof($fp)) {
    $chunk = fread($fp, (int) min(8192, $remaining));
    if ($chunk === false || $chunk === '') {
        break;
    }
    echo $chunk;
    $remaining -= strlen($chunk);
    // mijoz uzilsa, to'xtaymiz (boshqalar uchun bandlikni bo'shatamiz)
    if (connection_aborted()) {
        break;
    }
}
fclose($fp);
exit;
