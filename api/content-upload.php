<?php
// ============================================================================
// api/content-upload.php - Film/qism videolarini serverga YUKLASH (faqat ADMIN)
// ============================================================================
// POST multipart/form-data: video (fayl)
// Yangi fayl uploads/videos/ ga tasodifiy nom bilan saqlanadi va admin
// paneli video_url maydoniga shu relative yo'lni qo'yadi.
//
// DIQQAT: bu endpoint film fayllarini o'zgartirmaydi - faqat DISKGA saqlaydi
// va yo'lni qaytaradi. Kontekst (qaysi kontentga tegishli) panel orqali.
// ============================================================================
require_once __DIR__ . '/../includes/bootstrap.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    fail('POST so‘raladi', 405);
}

requireAdmin();

// --- hajm chegarasi (post_max_size xavfsizligi, Reels bilan bir xil naqsh)
$contentLength = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
$postMax = ini_bytes(ini_get('post_max_size'));
$upMax   = ini_bytes(ini_get('upload_max_filesize'));
$hardMax = min($postMax, $upMax, CONTENT_MAX_UPLOAD_MB * 1024 * 1024);

if ($contentLength > 0 && $contentLength > $hardMax) {
    fail('Fayl juda katta (' . round($contentLength / 1048576, 1) . ' MB). '
         . 'Server chegarasi: ' . round($hardMax / 1048576) . ' MB.', 413);
}

// --- Poster (rasm) yuklash: "image" maydoni. Video yuklashdan oldin
// tekshiriladi — ikkala maydon birga kelmasa, biri bajariladi.
$image = $_FILES['image'] ?? null;
if ($image && !empty($image['name'])) {
    $imgExt  = strtolower(pathinfo((string) $image['name'], PATHINFO_EXTENSION));
    $imgMime = null;
    if (function_exists('mime_content_type') && is_file($image['tmp_name'])) {
        $imgMime = mime_content_type($image['tmp_name']);
    }
    if (!$imgMime && function_exists('finfo_open')) {
        $fi = finfo_open(FILEINFO_MIME_TYPE);
        if ($fi) {
            $imgMime = finfo_file($fi, (string) $image['tmp_name']);
            finfo_close($fi);
        }
    }
    $imgAllowed = ['jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp', 'gif' => 'image/gif'];
    if (!isset($imgAllowed[$imgExt])
        || ($imgMime !== null && strpos($imgMime, 'image/') !== 0)) {
        fail('Faqat JPG, PNG, WEBP, GIF rasm formatida', 400);
    }
    if (!is_dir(POSTERS_DIR) && !@mkdir(POSTERS_DIR, 0775, true) && !is_dir(POSTERS_DIR)) {
        fail('Papka yaratib bo‘lmadi', 500);
    }
    $safe = bin2hex(random_bytes(16)) . '.' . $imgExt;
    if (!move_uploaded_file($image['tmp_name'], POSTERS_DIR . '/' . $safe)) {
        fail('Rasmni saqlab bo‘lmadi', 500);
    }
    @chmod(POSTERS_DIR . '/' . $safe, 0644);
    ok([
        'success' => true,
        'url'     => 'uploads/posters/' . $safe,
        'name'    => $image['name'],
        'size'    => (int) $image['size'],
        'mime'    => $imgMime ?: ($imgAllowed[$imgExt] ?? 'image/jpeg'),
        'message' => 'Poster yuklandi — poster maydoniga qo‘yildi',
    ]);
}

$file = $_FILES['video'] ?? null;
if (!$file) {
    if ($contentLength > 0 && $contentLength > $postMax) {
        fail('Fayl server chegarasidan katta (post_max_size = '
             . ini_get('post_max_size') . ')', 413);
    }
    fail('Fayl tanlanmagan', 400);
}

// --- format tekshiruvi
$ext = strtolower(pathinfo((string) $file['name'], PATHINFO_EXTENSION));
$mime = Catalog::mimeFromFile($file['tmp_name'] ?? '');
$allowed = [
    'mp4' => 'video/mp4',
    'm4v' => 'video/mp4',
    'webm'=> 'video/webm',
    'mov' => 'video/quicktime',
    'mkv' => 'video/x-matroska',
];

if (!isset($allowed[$ext]) || ($mime === null && empty($file['size']))) {
    fail('Faqat MP4, WEBM, MOV, MKV, M4V formatida', 400);
}
if ($mime !== null && strpos($mime, 'video/') !== 0) {
    fail('Bu video fayl emas: ' . $mime, 400);
}

if (!is_dir(VIDEOS_DIR) && !@mkdir(VIDEOS_DIR, 0775, true) && !is_dir(VIDEOS_DIR)) {
    fail('Papka yaratib bo‘lmadi', 500);
}

$safe = bin2hex(random_bytes(16)) . '.' . $ext;
$dest = VIDEOS_DIR . '/' . $safe;
if (!move_uploaded_file($file['tmp_name'], $dest)) {
    fail('Faylni saqlab bo‘lmadi', 500);
}
@chmod($dest, 0644);

ok([
    'success' => true,
    'url'     => 'uploads/videos/' . $safe,
    'name'    => $file['name'],
    'size'    => (int) $file['size'],
    'mime'    => $mime,
    'message' => 'Video yuklandi — video_url maydoniga qo‘yildi',
]);