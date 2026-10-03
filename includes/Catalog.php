<?php
// ============================================================================
// Catalog - kino / anime / multfilm katalogi
// ============================================================================
// "uzdub" bazasidagi content + episodes + categories + genres jadvallari
// bilan ishlaydi. Eski "videos" prototipi emas.
//
// Oqim (playback) mantiqi:
//   'direct' - .mp4/.webm/.m3u8  -> <video src> (m3u8 uchun hls.js)
//   'embed'  - vk / rutube / mover / sibnet -> <iframe>
//   'file'   - bizning uploads/ papkamiz -> api/stream.php (Range/206)
//   'none'   - manzil yo'q
// ============================================================================

require_once __DIR__ . '/Database.php';

class Catalog {

    // =========================================================================
    // Kategoriyalar (Kino / Anime / Multfilm)
    // =========================================================================
    public function getCategories() {
        return $this->db()->fetchAll(
            "SELECT c.id, c.name, c.slug,
                    (SELECT COUNT(*) FROM content ct WHERE ct.category_id = c.id) AS count
             FROM categories c
             ORDER BY c.id"
        );
    }

    public function getCategoryBySlug($slug) {
        return $this->db()->fetchOne(
            "SELECT * FROM categories WHERE slug = ?", [$slug]
        );
    }

    // =========================================================================
    // Janrlar
    // =========================================================================
    public function getGenres($limit = 20) {
        return $this->db()->fetchAll(
            "SELECT g.id, g.name, g.slug, COUNT(cg.content_id) AS count
             FROM genres g
             LEFT JOIN content_genres cg ON cg.genre_id = g.id
             GROUP BY g.id, g.name, g.slug
             HAVING count > 0
             ORDER BY count DESC, g.name
             LIMIT ?", [(int) $limit]
        );
    }

    public function getContentGenres($contentId) {
        return $this->db()->fetchAll(
            "SELECT g.id, g.name, g.slug
             FROM content_genres cg
             JOIN genres g ON g.id = cg.genre_id
             WHERE cg.content_id = ?", [(int) $contentId]
        );
    }

    // =========================================================================
    // Katalog ro'yxati
    // =========================================================================
    /**
     * @param array $opt category_slug, genre_id, search, sort, limit, offset
     */
    public function listContent($opt = []) {
        $limit  = (int) ($opt['limit']  ?? CATALOG_PAGE_SIZE);
        $offset = (int) ($opt['offset'] ?? 0);
        $sort   = $opt['sort'] ?? 'new';

        $where  = ["1 = 1"];
        $params = [];

        if (!empty($opt['category_slug'])) {
            // DIQQAT: alias "cat" - bu categories jadvali (JOIN qilingan),
            // "c" esa content jadvali. "c.slug_cat" desak SQL xato beradi.
            $where[] = 'cat.slug = ?';
            $params[] = $opt['category_slug'];
        }
        if (!empty($opt['genre_id'])) {
            $where[] = 'EXISTS (SELECT 1 FROM content_genres cg WHERE cg.content_id = c.id AND cg.genre_id = ?)';
            $params[] = (int) $opt['genre_id'];
        }
        if (!empty($opt['search'])) {
            $like = '%' . $opt['search'] . '%';
            // Raqamli qidiruv = ID bo'yicha ham (foydalanuvchi "12" deb
            // yozsa, 12-ID li kontent ham topiladi).
            if (ctype_digit(trim((string) $opt['search']))) {
                $where[] = '(c.title LIKE ? OR c.description LIKE ? OR c.id = ?)';
                $params[] = $like;
                $params[] = $like;
                $params[] = (int) $opt['search'];
            } else {
                $where[] = '(c.title LIKE ? OR c.description LIKE ?)';
                $params[] = $like;
                $params[] = $like;
            }
        }
        if (isset($opt['is_series'])) {
            $where[] = 'c.is_series = ?';
            $params[] = (int) $opt['is_series'];
        }

        $order = match ($sort) {
            'popular'  => 'c.views DESC, c.created_at DESC',
            'rating'   => 'c.rating DESC, c.views DESC',
            'az'       => 'c.title ASC',
            default    => 'c.created_at DESC, c.id DESC',
        };

        $sql = "SELECT c.*, cat.name AS category_name, cat.slug AS category_slug,
                       (SELECT COUNT(*) FROM episodes e WHERE e.content_id = c.id) AS episode_count
                FROM content c
                JOIN categories cat ON cat.id = c.category_id
                WHERE " . implode(' AND ', $where) . "
                ORDER BY $order
                LIMIT $limit OFFSET $offset";

        return $this->db()->fetchAll($sql, $params);
    }

    public function countContent($opt = []) {
        $where  = ["1 = 1"];
        $params = [];
        if (!empty($opt['category_slug'])) {
            $where[] = 'cat.slug = ?';
            $params[] = $opt['category_slug'];
        }
        if (!empty($opt['genre_id'])) {
            $where[] = 'EXISTS (SELECT 1 FROM content_genres cg WHERE cg.content_id = c.id AND cg.genre_id = ?)';
            $params[] = (int) $opt['genre_id'];
        }
        if (!empty($opt['search'])) {
            $like = '%' . $opt['search'] . '%';
            if (ctype_digit(trim((string) $opt['search']))) {
                $where[] = '(c.title LIKE ? OR c.description LIKE ? OR c.id = ?)';
                $params[] = $like;
                $params[] = $like;
                $params[] = (int) $opt['search'];
            } else {
                $where[] = '(c.title LIKE ? OR c.description LIKE ?)';
                $params[] = $like;
                $params[] = $like;
            }
        }

        $row = $this->db()->fetchOne(
            "SELECT COUNT(*) AS n FROM content c
             JOIN categories cat ON cat.id = c.category_id
             WHERE " . implode(' AND ', $where),
            $params
        );
        return (int) ($row['n'] ?? 0);
    }

    /** Boshlang'ich ekran uchun: mashhur + yangi. */
    public function getHomeSections() {
        $out = [];

        $out['trending'] = $this->listContent([
            'sort' => 'popular', 'limit' => CATALOG_HOME_LIMIT,
        ]);

        $out['new'] = $this->listContent([
            'sort' => 'new', 'limit' => CATALOG_HOME_LIMIT,
        ]);

        // Har bir kategoriya uchun bir qator
        foreach ($this->getCategories() as $cat) {
            $row = $this->listContent([
                'category_slug' => $cat['slug'],
                'sort' => 'popular',
                'limit' => 8,
            ]);
            if ($row) {
                $out['by_category'][] = [
                    'category' => $cat,
                    'items'    => $row,
                ];
            }
        }

        return $out;
    }

    // =========================================================================
    // Bitta kontent + qismlari
    // =========================================================================
    public function getContent($id) {
        return $this->db()->fetchOne(
            "SELECT c.*, cat.name AS category_name, cat.slug AS category_slug
             FROM content c
             JOIN categories cat ON cat.id = c.category_id
             WHERE c.id = ?", [(int) $id]
        );
    }

    public function getContentBySlug($slug) {
        return $this->db()->fetchOne(
            "SELECT c.*, cat.name AS category_name, cat.slug AS category_slug
             FROM content c
             JOIN categories cat ON cat.id = c.category_id
             WHERE c.slug = ?", [$slug]
        );
    }

    public function getEpisodes($contentId) {
        return $this->db()->fetchAll(
            "SELECT id, content_id, season, episode_number, title, thumbnail,
                    video_type, video_url, video_url_1080p, video_url_720p,
                    duration, description, is_premium
             FROM episodes
             WHERE content_id = ?
             ORDER BY season ASC, episode_number ASC", [(int) $contentId]
        );
    }

    public function getEpisode($episodeId) {
        return $this->db()->fetchOne(
            "SELECT e.*, c.title AS content_title, c.category_id,
                    cat.name AS category_name, cat.slug AS category_slug
             FROM episodes e
             JOIN content c ON c.id = e.content_id
             JOIN categories cat ON cat.id = c.category_id
             WHERE e.id = ?", [(int) $episodeId]
        );
    }

    // =========================================================================
    // Oqim (playback) aniqlash
    // =========================================================================
    /**
     * $item - content yoki episode qatori.
     * Qaytaradi:
     *   type    : 'direct' | 'hls' | 'embed' | 'file' | 'none'
     *   url     : <video src> yoki <iframe src>
     *   mime    : direct/hls uchun
     *   warning : foydalanuvchiga ko'rsatiladigan ogohlantirish
     */
    public function getPlayback($item) {
        if (!$item) {
            return $this->playbackNone('Kontent topilmadi');
        }

        // Tanlangan sifat: 1080p -> 720p -> asosiy
        $url = $item['video_url_1080p'] ?? null;
        if (empty($url)) {
            $url = $item['video_url_720p'] ?? null;
        }
        if (empty($url)) {
            $url = $item['video_url'] ?? null;
        }
        $url = trim((string) $url);

        if ($url === '') {
            return $this->playbackNone('Bu kontent uchun video manzili kiritilmagan');
        }

        // 1) Bizning serverimizdagi fayl
        if (strpos($url, 'api/stream.php') !== false || strpos($url, SITE_URL) === 0) {
            return [
                'type' => 'file', 'url' => $url, 'mime' => 'video/mp4',
                'seek' => true, 'warning' => null,
            ];
        }

        // 2) Oqim turini URL dan aniqlaymiz
        return $this->playbackFromUrl($url, $item);
    }

    /** URL ni tahlil qilib 'direct' | 'hls' | 'embed' | 'file' | 'none' qaytaradi. */
    public function playbackFromUrl($url, $item = null) {
        $path   = strtolower((string) parse_url($url, PHP_URL_PATH));
        $host   = strtolower((string) parse_url($url, PHP_URL_HOST));

        // HLS (.m3u8) - hls.js orqali o'qiladi
        if (substr($path, -5) === '.m3u8') {
            return [
                'type' => 'hls', 'url' => $url, 'mime' => 'application/x-mpegURL',
                'seek' => true,
                'warning' => 'Bu HLS oqim. Ba\'zi brauzerlar to\'g\'ridan-to\'g\'ri qo\'llamaydi - hls.js yuklanmoqda.',
            ];
        }

        // --- Sibnet: o'lik ".mp4" havolalarni tirik player sahifasiga almashtirish
        //
        // Bazadagi sibnet manbalari ko'p hollarda shaklda:
        //     https://video.sibnet.ru/v/<hash>/<videoid>.mp4
        // DIQQAT: bu havolalar HAQIQIY video fayl EMAS. Tekshirilganda
        // 200 qaytaradi, lekin tanasi bo'sh HTML sahifa (0 bayt) - ya'ni
        // o'lik havola. <video src> bilan hech narsa ko'rinmaydi.
        //
        // Yechim: oxirgi qismdagi <videoid> ni olib, shell.php sahifasiga
        // o'tkazamiz. U ishlaydi (200 + player ichida) va X-Frame-Options
        // bermagani uchun iframe ga ham ruxsat beradi.
        //
        // DIQQAT: bu tekshiruv ".mp4" tekshiruvidan OLDIN turishi shart,
        // aks holda o'lik havola "direct" deb baholanib, o'ynatilmaydi.
        if (preg_match('#(^|\.)(video\.)?sibnet\.(ru|com)$#', $host)) {
            $videoId = 0;
            if (preg_match('#/v/[^/]+/(\d+)\.mp4$#', $path, $m)) {
                $videoId = (int) $m[1];
            } elseif (preg_match('/[?&]videoid=(\d+)/', $url, $m)) {
                $videoId = (int) $m[1];
            }

            if ($videoId > 0) {
                return [
                    'type' => 'embed',
                    'url'  => 'https://video.sibnet.ru/shell.php?videoid=' . $videoId,
                    'mime' => null,
                    'seek' => false,
                    'warning' => null,
                ];
            }
        }

        // To'g'ridan-to'g'ri fayl
        if (preg_match('/\.(mp4|webm|ogv|ogg|mov|mkv)(\?|$)/i', $path)) {
            return [
                'type' => 'direct', 'url' => $url, 'mime' => $this->mimeFromPath($path),
                'seek' => true, 'warning' => null,
            ];
        }

        // Sayt sahifalari -> embed ga aylantirish
        $embed = $this->toEmbedUrl($url);
        if ($embed) {
            return [
                'type' => 'embed', 'url' => $embed, 'mime' => null,
                'seek' => false, 'warning' => null,
            ];
        }

        // --- Telegram post -> NOL YUK arxitekturasi ("Telegram'da ko'rish")
        //
        // t.me havolasi (masalan https://t.me/Kinolark/9147) HTML sahifa,
        // <video src> uchun to'g'ridan-to'g'ri ishlatib bo'lmaydi.
        //
        // ASOSIY TAMOYIL: video sizning serveringizga umuman tegmaydi.
        // Tomoshabinning brauzeri videoni to'g'ridan-to'g'ri Telegram
        // serveridan oladi, sayt esa faqat katalog (bir necha KB HTML) beradi.
        // Shu sababli minglab bir vaqtda ko'ruvchilar saytga deyarli
        // umuman yuk tushirmaydi.
        //
        // Ketma-ketlik:
        //   0) admin "preview=1" -> eski jonli relay (faqat tekshirish uchun)
        //   1) HLS_ENABLED (VPS + ffmpeg bo'lganda)
        //   2) Telegram ommaviy CDN video URL beradigan post (kichik video)
        //      -> to'g'ridan-to'g'ri HTML5 player, yana ham nol yuk
        //   3) Qolgan barcha filmlar (katta hajm) -> "Telegram'da ko'rish"
        if (preg_match('#(^|\.)(t\.me|telegram\.me)$#', $host)
            && preg_match('#^/(?:c/)?[A-Za-z0-9_]+/\d+$#', $path)) {

            $cid = isset($item['content_id']) ? (int) $item['content_id'] : (int) ($item['id'] ?? 0);
            $eid = isset($item['content_id']) ? (int) $item['id'] : 0;

            // (0) ADMIN TEKSHIRUV REJIMI (eski "jonli uzatish").
            // Faqat "?preview=1" + admin sessiyasi bilan ishlaydi. Ommaviy
            // trafikda butunlay o'chirilgan: har bir ko'ruvchi uchun butun film
            // SERVER orqali oqar edi (terabayt trafik), minglab kishida
            // arzon hosting birinchi kunda o'lardi.
            if (self::relayForPreview()) {
                return [
                    'type' => 'file',
                    'url'  => 'api/live.php?id=' . $cid . '&episode=' . $eid,
                    'mime' => 'video/mp4',
                    'seek' => true,
                    'warning' => 'ADMIN TEKSHIRUV rejimi: video server orqali uzatilmoqda '
                        . '(oddiy tomoshabin uchun esa Telegram\'da ochiladi).',
                ];
            }

            // (1) HLS REJIMI (faqat VPS + ffmpeg bo'lganda): filmlar segmentlarga
            // bo'linadi, har bir segment deterministik URL'da edge'da keshlanadi.
            if (defined('HLS_ENABLED') && HLS_ENABLED) {
                return [
                    'type' => 'hls',
                    'url'  => 'api/hls.php?id=' . $cid . '&episode=' . $eid,
                    'mime' => 'application/vnd.apple.mpegurl',
                    'seek' => true,
                    'warning' => 'Cloudflare edge CDN orqali uzatilmoqda (HLS).',
                ];
            }

            // (2) Postni aniqlash: t.me sahifasi + "?embed=1" widget tahlili
            // (TgResolve ichida 6 soat keshlanadi — har ko'rishda t.me ga
            // so'rov ketmaydi).
            $tg = null;
            try {
                $tg = (new TgResolve())->resolve((string) $url);
            } catch (\Throwable $e) {
                $tg = null; // tahlil xatosi — quyidagi "Telegram'da ochish" ishlaydi
            }

            $tgVideo = ($tg && !empty($tg['video'])) ? $tg['video'] : null;
            $tgImage = ($tg && !empty($tg['image'])) ? $tg['image'] : null;

            // (3) Telegram ommaviy CDN video URL beradigan post (kichik video,
            // qisqa klip) -> to'g'ridan-to'g'ri <video> o'ynatamiz. Bu ham
            // NOL YUK: brauzer videoni Telegram CDN'dan oladi.
            if ($tgVideo) {
                $playUrl = $tgVideo;
                $worker  = trim((string) env_value('CLOUDFLARE_WORKER_URL', ''));
                if ($worker !== '') {
                    $srcHost = strtolower((string) parse_url($tgVideo, PHP_URL_HOST));
                    if (preg_match('#(^|\.)(telesco\.pe|cdn-telegram\.org)$#', $srcHost)) {
                        $playUrl = rtrim($worker, '/') . '/?url=' . rawurlencode($tgVideo);
                    }
                }
                return [
                    'type' => 'file', 'url' => $playUrl, 'mime' => 'video/mp4',
                    'poster' => $tgImage, 'seek' => true,
                    'warning' => $playUrl === $tgVideo
                        ? 'Video to‘g‘ridan-to‘g‘ri Telegram CDN‘dan oqadi — saytga yuk tushmaydi.'
                        : 'Telegram videosi Cloudflare Edge CDN orqali uzatilmoqda.',
                ];
            }

            // (4) ASOSIY HOLAT: katta filmlar (Telegram ulardan ommaviy
            // video URL bermaydi) — "Telegram'da ko'rish" tugmasi.
            return $this->playbackTelegram((string) $url, $tgImage, $tg);
        }

        // Noma'lum - lekin ruxsat etilgan domen bo'lsa, iframe bilan urinib ko'ramiz
        if ($this->isAllowedEmbedHost($host)) {
            return [
                'type' => 'embed', 'url' => $url, 'mime' => null,
                'seek' => false,
                'warning' => 'Bu manba to\'g\'ridan-to\'g\'ri video fayl emas - sayt ichida oqishi tekshirilmoqda.',
            ];
        }

        // Ruxsat etilmagan domen
        return [
            'type' => 'none', 'url' => null, 'mime' => null, 'seek' => false,
            'warning' => 'Video manzili noma\'lum yoki xavfsiz emas: ' . $host,
        ];
    }

    /**
     * Turli saytlarning sahifa manzilini iframe uchun embed manzilga
     * o'zgartiradi. Noma'lum manzil uchun null.
     */
    private function toEmbedUrl($url) {
        $host = strtolower((string) parse_url($url, PHP_URL_HOST));
        $path = (string) parse_url($url, PHP_URL_PATH);

        // --- Rutube: rutube.ru/video/<hash>/  ->  rutube.ru/play/embed/<hash>/
        if (preg_match('#(^|\.)rutube\.(ru|com)$#', $host)
            && preg_match('#/video/([A-Za-z0-9]+)#', $path, $m)) {
            return 'https://rutube.ru/play/embed/' . $m[1] . '/';
        }

        // --- VK: vkvideo.ru/video-<oid>_<id>  ->  vk.com/video_ext.php
        // DIQQAT: minus belgisi oid ichida emas, "/video" dan KEYIN keladi:
        // "/video-186124728_456247864". Shu sababli belgidan keyin -? qo'yilmaydi,
        // aks holda oid = "-186124728" bo'lib qoladi.
        if (preg_match('#(^|\.)(vkvideo\.ru|vk\.com)$#', $host)
            && preg_match('#/video-?(\d+)_(\d+)#', $path, $m)) {
            return 'https://vk.com/video_ext.php?oid=' . $m[1] . '&id=' . $m[2] . '&hd=2';
        }

        // --- Uqload: /e/<token>?strm<...>  ->  /e/<token>
        // "strm..." kesh buzuvchi parametri; iframe uchun kerak emas.
        if (preg_match('#(^|\.)uqload\.(is|to|com)$#', $host)
            && preg_match('#/e/([A-Za-z0-9]+)#', $path, $m)) {
            return 'https://uqload.is/e/' . $m[1];
        }

        // --- Mover: allaqachon embed yoki oddiy havola
        if (preg_match('#(^|\.)mover\.uz$#', $host)) {
            if (strpos($path, '/video/embed/') === 0) {
                return $url;
            }
            if (preg_match('#/video/([A-Za-z0-9]+)#', $path, $m)) {
                return 'https://mover.uz/video/embed/' . $m[1];
            }
        }

        // --- YouTube
        if (preg_match('#(^|\.)(youtube\.com|youtu\.be)$#', $host)) {
            if (preg_match('#/embed/([A-Za-z0-9_-]+)#', $path, $m)) {
                return $url;
            }
            if (preg_match('#/watch\?v=([A-Za-z0-9_-]+)#', $url, $m)) {
                return 'https://www.youtube.com/embed/' . $m[1];
            }
            if (preg_match('#youtu\.be/([A-Za-z0-9_-]+)#', $url, $m)) {
                return 'https://www.youtube.com/embed/' . $m[1];
            }
        }

        // --- Ok.ru
        if (preg_match('#(^|\.)ok\.ru$#', $host)
            && preg_match('#/video/(\d+)#', $path, $m)) {
            return 'https://ok.ru/videoembed/' . $m[1];
        }

        // --- Kodik
        if (preg_match('#(^|\.)kodikbd\.com$#', $host)
            && preg_match('#/(?:video|film)/([a-z0-9_-]+)/([a-z0-9_-]+)#i', $path, $m)) {
            return 'https://kodikbd.com/embed-full/' . $m[1] . '/' . $m[2];
        }

        return null;
    }

    private function isAllowedEmbedHost($host) {
        if ($host === '') {
            return false;
        }
        $host = preg_replace('/^www\./', '', $host);
        foreach (explode(',', ALLOWED_EMBED_HOSTS) as $allowed) {
            $allowed = trim(strtolower($allowed));
            if ($allowed === '') {
                continue;
            }
            if ($host === $allowed || substr($host, -(strlen($allowed) + 1)) === '.' . $allowed) {
                return true;
            }
        }
        return false;
    }

    private function mimeFromPath($path) {
        if (substr($path, -5) === '.webm') return 'video/webm';
        if (substr($path, -4) === '.ogv')  return 'video/ogg';
        if (substr($path, -4) === '.mov')  return 'video/quicktime';
        if (substr($path, -4) === '.mkv')  return 'video/x-matroska';
        return 'video/mp4';
    }

    /**
     * Serverdagi fayl uchun Content-Type (api/stream.php ishlatadi).
     */
    public static function mimeFromFile($path) {
        $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
        $map = [
            'mp4'  => 'video/mp4',
            'webm' => 'video/webm',
            'ogv'  => 'video/ogg',
            'mov'  => 'video/quicktime',
            'mkv'  => 'video/x-matroska',
            'm3u8' => 'application/vnd.apple.mpegurl',
        ];
        return $map[$ext] ?? 'video/mp4';
    }

    private function playbackNone($warning) {
        return [
            'type' => 'none', 'url' => null, 'mime' => null,
            'seek' => false, 'warning' => $warning,
        ];
    }

    /**
     * "Telegram'da ko'rish" oqimi - NOL YUK arxitekturasi.
     *
     * Nima uchun shu yechim: video sizning serveringizga umuman tegmaydi.
     * Tomoshabinning brauzeri videoni to'g'ridan-to'g'ri Telegram CDN'dan
     * oladi (t.me posti yoki tg:// deep link), sayt esa faqat katalog -
     * bir necha KB HTML - beradi. Shu sababli minglab bir vaqtda ko'ruvchilar
     * saytga deyarli umuman yuk tushirmaydi.
     *
     * Katta filmlarda Telegram ommaviy video URL bermaydi ("Media is too
     * big") - shuning uchun ular FAQAT Telegram ilovasida o'ynaydi.
     * Kichik videolarda esa yuqoridagi (3)-branch to'g'ridan-to'g'ri
     * o'ynatadi - u ham nol yuk.
     *
     * @param string $url    t.me post manzili
     * @param string|null $poster  Telegram CDN poster (og:image)
     * @param array|null $tg   TgResolve natijasi (og'iltirish uchun)
     */
    private function playbackTelegram($url, $poster = null, $tg = null) {
        $path      = (string) parse_url((string) $url, PHP_URL_PATH);
        $channel   = null;   // ommaviy kanal (@wcinemauz)
        $post      = 0;
        $deep      = null;   // mobil ilovada to'g'ridan-to'g'ri ochish

        if (preg_match('#^/c/(\d+)/(\d+)#', $path, $m)) {
            // Xususi kanal: t.me/c/<id>/<post>
            $channel = null;
            $post    = (int) $m[2];
            $deep    = 'tg://privatepost?channel=' . $m[1] . '&post=' . $post;
        } elseif (preg_match('#^/([A-Za-z0-9_]+)/(\d+)#', $path, $m)) {
            $channel = $m[1];
            $post    = (int) $m[2];
            $deep    = 'tg://resolve?domain=' . $channel . '&post=' . $post;
        }

        $big = $tg && !empty($tg['media_big']);

        return [
            'type'    => 'telegram',
            'url'     => $url,          // t.me post - desktop/vebda shu ochiladi
            'deep'    => $deep,         // tg:// - telefonda ilova ichida ochiladi
            'channel' => $channel,      // @wcinemauz (ko'rsatish uchun)
            'post'    => $post,
            'poster'  => $poster,
            'mime'    => null,
            'seek'    => false,
            'warning' => $big
                ? 'Katta hajmli film. Sayt uni Telegram serveridan to‘g‘ridan-to‘g‘ri o‘ynatadi '
                  . '— saytga yuk tushmaydi, ilovaga o‘tish shart emas.'
                : 'Video Telegram serveridan to‘g‘ridan-to‘g‘ri oqadi — saytga yuk tushmaydi.',
        ];
    }

    /**
     * Jonli relay (api/live.php) faqat ADMIN TEKSHIRUV uchun.
     *
     * Nima uchun ommaviy ishlatilmaydi: har bir tomoshabin uchun film
     * SERVER orqali oqadi. 1000 kishi bir vaqtda ko'rsa - kuniga terabayt
     * trafik, protsessor va disk I/O; arzon hosting (yoki VPS) buni ko'taramaydi.
     * Endi faqat "?preview=1" va admin sessiyasi bilan yoqiladi.
     */
    private static function relayForPreview() {
        if ((string) ($_GET['preview'] ?? '') !== '1') {
            return false;
        }
        try {
            return (new Auth())->isAdmin();
        } catch (\Throwable $e) {
            return false;
        }
    }

    /**
     * Poster manzilini <img> uchun moslashtiradi.
     *
     * t.me post havolasi (https://t.me/Kinolark/9147) HTML sahifa — rasm
     * emas. Uning o'rniga api/tg-resolve.php?mode=img ishlatiladi: server
     * og:image CDN manzilini topib 302 qaytaradi. Boshqa manzillar
     * o'zgartirilmaydi.
     */
    public static function posterSrc($poster) {
        if ($poster === null || $poster === '') {
            return $poster;
        }
        $poster = (string) $poster;
        $host = strtolower((string) parse_url($poster, PHP_URL_HOST));
        if (!preg_match('#(^|\.)(t\.me|telegram\.me)$#', $host)) {
            return $poster;
        }
        $path = (string) parse_url($poster, PHP_URL_PATH);
        if (!preg_match('#^/(?:c/)?[A-Za-z0-9_]+/\d+$#', $path)) {
            return $poster;
        }
        return 'api/tg-resolve.php?url=' . rawurlencode($poster) . '&mode=img';
    }

    // =========================================================================
    // Like
    // =========================================================================
    public function hasLiked($userId, $contentId) {
        $row = $this->db()->fetchOne(
            "SELECT id FROM likes WHERE user_id = ? AND content_id = ? LIMIT 1",
            [(int) $userId, (int) $contentId]
        );
        return (bool) $row;
    }

    public function toggleLike($contentId, $userId) {
        $item = $this->getContent($contentId);
        if (!$item) {
            return ['success' => false, 'message' => 'Kontent topilmadi'];
        }

        $existing = $this->db()->fetchOne(
            "SELECT id FROM likes WHERE user_id = ? AND content_id = ? LIMIT 1",
            [(int) $userId, (int) $contentId]
        );

        if ($existing) {
            $this->db()->query("DELETE FROM likes WHERE id = ?", [$existing['id']]);
            return ['success' => true, 'liked' => false];
        }

        $ok = $this->db()->insert('likes', [
            'user_id'    => (int) $userId,
            'content_id' => (int) $contentId,
            'type'       => 'like',
        ]);
        if (!$ok) {
            return ['success' => false, 'message' => 'Like saqlanmadi'];
        }

        // Muallifga xabar (agar boshqa foydalanuvchi bo'lsa)
        if (!empty($item['user_id']) && (int) $item['user_id'] !== (int) $userId) {
            $this->db()->insert('notifications', [
                'user_id'    => (int) $item['user_id'],
                'type'       => 'like',
                'title'      => 'Yangi like',
                'message'    => $item['title'],
                'target_url' => SITE_URL . '/index.php?c=' . (int) $contentId,
            ]);
        }

        return ['success' => true, 'liked' => true];
    }

    public function getLikeCount($contentId) {
        $row = $this->db()->fetchOne(
            "SELECT COUNT(*) AS n FROM likes WHERE content_id = ?", [(int) $contentId]
        );
        return (int) ($row['n'] ?? 0);
    }

    // =========================================================================
    // Watchlist
    // =========================================================================
    public function inWatchlist($userId, $contentId) {
        $row = $this->db()->fetchOne(
            "SELECT id FROM watchlist WHERE user_id = ? AND content_id = ? LIMIT 1",
            [(int) $userId, (int) $contentId]
        );
        return (bool) $row;
    }

    public function toggleWatchlist($contentId, $userId) {
        $existing = $this->db()->fetchOne(
            "SELECT id FROM watchlist WHERE user_id = ? AND content_id = ? LIMIT 1",
            [(int) $userId, (int) $contentId]
        );

        if ($existing) {
            $this->db()->query("DELETE FROM watchlist WHERE id = ?", [$existing['id']]);
            return ['success' => true, 'in_watchlist' => false];
        }

        $ok = $this->db()->insert('watchlist', [
            'user_id'    => (int) $userId,
            'content_id' => (int) $contentId,
        ]);
        return ['success' => (bool) $ok, 'in_watchlist' => (bool) $ok];
    }

    public function getWatchlist($userId, $limit = 50) {
        return $this->db()->fetchAll(
            "SELECT c.*, cat.name AS category_name, cat.slug AS category_slug, w.created_at AS added_at
             FROM watchlist w
             JOIN content c ON c.id = w.content_id
             JOIN categories cat ON cat.id = c.category_id
             WHERE w.user_id = ?
             ORDER BY w.created_at DESC
             LIMIT " . (int) $limit,
            [(int) $userId]
        );
    }

    // =========================================================================
    // Ko'rish progressi
    // =========================================================================
    public function getProgress($userId, $contentId, $episodeId = 0) {
        $row = $this->db()->fetchOne(
            "SELECT * FROM watch_progress
             WHERE user_id = ? AND content_id = ? AND episode_id = ?",
            [(int) $userId, (int) $contentId, (int) $episodeId]
        );
        return $row ?: ['position_seconds' => 0, 'duration_seconds' => 0, 'is_completed' => 0];
    }

    public function saveProgress($userId, $contentId, $episodeId, $position, $duration) {
        $completed = ($duration > 0 && $position >= $duration * 0.95) ? 1 : 0;

        // UNIQUE(user_id, content_id, episode_id) - avval mavjudligini tekshiramiz
        $existing = $this->db()->fetchOne(
            "SELECT id FROM watch_progress
             WHERE user_id = ? AND content_id = ? AND episode_id = ?",
            [(int) $userId, (int) $contentId, (int) $episodeId]
        );

        $fields = [
            'position_seconds' => (int) $position,
            'duration_seconds' => (int) $duration,
            'is_completed'     => $completed,
        ];

        if ($existing) {
            $this->db()->update('watch_progress', $fields, 'id = ?', [$existing['id']]);
        } else {
            $fields['user_id']    = (int) $userId;
            $fields['content_id'] = (int) $contentId;
            $fields['episode_id'] = (int) $episodeId;
            $ok = $this->db()->insert('watch_progress', $fields);
            if (!$ok) {
                return ['success' => false, 'message' => 'Progress saqlanmadi'];
            }
        }

        // Ko'rish tarixi (UNIQUE(user_id, content_id, episode_id) - shuning
        // uchun upsert qilamiz, aks holda ikkinchi marta xato beradi)
        $this->db()->query(
            "INSERT INTO watch_history (user_id, content_id, episode_id, watched_at, progress_seconds)
             VALUES (?, ?, ?, NOW(), ?)
             ON DUPLICATE KEY UPDATE watched_at = NOW(), progress_seconds = ?",
            [(int) $userId, (int) $contentId, (int) $episodeId, (int) $position, (int) $position]
        );

        return ['success' => true, 'is_completed' => $completed];
    }

    public function getContinueWatching($userId, $limit = 10) {
        return $this->db()->fetchAll(
            "SELECT wp.*, c.title, c.poster, c.slug, cat.name AS category_name,
                    cat.slug AS category_slug
             FROM watch_progress wp
             JOIN content c ON c.id = wp.content_id
             JOIN categories cat ON cat.id = c.category_id
             WHERE wp.user_id = ? AND wp.is_completed = 0 AND wp.position_seconds > 10
             ORDER BY wp.updated_at DESC
             LIMIT " . (int) $limit,
            [(int) $userId]
        );
    }

    // =========================================================================
    // Ko'rishlar
    // =========================================================================
    public function incrementViews($contentId) {
        $this->db()->query(
            "UPDATE content SET views = views + 1 WHERE id = ?", [(int) $contentId]
        );
    }

    /**
     * UNIKAL ko'rish: bitta odam (viewer_key) bitta kontentni necha marta
     * ko'rmasin — FAQAT BIR MARTA sanaladi (YouTube uslubi).
     *
     * `content_views` da (content_id, viewer_key) UNIQUE. Shuning uchun
     * INSERT IGNORE takroriy yozuvni jimgina tashlab yuboradi va biz
     * haqiqiy unikal sonni COUNT(*) bilan qayta hisoblaymiz — xuddi
     * Reels::addView() kabi (increment emas).
     *
     * @param string $viewerKey  "u:<id>" | "tg:<id>" | "anon:<uuid>"
     */
    public function addUniqueView($contentId, $viewerKey) {
        $contentId = (int) $contentId;
        $viewerKey = trim((string) $viewerKey);
        if ($contentId <= 0 || $viewerKey === '') {
            return ['success' => false, 'message' => 'viewer aniqlanmadi', 'views' => 0];
        }

        $this->db()->query(
            "INSERT IGNORE INTO content_views (content_id, viewer_key) VALUES (?, ?)",
            [$contentId, $viewerKey]
        );

        $row = $this->db()->fetchOne(
            "SELECT COUNT(*) AS n FROM content_views WHERE content_id = ?",
            [$contentId]
        );
        $count = (int) ($row['n'] ?? 0);

        // content.views endi shu unikal sonning aynan nusxasi bo'ladi.
        $this->db()->query(
            "UPDATE content SET views = ? WHERE id = ?", [$count, $contentId]
        );

        return ['success' => true, 'views' => $count];
    }

    /**
     * Davomiylikni AVTOMATIK to'ldirish (server-side ffmpeg ishlatilmaydi —
     * brauzer <video> metadatasidan aniqlanadi). Mavjud qiymatni
     * o'zgartirmaymiz, faqat bo'sh (NULL/0) bo'lsa yozamiz.
     */
    public function saveDuration($contentId, $episodeId, $seconds) {
        $contentId = (int) $contentId;
        $episodeId = (int) $episodeId;
        $seconds   = (int) $seconds;
        if ($contentId <= 0 || $seconds <= 0) {
            return false;
        }

        $this->db()->query(
            "UPDATE content SET duration = ?
             WHERE id = ? AND (duration IS NULL OR duration <= 0)",
            [$seconds, $contentId]
        );

        if ($episodeId > 0) {
            $this->db()->query(
                "UPDATE episodes SET duration = ?
                 WHERE id = ? AND content_id = ? AND (duration IS NULL OR duration <= 0)",
                [$seconds, $episodeId, $contentId]
            );
        }

        return true;
    }

    // =========================================================================
    // Ommaviy ma'lumot
    // =========================================================================
    public function getStats() {
        $db = $this->db();
        return [
            'content'   => (int) ($db->fetchOne("SELECT COUNT(*) AS n FROM content")['n'] ?? 0),
            'episodes'  => (int) ($db->fetchOne("SELECT COUNT(*) AS n FROM episodes")['n'] ?? 0),
            'categories'=> (int) ($db->fetchOne("SELECT COUNT(*) AS n FROM categories")['n'] ?? 0),
            'genres'    => (int) ($db->fetchOne("SELECT COUNT(*) AS n FROM genres")['n'] ?? 0),
        ];
    }

    /** Ommaviy API uchun xavfsiz kontent ma'lumotlari. */
    public function toPublicArray($c, $viewerId = null) {
        $isSeries = !empty($c['is_series']);
        $epCount  = isset($c['episode_count']) ? (int) $c['episode_count'] : 0;

        $out = [
            'id'          => (int) $c['id'],
            'title'       => $c['title'],
            'description' => $c['description'] ?? '',
            'poster'      => self::posterSrc($c['poster'] ?? null),
            'banner'      => $c['banner_url'] ?? null,
            'category'    => $c['category_name'] ?? null,
            'category_slug' => $c['category_slug'] ?? null,
            'year'        => $c['release_year'] !== null ? (int) $c['release_year'] : null,
            'rating'      => (float) $c['rating'],
            'views'       => (int) $c['views'],
            'duration'    => isset($c['duration']) && $c['duration'] !== null
                                ? (int) $c['duration'] : null,
            'added_at'    => $c['created_at'] ?? null,
            'studio'      => $c['studio'] ?? null,
            'director'    => $c['director'] ?? null,
            'is_series'   => $isSeries,
            'episodes'    => $epCount,
            'total_episodes' => $c['total_episodes'] !== null ? (int) $c['total_episodes'] : $epCount,
            'is_premium'  => !empty($c['is_premium']),
        ];

        if ($viewerId) {
            $out['has_liked']     = $this->hasLiked($viewerId, $c['id']);
            $out['in_watchlist']  = $this->inWatchlist($viewerId, $c['id']);
            $out['likes']         = $this->getLikeCount($c['id']);
        }

        return $out;
    }

    private $dbInstance = null;
    private function db() {
        if ($this->dbInstance === null) {
            $this->dbInstance = Database::getInstance();
        }
        return $this->dbInstance;
    }
}
