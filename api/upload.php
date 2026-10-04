<?php
// ============================================================================
// api/upload.php — umumiy kontent yuklash (Reels / Image Post / Long Video)
// ---------------------------------------------------------------------------
//   POST (multipart) — asosiy:
//     format       'reel'  (9:16)  | 'post' (1:1, 1..10 rasm) | 'video' (16:9)
//     media[]      fayllar (yoki `video` bitta fayl — orqali qabul qilinadi)
//     title        sarlavha
//     description  izoh
//     content_id   ixtiyoriy — qaysi film bilan bog'lash
//     tg_me        brauzer MTProto identifikatori
//
//   POST (multipart) — videolar uchun qo'shimcha:
//     poster       brauzerda canvas bilan ajratilgan kadr (JPEG, ≤4 MB)
//     width,height, duration — brauzer o'lchagan meta ma'lumot
//
//   GET  ?action=formats → qabul qilinadigan formatlar va limitlar
//   GET  ?id=N          → bitta kontent + uning carousel mediasi
// ============================================================================
require_once __DIR__ . '/../includes/bootstrap.php';
require_once __DIR__ . '/../includes/Uploader.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = input('action', '', 30);

// ------------------------------------------------------------ GET: formatlar
if ($method === 'GET' && $action === 'formats') {
    ok([
        'formats' => [
            [
                'id'       => 'reel',
                'label'    => 'Reels',
                'aspect'   => '9:16',
                'max_mb'   => Uploader::MAX_REEL_MB,
                'accept'   => 'video/mp4,video/webm,video/quicktime',
                'multiple' => false,
                'hint'     => 'Vertikal qisqa video (taxminan 90 soniyagacha)',
            ],
            [
                'id'       => 'post',
                'label'    => 'Rasm post',
                'aspect'   => '1:1',
                'max_mb'   => Uploader::MAX_IMAGE_MB,
                'accept'   => 'image/jpeg,image/png,image/webp,image/gif',
                'multiple' => true,
                'max_items' => Uploader::MAX_POST_MEDIA,
                'hint'     => 'Yitta rasm yoki galereya (carousel)',
            ],
            [
                'id'       => 'video',
                'label'    => 'Uzun video',
                'aspect'   => '16:9',
                'max_mb'   => Uploader::MAX_VIDEO_MB,
                'accept'   => 'video/mp4,video/webm,video/quicktime',
                'multiple' => false,
                'hint'     => 'YouTube uslubida gorizontal video',
            ],
        ],
    ]);
}

// ------------------------------------------------- GET: bitta kontent + media
if ($method === 'GET' && $action === '') {
    $id = inputInt('id', 0);
    if ($id <= 0) fail('id kerak', 400);

    $reels = new Reels();
    $uid   = reelUserId();
    $row   = $reels->getReel($id, $uid);
    if (!$row) fail('Topilmadi', 404);

    $up    = new Uploader();
    $media = $up->media($id);
    // Carousel bo'lmasa, asosiy media turida bitta element qaytaramiz.
    if (!$media) {
        $pb = $row['playback'] ?? [];
        $media = [[
            'idx'        => 0,
            'kind'       => (string) ($row['format'] ?? 'reel') === 'post' ? 'image' : 'video',
            'video_type' => (string) ($pb['type'] ?? ''),
            'video_url'  => (string) ($pb['url'] ?? ''),
            'poster'     => (string) ($row['poster'] ?? ''),
            'width'      => 0,
            'height'     => 0,
            'duration'   => (int) ($row['duration'] ?? 0),
        ]];
    }
    ok([
        'reel'  => [
            'id'          => (int) $row['id'],
            'title'       => (string) $row['title'],
            'description' => (string) ($row['description'] ?? ''),
            'format'      => (string) ($row['format'] ?? 'reel'),
            'aspect'      => (string) ($row['aspect'] ?? '9:16'),
            'is_carousel' => !empty($row['is_carousel']),
            'playback'    => $row['playback'] ?? null,
            'poster'      => (string) ($row['poster'] ?? ''),
            'views'       => (int) ($row['views'] ?? 0),
            'likes'       => (int) ($row['likes'] ?? 0),
            'comments'    => (int) ($row['comments'] ?? 0),
            'shares'      => (int) ($row['shares'] ?? 0),
            'status'      => (int) ($row['status'] ?? 0),
            'author'      => $row['author'] ?? null,
        ],
        'media' => array_map(function ($m) {
            return [
                'idx'   => (int) $m['idx'],
                'kind'  => (string) $m['kind'],
                'type'  => (string) $m['video_type'],
                'url'   => (string) $m['video_url'],
                'poster'=> (string) $m['poster'],
                'w'     => (int) $m['width'],
                'h'     => (int) $m['height'],
                'dur'   => (int) $m['duration'],
            ];
        }, $media),
    ]);
}

// ------------------------------------------------------------------- POST
if ($method !== 'POST') fail('POST so‘raladi', 405);

$userId = reelUserId();
if ($userId <= 0) {
    fail('Foydalanuvchi aniqlanmadi. Sahifani yangilab, qayta urinib ko‘ring.', 401);
}

// Fayllar: `media[]` (yangi) yoki `video` (eski shakl).
$files = $_FILES['media'] ?? [];
if (!$files) {
    $files = $_FILES['video'] ?? $_FILES['files'] ?? [];
}
if (!$files) fail('Fayl tanlanmagan', 400);

// Format: `format` maydoni, bo'lmasa fayl turidan aniqlanadi.
$format = input('format', '', 20);
if ($format === '') {
    $first = Uploader::normFiles($files)[0] ?? [];
    $mime  = strtolower((string) ($first['type'] ?? ''));
    $ext   = strtolower(pathinfo((string) ($first['name'] ?? ''), PATHINFO_EXTENSION));
    $format = (strpos($mime, 'image/') === 0 || in_array($ext, Uploader::IMAGE_EXT, true))
        ? 'post' : 'reel';
}

$result = (new Uploader())->create($userId, $format, $files, [
    'title'       => input('title', '', 200),
    'description' => input('description', '', 500),
    'content_id'  => inputInt('content_id', 0),
    'poster'      => $_FILES['poster'] ?? null,
    'width'       => inputInt('width', 0),
    'height'      => inputInt('height', 0),
    'duration'    => inputInt('duration', 0),
]);

if (empty($result['success'])) {
    fail($result['message'] ?? 'Yuklab bo‘lmadi', 400);
}
ok($result);