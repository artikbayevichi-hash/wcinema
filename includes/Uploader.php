<?php
// ============================================================================
// Uploader.php — kontent yuklash moduli (Reels / Image Post / Long Video)
// ---------------------------------------------------------------------------
// Uch xil formatni qabul qiladi — hammasi bitta `reels` jadvalida saqlanadi
// (`format` maydoni orqali ajratiladi), galereya uchun `reel_media` jadvali:
//
//   format = 'reel'  → 9:16 vertikal qisqa video (Instagram Reels)
//                       media → Telegram kanalga (mavjud ishonchli oqim)
//   format = 'post'  → 1:1 rasm yoki galereya (carousel, 1..10 ta)
//                       media → serverga (uploads/posts/) saqlanadi
//   format = 'video' → 16:9 uzun video (YouTube uslubida)
//                       media → Telegram kanalga
//
// THUMBNAIL (preview):
//   ffmpeg yo'q (XAMPP muhitida), shuning uchun poster —
//     · rasm postlarda: rasmning o'zidan `getimagesize` orqali nisbat olinadi
//                       va fayl kanal preview sifatida ishlatiladi;
//     · videolarda:    BRAUZER `canvas` bilan kadr ajratadi, JPEG sifatida
//                       yuboradi (`poster` maydoni). Agar kelmasa —
//                       fayl nomidan generatsiya qilingan placeholder.
//   `reels.thumb_source`: 'client' | 'auto' | 'manual'
// ============================================================================

class Uploader
{
    /** @var Database */
    private $db;

    /** Rasm formatlari (galereya uchun) */
    const IMAGE_EXT  = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
    /** Video formatlari */
    const VIDEO_EXT  = ['mp4', 'webm', 'mov'];

    /** Galereyadagi maksimal rasm soni */
    const MAX_POST_MEDIA = 10;

    /** Rasm uchun maksimal MB (bitta fayl) */
    const MAX_IMAGE_MB = 12;

    /** Reel uchun maksimal MB */
    const MAX_REEL_MB = 50;

    /** Uzun video uchun maksimal MB */
    const MAX_VIDEO_MB = 200;

    /** Rasm postlar saqlanadigan papka */
    const POSTS_DIR = UPLOAD_DIR . 'posts';

    /** Poster (thumbnail) saqlanadigan papka */
    const THUMBS_DIR = UPLOAD_DIR . 'thumbnails';

    public function __construct(?Database $db = null)
    {
        $this->db = $db ?: Database::getInstance();
        self::ensureDirs();
    }

    /** Kerakli papkalarni yaratadi (bir marta chaqiriladi). */
    private static function ensureDirs()
    {
        foreach ([self::POSTS_DIR, self::THUMBS_DIR] as $dir) {
            if (!is_dir($dir)) {
                @mkdir($dir, 0755, true);
            }
            // Papka ichiga to'g'ridan-to'g'ri kiritishga qarshi himoya.
            $ht = rtrim($dir, '/\\') . '/.htaccess';
            if (is_dir($dir) && !is_file($ht)) {
                @file_put_contents($ht, "Options -Indexes\n<FilesMatch \"\\.(php|phtml|php3|php4|php5|phar)$\">\n    Require all denied\n</FilesMatch>\n");
            }
        }
    }

    // ==================================================================
    //  1) ASOSIY KIRISH
    // ==================================================================

    /**
     * Kontentni yaratadi.
     *
     * @param int    $userId
     * @param string $format   'reel' | 'post' | 'video'
     * @param array  $files    $_FILES['media'] yoki $_FILES['video'] (normalize qilingan)
     * @param array  $opts     ['title','description','content_id','poster','width','height']
     * @return array{success: bool, message?: string, id?: int, format?: string, ...}
     */
    public function create($userId, $format, array $files, array $opts = [])
    {
        $userId = (int) $userId;
        if ($userId <= 0) {
            return ['success' => false, 'message' => 'Foydalanuvchi aniqlanmadi'];
        }
        $format = self::normFormat($format);
        if ($format === null) {
            return ['success' => false, 'message' => 'Format noto‘g‘ri (reel / post / video)'];
        }
        $files = self::normFiles($files);
        if (!$files) {
            return ['success' => false, 'message' => 'Fayl tanlanmagan'];
        }

        if ($format === 'post') {
            return $this->createPost($userId, $files, $opts);
        }
        return $this->createVideo($userId, $files[0], $format, $opts);
    }

    // ==================================================================
    //  2) RASM POST (single / carousel)
    // ==================================================================

    /**
     * Rasm yoki galereya (carousel) yaratadi.
     *
     * @param int   $userId
     * @param array $files  normalize qilingan fayllar ro'yxati
     */
    private function createPost($userId, array $files, array $opts)
    {
        if (count($files) > self::MAX_POST_MEDIA) {
            return ['success' => false, 'message' =>
                'Galereyada kamida ' . self::MAX_POST_MEDIA . ' ta rasm bo‘lishi mumkin'];
        }
        $limit = self::MAX_IMAGE_MB * 1024 * 1024;
        $allowExt = self::IMAGE_EXT;
        $allowMime = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];

        $saved = [];   // saqlangan fayllar (xato bo'lsa tozalash uchun)
        foreach ($files as $i => $f) {
            $err = self::checkFile($f, $limit, $allowExt, $allowMime, 'rasm');
            if ($err !== null) {
                self::cleanup($saved);
                return ['success' => false, 'message' => 'Fayl #' . ($i + 1) . ': ' . $err];
            }
            // Kengaytmani SAQLAYMIZ (GD yo'q — konvertatsiya qilinmaydi),
            // faqat xavfsizlashtiramiz: nomni tozalab, noyob qo'shamiz.
            $ext  = strtolower(pathinfo((string) $f['name'], PATHINFO_EXTENSION));
            $ext  = in_array($ext, self::IMAGE_EXT, true) ? $ext : 'jpg';
            $name = self::uniqueName($f['name'], $ext);
            $dest = self::POSTS_DIR . '/' . $name;
            if (!@move_uploaded_file($f['tmp_name'], $dest)) {
                self::cleanup($saved);
                return ['success' => false, 'message' => 'Faylni saqlab bo‘lmadi'];
            }
            @chmod($dest, 0644);
            $size = @getimagesize($dest);
            $saved[] = [
                'path'      => $dest,
                'url'       => self::urlFor($dest),
                'width'     => (int) ($size[0] ?? 0),
                'height'    => (int) ($size[1] ?? 0),
                'mime'      => (string) ($size['mime'] ?? ''),
            ];
        }
        if (!$saved) {
            return ['success' => false, 'message' => 'Rasmni saqlab bo‘lmadi'];
        }

        $title = self::cleanText($opts['title'] ?? '', 200);
        if ($title === '') {
            $title = mb_substr(pathinfo((string) $files[0]['name'], PATHINFO_FILENAME), 0, 200) ?: 'Rasm';
        }
        $description = self::cleanText($opts['description'] ?? '', 500) ?: null;
        $contentId   = (int) ($opts['content_id'] ?? 0);

        // Asosiy media — birinchi rasm (eski kod `video_url` ni o'qidi).
        $first = $saved[0];
        $isCarousel = count($saved) > 1;

        try {
            $reelId = $this->db->insert('reels', [
                'user_id'      => $userId,
                'content_id'   => $contentId > 0 ? $contentId : null,
                'episode_id'   => null,
                'kind'         => 'upload',
                'format'       => 'post',
                'aspect'       => '1:1',
                'title'        => $title,
                'description'  => $description,
                'video_type'   => 'direct',
                'video_url'    => $first['url'],
                'channel_post' => null,
                'poster'       => $first['url'],       // rasm = o'z preview'i
                'thumb_source' => 'auto',
                'start_time'   => 0,
                'end_time'     => 0,
                'status'       => REELS_REQUIRE_APPROVAL ? 0 : 1,
            ]);
        } catch (\Throwable $e) {
            error_log('[Uploader] post insert: ' . $e->getMessage());
            self::cleanup($saved);
            return ['success' => false, 'message' => 'Bazaga yozilmadi'];
        }
        if (!$reelId) {
            self::cleanup($saved);
            return ['success' => false, 'message' => 'Bazaga yozilmadi'];
        }

        // Galereya elementlari
        foreach ($saved as $i => $m) {
            try {
                $this->db->insert('reel_media', [
                    'reel_id'    => $reelId,
                    'idx'        => $i,
                    'kind'       => 'image',
                    'video_type' => 'direct',
                    'video_url'  => $m['url'],
                    'poster'     => $m['url'],
                    'width'      => $m['width'],
                    'height'     => $m['height'],
                    'duration'   => 0,
                ]);
            } catch (\Throwable $e) {
                error_log('[Uploader] media insert: ' . $e->getMessage());
            }
        }

        return [
            'success'   => true,
            'id'        => (int) $reelId,
            'format'    => 'post',
            'aspect'    => '1:1',
            'carousel'  => $isCarousel,
            'media'     => array_map(function ($m) {
                return ['url' => $m['url'], 'w' => $m['width'], 'h' => $m['height']];
            }, $saved),
            'poster'    => $first['url'],
            'status'    => REELS_REQUIRE_APPROVAL ? 0 : 1,
            'message'   => REELS_REQUIRE_APPROVAL
                ? 'Yuborildi! Admin tasdiqlashidan keyin ko‘rinadi'
                : 'Yayinlandi!',
        ];
    }

    // ==================================================================
    //  3) VIDEO (reel 9:16 / long 16:9)
    // ==================================================================

    /**
     * Videoni Telegram kanalga joylab, `reels` yozuvini yaratadi.
     *
     * @param int    $userId
     * @param array  $file    bitta normalize qilingan fayl
     * @param string $format  'reel' | 'video'
     */
    private function createVideo($userId, array $file, $format, array $opts)
    {
        $isReel = ($format === 'reel');
        $limit  = ($isReel ? self::MAX_REEL_MB : self::MAX_VIDEO_MB) * 1024 * 1024;

        $err = self::checkFile($file, $limit, self::VIDEO_EXT, [
            'video/mp4', 'video/webm', 'video/quicktime',
            'application/octet-stream', 'video/x-m4v', 'video/x-matroska',
        ], 'video');
        if ($err !== null) {
            return ['success' => false, 'message' => $err];
        }
        if (REELS_CHANNEL === '') {
            return ['success' => false, 'message' => 'Kanal sozlanmagan (REELS_CHANNEL)'];
        }

        // ---- 3.1) THUMBNAIL: brauzer yuborgan kadr yoki placeholder -----
        $thumb = $this->savePoster($opts['poster'] ?? null, $file);
        $thumbSource = $thumb['saved'] ? 'client' : 'auto';

        // ---- 3.2) Caption ----
        $title = self::cleanText($opts['title'] ?? '', 200);
        if ($title === '') {
            $title = mb_substr(pathinfo((string) $file['name'], PATHINFO_FILENAME), 0, 200)
                   ?: ($isReel ? 'Reels' : 'Video');
        }
        $description = self::cleanText($opts['description'] ?? '', 500) ?: null;
        $caption = $title . ($description ? "\n\n" . $description : '');

        $ext  = strtolower(pathinfo((string) $file['name'], PATHINFO_EXTENSION));
        $mime = self::videoMime($ext);

        $tg = new TelegramBot();
        $tg->setTimeout(600);

        $res = $tg->sendVideo(REELS_CHANNEL, new CURLFile($file['tmp_name'], $mime, $file['name']), [
            'caption'            => $caption,
            'supports_streaming' => true,
        ]);
        if (!$res || empty($res['result']['message_id'])) {
            $res = $tg->sendDocument(REELS_CHANNEL, new CURLFile($file['tmp_name'], $mime, $file['name']), [
                'caption' => $caption,
            ]);
        }
        @unlink($file['tmp_name']);

        if (!$res || empty($res['result']['message_id'])) {
            $last = $tg->getLastError();
            return ['success' => false, 'message' =>
                'Kanalga joylab bo‘lmadi. Bot kanalda admin emas yoki post huquqi yo‘q.'
                . ($last ? ' (' . $last . ')' : '')];
        }

        $post = (int) $res['result']['message_id'];
        $link = (REELS_CHANNEL[0] === '@')
            ? 'https://t.me/' . substr(REELS_CHANNEL, 1) . '/' . $post
            : null;

        // Telegram o'zi poster yuborgan bo'lsa, o'shani olamiz.
        $posterUrl = $thumb['url'];
        if ($posterUrl === null) {
            $tgPhoto = $res['result']['video']['thumb']['file_id'] ?? '';
            if ($tgPhoto !== '') {
                $posterUrl = 'tg://' . $tgPhoto;
            }
        }
        if ($posterUrl === null) {
            $posterUrl = 'placeholder:' . self::placeholderPoster($format);
        }

        $row = [
            'user_id'      => $userId,
            'content_id'   => ((int) ($opts['content_id'] ?? 0)) > 0 ? (int) $opts['content_id'] : null,
            'episode_id'   => null,
            'kind'         => 'upload',
            'format'       => $isReel ? 'reel' : 'video',
            'aspect'       => $isReel ? '9:16' : '16:9',
            'title'        => $title,
            'description'  => $description,
            'video_type'   => 'telegram',
            'video_url'    => $link,
            'channel_post' => $post,
            'poster'       => mb_substr((string) $posterUrl, 0, 500),
            'thumb_source' => $posterUrl === 'placeholder:' . self::placeholderPoster($format)
                                ? 'auto' : $thumbSource,
            'start_time'   => 0,
            'end_time'     => 0,
            'status'       => REELS_REQUIRE_APPROVAL ? 0 : 1,
        ];

        try {
            $id = $this->db->insert('reels', $row);
        } catch (\Throwable $e) {
            error_log('[Uploader] video insert: ' . $e->getMessage());
            $id = 0;
        }
        if (!$id) {
            return ['success' => false, 'message' => 'Kanalga joylandi, lekin bazaga yozilmadi'];
        }

        // Bitta media qatori ham yozamiz — galereya o'quvchilar bir xil
        // yo'lni ishlatsin (carousel ham shu jadvaldan o'qiydi).
        try {
            $this->db->insert('reel_media', [
                'reel_id'    => (int) $id,
                'idx'        => 0,
                'kind'       => 'video',
                'video_type' => 'telegram',
                'video_url'  => $link,
                'poster'     => mb_substr((string) $posterUrl, 0, 500),
                'width'      => (int) ($opts['width'] ?? 0),
                'height'     => (int) ($opts['height'] ?? 0),
                'duration'   => (int) ($opts['duration'] ?? 0),
            ]);
        } catch (\Throwable $e) {
            error_log('[Uploader] video media insert: ' . $e->getMessage());
        }

        return [
            'success' => true,
            'id'      => (int) $id,
            'format'  => $isReel ? 'reel' : 'video',
            'aspect'  => $isReel ? '9:16' : '16:9',
            'link'    => $link,
            'poster'  => $posterUrl,
            'status'  => REELS_REQUIRE_APPROVAL ? 0 : 1,
            'message' => REELS_REQUIRE_APPROVAL
                ? 'Yuborildi! Admin tasdiqlashidan keyin ko‘rinadi'
                : 'Yayinlandi!',
        ];
    }

    // ==================================================================
    //  4) THUMBNAIL
    // ==================================================================

    /**
     * Brauzer yuborgan kadrni saqlaydi.
     * @param  array|null $posterFile $_FILES['poster']
     * @return array{saved: bool, url: ?string}
     */
    private function savePoster($posterFile, array $videoFile)
    {
        $f = self::normFiles($posterFile);
        if (!$f) {
            return ['saved' => false, 'url' => null];
        }
        $f = $f[0];
        $err = self::checkFile($f, 4 * 1024 * 1024, ['jpg', 'jpeg', 'png', 'webp'],
            ['image/jpeg', 'image/png', 'image/webp'], 'rasm');
        if ($err !== null) {
            return ['saved' => false, 'url' => null];
        }
        $vname = self::safeName(pathinfo((string) $videoFile['name'], PATHINFO_FILENAME));
        // GD yo'q — konvertatsiya qilinmaydi, shuning uchun kengaytma
        // SAQLANADI (boshqa kengaytma yozilsa brauzer rasmni
        // barchaqli ko'rsatishi mumkin, lekin toza bo'lmasdi).
        $ext = strtolower(pathinfo((string) $f['name'], PATHINFO_EXTENSION));
        $ext = in_array($ext, ['jpg', 'jpeg', 'png', 'webp'], true) ? $ext : 'jpg';
        $name = $vname . '_' . substr(bin2hex(random_bytes(6)), 0, 10) . '.' . $ext;
        $dest = self::THUMBS_DIR . '/' . $name;
        if (!@move_uploaded_file($f['tmp_name'], $dest)) {
            return ['saved' => false, 'url' => null];
        }
        @chmod($dest, 0644);
        return ['saved' => true, 'url' => self::urlFor($dest)];
    }

    /** ffmpeg yo'q — shuning uchun matnli placeholder (SVG data). */
    private static function placeholderPoster($format)
    {
        $label = ($format === 'reel') ? 'Reels' : 'Video';
        $svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">'
             . '<rect width="640" height="360" fill="#1a1f2b"/>'
             . '<text x="320" y="190" font-family="sans-serif" font-size="40"'
             . ' fill="#8b95a8" text-anchor="middle">' . $label . '</text></svg>';
        return 'data:image/svg+xml;base64,' . base64_encode($svg);
    }

    // ==================================================================
    //  5) YORDAMCHI
    // ==================================================================

    /** @return ?string 'reel'|'post'|'video' yoki null */
    public static function normFormat($f)
    {
        $f = strtolower(trim((string) $f));
        if ($f === '') return null;
        if ($f === 'reels') return 'reel';
        if ($f === 'image' || $f === 'images' || $f === 'carousel' || $f === 'gallery') return 'post';
        if ($f === 'long' || $f === 'longvideo' || $f === 'long_video' || $f === 'yt') return 'video';
        return in_array($f, ['reel', 'post', 'video'], true) ? $f : null;
    }

    /**
     * `$_FILES['media']` yoki `$_FILES['video']` ni ro'yxatga aylantiradi.
     * @return array<int,array<string,mixed>>
     */
    public static function normFiles($files)
    {
        if (empty($files) || !is_array($files)) return [];
        // Tekil fayl (bitta maydon) — ['name' => ...]
        if (isset($files['name'])) {
            if (is_array($files['name'])) {
                $out = [];
                $n = count($files['name']);
                for ($i = 0; $i < $n; $i++) {
                    $out[] = [
                        'name'     => (string) ($files['name'][$i] ?? ''),
                        'type'     => (string) ($files['type'][$i] ?? ''),
                        'tmp_name' => (string) ($files['tmp_name'][$i] ?? ''),
                        'error'    => $files['error'][$i] ?? UPLOAD_ERR_NO_FILE,
                        'size'     => (int) ($files['size'][$i] ?? 0),
                    ];
                }
                return $out;
            }
            return [$files];
        }
        // `media[]` ko'rinishida massiv massivi
        $out = [];
        foreach ($files as $k => $v) {
            if (!is_array($v) || !isset($v['name'])) continue;
            $out = array_merge($out, self::normFiles($v));
        }
        return $out;
    }

    /**
     * Bitta faylni tekshiradi. Xato bo'lsa xabar qaytaradi, aks holda null.
     */
    public static function checkFile($f, $maxBytes, array $allowExt, array $allowMime, $kindLabel)
    {
        if (!isset($f['error']) || is_array($f['error'])) {
            return 'Fayl yuklanmagan';
        }
        switch ($f['error']) {
            case UPLOAD_ERR_OK:
                break;
            case UPLOAD_ERR_INI_SIZE:
            case UPLOAD_ERR_FORM_SIZE:
                return 'Fayl juda katta (server limiti: ' . ini_get('upload_max_filesize') . ')';
            case UPLOAD_ERR_PARTIAL:
                return 'Fayl to‘liq yuklanmagan';
            case UPLOAD_ERR_NO_FILE:
                return 'Fayl tanlanmagan';
            default:
                return 'Yuklashda xatolik';
        }
        $tmp = (string) ($f['tmp_name'] ?? '');
        if ($tmp === '' || !is_uploaded_file($tmp)) {
            return 'Yuklangan fayl topilmadi';
        }
        $size = (int) ($f['size'] ?? 0);
        if ($size === 0) return 'Fayl bo‘sh';
        if ($size > $maxBytes) {
            return 'Fayl ' . self::mb($maxBytes) . ' dan kichik bo‘lishi kerak';
        }

        $ext = strtolower(pathinfo((string) ($f['name'] ?? ''), PATHINFO_EXTENSION));
        if (!in_array($ext, $allowExt, true)) {
            return 'Faqat ' . strtoupper(implode(', ', $allowExt)) . ' formatida';
        }
        // Haqiqiy formatni tekshirish (nom aldayishi mumkin).
        $mime = self::detectMime($tmp);
        if ($mime && !in_array($mime, $allowMime, true)) {
            return 'Bu fayl haqiqatan ' . $kindLabel . ' emas (' . $mime . ')';
        }
        return null;
    }

    private static function videoMime($ext)
    {
        switch ($ext) {
            case 'webm': return 'video/webm';
            case 'mov':  return 'video/quicktime';
            case 'mkv':  return 'video/x-matroska';
            default:     return 'video/mp4';
        }
    }

    private static function detectMime($path)
    {
        if (function_exists('finfo_open')) {
            $fi = finfo_open(FILEINFO_MIME_TYPE);
            if ($fi) {
                $m = finfo_file($fi, $path);
                finfo_close($fi);
                if ($m) return $m;
            }
        }
        $size = @getimagesize($path);
        return $size['mime'] ?? null;
    }

    /** Fayl nomini xavfsiz, noyob bilan qaytaradi. */
    private static function uniqueName($origName, $ext)
    {
        $base = self::safeName(pathinfo((string) $origName, PATHINFO_FILENAME));
        if ($base === '') $base = 'f';
        return $base . '_' . substr(bin2hex(random_bytes(6)), 0, 12) . '.' . $ext;
    }

    private static function safeName($s)
    {
        $s = preg_replace('/[^\p{L}\p{N}_\-]+/u', '-', (string) $s);
        $s = trim((string) $s, '-');
        return mb_substr($s ?: 'f', 0, 40);
    }

    /** Server papkasidan ommaviy URL. */
    public static function urlFor($absPath)
    {
        $base = str_replace('\\', '/', realpath(UPLOAD_DIR));
        $full = str_replace('\\', '/', $absPath);
        if ($base !== '' && strpos($full, $base) === 0) {
            $rel = ltrim(substr($full, strlen($base)), '/');
            return 'uploads/' . str_replace('%2F', '/', rawurlencode($rel));
        }
        return null;
    }

    private static function cleanText($s, $max)
    {
        $s = trim(strip_tags((string) $s));
        $s = preg_replace('/\s+/u', ' ', $s);
        return mb_substr((string) $s, 0, $max);
    }

    private static function mb($bytes)
    {
        return round($bytes / 1048576, 1) . ' MB';
    }

    /** Xatoda yozilgan vaqtinchalik fayllarni o'chiradi. */
    private static function cleanup(array $saved)
    {
        foreach ($saved as $m) {
            if (!empty($m['path']) && is_file($m['path'])) @unlink($m['path']);
        }
    }

    // ==================================================================
    //  6) O'QISH (galereya)
    // ==================================================================

    /**
     * Reelning barcha medialari (carousel uchun).
     * @return array<int,array<string,mixed>>
     */
    public function media($reelId)
    {
        $rows = $this->db->fetchAll(
            'SELECT idx, kind, video_type, video_url, poster, width, height, duration
               FROM reel_media WHERE reel_id = ? ORDER BY idx ASC',
            [(int) $reelId]
        );
        return is_array($rows) ? $rows : [];
    }
}