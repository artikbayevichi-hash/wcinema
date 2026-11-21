<?php
// ============================================================================
// TgMeta — Telegram video metama'lumotini BAZADA doimiy saqlash
// ============================================================================
//
// NIMA UCHUN:
//   Admin panelga video qo'shilganda uning Telegram "manzili" —
//   kanal / post / fayl ID / access_hash / file_reference / dc / hajm / nom /
//   o'lcham / davomiylik — darhol bazaga yozib qo'yiladi. Shuning uchun:
//     • video ochilishida metama'lumot uchun Telegram'ga murojaat qilish
//       shart emas (javob bazadan ~1 ms da keladi);
//     • bot vaqtincha ishlamasa ham ma'lumot yo'qolmaydi;
//     • eski videolarni birdamali to'ldirish (backfill) mumkin.
//
// MUHIM (xavfsizlik):
//   • Bu yerda faqat METAMA'LUMOT saqlanadi. Video baytlari HECH QACHON
//     bu yerdan o'tmaydi — ular to'g'ridan-to'g'ri brauzer -> Telegram DC.
//   • `file_reference` bot sessiyasidan olinadi. Brauzer (tomoshabin
//     akkaunti) uni ishlata olmaydi — shuning uchun `tg-stream.js` da
//     server yo'li (`USE_SERVER_DOC_META`) o'chirilgan va video foydalanuvchi
//     akkauntining GramJS sessiyasi bilan ochiladi. Bazadagi `fr` faqat
//     ma'lumot/tezkor kesh uchun; ijro etish kanaliga ta'sir qilmaydi.
//   • Jadval o'z-o'zidan yaratiladi (`ensure()`), migratsiya qilmasa ham
//     panel ishlayveradi.
// ============================================================================

if (!defined('TG_META_VER')) {
    define('TG_META_VER', 2);
}

class TgMeta
{
    /** Jadval yo'q bo'lsa, yaratamiz (xato bo'lsa jim — panel ishlashda davom etadi). */
    public static function ensure()
    {
        static $done = false;
        if ($done) return true;
        try {
            Database::getInstance()->query(
                "CREATE TABLE IF NOT EXISTS `telegram_meta` (
                    `id` INT NOT NULL AUTO_INCREMENT,
                    `channel` VARCHAR(100) NOT NULL,
                    `post` INT NOT NULL,
                    `doc_id` VARCHAR(40) DEFAULT NULL,
                    `access_hash` VARCHAR(40) DEFAULT NULL,
                    `file_reference` TEXT,
                    `dc` SMALLINT NOT NULL DEFAULT 0,
                    `size` BIGINT NOT NULL DEFAULT 0,
                    `mime` VARCHAR(120) DEFAULT NULL,
                    `fn` VARCHAR(500) DEFAULT NULL,
                    `w` INT NOT NULL DEFAULT 0,
                    `h` INT NOT NULL DEFAULT 0,
                    `dur` INT NOT NULL DEFAULT 0,
                    `source` VARCHAR(16) NOT NULL DEFAULT 'bot',
                    `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
                    `error` VARCHAR(500) DEFAULT NULL,
                    `t` INT NOT NULL DEFAULT 0,
                    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                        ON UPDATE CURRENT_TIMESTAMP,
                    PRIMARY KEY (`id`),
                    UNIQUE KEY `uk_tgmeta_ch_post` (`channel`, `post`),
                    KEY `idx_tgmeta_status` (`status`)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
            );
            // Video thumbnail (poster) ma'lumoti — alohida jadval, asosiy
            // jadvalga ALTER qilish shart emas.
            Database::getInstance()->query(
                "CREATE TABLE IF NOT EXISTS `telegram_thumb` (
                    `channel` VARCHAR(100) NOT NULL,
                    `post` INT NOT NULL,
                    `doc_id` VARCHAR(40) DEFAULT NULL,
                    `doc_ah` VARCHAR(40) DEFAULT NULL,
                    `fr` TEXT,
                    `dc` SMALLINT NOT NULL DEFAULT 0,
                    `type` VARCHAR(40) DEFAULT NULL,
                    `tid` VARCHAR(40) DEFAULT NULL,
                    `tah` VARCHAR(40) DEFAULT NULL,
                    `vol` INT NOT NULL DEFAULT 0,
                    `local` INT NOT NULL DEFAULT 0,
                    `secret` VARCHAR(40) DEFAULT NULL,
                    `size` INT NOT NULL DEFAULT 0,
                    `w` INT NOT NULL DEFAULT 0,
                    `h` INT NOT NULL DEFAULT 0,
                    `t` INT NOT NULL DEFAULT 0,
                    PRIMARY KEY (`channel`, `post`)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
            );
            $done = true;
            return true;
        } catch (\Throwable $e) {
            return false;
        }
    }

    /**
     * Video hujjatining tayyor Telegram thumbnail'ini ajratib oladi.
     * MadelineProto turli layerlarda `thumb` yoki `thumbs` beradi; ikkalasi
     * ham qo'llab-quvvatlanadi. Natija ~15 ta kichik maydon — video bayti YO'Q.
     * @return array|null
     */
    public static function extractThumb($doc)
    {
        $sizes = [];
        if (!empty($doc['thumb']) && is_array($doc['thumb'])) {
            $sizes[] = $doc['thumb'];
        }
        foreach ((array) ($doc['thumbs'] ?? []) as $s) {
            if (is_array($s)) $sizes[] = $s;
        }
        if (!$sizes) return null;

        // Eng kichigi → tez yuklanadi (poster uchun kifoya).
        $best = null; $bestSize = PHP_INT_MAX;
        foreach ($sizes as $s) {
            $n = (int) ($s['size'] ?? 0);
            if ($n <= 0) $n = PHP_INT_MAX;
            if ($n < $bestSize) { $bestSize = $n; $best = $s; }
        }
        if (!$best) return null;
        $loc = $best['location'] ?? $best;
        if (!is_array($loc)) return null;

        $fr = $doc['file_reference'] ?? '';
        if (is_object($fr)) {
            $fr = method_exists($fr, '__toString') ? (string) $fr : '';
        } elseif (is_array($fr)) {
            $fr = implode('', array_map('chr', array_map('intval', $fr)));
        }
        if (!is_string($fr) || $fr === '') return null;

        return [
            'doc_id'   => (string) ($doc['id'] ?? ''),
            'doc_ah'   => (string) ($doc['access_hash'] ?? ''),
            'fr'       => base64_encode($fr),
            'dc'       => (int) ($loc['dc_id'] ?? $doc['dc_id'] ?? 0),
            'type'     => (string) ($best['type'] ?? ''),
            'tid'      => (string) ($loc['id'] ?? ''),
            'tah'      => (string) ($loc['access_hash'] ?? ''),
            'vol'      => (int) ($loc['volume_id'] ?? 0),
            'local'    => (int) ($loc['local_id'] ?? 0),
            'secret'   => (string) ($loc['secret'] ?? ''),
            'size'     => (int) ($best['size'] ?? 0),
            'w'        => (int) ($best['w'] ?? 0),
            'h'        => (int) ($best['h'] ?? 0),
        ];
    }

    /** Thumbnail ma'lumotini alohida jadvalga saqlaydi (jim). */
    public static function saveThumb($ch, $post, $t)
    {
        // Zamonaviy Telegram layerlarida thumb'ning o'z `location` i yo'q —
        // hujjatning (doc_id / doc_ah / fr) + `type` (thumb_size) ishlatiladi.
        if (!$t || empty($t['doc_id']) || empty($t['doc_ah'])
            || empty($t['fr']) || empty($t['type'])) return false;
        try {
            self::ensure();
            Database::getInstance()->query(
                "INSERT INTO `telegram_thumb`
                 (`channel`,`post`,`doc_id`,`doc_ah`,`fr`,`dc`,`type`,`tid`,`tah`,
                  `vol`,`local`,`secret`,`size`,`w`,`h`,`t`)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                 ON DUPLICATE KEY UPDATE
                   `doc_id`=VALUES(`doc_id`), `doc_ah`=VALUES(`doc_ah`),
                   `fr`=VALUES(`fr`), `dc`=VALUES(`dc`), `type`=VALUES(`type`),
                   `tid`=VALUES(`tid`), `tah`=VALUES(`tah`), `vol`=VALUES(`vol`),
                   `local`=VALUES(`local`), `secret`=VALUES(`secret`),
                   `size`=VALUES(`size`), `w`=VALUES(`w`), `h`=VALUES(`h`), `t`=VALUES(`t`)",
                [
                    self::key($ch), (int) $post,
                    $t['doc_id'], $t['doc_ah'], $t['fr'], $t['dc'], $t['type'],
                    $t['tid'], $t['tah'], $t['vol'], $t['local'], $t['secret'],
                    $t['size'], $t['w'], $t['h'], time(),
                ]
            );
            return true;
        } catch (\Throwable $e) {
            return false;
        }
    }

    /** Saqlangan thumbnail ma'lumoti. */
    public static function getThumb($ch, $post)
    {
        try {
            self::ensure();
            return Database::getInstance()->fetchOne(
                "SELECT * FROM `telegram_thumb` WHERE `channel`=? AND `post`=? LIMIT 1",
                [self::key($ch), (int) $post]
            );
        } catch (\Throwable $e) {
            return null;
        }
    }

    /** Thumb JPEG'ining diskdagi kesh yo'li (barqaror, kanal/post bo'yicha). */
    public static function thumbCachePath($ch, $post)
    {
        $dir = defined('UPLOAD_DIR') ? UPLOAD_DIR . 'tg_thumbs' : dirname(__DIR__) . '/uploads/tg_thumbs';
        if (!is_dir($dir)) @mkdir($dir, 0777, true);
        $safe = preg_replace('/[^A-Za-z0-9_-]/', '_', self::key($ch));
        return $dir . '/' . $safe . '_' . (int) $post . '.jpg';
    }

    /**
     * Thumb baytlarini bot MTProto sessiyasi bilan yuklab, diskka keshlaydi.
     * `file_reference` -> `inputDocumentFileLocation` + `thumb_size` orqali
     * OLIB KELINADI (video bayti EMAS, faqat ~25 KB JPEG). Muvaffaqiyatsizlik
     * jim qaytariladi — poster ixtiyoriy, video ochilishiga ta'sir qilmaydi.
     *
     * @param mixed $api  ochiq MadelineProto sessiyasi (TgPull::openBotSession())
     * @return int yozilgan baytlar soni (0 = muvaffaqiyatsiz)
     */
    public static function cacheThumbBytes($api, $ch, $post, $t = null)
    {
        if (!$t) $t = self::getThumb($ch, $post);
        if (!$t || empty($t['doc_id']) || empty($t['doc_ah'])
            || empty($t['fr']) || empty($t['type'])) return 0;
        $size = (int) ($t['size'] ?? 0);
        if ($size <= 0 || $size > 2 * 1024 * 1024) return 0; // 2 MB dan katta emas

        try {
            $dl = [
                'InputFileLocation' => [
                    '_' => 'inputDocumentFileLocation',
                    'id' => (int) $t['doc_id'],
                    'access_hash' => (int) $t['doc_ah'],
                    'file_reference' => base64_decode((string) $t['fr'], true),
                    'thumb_size' => (string) $t['type'],
                    'dc_id' => (int) ($t['dc'] ?? 0),
                ],
                'size' => $size, 'mime' => 'image/jpeg',
                'ext' => '.jpg', 'name' => 'thumb',
            ];
            $buf = '';
            $api->downloadToCallable($dl, function ($payload) use (&$buf) {
                $buf .= (string) $payload;
            }, null, false, 0, $size, 512 * 1024);
            if (strlen($buf) < 100 || substr($buf, 0, 2) !== "\xFF\xD8") return 0; // JPEG emas

            $path = self::thumbCachePath($ch, $post);
            $tmp  = $path . '.tmp.' . getmypid();
            if (@file_put_contents($tmp, $buf) === false) return 0;
            @rename($tmp, $path);
            return strlen($buf);
        } catch (\Throwable $e) {
            return 0;
        }
    }

    /**
     * Thumbni to'liq tayyorlash: hujjatdan ma'lumot olish + baza + disk kesh.
     * Backfill paytida ochiq sessiya bilan chaqiriladi.
     */
    public static function captureThumb($ch, $post, $doc, $api = null)
    {
        try {
            $t = self::extractThumb($doc);
            if (!$t) return false;
            self::saveThumb($ch, $post, $t);
            if ($api) self::cacheThumbBytes($api, $ch, $post, $t);
            return true;
        } catch (\Throwable $e) { /* poster ixtiyoriy */ }
        return false;
    }

    /**
     * `https://t.me/kanal/123` yoki `https://t.me/c/123456/123` -> ref.
     * @return array{channel:string,post:int,url:string}|null
     */
    public static function parseUrl($url)
    {
        $url = trim((string) $url);
        if ($url === '') return null;
        if (!preg_match('#(?:https?://)?(?:www\.)?(?:t|telegram)\.me/(?:c/(\d+)|([A-Za-z0-9_]{3,}))/(\d+)#i', $url, $m)) {
            return null;
        }
        $post = (int) $m[3];
        if ($post <= 0) return null;
        if (!empty($m[1])) {
            $ch = 'c' . $m[1];
            return ['channel' => $ch, 'post' => $post, 'url' => 'https://t.me/c/' . $m[1] . '/' . $post];
        }
        $ch = $m[2];
        return ['channel' => $ch, 'post' => $post, 'url' => 'https://t.me/' . $ch . '/' . $post];
    }

    /** Kanal nomi uchun normal kalit (TgDocCache bilan bir xil: kichik harf). */
    private static function key($ch)
    {
        return strtolower((string) $ch);
    }

    /**
     * Bazadagi metama'lumotni `api/tg-doc.php` javob shaklida qaytaradi.
     * Faqat to'liq va muvaffaqiyatli (`status=ok`) yozuv qaytariladi.
     * @return array|null
     */
    public static function get($ch, $post)
    {
        self::ensure();
        $row = Database::getInstance()->fetchOne(
            "SELECT * FROM `telegram_meta` WHERE `channel` = ? AND `post` = ? LIMIT 1",
            [self::key($ch), (int) $post]
        );
        if (!$row || ($row['status'] ?? '') !== 'ok'
            || empty($row['doc_id']) || empty($row['file_reference'])) {
            return null;
        }
        return [
            'ok'      => true,
            'cached'  => true,
            't'       => (int) ($row['t'] ?? 0),
            'v'       => TG_META_VER,
            'id'      => (string) $row['doc_id'],
            'ah'      => (string) ($row['access_hash'] ?? ''),
            'fr'      => (string) $row['file_reference'],
            'dc'      => (int) ($row['dc'] ?? 0),
            'size'    => (int) ($row['size'] ?? 0),
            'mime'    => (string) ($row['mime'] ?? ''),
            'fn'      => (string) ($row['fn'] ?? ''),
            'w'       => (int) ($row['w'] ?? 0),
            'h'       => (int) ($row['h'] ?? 0),
            'dur'     => (int) ($row['dur'] ?? 0),
            'source'  => (string) ($row['source'] ?? 'bot'),
        ];
    }

    /** To'liq metama'lumotni bazaga yozadi (yangilaydi). */
    public static function save($ch, $post, $out, $source = 'bot')
    {
        self::ensure();
        if (empty($out['id']) || empty($out['ah']) || empty($out['fr'])) {
            return false;
        }
        // Bot yozuvi foydalanuvchi (gram) havolasini ESKIRITMASIN: agar hozirgi
        // yozuv gram manbasidan bo'lsa va yangi bo'lsa, uni saqlaymiz. Bot cron
        // keyinroq ishlasa ham yaxshi havola yo'qolmaydi.
        if ($source === 'bot') {
            $cur = Database::getInstance()->fetchOne(
                "SELECT `source`, `t` FROM `telegram_meta` WHERE `channel`=? AND `post`=? LIMIT 1",
                [self::key($ch), (int) $post]
            );
            if ($cur && ($cur['source'] ?? '') === 'gram'
                && (time() - (int) ($cur['t'] ?? 0)) < 43200) {
                return true;   // 12 soatlik gram havolasi ustun
            }
        }
        $sql = "INSERT INTO `telegram_meta`
            (`channel`, `post`, `doc_id`, `access_hash`, `file_reference`,
             `dc`, `size`, `mime`, `fn`, `w`, `h`, `dur`, `source`, `status`, `error`, `t`)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'ok', NULL, ?)
            ON DUPLICATE KEY UPDATE
                `doc_id`=VALUES(`doc_id`), `access_hash`=VALUES(`access_hash`),
                `file_reference`=VALUES(`file_reference`), `dc`=VALUES(`dc`),
                `size`=VALUES(`size`), `mime`=VALUES(`mime`), `fn`=VALUES(`fn`),
                `w`=VALUES(`w`), `h`=VALUES(`h`), `dur`=VALUES(`dur`),
                `source`=VALUES(`source`), `status`='ok', `error`=NULL, `t`=VALUES(`t`)";
        $stmt = Database::getInstance()->query($sql, [
            self::key($ch), (int) $post,
            (string) $out['id'], (string) $out['ah'], (string) $out['fr'],
            (int) ($out['dc'] ?? 0), (int) ($out['size'] ?? 0),
            (string) ($out['mime'] ?? ''), (string) ($out['fn'] ?? ''),
            (int) ($out['w'] ?? 0), (int) ($out['h'] ?? 0), (int) ($out['dur'] ?? 0),
            (string) $source, (int) ($out['t'] ?? time()),
        ]);
        return $stmt !== false;
    }

    /**
     * Foydalanuvchining O'Z sessiyasi (GramJS) yechgan hujjat havolasini saqlaydi.
     * Bu — server (bot) havolasidan farqli ravishda tomoshabbin akkauntida ham
     * ishlaydigan havola. Faqat katalogda bor (kanal, post) juftliklariga va
     * bot bilan bir xil hujjat ID'siga ega bo'lgan yozuvlarga ruxsat beriladi —
     * shuning uchun tasodifiy/sox ta ma'lumot bazani buzolmaydi.
     *
     * @return bool saqlandi yoki yo'q
     */
    public static function saveGram($ch, $post, $out)
    {
        self::ensure();
        $ch   = self::key($ch);
        $post = (int) $post;
        if ($ch === '' || $post <= 0 || empty($out['id'])
            || empty($out['ah']) || empty($out['fr'])) {
            return false;
        }

        // 1) Faqat katalogdagi video bo'lishi kerak.
        $db = Database::getInstance();
        $like = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $ch) . '%';
        $known = false;
        foreach (['episodes', 'reels'] as $tbl) {
            $rows = $db->fetchAll(
                "SELECT video_url FROM `{$tbl}` WHERE video_url LIKE ? LIMIT 100",
                [$like]
            );
            $re = '#(?:t|telegram)\.me/(?:c/\d+|' . preg_quote($ch, '#') . ')/'
                . $post . '(?:[/?\#]|$)#i';
            foreach ($rows as $r) {
                if (preg_match($re, (string) ($r['video_url'] ?? ''))) {
                    $known = true;
                    break 2;
                }
            }
        }
        if (!$known) return false;

        // 2) Hujjat ID'si bot yozuvidagi bilan bir xil bo'lishi kerak
        //    (agar bot yozuvi bor bo'lsa). Bu noto'g'ri havola yuborishning
        //    oldini oladi.
        $bot = $db->fetchOne(
            "SELECT `doc_id` FROM `telegram_meta` WHERE `channel`=? AND `post`=? LIMIT 1",
            [$ch, $post]
        );
        if ($bot && !empty($bot['doc_id'])
            && (string) $bot['doc_id'] !== (string) $out['id']) {
            return false;
        }

        // 3) `fr` base64 bo'lishi va oqilona uzunlikda bo'lishi kerak.
        $fr = (string) $out['fr'];
        if (!preg_match('#^[A-Za-z0-9+/]+={0,2}$#', $fr) || strlen($fr) > 8192) {
            return false;
        }
        $raw = base64_decode($fr, true);
        if ($raw === false || strlen($raw) < 8 || strlen($raw) > 4096) {
            return false;
        }

        $out['t'] = time();
        return self::save($ch, $post, $out, 'gram');
    }

    /**
     * Qo'shish paytida darhol "bu video bor" degan yozuv qoldiramiz.
     * To'liq metama'lumot keyin (fetch/backfill) to'ldiriladi.
     */
    public static function savePending($ch, $post)
    {
        self::ensure();
        $sql = "INSERT INTO `telegram_meta` (`channel`, `post`, `status`, `t`)
                VALUES (?,?, 'pending', ?)
                ON DUPLICATE KEY UPDATE `t` = IF(`t` = 0, VALUES(`t`), `t`)";
        Database::getInstance()->query($sql, [self::key($ch), (int) $post, time()]);
    }

    /** Xatoni bazaga qayd etamiz (keyin backfill qayta urinadi). */
    public static function saveError($ch, $post, $message)
    {
        self::ensure();
        $sql = "INSERT INTO `telegram_meta` (`channel`, `post`, `status`, `error`, `t`)
                VALUES (?,?, 'error', ?, ?)
                ON DUPLICATE KEY UPDATE `status`='error', `error`=VALUES(`error`), `t`=VALUES(`t`)";
        Database::getInstance()->query($sql, [
            self::key($ch), (int) $post,
            function_exists('mb_substr')
                ? mb_substr((string) $message, 0, 500)
                : substr((string) $message, 0, 500),
            time(),
        ]);
    }

    /** MadelineProto `document` -> `api/tg-doc.php` javob shakli. */
    public static function docToOut($doc)
    {
        $fn = ''; $w = 0; $h = 0; $dur = 0;
        foreach ((array) ($doc['attributes'] ?? []) as $a) {
            if (!is_array($a)) continue;
            $cn = strtolower((string) ($a['className'] ?? ($a['_'] ?? '')));
            if ($cn === 'documentattributefilename') {
                $fn = (string) ($a['fileName'] ?? ($a['file_name'] ?? ''));
            } elseif ($cn === 'documentattributevideo') {
                $w   = (int) ($a['w'] ?? 0);
                $h   = (int) ($a['h'] ?? 0);
                $dur = (int) round((float) ($a['duration'] ?? 0));
            }
        }
        $fr = $doc['file_reference'] ?? '';
        if (is_object($fr)) {
            $fr = method_exists($fr, '__toString') ? (string) $fr : '';
        } elseif (is_array($fr)) {
            $fr = implode('', array_map('chr', array_map('intval', $fr)));
        }
        if (!is_string($fr)) $fr = '';

        $out = [
            'ok'     => true,
            'cached' => false,
            't'      => time(),
            'v'      => TG_META_VER,
            'id'     => (string) ($doc['id'] ?? ''),
            'ah'     => (string) ($doc['access_hash'] ?? ''),
            'fr'     => $fr === '' ? '' : base64_encode($fr),
            'dc'     => (int) ($doc['dc_id'] ?? 0),
            'size'   => (int) ($doc['size'] ?? 0),
            'mime'   => (string) ($doc['mime_type'] ?? ''),
            'fn'     => $fn, 'w' => $w, 'h' => $h, 'dur' => $dur,
        ];
        if ($out['id'] === '' || $out['ah'] === '' || $out['fr'] === '') return null;
        return $out;
    }

    /**
     * Bitta URL: metama'lumotni Telegram'dan olib, bazaga saqlaydi.
     * Har qanday xato jim yutiladi (admin amaliyoti buzilmaydi).
     * @return array|null  saqlangan metama'lumot
     */
    public static function fetchAndStore($url, $lockTimeout = 5)
    {
        $ref = self::parseUrl($url);
        if (!$ref) return null;
        self::savePending($ref['channel'], $ref['post']);

        $out = null;
        $err = null;
        try {
            require_once __DIR__ . '/TgPull.php';
            TgPull::sessionLockAcquire($lockTimeout);
            $api  = TgPull::openBotSession();
            $info = TgPull::fetchDocInfo($api, $ref['url']);
            $doc  = is_array($info['doc'] ?? null) ? $info['doc'] : null;
            $out  = $doc ? self::docToOut($doc) : null;
            if (!$out) $err = 'Hujjat topilmadi';
            else self::captureThumb($ref['channel'], $ref['post'], $doc, $api);
        } catch (\Throwable $e) {
            $err = $e->getMessage();
        } finally {
            TgPull::sessionLockRelease();
        }

        if ($out) {
            self::save($ref['channel'], $ref['post'], $out, 'bot');
            return $out;
        }
        self::saveError($ref['channel'], $ref['post'], $err ?: 'Noma\'lum xato');
        return null;
    }

    /**
     * Ko'p juftlik: BITTA sessiya, kanal boshiga BITTA RPC. Backfill/bulk uchun.
     * `$pairs`: [['ch'=>'kanal','post'=>71], ...]
     * @return int saqlanganlar soni
     */
    public static function fetchManyAndStore($pairs, $lockTimeout = 8)
    {
        self::ensure();
        $pairs = array_values((array) $pairs);
        if (!$pairs) return 0;
        foreach ($pairs as $p) {
            self::savePending($p['ch'] ?? '', $p['post'] ?? 0);
        }

        $saved = 0;
        try {
            require_once __DIR__ . '/TgPull.php';
            TgPull::sessionLockAcquire($lockTimeout);
            $api  = TgPull::openBotSession();
            $docs = TgPull::fetchDocInfos($api, $pairs);
            foreach ($docs as $key => $res) {
                $parts = explode('/', $key, 2);
                $c = (string) ($parts[0] ?? '');
                $p = (int) ($parts[1] ?? 0);
                if ($c === '' || $p <= 0) continue;
                if (empty($res['doc'])) {
                    self::saveError($c, $p, (string) ($res['err'] ?? 'Hujjat topilmadi'));
                    continue;
                }
                $out = self::docToOut($res['doc']);
                self::captureThumb($c, $p, $res['doc'], $api);
                if ($out && self::save($c, $p, $out, 'bot')) {
                    $saved++;
                } else {
                    self::saveError($c, $p, 'Metama\'lumot noto\'g\'ri yoki saqlanmadi');
                }
            }
        } catch (\Throwable $e) {
            foreach ($pairs as $p) {
                self::saveError($p['ch'] ?? '', $p['post'] ?? 0, $e->getMessage());
            }
        } finally {
            TgPull::sessionLockRelease();
        }
        return $saved;
    }
}
