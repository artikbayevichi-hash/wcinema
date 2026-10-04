<?php
// ============================================================================
// Reels - qisqa vertikal videolar
// ============================================================================
// Ikki turda reel bor:
//
//   'upload' - foydalanuvchi MP4 fayl YUKLAYDI (uploads/reels/ga).
//              Barcha qoidalar (format, hajm, uzunlik) qo'llanadi.
//
//   'clip'   - "virtual reel": mavjud film/qismdan bir bo'lak.
//              Fayl KO'CHIRILMAYDI - faqat content_id/episode_id +
//              start_time/end_time saqlanadi.
//
// Nima uchun 'clip' alohida tur? Sababi - iqtisodiy: 100 ta virtual reel
// yaratilsa, diskda 0 bayt qo'shiladi. Lekin foydalanuvchi uchun
// natija bir xil: qisqa vertikal video oqimda chiqadi.
//
// DIQQAT: 'clip' faqat o'zgartirish mumkin bo'lgan (direct/file/hls)
// manbadan yaratiladi. Embed (iframe) manbada vaqtni kesib bo'lmaydi -
// <iframe> ichiga currentTime berib yuborib bo'lmaydi. Shuning uchun
// embed manbadan clip yaratishga urinish "yo'q" xatosi bilan rad etiladi
// (jimgina "muvaffaqiyatsiz" desak, foydalanuvchi nima uchunini bilmaydi).
// ============================================================================

require_once __DIR__ . '/Database.php';
require_once __DIR__ . '/Catalog.php';
require_once __DIR__ . '/TelegramBot.php';
require_once __DIR__ . '/Notifications.php';
require_once __DIR__ . '/Alerts.php';

class Reels {

    /** Bildirishnomalar (lazy). */
    private $ntf = null;

    private function notifier() {
        if ($this->ntf === null) {
            $this->ntf = new Notifications();
        }
        return $this->ntf;
    }

    /** Telegram orqali instant bildirishnomalar (lazy). */
    private $alerts = null;

    private function alerts() {
        if ($this->alerts === null) {
            $this->alerts = new Alerts();
        }
        return $this->alerts;
    }

    // =====================================================================
    // O'qish
    // =====================================================================

    /**
     * Oqim (feed).
     *
     * @param int   $userId     joriy foydalanuvchi (yoki null) - "yoqdimi" belgisi uchun
     * @param int   $limit
     * @param int   $offset
     * @param string $sort  'new' | 'top' | 'mine'
     */
    public function getFeed($userId, $limit = 10, $offset = 0, $sort = 'new') {
        $limit  = max(1, min(30, (int) $limit));
        $offset = max(0, (int) $offset);

        // DIQQAT: "mine" saralash faqat o'z reel'larini ko'rsatadi -
        // shuning uchun status filtri qo'yilmaydi (kutilmoqda bo'lsa ham
        // ko'rinishi kerak, aks holda foydalanuvchi "yo'qoldi" deb
        // o'ylaydi va qayta yuklaydi).
        if ($sort === 'mine') {
            $where  = 'r.user_id = ?';
            $params = [(int) $userId];
            $order  = 'r.id DESC';
        } else {
            $where  = 'r.status = 1';
            $params = [];
            // "top" = o'zaroqlik bo'yicha (ko'rish x10 + yoqish x3).
            // Sababi: atigi 100 ko'rishli video ham 5000 yoqishli videodan
            // "mashhur" bo'lishi mumkin. Oddiy likes_count DESC esa
            // eski videolarni bir o'ringa yig'adi va yangi qisqa videolar
            // hech qachon yuqoriga chiqmay qoladi.
            $order = ($sort === 'top')
                ? '(r.views_count * 10 + r.likes_count * 3) DESC, r.id DESC'
                : 'r.id DESC';
        }

        $sql = "SELECT r.*,
                       u.username   AS author_username,
                       u.first_name AS author_name,
                       u.avatar     AS author_avatar,
                       c.title      AS content_title,
                       c.slug       AS content_slug,
                       e.episode_number AS episode_number,
                       e.season         AS episode_season
                FROM reels r
                LEFT JOIN users    u ON u.id = r.user_id
                LEFT JOIN content c ON c.id = r.content_id
                LEFT JOIN episodes e ON e.id = r.episode_id
                WHERE $where
                ORDER BY $order
                LIMIT $limit OFFSET $offset";

        $rows = $this->db()->fetchAll($sql, $params);
        return $this->decorate($rows, $userId);
    }

    public function countFeed($sort = 'new') {
        if ($sort === 'mine') {
            return 0; // "mine" uchun umumiy son kerak emas
        }
        $row = $this->db()->fetchOne("SELECT COUNT(*) AS c FROM reels WHERE status = 1");
        return (int) ($row['c'] ?? 0);
    }

    public function getReel($id, $userId = null) {
        $row = $this->db()->fetchOne(
            "SELECT r.*,
                    u.username   AS author_username,
                    u.first_name AS author_name,
                    u.avatar     AS author_avatar,
                    c.title      AS content_title,
                    c.slug       AS content_slug,
                    e.episode_number AS episode_number,
                    e.season         AS episode_season
             FROM reels r
             LEFT JOIN users    u ON u.id = r.user_id
             LEFT JOIN content c ON c.id = r.content_id
             LEFT JOIN episodes e ON e.id = r.episode_id
             WHERE r.id = ? LIMIT 1",
            [(int) $id]
        );
        if (!$row) {
            return null;
        }
        $out = $this->decorate([$row], $userId);
        return $out[0] ?? null;
    }

    /**
     * Reel'ni API uchun tayyorlash.
     *
     * Muhim nuqta - "playback": har bir reel o'z turiga qarab
     * ko'rsatiladi:
     *   file/direct -> <video src> (metadata: start_time/end_time)
     *   embed       -> <iframe>  (bo'lak kesib bo'lmaydi)
     *   none        -> ogohlantirish
     */
    private function decorate($rows, $userId) {
        if (!$rows) {
            return [];
        }

        $ids    = array_column($rows, 'id');
        $liked  = $userId ? $this->likedMap($ids, $userId) : [];
        // Instagram-uslubidagi holatlar: saqlangan / repost qilingan /
        // muallifni kuzatayaptimi. Bularning hammasi bitta-o'qishda
        // xarita sifatida olinadi (reel boshiga so'rov YO'Q).
        $saved    = $userId ? $this->flagMap('reel_saves', $ids, $userId) : [];
        $reposted = $userId ? $this->flagMap('reel_reposts', $ids, $userId) : [];

        $authorIds = array_values(array_unique(array_map('intval', array_column($rows, 'user_id'))));
        $following = $userId ? $this->followingMap($authorIds, $userId) : [];
        $followers = $this->followerCountMap($authorIds);

        // Galereya (carousel) ekanini bitta so'rov bilan aniqlaymiz:
        // ko'p media'si bor reel'lar "ko'p rasm" deb belgilanadi.
        $mediaCount = $this->mediaCountMap($ids);

        $out = [];
        foreach ($rows as $r) {
            $pb = $this->playback($r);
            $format = self::fmtFormat($r);
            $nMedia = (int) ($mediaCount[$r['id']] ?? 0);
            $isCarousel = ($format === 'post' && $nMedia > 1);

            // CTA: "🎬 To'liq qismni tomosha qilish (12:30 dan)"
            // Faqat 'clip' turida bor - upload turida asosiy kontent yo'q.
            $cta = null;
            if ($r['kind'] === 'clip' && $r['content_id']) {
                $cta = [
                    'label' => '🎬 To‘liq qismni tomosha qilish ('
                               . $this->fmtTime((int) $r['start_time']) . ' dan)',
                    'url'   => 'index.php?c=' . (int) $r['content_id']
                               . ($r['episode_id'] ? '&e=' . (int) $r['episode_id'] : '')
                               . '#t=' . (int) $r['start_time'],
                    'start' => (int) $r['start_time'],
                ];
            }

            $out[] = [
                'id'         => (int) $r['id'],
                'kind'       => $r['kind'],
                // --- YouTube/Instagram uslubidagi format turlari ---
                'format'     => $format,               // reel | post | video
                'aspect'     => self::fmtAspect($r),    // 9:16 | 1:1 | 16:9
                'is_carousel'=> $isCarousel,
                'media_count'=> $nMedia,
                'title'      => $r['title'] ?: ($r['content_title'] ?? 'Reels'),
                'description'=> $r['description'],
                'poster'     => $r['poster'] ?: ($pb['poster'] ?? null),
                'status'     => (int) $r['status'],
                // Rad etish sababi - faqat muallif va admin uchun ko'rsatiladi
                'reject_reason' => $r['reject_reason'] ?? null,
                'views'      => (int) ($r['views_count'] ?? 0),
                'likes'      => (int) ($r['likes_count'] ?? 0),
                'comments'   => (int) ($r['comments_count'] ?? 0),
                'shares'     => (int) ($r['shares_count'] ?? 0),
                'saves'      => (int) ($r['saves_count'] ?? 0),
                'reposts'    => (int) ($r['reposts_count'] ?? 0),
                'liked'      => !empty($liked[$r['id']]),
                'saved'      => !empty($saved[$r['id']]),
                'reposted'   => !empty($reposted[$r['id']]),
                'following'  => !empty($following[$r['user_id']]),
                'created_at' => $r['created_at'],
                'duration'   => $this->durationOf($r),
                'topic_id'   => !empty($r['tg_topic_id']) ? (int) $r['tg_topic_id'] : null,

                'playback'   => $pb,
                'cta'        => $cta,

                'author'     => [
                    'id'       => (int) $r['user_id'],
                    'username' => $r['author_username'] ?? null,
                    'name'     => ($r['author_name'] ?? '') ?: 'Foydalanuvchi',
                    'avatar'   => $r['author_avatar'] ?? null,
                    'followers'=> (int) ($followers[$r['user_id']] ?? 0),
                ],

                // Virtual reel qaysi kontentdan olingani (foydalanuvchi uchun
                // "bu nima?" savoliga javob)
                'source'     => !empty($r['content_id']) ? [
                    'content_id' => (int) $r['content_id'],
                    'title'      => $r['content_title'] ?? null,
                    'episode'    => !empty($r['episode_id']) ? (int) $r['episode_id'] : null,
                    'episode_no' => ($r['episode_number'] ?? null) !== null ? (int) $r['episode_number'] : null,
                    'season'     => ($r['episode_season'] ?? null) !== null ? (int) $r['episode_season'] : null,
                ] : null,
            ];
        }
        return $out;
    }

    /** Reel uzunligi (soniya). */
    private function durationOf($r) {
        if ((int) $r['end_time'] > (int) $r['start_time']) {
            return (int) $r['end_time'] - (int) $r['start_time'];
        }
        return 0;
    }

    /**
     * Reel formatini aniqlaydi: 'post' | 'video' | 'reel'.
     *
     * Eski (migratsiyadan oldingi) yozuvlarda `format` ustuni yo'q — ular
     * `kind='upload'` bo'lgani uchun odatdagdek 'reel' qaror qilinadi
     * (ilgari hammasi shu edi).
     */
    public static function fmtFormat($r) {
        $f = strtolower(trim((string) ($r['format'] ?? '')));
        if (in_array($f, ['post', 'video', 'reel'], true)) {
            return $f;
        }
        return 'reel';
    }

    /** Ko'rsatish nisbati. */
    public static function fmtAspect($r) {
        $a = strtolower(trim((string) ($r['aspect'] ?? '')));
        if (in_array($a, ['9:16', '1:1', '16:9'], true)) {
            return $a;
        }
        return self::fmtFormat($r) === 'post' ? '1:1' : '9:16';
    }

    /**
     * Reel id → media soni (galereya uchun).
     * @param  array $ids
     * @return array<int,int>
     */
    private function mediaCountMap($ids) {
        if (!$ids) return [];
        $in = implode(',', array_map('intval', $ids));
        $rows = $this->db()->fetchAll(
            "SELECT reel_id, COUNT(*) AS n FROM reel_media
              WHERE reel_id IN ($in) GROUP BY reel_id"
        );
        $map = [];
        foreach ($rows as $row) {
            $map[(int) $row['reel_id']] = (int) $row['n'];
        }
        return $map;
    }

    /**
     * Reel qanday ko'rsatiladi.
     *
     * 'clip' turida asosiy kontentning playback turi olinadi va
     * start/end vaqti qo'shiladi. Lekin FAQAT o'zgartirish mumkin
     * bo'lgan turlarda (direct/file/hls) - embed da currentTime
     * yo'qotiladi.
     */
    private function playback($r) {
        $start = (int) $r['start_time'];

        // --- rasm post (single / carousel): video emas, rasm ko'rsatiladi.
        if (self::fmtFormat($r) === 'post') {
            $url = (string) ($r['video_url'] ?? '');
            if ($url === '') {
                return ['type' => 'none', 'url' => null, 'warning' => 'Rasm topilmadi'];
            }
            return [
                'type'   => 'image',
                'url'    => $url,
                'poster' => $r['poster'] ?: $url,
                'start'  => 0,
                'seek'   => false,
            ];
        }

        // --- upload: Telegram kanalidagi video (yoki eski server fayli)
        if ($r['kind'] === 'upload') {
            if (empty($r['video_url'])) {
                return ['type' => 'none', 'url' => null, 'warning' => 'Video hali kanalga joylanmagan'];
            }

            // Telegram kanal posti -> nol yuk oqimi. Sayt serveri videoni
            // umuman uzatmaydi: brauzer videoni to'g'ridan-to'g'ri Telegram
            // CDN'dan oladi (kichik klip) yoki TgStream orqali kanal
            // postidan o'qiydi (katta video). Ikkalasi ham serverga yuk
            // tushirmaydi.
            $host = strtolower((string) parse_url((string) $r['video_url'], PHP_URL_HOST));
            if (preg_match('#(^|\.)(t\.me|telegram\.me)$#', $host)) {
                $pb = (new Catalog())->playbackFromUrl((string) $r['video_url']);
                if (empty($pb['poster']) && !empty($r['poster'])) {
                    $pb['poster'] = $r['poster'];
                }
                return $pb;
            }

            // Eski (migratsiyadan oldin yuklangan) server fayli.
            //
            // DIQQAT: fayl diskdan o'chib ketgan bo'lishi mumkin (tozalash,
            // ko'chirish). U holda `api/stream.php` 404 qaytaradi va <video>
            // "ochilmaydi" — foydalanuvchi "video buzuq" deb o'ylaydi.
            // Shuning uchun fayl borligini tekshiramiz: yo'q bo'lsa aniq
            // holat (type=none) qaytaramiz, buzuq oqim emas.
            $local = (string) $r['video_url'];
            $localAbs = __DIR__ . '/../' . ltrim(str_replace('\\', '/', $local), '/');
            if (!is_file($localAbs)) {
                return [
                    'type'    => 'none',
                    'url'     => null,
                    'warning' => 'Video fayli serverda topilmadi (ehtimol kanalga ko‘chirilmagan)',
                ];
            }
            return [
                'type'  => 'file',
                'url'   => 'api/stream.php?reel=' . (int) $r['id'],
                'mime'  => Catalog::mimeFromFile($local),
                'start' => 0,
                'seek'  => true,
            ];
        }

        // --- clip: asosiy kontentdan olingan bo'lak
        $item = null;
        if ($r['episode_id']) {
            $item = (new Catalog())->getEpisode((int) $r['episode_id']);
        } elseif ($r['content_id']) {
            $item = (new Catalog())->getContent((int) $r['content_id']);
        }

        if (!$item) {
            return ['type' => 'none', 'url' => null, 'warning' => 'Asosiy video topilmadi'];
        }

        $pb = (new Catalog())->getPlayback($item);

        if ($pb['type'] === 'embed') {
            // Vaqtni kesib bo'lmaydi - bo'lak o'rniga to'liq asosiy video
            // ko'rsatiladi (bo'lim boshida boshlanadi).
            $pb['warning'] = 'Bu bo‘lak to‘liq qismni ochadi (bo‘lakni kesish bu manbada mumkin emas)';
            $pb['start']   = 0;
            $pb['seek']    = false;
            return $pb;
        }

        if ($pb['type'] === 'none') {
            $pb['warning'] = $pb['warning'] ?: 'Video mavjud emas';
            return $pb;
        }

        $pb['start'] = $start;
        $pb['seek']  = true;
        return $pb;
    }

    // =====================================================================
    // Yaratish
    // =====================================================================

    /**
     * Virtual reel (bo'lak) yaratish.
     *
     * @param int   $userId
     * @param int   $contentId
     * @param int   $episodeId  0 = butun film
     * @param int   $start      sekund
     * @param int   $end        sekund
     * @param string $title
     * @param string $description
     */
    public function createClip($userId, $contentId, $episodeId, $start, $end, $title = '', $description = '') {
        $item = $episodeId > 0
            ? (new Catalog())->getEpisode($episodeId)
            : (new Catalog())->getContent($contentId);

        if (!$item) {
            return ['success' => false, 'message' => 'Kontent topilmadi'];
        }

        // DIQQAT: $item["id"] har doim CONTENT id emas.
        //   getEpisode() -> id = episode.id, content_id = content.id
        //   getContent() -> id = content.id
        // Agar bitta qilib "$item['id']" yozilsa, episode'dan yaratilgan
        // bo'lakda reels.content_id ga EPISODE id yozilardi. Keyin CTA
        // havolasi boshqa filmni ochib yuborardi (jonli xato, ko'rinmaydi).
        if ($episodeId > 0) {
            $contentId = (int) ($item['content_id'] ?? 0);
            if ($contentId <= 0) {
                return ['success' => false, 'message' => 'Bu qism filmga bog‘lanmagan'];
            }
        } else {
            $contentId = (int) $item['id'];
        }

        // --- vaqt oralig'ini tekshirish
        $start = max(0, (int) $start);
        $end   = (int) $end;
        $len   = $end - $start;

        if ($len <= 0) {
            return ['success' => false, 'message' => 'Tugash vaqti boshlanishdan keyin bo‘lishi kerak'];
        }
        if ($len < REEL_MIN_LENGTH) {
            return ['success' => false,
                    'message' => 'Juda qisqa: kamida ' . REEL_MIN_LENGTH . ' soniya'];
        }
        if ($len > REEL_MAX_LENGTH) {
            return ['success' => false,
                    'message' => 'Juda uzun: ko‘pi bilan ' . REEL_MAX_LENGTH . ' soniya'];
        }

        // --- manba o'zgartirish mumkinligi
        //
        // DIQQAT: "embed" (YouTube, VK, Rutube va h.k.) da <iframe> ichidagi
        // videoni biz boshqaray olmaymiz - currentTime ni JS orqali
        // o'zgartirib bo'lmaydi. Shu sababli bo'lak yaratib bo'lmaydi.
        //
        // "none" esa umuman video yo'q (manba kiritilmagan yoki noma'lum
        // domen) - bu boshqa holat, xabari boshqacha bo'lishi kerak.
        // Aks holda ikkala xato ham bir xil ko'rinib, foydalanuvchi
        // "nima qilishim kerak?" deb qamqab qoladi.
        $pb = (new Catalog())->getPlayback($item);
        if ($pb['type'] === 'embed') {
            return ['success' => false,
                    'message' => 'Bu manba YouTube/iframe ko\'rinishida — undan bo‘lak '
                               . 'kesib bo‘lmaydi. MP4 yoki to\'g\'ridan-to\'g\'ri '
                               . 'havola kerak.'];
        }
        if ($pb['type'] === 'none') {
            return ['success' => false,
                    'message' => $pb['warning'] ?: 'Bu videoda manba topilmadi'];
        }

        // --- haqiqiy davomiylikdan chiqib ketmaslik
        $duration = (int) ($item['duration'] ?? 0);
        if ($duration > 0) {
            if ($end > $duration) {
                $end   = $duration;
                $len   = $end - $start;
                if ($len < REEL_MIN_LENGTH) {
                    return ['success' => false,
                            'message' => 'Boshlanish nuqtasi videoning oxiriga yaqin'];
                }
            }
        }

        // --- bo'sh nom avtomatik to'ldiriladi
        if ($title === '') {
            $title = $item['title'] ?? 'Reels';
        }
        $title = mb_substr(trim(strip_tags($title)), 0, 200);

        $data = [
            'user_id'     => (int) $userId,
            'content_id'  => $contentId,
            'episode_id'  => $episodeId > 0 ? (int) $episodeId : null,
            'kind'        => 'clip',
            'title'       => $title,
            'description' => mb_substr(trim(strip_tags($description)), 0, 500) ?: null,
            'video_type'  => $pb['type'],      // qaysi turda oynatilishi
            'video_url'   => null,            // manba kontentda saqlangan
            'start_time'  => $start,
            'end_time'    => $end,
            'status'      => REELS_REQUIRE_APPROVAL ? 0 : 1,
        ];

        $id = $this->db()->insert('reels', $data);
        if (!$id) {
            return ['success' => false, 'message' => 'Saqlab bo‘lmadi'];
        }

        return [
            'success' => true,
            'id'      => $id,
            'message' => REELS_REQUIRE_APPROVAL
                ? 'Yuborildi! Admin tasdiqlashidan keyin paydo bo‘ladi'
                : 'Yayinlandi!',
            'status'  => (int) $data['status'],
        ];
    }

    /**
     * Yuklangan videoni to'g'ridan-to'g'ri Telegram kanalga joylash.
     *
     * Oqim: brauzer -> sayt (PHP vaqtinchalik fayl) -> Telegram kanal.
     * Fayl SERVERDA SAQLANMAYDI: Telegram'ga uzatilgach darhol o'chiriladi
     * (PHP ham so'rov oxirida o'zi tozalaydi). Tomoshabinlar videoni
     * Telegram'dan ko'radi — sayt faqat havolani saqlaydi.
     *
     * @param int    $userId
     * @param array  $file        $_FILES['video']
     * @param string $title
     * @param string $description
     * @param int    $contentId   Ixtiyoriy - reel qaysi filmdan olingan
     */
    public function createUpload($userId, array $file, $title = '', $description = '', $contentId = 0) {
        $err = $this->checkUpload($file);
        if ($err !== null) {
            return ['success' => false, 'message' => $err];
        }
        if (REELS_CHANNEL === '') {
            return ['success' => false,
                    'message' => 'Reels kanali sozlanmagan (REELS_CHANNEL). Administratorga murojaat qiling.'];
        }

        // Ixtiyoriy kontent bog'lanishi
        $contentId = (int) $contentId;
        if ($contentId > 0 && !(new Catalog())->getContent($contentId)) {
            $contentId = 0;
        }

        $title = mb_substr(trim(strip_tags((string) $title)), 0, 200);
        if ($title === '') {
            $title = mb_substr(pathinfo((string) $file['name'], PATHINFO_FILENAME), 0, 200) ?: 'Reels';
        }
        $description = mb_substr(trim(strip_tags((string) $description)), 0, 500) ?: null;

        $caption = $title;
        if ($description) {
            $caption .= "\n\n" . $description;
        }

        $ext  = strtolower(pathinfo((string) $file['name'], PATHINFO_EXTENSION));
        $mime = $ext === 'webm' ? 'video/webm'
              : ($ext === 'mov' ? 'video/quicktime'
              : ($ext === 'mkv' ? 'video/x-matroska' : 'video/mp4'));

        $tg = new TelegramBot();
        $tg->setTimeout(600);   // katta fayl sekin yuklanishi mumkin

        // 1) sendVideo — kanalda inline oqim uchun eng yaxshi variant.
        $res = $tg->sendVideo(REELS_CHANNEL, new CURLFile($file['tmp_name'], $mime, $file['name']), [
            'caption'            => $caption,
            'supports_streaming' => true,
        ]);
        // 2) Zaxira: sendDocument (mkv/mov ba'zan video deb qabul qilinmaydi).
        if (!$res || empty($res['result']['message_id'])) {
            $res = $tg->sendDocument(REELS_CHANNEL, new CURLFile($file['tmp_name'], $mime, $file['name']), [
                'caption' => $caption,
            ]);
        }

        // Vaqtinchalik faylni darhol o'chiramiz — diskda qolmasin.
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

        $id = $this->db()->insert('reels', [
            'user_id'      => (int) $userId,
            'content_id'   => $contentId > 0 ? $contentId : null,
            'episode_id'   => null,
            'kind'         => 'upload',
            'title'        => $title,
            'description'  => $description,
            'video_type'   => 'telegram',
            'video_url'    => $link,
            'channel_post' => $post,
            'poster'       => null,
            'start_time'   => 0,
            'end_time'     => 0,
            'status'       => REELS_REQUIRE_APPROVAL ? 0 : 1,
        ]);
        if (!$id) {
            return ['success' => false, 'message' => 'Kanalga joylandi, lekin bazaga yozilmadi'];
        }

        return [
            'success' => true,
            'id'      => $id,
            'status'  => REELS_REQUIRE_APPROVAL ? 0 : 1,
            'link'    => $link,
            'message' => REELS_REQUIRE_APPROVAL
                ? 'Yuborildi! Admin tasdiqlashidan keyin ko‘rinadi'
                : 'Yuborildi! Reels oqimda paydo bo‘ldi',
        ];
    }

    /**
     * Telegram kanal orqali reel yuklashni boshlash.
     *
     * Fayl SERVERGA yozilmaydi. Bu yerda faqat "kutilayotgan" reel yozuvi
     * yaratiladi va bir martalik token qaytariladi. Foydalanuvchi botga
     * start=reel_<token> bilan o'tib videoni yuboradi; bot videoni
     * REELS_CHANNEL kanaliga joylaydi va shu qatorni to'ldiradi.
     *
     * @param int    $userId
     * @param int    $contentId   Ixtiyoriy - reel qaysi filmdan olingan
     * @param string $title
     * @param string $description
     */
    public function createIntent($userId, $contentId = 0, $title = '', $description = '') {
        if (REELS_CHANNEL === '') {
            return ['success' => false,
                    'message' => 'Reels kanali sozlanmagan. Administrator REELS_CHANNEL ni sozlashi kerak.'];
        }

        // content_id IXTIYORIY. Faqat haqiqiy kontent bo'lsa saqlanadi,
        // aks holda bo'sh qoldiriladi (foydalanuvchi "belgilamay qo'yadi").
        $contentId = (int) $contentId;
        if ($contentId > 0) {
            $item = (new Catalog())->getContent($contentId);
            if (!$item) {
                $contentId = 0;
            } elseif ($title === '') {
                $title = $item['title'] ?? '';
            }
        }

        $title = mb_substr(trim(strip_tags((string) $title)), 0, 200);
        if ($title === '') {
            $title = 'Reels';
        }

        $token = bin2hex(random_bytes(16));

        $data = [
            'user_id'      => (int) $userId,
            'content_id'   => $contentId > 0 ? $contentId : null,
            'episode_id'   => null,
            'kind'         => 'upload',
            'title'        => $title,
            'description'  => mb_substr(trim(strip_tags((string) $description)), 0, 500) ?: null,
            'video_type'   => 'telegram',
            'video_url'    => null,
            'ingest_token' => $token,
            'poster'       => null,
            'start_time'   => 0,
            'end_time'     => 0,
            'status'       => 0,   // bot videoni kanalga joylagach 1 bo'ladi
        ];

        $id = $this->db()->insert('reels', $data);
        if (!$id) {
            return ['success' => false, 'message' => 'Saqlab bo‘lmadi'];
        }

        return [
            'success'  => true,
            'id'       => $id,
            'token'    => $token,
            'bot_link' => REELS_BOT_LINK . $token,
            'message'  => 'Endi bot ochiladi — videoni yuboring. '
                        . 'Reel avtomatik kanalga tushadi.',
        ];
    }

    /** Faylni tekshirish. Xato bo'lsa xabar qaytaradi, aks holda null. */
    private function checkUpload($f) {
        if (!isset($f['error']) || is_array($f['error'])) {
            return 'Fayl yuklanmagan';
        }
        switch ($f['error']) {
            case UPLOAD_ERR_OK:
                break;
            case UPLOAD_ERR_INI_SIZE:
            case UPLOAD_ERR_FORM_SIZE:
                return 'Fayl juda katta (server limiti: '
                     . ini_get('upload_max_filesize') . ')';
            case UPLOAD_ERR_PARTIAL:
                return 'Fayl to‘liq yuklanmagan';
            case UPLOAD_ERR_NO_FILE:
                return 'Fayl tanlanmagan';
            default:
                return 'Yuklashda xatolik';
        }

        if (!is_uploaded_file($f['tmp_name'])) {
            return 'Yuklangan fayl topilmadi';
        }

        $max = REEL_MAX_UPLOAD_MB * 1024 * 1024;
        if ((int) $f['size'] > $max) {
            return 'Fayl ' . REEL_MAX_UPLOAD_MB . ' MB dan kichik bo‘lishi kerak';
        }
        if ((int) $f['size'] === 0) {
            return 'Fayl bo‘sh';
        }

        $ext = strtolower(pathinfo($f['name'], PATHINFO_EXTENSION));
        $allowed = ['mp4', 'webm', 'mov'];
        if (!in_array($ext, $allowed, true)) {
            // DIQQAT: kengaytma tekshiruvi HECH QACHON yetarli emas -
            // fayl nomi ".mp4" bo'lib, ichida boshqa narsa bo'lishi
            // mumkin. Shuning uchun pastda MIME ham tekshiriladi.
            return 'Faqat ' . strtoupper(implode(', ', $allowed)) . ' formatida';
        }

        // Haqiqiy format tekshiruvi
        $mime = $this->detectMime($f['tmp_name']);
        $okMimes = [
            'video/mp4', 'video/webm', 'video/quicktime',
            'application/octet-stream',   // ba'zi serverlar aniq bermaydi
            'video/x-m4v',
        ];
        if ($mime && !in_array($mime, $okMimes, true)) {
            return 'Bu fayl haqiqatan video emas (' . $mime . ')';
        }

        return null;
    }

    /** Finfo yoki getimagesize orqali haqiqiy MIME. */
    private function detectMime($path) {
        if (function_exists('finfo_open')) {
            $fi = finfo_open(FILEINFO_MIME_TYPE);
            if ($fi) {
                $m = finfo_file($fi, $path);
                finfo_close($fi);
                if ($m) {
                    return $m;
                }
            }
        }
        // Zaxira usul: MP4 fayllar 4-7 baytida "ftyp" belgisini oladi
        $fh = @fopen($path, 'rb');
        if ($fh) {
            $head = fread($fh, 16);
            fclose($fh);
            if (is_string($head) && strlen($head) >= 8 && substr($head, 4, 4) === 'ftyp') {
                return 'video/mp4';
            }
        }
        return null;
    }

    // =====================================================================
    // O'zgartirish / o'chirish
    // =====================================================================

    /**
     * Yuklangan faylning server ichidagi YO'LI (faqat 'upload' turi).
     *
     * DIQQAT: api/stream.php shuni ishlatadi, chunki u faylni Range/206
     * bilan oqitadi. getReel() bu uchun MOS EMAS - u "decorate" ichidan
     * o'tadi va o'zida ham stream.php ga havola quradi, ya'ni fayl yo'lini
     * olish uchun butun API javobini qurish shart edi (va u yana
     * qo'shimcha DB so'rovlar qilardi). Bu yerda bitta aniq SELECT bor.
     */
    public function getFilePath($reelId) {
        $row = $this->db()->fetchOne(
            "SELECT kind, video_url FROM reels WHERE id = ? LIMIT 1", [(int) $reelId]
        );
        if (!$row || $row['kind'] !== 'upload' || empty($row['video_url'])) {
            return null;
        }
        return $row['video_url'];
    }

    /** Reels egasi va holati (homiya tekshiruvi uchun yengil ma'lumot). */
    public function getOwnerAndStatus($reelId) {
        $row = $this->db()->fetchOne(
            "SELECT user_id, status FROM reels WHERE id = ? LIMIT 1", [(int) $reelId]
        );
        return $row ?: null;
    }

    public function delete($reelId, $userId, $isAdmin = false) {
        $reel = $this->getReel($reelId);
        if (!$reel) {
            return ['success' => false, 'message' => 'Reels topilmadi'];
        }

        if (!$isAdmin && (int) $reel['author']['id'] !== (int) $userId) {
            return ['success' => false, 'message' => 'Bu sizning reelingiz emas'];
        }

        // Yuklangan faylni o'chiramiz (virtual clip'da fayl yo'q)
        if ($reel['kind'] === 'upload') {
            $row = $this->db()->fetchOne(
                "SELECT video_url FROM reels WHERE id = ?", [(int) $reelId]
            );
            $url = $row['video_url'] ?? '';
            if ($url && strpos($url, 'uploads/reels/') === 0) {
                $this->unlinkWithRetry(__DIR__ . '/../' . $url);
            }
        }

        $this->db()->delete('reels', 'id = ?', [(int) $reelId]);
        return ['success' => true, 'message' => 'O‘chirildi'];
    }

    /**
     * Faylni o'chirish, Windows'da 1-2 marta urinish yetmaydi.
     *
     * Nima uchun: yangi yuklangan videoni Windows antivirus / indeksator
     * bir necha yuz millisekund "qulflab" o'z tekshiruvini o'tkazadi.
     * Shu paytda unlink "Ruxsat yo'q" degan xato bilan (jimgina, @ bilan)
     * muvaffaqiyatsiz bo'lib qoladi - row o'chadi, lekin fayl diskda
     * qolib ketaveradi. Diskda taloqqa tushgan fayllar to'planib ketmasligi
     * uchun bir necha marta, qisqa pauza bilan urinamiz.
     */
    private function unlinkWithRetry($path, $tries = 6) {
        for ($i = 0; $i < $tries; $i++) {
            clearstatcache(true, $path);
            if (!is_file($path)) {
                return true;
            }
            if (@unlink($path)) {
                return true;
            }
            usleep(150000);   // 150 ms
        }
        clearstatcache(true, $path);
        return !is_file($path);
    }

    // =====================================================================
    // Like
    // =====================================================================

    /** Bir nechta reel uchun "yoqganmi" xaritasi (1 so'rovda). */
    private function likedMap(array $reelIds, $userId) {
        if (!$reelIds || !$userId) {
            return [];
        }
        $in = implode(',', array_fill(0, count($reelIds), '?'));
        $rows = $this->db()->fetchAll(
            "SELECT reel_id FROM reel_likes WHERE user_id = ? AND reel_id IN ($in)",
            array_merge([(int) $userId], array_map('intval', $reelIds))
        );
        $out = [];
        foreach ($rows as $r) {
            $out[(int) $r['reel_id']] = true;
        }
        return $out;
    }

    /**
     * Yoqishni o'zgartirish (toggle).
     *
     * DIQQAT: reels.likes_count va reel_likes jadvali IKKALASI saqlanadi.
     * Nega? chunki count - tez hisob (o'qishda), jadval - haqiqiy ro'yxat
     * ("kim yoqgan", "o'z reel'imi yoqdimi"). Ikkalasini bitta qilish
     * mumkin emas: ro'yxatdan sanash har feed'da sekin.
     * Shu sabab count har o'zgarishda yangilanadi.
     */
    public function toggleLike($reelId, $userId) {
        $reel = $this->db()->fetchOne(
            "SELECT id, user_id, likes_count, status FROM reels WHERE id = ?", [(int) $reelId]
        );
        if (!$reel) {
            return ['success' => false, 'message' => 'Reels topilmadi'];
        }

        $existing = $this->db()->fetchOne(
            "SELECT id FROM reel_likes WHERE reel_id = ? AND user_id = ? LIMIT 1",
            [(int) $reelId, (int) $userId]
        );

        if ($existing) {
            $this->db()->delete('reel_likes', 'id = ?', [(int) $existing['id']]);
            $liked = false;
        } else {
            $ok = $this->db()->insert('reel_likes', [
                'reel_id' => (int) $reelId,
                'user_id' => (int) $userId,
            ]);
            if (!$ok) {
                return ['success' => false, 'message' => 'Saqlab bo‘lmadi'];
            }
            $liked = true;
        }

        // count'ni qayta hisoblab qo'yamiz (increment emas).
        // Sababi: increment "double count" xatolari uchun zaqsiz -
        // agar qator yo'qolsa yoki ikki marta ishga tushsa, son doim
        // noto'g'ri bo'lib qoladi. COUNT(*) har doim haqiqiy.
        $c = $this->db()->fetchOne(
            "SELECT COUNT(*) AS c FROM reel_likes WHERE reel_id = ?", [(int) $reelId]
        );
        $count = (int) ($c['c'] ?? 0);
        $this->db()->update('reels', ['likes_count' => $count], 'id = ?', [(int) $reelId]);

        // Bildirishnoma: faqat YANGI laykda, muallifga (o'ziga emas).
        if ($liked) {
            try {
                $this->notifier()->notifyLike((int) $reelId, (int) $userId, (int) $reel['user_id']);
            } catch (Exception $e) {
                error_log('[Reels] notifyLike: ' . $e->getMessage());
            }
        }

        return ['success' => true, 'liked' => $liked, 'likes' => $count];
    }

    // =====================================================================
    // Saqlash (bookmark) + Repost + Kuzatish (follow)
    // =====================================================================

    /**
     * "Belgilangan" xaritasi (reel_saves yoki reel_reposts).
     * Jadval nomi faqat ichki ro'yxatdan olinadi (SQL in'ektsiyaga yo'l yo'q).
     */
    private function flagMap($table, array $reelIds, $userId) {
        $allowed = ['reel_saves', 'reel_reposts'];
        if (!$reelIds || !$userId || !in_array($table, $allowed, true)) {
            return [];
        }
        $in = implode(',', array_fill(0, count($reelIds), '?'));
        $rows = $this->db()->fetchAll(
            "SELECT reel_id FROM `$table` WHERE user_id = ? AND reel_id IN ($in)",
            array_merge([(int) $userId], array_map('intval', $reelIds))
        );
        $out = [];
        foreach ($rows as $r) {
            $out[(int) $r['reel_id']] = true;
        }
        return $out;
    }

    /** Ko'ruvchi qaysi mualliflarni kuzatayotgani. */
    private function followingMap(array $authorIds, $userId) {
        if (!$authorIds || !$userId) {
            return [];
        }
        $in = implode(',', array_fill(0, count($authorIds), '?'));
        $rows = $this->db()->fetchAll(
            "SELECT following_id FROM user_follows WHERE follower_id = ? AND following_id IN ($in)",
            array_merge([(int) $userId], array_map('intval', $authorIds))
        );
        $out = [];
        foreach ($rows as $r) {
            $out[(int) $r['following_id']] = true;
        }
        return $out;
    }

    /** Mualliflarning kuzatuvchilar soni (reel boshiga emas, bir so'rovda). */
    private function followerCountMap(array $authorIds) {
        if (!$authorIds) {
            return [];
        }
        $in = implode(',', array_fill(0, count($authorIds), '?'));
        $rows = $this->db()->fetchAll(
            "SELECT following_id, COUNT(*) AS c
             FROM user_follows WHERE following_id IN ($in)
             GROUP BY following_id",
            array_map('intval', $authorIds)
        );
        $out = [];
        foreach ($rows as $r) {
            $out[(int) $r['following_id']] = (int) $r['c'];
        }
        return $out;
    }

    /** Saqlashni o'zgartirish (toggle). */
    public function toggleSave($reelId, $userId) {
        return $this->toggleFlag('reel_saves', 'saves_count', $reelId, $userId, 'saved', 'saves');
    }

    /** Repostni o'zgartirish (toggle). */
    public function toggleRepost($reelId, $userId) {
        return $this->toggleFlag('reel_reposts', 'reposts_count', $reelId, $userId, 'reposted', 'reposts');
    }

    /**
     * Umumiy toggle: like bilan bir xil mantiq — count COUNT(*) dan qayta
     * hisoblanadi (increment double-count xatolariga chidamsiz).
     */
    private function toggleFlag($table, $countCol, $reelId, $userId, $stateKey, $countKey) {
        $allowedT = ['reel_saves', 'reel_reposts'];
        $allowedC = ['saves_count', 'reposts_count'];
        if (!in_array($table, $allowedT, true) || !in_array($countCol, $allowedC, true)) {
            return ['success' => false, 'message' => 'Noto‘g‘ri amal'];
        }
        $reel = $this->db()->fetchOne("SELECT id, user_id FROM reels WHERE id = ?", [(int) $reelId]);
        if (!$reel) {
            return ['success' => false, 'message' => 'Reels topilmadi'];
        }

        $existing = $this->db()->fetchOne(
            "SELECT id FROM `$table` WHERE reel_id = ? AND user_id = ? LIMIT 1",
            [(int) $reelId, (int) $userId]
        );
        if ($existing) {
            $this->db()->delete($table, 'id = ?', [(int) $existing['id']]);
            $state = false;
        } else {
            $ok = $this->db()->insert($table, [
                'reel_id' => (int) $reelId,
                'user_id' => (int) $userId,
            ]);
            if (!$ok) {
                return ['success' => false, 'message' => 'Saqlab bo‘lmadi'];
            }
            $state = true;
        }

        $c = $this->db()->fetchOne(
            "SELECT COUNT(*) AS c FROM `$table` WHERE reel_id = ?", [(int) $reelId]
        );
        $count = (int) ($c['c'] ?? 0);
        $this->db()->update('reels', [$countCol => $count], 'id = ?', [(int) $reelId]);

        // Repost bo'lsa - muallifga bildirishnoma (saqlashda emas).
        if ($state && $table === 'reel_reposts') {
            try {
                $this->notifier()->notifyRepost((int) $reelId, (int) $userId, (int) $reel['user_id']);
            } catch (Exception $e) {
                error_log('[Reels] notifyRepost: ' . $e->getMessage());
            }
        }

        return ['success' => true, $stateKey => $state, $countKey => $count];
    }

    /** Muallifni kuzatishni o'zgartirish. */
    public function toggleFollow($targetId, $userId) {
        $targetId = (int) $targetId;
        $userId   = (int) $userId;
        if ($targetId <= 0 || $userId <= 0) {
            return ['success' => false, 'message' => 'Foydalanuvchi topilmadi'];
        }
        if ($targetId === $userId) {
            return ['success' => false, 'message' => 'O‘zingizni kuzata olmaysiz'];
        }
        $u = $this->db()->fetchOne("SELECT id FROM users WHERE id = ? LIMIT 1", [$targetId]);
        if (!$u) {
            return ['success' => false, 'message' => 'Foydalanuvchi topilmadi'];
        }

        $existing = $this->db()->fetchOne(
            "SELECT id FROM user_follows WHERE follower_id = ? AND following_id = ? LIMIT 1",
            [$userId, $targetId]
        );
        if ($existing) {
            $this->db()->delete('user_follows', 'id = ?', [(int) $existing['id']]);
            $following = false;
        } else {
            $ok = $this->db()->insert('user_follows', [
                'follower_id'  => $userId,
                'following_id' => $targetId,
            ]);
            if (!$ok) {
                return ['success' => false, 'message' => 'Saqlab bo‘lmadi'];
            }
            $following = true;
        }

        $c = $this->db()->fetchOne(
            "SELECT COUNT(*) AS c FROM user_follows WHERE following_id = ?",
            [$targetId]
        );

        // Yangi kuzatishda — kuzatilayotgan foydalanuvchiga bildirishnoma
        // (sayt ichida + Telegram orqali instant).
        if ($following) {
            try {
                $this->alerts()->follow($targetId, $userId);
            } catch (Exception $e) {
                error_log('[Reels] follow alert: ' . $e->getMessage());
            }
        }

        return [
            'success'   => true,
            'following' => $following,
            'followers' => (int) ($c['c'] ?? 0),
        ];
    }

    // =====================================================================
    // Ko'rish
    // =====================================================================

    /**
     * Ko'rishni hisobga olish.
     *
     * DIQQAT: bir foydalanuvchi bitta reelni faqat BIR marta hisoblanadi.
     * Sababi: aks holda bitta odam qayta-qayta ochsa, "mashhur" reytingi
     * yolg'on bo'ladi. Buni chaqiruvchi (JS) "sessiya da ko'rilgan"
     * ro'yxat bilan ham qo'llab-quvvatlaydi.
     */
    public function addView($reelId, $userId) {
        $reel = $this->db()->fetchOne("SELECT id, status FROM reels WHERE id = ?", [(int) $reelId]);
        if (!$reel) {
            return ['success' => false, 'message' => 'Reels topilmadi'];
        }
        // Kutilayotgan reelni ko'rish hisobga olmaydi
        if ((int) $reel['status'] !== 1) {
            return ['success' => false, 'message' => 'Reels hali tasdiqlanmagan'];
        }

        // allaqachon ko'rib bo'ldimi?
        if ($userId) {
            $seen = $this->db()->fetchOne(
                "SELECT id FROM reel_views WHERE reel_id = ? AND user_id = ? LIMIT 1",
                [(int) $reelId, (int) $userId]
            );
            if ($seen) {
                $c = $this->db()->fetchOne(
                    "SELECT views_count AS v FROM reels WHERE id = ?", [(int) $reelId]
                );
                return ['success' => true, 'counted' => false, 'views' => (int) ($c['v'] ?? 0)];
            }
        }

        $this->db()->insert('reel_views', [
            'reel_id' => (int) $reelId,
            'user_id' => $userId ? (int) $userId : null,
        ]);

        // count'ni ham qayta hisoblab (increment emas - xuddi like kabi)
        $c = $this->db()->fetchOne(
            "SELECT COUNT(*) AS c FROM reel_views WHERE reel_id = ?", [(int) $reelId]
        );
        $count = (int) ($c['c'] ?? 0);
        $this->db()->update('reels', ['views_count' => $count], 'id = ?', [(int) $reelId]);

        return ['success' => true, 'counted' => true, 'views' => $count];
    }

    // =====================================================================
    // Ulashish
    // =====================================================================

    /**
     * Ulashish sonini oshirish.
     *
     * DIQQAT: bu "taxminiy" son - Telegram ulashish tugmasi bosilganini
     * bize aytib bermaydi (u Telegram ichida ishlaydi, brauzerga qaytmaydi).
     * Biz faqat "foydalanuvchi ulashish tugmasini bosdi" degan voqeani
     * olamiz. Shu sababli bu son reytingda ishlatilmaydi - faqat
     * ko'rsatish uchun.
     */
    public function addShare($reelId) {
        $reel = $this->db()->fetchOne("SELECT id FROM reels WHERE id = ?", [(int) $reelId]);
        if (!$reel) {
            return ['success' => false, 'message' => 'Reels topilmadi'];
        }
        $this->db()->query(
            "UPDATE reels SET shares_count = shares_count + 1 WHERE id = ?",
            [(int) $reelId]
        );
        return ['success' => true];
    }

    /**
     * Reelni kimlar yoqgan (ochiq ro'yxat).
     *
     * DIQQAT: Telegram Mini App da foydalanuvchi kuni Telegram'ni
     * identifikatsiya qilgan bo'lishi mumkin, lekin W CINEMA foydalanuvchisi
     * boshqa odam bo'lishi mumkin. Shuning uchun bu ro'yxat "kim qaysi
     * videoni yuklab oldi" degan ma'lumotni oshkor qilmasligi kerak -
     * faqat ism ko'rsatiladi, Telegram ID emas.
     */
    public function likedBy($reelId, $limit = 20) {
        $rows = $this->db()->fetchAll(
            "SELECT u.id, u.username, u.first_name, u.avatar
             FROM reel_likes rl
             JOIN users u ON u.id = rl.user_id
             WHERE rl.reel_id = ?
             ORDER BY rl.id DESC
             LIMIT ?",
            [(int) $reelId, max(1, min(100, (int) $limit))]
        );
        return array_map(static fn($u) => [
            'id'       => (int) $u['id'],
            'username' => $u['username'],
            'name'     => $u['first_name'] ?: ('@' . $u['username']),
            'avatar'   => $u['avatar'],
        ], $rows);
    }

    // =====================================================================
    // Izohlar (comments)
    // =====================================================================

    /**
     * Reelga izoh qo'shish.
     *
     * Matn tozalanadi (HTML teglar olib tashlanadi, ortiqcha bo'sh joylar
     * birlashtiriladi) va 1000 belgiga qisqartiriladi. `comments_count`
     * COUNT(*) dan qayta hisoblanadi — increment emas, xuddi like kabi
     * (double-count xatolariga chidamli).
     */
    public function addComment($reelId, $userId, $body) {
        $reel = $this->db()->fetchOne(
            "SELECT id, user_id FROM reels WHERE id = ?", [(int) $reelId]
        );
        if (!$reel) {
            return ['success' => false, 'message' => 'Reels topilmadi'];
        }

        $body = trim(strip_tags((string) $body));
        $body = trim((string) preg_replace('/\s+/u', ' ', $body));
        if ($body === '') {
            return ['success' => false, 'message' => 'Izoh bo‘sh'];
        }
        if (mb_strlen($body) > 1000) {
            $body = mb_substr($body, 0, 1000);
        }

        $id = $this->db()->insert('reel_comments', [
            'reel_id' => (int) $reelId,
            'user_id' => (int) $userId,
            'body'    => $body,
        ]);
        if (!$id) {
            return ['success' => false, 'message' => 'Saqlab bo‘lmadi'];
        }

        $count = $this->commentCount($reelId);
        $this->db()->update('reels', ['comments_count' => $count], 'id = ?', [(int) $reelId]);

        // Muallifga izoh haqida bildirishnoma.
        try {
            $this->notifier()->notifyComment(
                (int) $reelId, (int) $userId, (int) $reel['user_id'],
                function_exists('mb_substr') ? mb_substr($body, 0, 120) : substr($body, 0, 120),
                false
            );
        } catch (Exception $e) {
            error_log('[Reels] notifyComment: ' . $e->getMessage());
        }

        return [
            'success'  => true,
            'comment'  => $this->getComment($id),
            'comments' => $count,
        ];
    }

    /**
     * Reelning izohlari (eng yangisi birinchi).
     *
     * @return array|null null — reel topilmadi.
     */
    public function getComments($reelId, $limit = 30, $offset = 0) {
        $reel = $this->db()->fetchOne(
            "SELECT id FROM reels WHERE id = ?", [(int) $reelId]
        );
        if (!$reel) {
            return null;
        }

        $limit  = max(1, min(50, (int) $limit));
        $offset = max(0, (int) $offset);

        $rows = $this->db()->fetchAll(
            "SELECT c.id, c.reel_id, c.user_id, c.body, c.created_at,
                    u.username, u.first_name, u.avatar
             FROM reel_comments c
             LEFT JOIN users u ON u.id = c.user_id
             WHERE c.reel_id = ?
             ORDER BY c.id DESC
             LIMIT $limit OFFSET $offset",
            [(int) $reelId]
        );

        return array_map([$this, 'formatComment'], $rows);
    }

    /** Bitta izohni muallif ma'lumoti bilan qaytaradi. */
    private function getComment($id) {
        $row = $this->db()->fetchOne(
            "SELECT c.id, c.reel_id, c.user_id, c.body, c.created_at,
                    u.username, u.first_name, u.avatar
             FROM reel_comments c
             LEFT JOIN users u ON u.id = c.user_id
             WHERE c.id = ? LIMIT 1",
            [(int) $id]
        );
        return $row ? $this->formatComment($row) : null;
    }

    /** API uchun izoh shakli. */
    private function formatComment($c) {
        return [
            'id'         => (int) $c['id'],
            'reel_id'    => (int) $c['reel_id'],
            'body'       => $c['body'],
            'created_at' => $c['created_at'],
            'author'     => [
                'id'       => (int) $c['user_id'],
                'username' => $c['username'] ?? null,
                'name'     => ($c['first_name'] ?? '') ?: 'Foydalanuvchi',
                'avatar'   => $c['avatar'] ?? null,
            ],
        ];
    }

    /** Izohni o'chirish (muallif yoki admin). */
    public function deleteComment($commentId, $userId, $isAdmin = false) {
        $row = $this->db()->fetchOne(
            "SELECT id, reel_id, user_id FROM reel_comments WHERE id = ?",
            [(int) $commentId]
        );
        if (!$row) {
            return ['success' => false, 'message' => 'Izoh topilmadi'];
        }
        if (!$isAdmin && (int) $row['user_id'] !== (int) $userId) {
            return ['success' => false, 'message' => 'Bu sizning izohingiz emas'];
        }

        $this->db()->delete('reel_comments', 'id = ?', [(int) $commentId]);
        $count = $this->commentCount($row['reel_id']);
        $this->db()->update('reels', ['comments_count' => $count], 'id = ?', [(int) $row['reel_id']]);

        return ['success' => true, 'comments' => $count];
    }

    /** Izohlar soni (haqiqiy). */
    private function commentCount($reelId) {
        $c = $this->db()->fetchOne(
            "SELECT COUNT(*) AS c FROM reel_comments WHERE reel_id = ?",
            [(int) $reelId]
        );
        return (int) ($c['c'] ?? 0);
    }

    // =====================================================================
    // Telegram izohlari (forum topics)
    // =====================================================================
    //
    // Har bir reel uchun TG_COMMENTS_CHAT guruhida alohida MAVZU (topic)
    // ochiladi. Izohlar o'sha mavzuda saqlanadi. Bu metod faqat mavzuni
    // ta'minlaydi - izohlarni o'qish/yozish brauzerdagi MTProto sessiyasi
    // orqali bo'ladi (serverda Telegram sessiyasi yo'q).

    /** Reel uchun Telegram topic id (bo'lmasa null). */
    public function topicId($reelId) {
        $row = $this->db()->fetchOne(
            "SELECT tg_topic_id FROM reels WHERE id = ?", [(int) $reelId]
        );
        if (!$row) {
            return null;
        }
        return !empty($row['tg_topic_id']) ? (int) $row['tg_topic_id'] : null;
    }

    /**
     * Reel uchun Telegram mavzusini ta'minlaydi (bo'lmasa bot orqali ochadi).
     *
     * @return array ['success'=>bool, 'topic_id'=>int|null, 'chat'=>string,
     *                'url'=>string, 'created'=>bool, 'message'=>?]
     */
    public function ensureTopic($reelId) {
        $reelId = (int) $reelId;
        $row = $this->db()->fetchOne(
            "SELECT r.id, r.title, r.tg_topic_id, r.channel_post,
                    c.title AS content_title
             FROM reels r
             LEFT JOIN content c ON c.id = r.content_id
             WHERE r.id = ?",
            [$reelId]
        );
        if (!$row) {
            return ['success' => false, 'message' => 'Reels topilmadi'];
        }
        if (!empty($row['tg_topic_id'])) {
            return [
                'success'  => true,
                'topic_id' => (int) $row['tg_topic_id'],
                'chat'     => TG_COMMENTS_CHAT,
                'url'      => $this->topicUrl((int) $row['tg_topic_id']),
                'created'  => false,
            ];
        }
        if (TG_COMMENTS_CHAT === '') {
            return ['success' => false, 'message' => 'Izohlar sozlanmagan'];
        }

        $name = trim((string) ($row['title'] ?? ''));
        if ($name === '') {
            $name = trim((string) ($row['content_title'] ?? ''));
        }
        if ($name === '') {
            $name = 'Reel #' . $reelId;
        }
        $name = '▶︎ ' . $name;

        $bot = new TelegramBot();
        $res = $bot->createForumTopic(TG_COMMENTS_CHAT, $name);
        if (!$res || empty($res['message_thread_id'])) {
            return [
                'success' => false,
                'message' => 'Mavzu ochilmadi: ' . ($bot->getLastError() ?: 'noma’lum xato')
                    . ' (guruhda Topics yoqilganini va bot admin ekanini tekshiring)',
            ];
        }
        $topicId = (int) $res['message_thread_id'];
        $this->db()->update('reels', ['tg_topic_id' => $topicId], 'id = ?', [$reelId]);

        return [
            'success'  => true,
            'topic_id' => $topicId,
            'chat'     => TG_COMMENTS_CHAT,
            'url'      => $this->topicUrl($topicId),
            'created'  => true,
        ];
    }

    /** Mavzuning Telegram havolasi (web). */
    private function topicUrl($topicId) {
        $topicId = (int) $topicId;
        if ($topicId <= 0 || TG_COMMENTS_URL === '') {
            return null;
        }
        return rtrim(TG_COMMENTS_URL, '/') . '/' . $topicId;
    }

    // =====================================================================
    // Moderatsiya
    // =====================================================================

    /**
     * Tasdiqlash / rad etish.
     * status: 1 = tasdiqlandi, 2 = rad etildi
     */
    public function moderate($reelId, $status, $reason = '', $adminId = null) {
        $status = (int) $status;
        if (!in_array($status, [1, 2], true)) {
            return ['success' => false, 'message' => 'Status 1 (tasdiq) yoki 2 (rad) bo‘lishi kerak'];
        }

        $reel = $this->db()->fetchOne("SELECT id, user_id FROM reels WHERE id = ?", [(int) $reelId]);
        if (!$reel) {
            return ['success' => false, 'message' => 'Reels topilmadi'];
        }

        $data = ['status' => $status];
        $data['reject_reason'] = ($status === 2)
            ? (mb_substr(trim(strip_tags($reason)), 0, 255) ?: 'Sabab ko‘rsatilmagan')
            : null;

        $this->db()->update('reels', $data, 'id = ?', [(int) $reelId]);

        // Sayt ichidagi bildirishnoma (Telegram xabaridan tashqari).
        try {
            $this->notifier()->notifyStatus((int) $reelId, (int) $reel['user_id'], $status, $data['reject_reason'] ?: '');
        } catch (Exception $e) {
            error_log('[Reels] notifyStatus: ' . $e->getMessage());
        }

        // Muallifga xabar berish (Telegram bot orqali, ixtiyoriy)
        if ($adminId && function_exists('TelegramBot')) {
            $this->notifyAuthor((int) $reelId, $status, $data['reject_reason']);
        }

        return ['success' => true, 'message' => $status === 1 ? 'Tasdiqlandi' : 'Rad etildi'];
    }

    /** Muallifga Telegram orqali xabar. Xato bo'lsa ham oqim buzilmaydi. */
    private function notifyAuthor($reelId, $status, $reason) {
        try {
            $row = $this->db()->fetchOne(
                "SELECT r.title, r.id, u.telegram_chat_id, u.telegram_user_id
                 FROM reels r JOIN users u ON u.id = r.user_id
                 WHERE r.id = ? LIMIT 1",
                [(int) $reelId]
            );
            if (!$row) return;

            $chatId = $row['telegram_chat_id'] ?: $row['telegram_user_id'];
            if (!$chatId) return;

            $bot = new TelegramBot();
            $link = SITE_URL . '/reels.php?reel=' . $row['id'];

            // Xabar oddiy matn bo'lib yuboriladi (HTML emas). Sababi: sarlavha
            // foydalanuvchikidan keladi va "qizg'in bo'lish" (& < >) kabi
            // belgilar HTML-rejimda butun xabarni buzadi.

            if ($status === 1) {
                $text = "✅ Reelsingiz tasdiqlandi!\n\n"
                      . $row['title'] . "\n"
                      . $link;
            } else {
                $text = "❌ Reelsingiz rad etildi.\n\n"
                      . $row['title'] . "\n\n"
                      . "Sabab: " . ($reason ?: '—');
            }
            $bot->sendMessage($chatId, $text, null);
        } catch (Exception $e) {
            error_log('[Reels] notify: ' . $e->getMessage());
        }
    }

    /**
     * Kutilayotgan reels (admin paneli uchun).
     */
    public function getPending($limit = 50, $status = 0) {
        $rows = $this->db()->fetchAll(
            "SELECT r.*, u.username AS author_username, u.first_name AS author_name,
                    u.avatar     AS author_avatar,
                    u.telegram_user_id,
                    c.title AS content_title
             FROM reels r
             LEFT JOIN users    u ON u.id = r.user_id
             LEFT JOIN content c ON c.id = r.content_id
             WHERE r.status = ?
             ORDER BY r.id ASC
             LIMIT ?",
            [(int) $status, max(1, min(200, (int) $limit))]
        );
        $out = $this->decorate($rows, null);
        return $out;
    }

    public function countPending($status = 0) {
        $row = $this->db()->fetchOne(
            "SELECT COUNT(*) AS c FROM reels WHERE status = ?", [(int) $status]
        );
        return (int) ($row['c'] ?? 0);
    }

    // =====================================================================
    // "Top Authors" reytingi
    // =====================================================================

    /**
     * Reyting hisobi:
     *   ball = ko'rishlar + yoqishlar*5 + (tasdiqlangan reel)*20
     *
     * Nima uchun shunday:
     *  - yoqish ko'rishdan qimmatroq (odam ko'rib o'tib ketishi mumkin,
     *    lekin yoqish irodasini bildiradi) -> 5x
     *  - tasdiqlangan reel muallif sifatini ko'rsatadi -> 20x
     */
    public function topAuthors($limit = 10) {
        $limit = max(1, min(50, (int) $limit));

        $rows = $this->db()->fetchAll(
            "SELECT r.user_id,
                    u.username, u.first_name, u.avatar,
                    COUNT(*)                          AS reels,
                    COALESCE(SUM(r.views_count), 0)   AS views,
                    COALESCE(SUM(r.likes_count), 0)  AS likes
             FROM reels r
             JOIN users u ON u.id = r.user_id
             WHERE r.status = 1
             GROUP BY r.user_id, u.username, u.first_name, u.avatar
             ORDER BY (COALESCE(SUM(r.views_count),0)
                       + COALESCE(SUM(r.likes_count),0) * 5
                       + COUNT(*) * 20) DESC
             LIMIT $limit"
        );

        $out = [];
        $rank = 0;
        foreach ($rows as $r) {
            $out[] = [
                'rank'    => ++$rank,
                'user_id' => (int) $r['user_id'],
                'username'=> $r['username'],
                'name'    => $r['first_name'] ?: ($r['username'] ?: 'Foydalanuvchi'),
                'avatar'  => $r['avatar'],
                'reels'   => (int) $r['reels'],
                'views'   => (int) $r['views'],
                'likes'   => (int) $r['likes'],
                'score'   => (int) $r['views'] + (int) $r['likes'] * 5 + (int) $r['reels'] * 20,
            ];
        }
        return $out;
    }

    /** Muallifning statistikasi (profil uchun). */
    public function authorStats($userId) {
        $row = $this->db()->fetchOne(
            "SELECT
                COUNT(*) AS total,
                COALESCE(SUM(status = 1), 0) AS approved,
                COALESCE(SUM(status = 0), 0) AS pending,
                COALESCE(SUM(status = 2), 0) AS rejected,
                COALESCE(SUM(views_count), 0) AS views,
                COALESCE(SUM(likes_count), 0) AS likes
             FROM reels WHERE user_id = ?",
            [(int) $userId]
        );
        return [
            'total'    => (int) ($row['total'] ?? 0),
            'approved' => (int) ($row['approved'] ?? 0),
            'pending'  => (int) ($row['pending'] ?? 0),
            'rejected' => (int) ($row['rejected'] ?? 0),
            'views'    => (int) ($row['views'] ?? 0),
            'likes'    => (int) ($row['likes'] ?? 0),
        ];
    }

    // =====================================================================
    // Profil (Instagram uslubidagi grid) uchun
    // =====================================================================

    /**
     * Bitta foydalanuvchining reels grid'i (profil sahifasi uchun).
     *
     * @param int $profileUserId  ko'rsatilayotgan profil egasi
     * @param int|null $viewerId  ko'rayotgan foydalanuvchi (liked uchun)
     * @param bool $includeAll    o'z profili - barcha statuslar (badge bilan)
     * @param string|null $format 'reel' | 'post' | 'video' — null = hammasi
     * @return array decorate() chiqishi (id, poster, views, likes, status...)
     */
    public function profileGrid($profileUserId, $viewerId = null, $includeAll = false, $limit = 30, $offset = 0, $format = null) {
        $limit  = max(1, min(60, (int) $limit));
        $offset = max(0, (int) $offset);
        $where  = 'r.user_id = ?' . ($includeAll ? '' : ' AND r.status = 1');
        $params = [(int) $profileUserId];

        // Format filtri. Eski yozuvlarda `format` NULL bo'lishi mumkin —
        // ular "reels" yorlig'iga tushishi uchun shart shunday yozilgan.
        if ($format !== null && $format !== '' && $format !== 'all') {
            if ($format === 'reel') {
                $where .= " AND (r.format = 'reel' OR r.format IS NULL OR r.format = '')";
            } else {
                $where .= ' AND r.format = ?';
                $params[] = $format;
            }
        }

        $sql = "SELECT r.*,
                       u.username   AS author_username,
                       u.first_name AS author_name,
                       u.avatar     AS author_avatar,
                       c.title      AS content_title,
                       c.slug       AS content_slug,
                       e.episode_number AS episode_number,
                       e.season         AS episode_season
                FROM reels r
                LEFT JOIN users    u ON u.id = r.user_id
                LEFT JOIN content c ON c.id = r.content_id
                LEFT JOIN episodes e ON e.id = r.episode_id
                WHERE $where
                ORDER BY (r.views_count * 10 + r.likes_count * 3) DESC, r.id DESC
                LIMIT $limit OFFSET $offset";

        return $this->decorate($this->db()->fetchAll($sql, $params), $viewerId);
    }

    /**
     * Ko'rayotgan foydalanuvchi yoqqan reels (faqat tasdiqlanganlar).
     * Instagram'dagi "Yoqqanlar" o'xshashi - faqat O'Z profilingizda ko'rinadi.
     */
    public function likedGrid($viewerId, $limit = 30, $offset = 0) {
        $limit  = max(1, min(60, (int) $limit));
        $offset = max(0, (int) $offset);

        $sql = "SELECT r.*,
                       u.username   AS author_username,
                       u.first_name AS author_name,
                       u.avatar     AS author_avatar,
                       c.title      AS content_title,
                       c.slug       AS content_slug,
                       e.episode_number AS episode_number,
                       e.season         AS episode_season
                FROM reel_likes l
                JOIN reels r ON r.id = l.reel_id
                LEFT JOIN users    u ON u.id = r.user_id
                LEFT JOIN content c ON c.id = r.content_id
                LEFT JOIN episodes e ON e.id = r.episode_id
                WHERE l.user_id = ? AND r.status = 1
                ORDER BY l.created_at DESC
                LIMIT $limit OFFSET $offset";

        return $this->decorate($this->db()->fetchAll($sql, [(int) $viewerId]), $viewerId);
    }

    /**
     * Ko'ruvchi SAQLAGAN reels (bookmark). Instagram'dagi "Saqlanganlar"
     * bo'limining reels qismi.
     */
    public function savedGrid($viewerId, $limit = 30, $offset = 0) {
        $limit  = max(1, min(60, (int) $limit));
        $offset = max(0, (int) $offset);

        $sql = "SELECT r.*,
                       u.username   AS author_username,
                       u.first_name AS author_name,
                       u.avatar     AS author_avatar,
                       c.title      AS content_title,
                       c.slug       AS content_slug,
                       e.episode_number AS episode_number,
                       e.season         AS episode_season
                FROM reel_saves s
                JOIN reels r ON r.id = s.reel_id
                LEFT JOIN users    u ON u.id = r.user_id
                LEFT JOIN content c ON c.id = r.content_id
                LEFT JOIN episodes e ON e.id = r.episode_id
                WHERE s.user_id = ? AND r.status = 1
                ORDER BY s.created_at DESC
                LIMIT $limit OFFSET $offset";

        return $this->decorate($this->db()->fetchAll($sql, [(int) $viewerId]), $viewerId);
    }

    /**
     * Profildagi "Highlight" qator (Instagram'dagi o'xshashi):
     * muallifning eng mashhur 6 ta reelsi.
     */
    public function highlights($userId, $limit = 6) {
        $rows = $this->db()->fetchAll(
            "SELECT r.id, r.title, r.poster,
                    c.title AS content_title,
                    (r.views_count * 10 + r.likes_count * 3) AS score
             FROM reels r
             LEFT JOIN content c ON c.id = r.content_id
             WHERE r.user_id = ? AND r.status = 1
             ORDER BY score DESC, r.id DESC
             LIMIT " . max(1, min(12, (int) $limit)),
            [(int) $userId]
        );
        $out = [];
        foreach ($rows as $r) {
            $out[] = [
                'id'     => (int) $r['id'],
                'title'  => ($r['title'] ?: $r['content_title']) ?: 'Reels',
                'poster' => $r['poster'],
            ];
        }
        return $out;
    }

    /**
     * Profil statistikasi + saqlanganlar soni.
     */
    public function profileStats($userId) {
        $r = $this->db()->fetchOne(
            "SELECT
                COUNT(*) AS total,
                COALESCE(SUM(status = 1), 0) AS approved,
                COALESCE(SUM(views_count), 0) AS views,
                COALESCE(SUM(likes_count), 0) AS likes
             FROM reels WHERE user_id = ?",
            [(int) $userId]
        );
        $w = $this->db()->fetchOne(
            "SELECT COUNT(*) AS c FROM watchlist WHERE user_id = ?",
            [(int) $userId]
        );
        return [
            'reels'     => (int) ($r['approved'] ?? 0),
            'views'     => (int) ($r['views'] ?? 0),
            'likes'     => (int) ($r['likes'] ?? 0),
            'watchlist' => (int) ($w['c'] ?? 0),
        ];
    }

    // =====================================================================
    // Yordamchi
    // =====================================================================
    public static function fmtTime($sec) {
        $sec = max(0, (int) $sec);
        $h = intdiv($sec, 3600);
        $m = intdiv($sec % 3600, 60);
        $s = $sec % 60;
        return $h > 0
            ? sprintf('%d:%02d:%02d', $h, $m, $s)
            : sprintf('%d:%02d', $m, $s);
    }

    private $dbInstance = null;
    private function db() {
        if ($this->dbInstance === null) {
            $this->dbInstance = Database::getInstance();
        }
        return $this->dbInstance;
    }
}
