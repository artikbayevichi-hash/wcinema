<?php
// ============================================================================
// includes/TgPreview.php — kichik faststart PREVIEW videolar
// ============================================================================
// MAQSAD: 1 GB+ film ochilganda "birinchi kadr" uchun kutishni yo'q qilish.
//   • Bot MTProto orqali videoning BOSHIDAN kichik qismini oladi (to'liq
//     faylni yuklab olish shart emas — ko'p hollarda 32 MB yetarli);
//   • FFmpeg bilan 20 s, 480p, ~2–5 MB, `moov` boshida (faststart) MP4
//     yasaydi;
//   • preview Bot API orqali OMMAVIY kanalga yuklanadi — brauzer uni o'z
//     sessiyasi (GramJS) bilan yechib, to'g'ridan-to'g'ri Telegram CDN'dan
//     oqizadi. Sayt origin'i video baytlarini KO'RMAYDI.
//   • natija `telegram_preview` jadvaliga yoziladi; asl `telegram_meta` ga
//     hech qanday o'zgartirish kiritilmaydi.
//
// Ishlatish (CLI, bir marta):
//   php cli/tg-preview.php --ch=wcinemauz --post=12
//   php cli/tg-preview.php --all --limit=10
// ============================================================================

require_once __DIR__ . '/VideoPrep.php';

class TgPreview
{
    /** @var bool fon worker qulfi shu jarayonda olinganmi */
    private static $workerLockOwned = false;

    /**
     * @var string|null DB'siz ishlaydigan server generatori uchun natija fayli.
     * NULL bo'lsa oddiy MySQL rejimi (sayt/ lokal CLI) ishlayveradi.
     */
    private static $offlineResults = null;

    /** Jadval yo'q bo'lsa yaratamiz (migratsiya qilmasa ham ishlayveradi). */
    public static function ensure()
    {
        static $done = false;
        if ($done) return true;
        try {
            $db = Database::getInstance();
            $db->query(
                "CREATE TABLE IF NOT EXISTS `telegram_preview` (
                    `channel` VARCHAR(64) NOT NULL,
                    `post` INT NOT NULL,
                    `preview_channel` VARCHAR(64) NOT NULL DEFAULT '',
                    `preview_post` INT NOT NULL DEFAULT 0,
                    `size` INT NOT NULL DEFAULT 0,
                    `mime` VARCHAR(64) NOT NULL DEFAULT 'video/mp4',
                    `w` INT NOT NULL DEFAULT 0,
                    `h` INT NOT NULL DEFAULT 0,
                    `dur` INT NOT NULL DEFAULT 0,
                    `status` ENUM('ok','error','pending') NOT NULL DEFAULT 'pending',
                    `error` VARCHAR(500) NOT NULL DEFAULT '',
                    `t` INT NOT NULL DEFAULT 0,
                    PRIMARY KEY (`channel`, `post`),
                    KEY `idx_status_t` (`status`, `t`)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
            );
            // DIQQAT: faqat O'Z jadvalimizga ustun qo'shamiz. `telegram_meta` ga
            // hech qanday ALTER qilinmaydi (eski shart saqlanadi).
            self::ensureColumns();
            // Yangi video qo'shilganda bu yerga navbat yoziladi; fon worker
            // (`php cli/tg-preview.php --queue`) uni bosqichma-bosqich bajaradi.
            $db->query(
                "CREATE TABLE IF NOT EXISTS `telegram_preview_queue` (
                    `channel` VARCHAR(64) NOT NULL,
                    `post` INT NOT NULL,
                    `regen` TINYINT(1) NOT NULL DEFAULT 0,
                    `attempts` INT NOT NULL DEFAULT 0,
                    `last_error` VARCHAR(500) NOT NULL DEFAULT '',
                    `created` INT NOT NULL DEFAULT 0,
                    `updated` INT NOT NULL DEFAULT 0,
                    PRIMARY KEY (`channel`, `post`),
                    KEY `idx_pq_updated` (`updated`)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
            );
            $done = true;
            return true;
        } catch (\Throwable $e) {
            return false;
        }
    }

    /** Eski bazalarda preview jadvalini yangi metama'lumot ustunlari bilan to'ldirish. */
    private static function ensureColumns()
    {
        $db = Database::getInstance();
        $wanted = [
            'bot_file_id'       => "VARCHAR(255) NOT NULL DEFAULT ''",
            'bot_file_unique_id'=> "VARCHAR(64) NOT NULL DEFAULT ''",
            'fname'             => "VARCHAR(255) NOT NULL DEFAULT ''",
            // INSTANT kadr (1 s, ~100–200 KB) — faqat O'Z jadvalimizga.
            'instant_channel'   => "VARCHAR(64) NOT NULL DEFAULT ''",
            'instant_post'      => "INT NOT NULL DEFAULT 0",
            'instant_size'      => "INT NOT NULL DEFAULT 0",
            'instant_w'         => "INT NOT NULL DEFAULT 0",
            'instant_h'         => "INT NOT NULL DEFAULT 0",
            'instant_dur'       => "INT NOT NULL DEFAULT 0",
            'instant_fname'     => "VARCHAR(255) NOT NULL DEFAULT ''",
            'instant_file_id'   => "VARCHAR(255) NOT NULL DEFAULT ''",
            'instant_unique_id' => "VARCHAR(64) NOT NULL DEFAULT ''",
        ];
        foreach ($wanted as $col => $def) {
            try {
                $has = $db->fetchOne(
                    "SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                     WHERE TABLE_SCHEMA = DATABASE()
                       AND TABLE_NAME = 'telegram_preview'
                       AND COLUMN_NAME = ? LIMIT 1",
                    [$col]
                );
                if (!$has) {
                    $db->query("ALTER TABLE `telegram_preview` ADD COLUMN `{$col}` {$def}");
                }
            } catch (\Throwable $e) {
                // jim: eski preview'lar metadata'siz ham ishlayveradi
            }
        }
    }

    /**
     * Tayyor preview ma'lumotini qaytaradi (faqat `status=ok`).
     * @return array|null
     */
    public static function get($ch, $post)
    {
        if (!defined('TG_PREVIEW_ENABLED') || !TG_PREVIEW_ENABLED) return null;
        $ch = strtolower(trim((string) $ch));
        $post = (int) $post;

        if (self::$offlineResults !== null) {
            $row = self::offlineFind($ch, $post);
        } else {
            self::ensure();
            $row = Database::getInstance()->fetchOne(
                "SELECT * FROM `telegram_preview` WHERE `channel` = ? AND `post` = ? LIMIT 1",
                [$ch, $post]
            );
        }
        // `error` holatida ham eski yaroqli preview saqlanib qolishi mumkin
        // (qayta yaratish muvaffaqiyatsiz bo'lsa). U tomoshabinga ko'rsatiladi.
        if (!$row || ($row['status'] ?? '') === 'pending') return null;
        // Kamida bitta klip (19 MB intro YOKI 1 s instant) bo'lishi shart.
        // Instant bor, intro yo'q holatda pleyer to'g'ridan-to'g'ri asl
        // videoga o'tadi — hech qanday xato ko'rsatilmaydi.
        $hasIntro = !empty($row['preview_channel']) && (int) ($row['preview_post'] ?? 0) > 0;
        $hasInstant = !empty($row['instant_channel']) && (int) ($row['instant_post'] ?? 0) > 0;
        if (!$hasIntro && !$hasInstant) return null;
        return self::shapeRow($row);
    }

    /** DB qatori yoki offline natija qatorini pleyer ko'rinishiga o'tkazadi. */
    private static function shapeRow(array $row)
    {
        return [
            'ch' => (string) $row['preview_channel'],
            'p'  => (int) $row['preview_post'],
            'size' => (int) ($row['size'] ?? 0),
            'mime' => (string) ($row['mime'] ?? 'video/mp4'),
            'w' => (int) ($row['w'] ?? 0),
            'h' => (int) ($row['h'] ?? 0),
            'dur' => (int) ($row['dur'] ?? 0),
            't' => (int) ($row['t'] ?? 0),
            'bot_file_id' => (string) ($row['bot_file_id'] ?? ''),
            'bot_file_unique_id' => (string) ($row['bot_file_unique_id'] ?? ''),
            'instant_fname'     => (string) ($row['instant_fname'] ?? ''),
            'instant_file_id'   => (string) ($row['instant_file_id'] ?? ''),
            'instant_unique_id' => (string) ($row['instant_unique_id'] ?? ''),
            // INSTANT kadr — alohida Telegram posti. Yo'q bo'lsa null:
            // pleyer eski tartibda (intro -> asl video) ishlayveradi.
            'instant' => ((string) ($row['instant_channel'] ?? '') !== ''
                && (int) ($row['instant_post'] ?? 0) > 0) ? [
                    'ch'   => (string) $row['instant_channel'],
                    'p'    => (int) $row['instant_post'],
                    'size' => (int) ($row['instant_size'] ?? 0),
                    'w'    => (int) ($row['instant_w'] ?? 0),
                    'h'    => (int) ($row['instant_h'] ?? 0),
                    'dur'  => (int) ($row['instant_dur'] ?? 0),
                ] : null,
        ];
    }

    // --- DB'siz server rejimi -------------------------------------------------
    // Interneti sekin kompyuterda 19 MB larni olish o'rniga, ular yaxshi
    // kanalga ega serverda generatsiya qilinadi. Server MySQL'ga ulanmaydi:
    // faqat kichik JSON vazifalar/natijalar almashinadi.

    public static function setOfflineResults($path)
    {
        self::$offlineResults = ($path === null || trim((string) $path) === '')
            ? null : (string) $path;
    }

    public static function offlineResultsPath()
    {
        return self::$offlineResults;
    }

    private static function offlineRead()
    {
        $path = self::$offlineResults;
        if ($path === null || !is_file($path)) {
            return ['version' => 1, 'results' => []];
        }
        $raw = (string) @file_get_contents($path);
        $doc = $raw === '' ? [] : json_decode($raw, true);
        if (!is_array($doc) || !isset($doc['results']) || !is_array($doc['results'])) {
            return ['version' => 1, 'results' => []];
        }
        return $doc;
    }

    private static function offlineFind($ch, $post)
    {
        foreach (self::offlineRead()['results'] as $row) {
            if (!is_array($row)) continue;
            if (strtolower(trim((string) ($row['channel'] ?? ''))) === $ch
                && (int) ($row['post'] ?? 0) === $post) {
                return $row;
            }
        }
        return null;
    }

    /** Natijani JSON fayliga qo'shamiz/yangilaymiz (parallel ishchilar uchun qulfli). */
    private static function offlineWrite($ch, $post, array $data)
    {
        $path = self::$offlineResults;
        if ($path === null) return false;
        $dir = dirname($path);
        if (!is_dir($dir)) @mkdir($dir, 0777, true);

        $fp = @fopen($path, 'c+');
        if (!$fp) return false;
        $ok = false;
        try {
            if (!flock($fp, LOCK_EX)) return false;
            $raw = stream_get_contents($fp);
            $doc = $raw === '' ? ['version' => 1, 'results' => []] : json_decode($raw, true);
            if (!is_array($doc) || !isset($doc['results']) || !is_array($doc['results'])) {
                $doc = ['version' => 1, 'results' => []];
            }
            $row = array_merge(['channel' => $ch, 'post' => $post], $data);
            $found = false;
            foreach ($doc['results'] as $i => $old) {
                if (!is_array($old)) continue;
                if (strtolower(trim((string) ($old['channel'] ?? ''))) === $ch
                    && (int) ($old['post'] ?? 0) === $post) {
                    $doc['results'][$i] = $row;
                    $found = true;
                    break;
                }
            }
            if (!$found) $doc['results'][] = $row;
            $json = json_encode($doc, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            if ($json === false) return false;
            rewind($fp);
            if (!ftruncate($fp, 0)) return false;
            $ok = fwrite($fp, $json) !== false;
            fflush($fp);
        } finally {
            flock($fp, LOCK_UN);
            fclose($fp);
        }
        return $ok;
    }

    /** Lokal DB'ga keyinchalik import qilish uchun ochiq metod. */
    public static function importRow($ch, $post, array $data)
    {
        return self::save($ch, $post, $data);
    }

    /** Barcha tayyor preview'lar soni (diagnostika uchun). */
    public static function countReady()
    {
        if (self::$offlineResults !== null) {
            $n = 0;
            foreach (self::offlineRead()['results'] as $row) {
                if (is_array($row) && ($row['status'] ?? '') === 'ok') $n++;
            }
            return $n;
        }
        self::ensure();
        $row = Database::getInstance()->fetchOne(
            "SELECT COUNT(*) AS n FROM `telegram_preview` WHERE `status` = 'ok'"
        );
        return (int) ($row['n'] ?? 0);
    }

    private static function save($ch, $post, array $data)
    {
        $ch = strtolower(trim((string) $ch));
        $post = (int) $post;
        $fields = [
            'preview_channel' => (string) ($data['preview_channel'] ?? ''),
            'preview_post'    => (int) ($data['preview_post'] ?? 0),
            'size'            => (int) ($data['size'] ?? 0),
            'mime'            => (string) ($data['mime'] ?? 'video/mp4'),
            'w'               => (int) ($data['w'] ?? 0),
            'h'               => (int) ($data['h'] ?? 0),
            'dur'             => (int) ($data['dur'] ?? 0),
            'status'          => (string) ($data['status'] ?? 'ok'),
            'error'           => mb_substr((string) ($data['error'] ?? ''), 0, 480),
            't'               => time(),
            'bot_file_id'       => mb_substr((string) ($data['bot_file_id'] ?? ''), 0, 240),
            'bot_file_unique_id'=> mb_substr((string) ($data['bot_file_unique_id'] ?? ''), 0, 60),
            'fname'             => mb_substr((string) ($data['fname'] ?? ''), 0, 240),
            'instant_channel'   => (string) ($data['instant_channel'] ?? ''),
            'instant_post'      => (int) ($data['instant_post'] ?? 0),
            'instant_size'      => (int) ($data['instant_size'] ?? 0),
            'instant_w'         => (int) ($data['instant_w'] ?? 0),
            'instant_h'         => (int) ($data['instant_h'] ?? 0),
            'instant_dur'       => (int) ($data['instant_dur'] ?? 0),
            'instant_fname'     => mb_substr((string) ($data['instant_fname'] ?? ''), 0, 240),
            'instant_file_id'   => mb_substr((string) ($data['instant_file_id'] ?? ''), 0, 240),
            'instant_unique_id' => mb_substr((string) ($data['instant_unique_id'] ?? ''), 0, 60),
        ];
        if (self::$offlineResults !== null) {
            return self::offlineWrite($ch, $post, $fields);
        }
        self::ensure();
        $db = Database::getInstance();
        $exists = $db->fetchOne(
            "SELECT 1 FROM `telegram_preview` WHERE `channel` = ? AND `post` = ? LIMIT 1",
            [$ch, $post]
        );
        if ($exists) {
            $set = [];
            foreach ($fields as $k => $v) {
                $set[] = "`$k` = ?";
            }
            $vals = array_values($fields);
            $vals[] = $ch;
            $vals[] = $post;
            return $db->query(
                "UPDATE `telegram_preview` SET " . implode(', ', $set)
                . " WHERE `channel` = ? AND `post` = ?",
                $vals
            );
        }
        $fields['channel'] = $ch;
        $fields['post'] = $post;
        $cols = [];
        $marks = [];
        foreach ($fields as $k => $v) {
            $cols[] = "`$k`";
            $marks[] = '?';
        }
        return $db->query(
            "INSERT INTO `telegram_preview` (" . implode(', ', $cols) . ") VALUES ("
            . implode(', ', $marks) . ")",
            array_values($fields)
        );
    }

    public static function markError($ch, $post, $message)
    {
        $data = [
            'status' => 'error',
            'error' => (string) $message,
        ];
        // Qayta yaratish xatosi eski tayyor preview'ni yo'q qilmasin.
        $old = self::get($ch, $post);
        if ($old) {
            $data['preview_channel'] = $old['ch'];
            $data['preview_post']    = $old['p'];
            $data['size']            = $old['size'];
            $data['mime']            = $old['mime'];
            $data['w']               = $old['w'];
            $data['h']               = $old['h'];
            $data['dur']             = $old['dur'];
            $data['bot_file_id']       = $old['bot_file_id'];
            $data['bot_file_unique_id']= $old['bot_file_unique_id'];
            // Qayta generatsiya xato bersa, tayyor INSTANT kadr yo'qolmasin.
            $data['instant_channel']   = $old['instant']['ch'] ?? '';
            $data['instant_post']      = $old['instant']['p'] ?? 0;
            $data['instant_size']      = $old['instant']['size'] ?? 0;
            $data['instant_w']         = $old['instant']['w'] ?? 0;
            $data['instant_h']         = $old['instant']['h'] ?? 0;
            $data['instant_dur']       = $old['instant']['dur'] ?? 0;
            $data['instant_fname']     = $old['instant_fname'] ?? '';
            $data['instant_file_id']   = $old['instant_file_id'] ?? '';
            $data['instant_unique_id'] = $old['instant_unique_id'] ?? '';
        }
        return self::save($ch, $post, $data);
    }

    // ------------------------------------------------------------------- navbat

    /** Admin panel yangi video qo'shganda chaqiriladi. Hech qachon xato tashlamaydi. */
    public static function enqueue($ch, $post, $regen = false)
    {
        $ch = strtolower(trim((string) $ch));
        $post = (int) $post;
        if ($post <= 0 || !preg_match('/^[A-Za-z0-9_]{1,64}$/', $ch)) return false;
        if (!self::ensure()) return false;
        $db = Database::getInstance();
        $now = time();
        $regen = $regen ? 1 : 0;
        try {
            $old = $db->fetchOne(
                "SELECT regen FROM `telegram_preview_queue` WHERE `channel` = ? AND `post` = ? LIMIT 1",
                [$ch, $post]
            );
            if ($old) {
                // Kuchliroq (qayta yaratish) so'rovi allaqachon turibdi.
                if (!$regen && (int) ($old['regen'] ?? 0) === 1) return true;
                $db->query(
                    "UPDATE `telegram_preview_queue`
                     SET `regen` = ?, `attempts` = 0, `last_error` = '', `updated` = ?
                     WHERE `channel` = ? AND `post` = ?",
                    [$regen, $now, $ch, $post]
                );
            } else {
                $db->query(
                    "INSERT INTO `telegram_preview_queue`
                     (`channel`, `post`, `regen`, `attempts`, `last_error`, `created`, `updated`)
                     VALUES (?, ?, ?, 0, '', ?, ?)",
                    [$ch, $post, $regen, $now, $now]
                );
            }
            return true;
        } catch (\Throwable $e) {
            return false;
        }
    }

    /** Fon worker uchun keyingi vazifalar (bitta sessiyada ketma-ket bajariladi). */
    public static function pending($limit = 10)
    {
        if (!self::ensure()) return [];
        $limit = max(1, min(100, (int) $limit));
        try {
            return Database::getInstance()->fetchAll(
                "SELECT `channel`, `post`, `regen`, `attempts`
                 FROM `telegram_preview_queue`
                 ORDER BY `created` ASC, `post` ASC LIMIT {$limit}"
            );
        } catch (\Throwable $e) {
            return [];
        }
    }

    public static function queueDone($ch, $post)
    {
        try {
            Database::getInstance()->query(
                "DELETE FROM `telegram_preview_queue` WHERE `channel` = ? AND `post` = ?",
                [strtolower(trim((string) $ch)), (int) $post]
            );
        } catch (\Throwable $e) {}
    }

    /** 3 marta xato qilsa, navbatdan o'chiramiz (xato `telegram_preview` da qoladi). */
    public static function queueFail($ch, $post, $error, $attempts = 0)
    {
        $ch = strtolower(trim((string) $ch));
        $post = (int) $post;
        $next = (int) $attempts + 1;
        try {
            if ($next >= 3) {
                self::markError($ch, $post, $error);
                self::queueDone($ch, $post);
                return;
            }
            Database::getInstance()->query(
                "UPDATE `telegram_preview_queue`
                 SET `attempts` = ?, `last_error` = ?, `updated` = ?
                 WHERE `channel` = ? AND `post` = ?",
                [$next, mb_substr((string) $error, 0, 480), time(), $ch, $post]
            );
        } catch (\Throwable $e) {}
    }

    public static function workerLockPath()
    {
        $dir = dirname(__DIR__) . '/storage/cache/preview';
        if (!is_dir($dir)) @mkdir($dir, 0777, true);
        return $dir . '/queue.worker.lock';
    }

    /** Qulf fayli yangimi? (bosh jarayon ishlayapti degani) */
    private static function workerLockBusy()
    {
        $path = self::workerLockPath();
        if (!is_file($path)) return false;
        $age = time() - (int) @filemtime($path);
        if ($age > 7200) { @unlink($path); return false; }   // o'lik qulf
        return true;
    }

    /**
     * Fon worker qulfini oladi. `spawnWorker()` yozgan "spawn:" tokenini
     * qabul qiladi; allaqachon ishlayotgan "run:" bo'lsa — rad etadi.
     */
    public static function workerLockAcquire()
    {
        $path = self::workerLockPath();
        if (is_file($path)) {
            $body = (string) @file_get_contents($path);
            $age  = time() - (int) @filemtime($path);
            if ($age <= 7200 && strpos($body, 'run:') === 0) return false;
        }
        @file_put_contents($path, 'run:' . (int) getmypid() . ':' . time());
        self::$workerLockOwned = true;
        return true;
    }

    /** Uzoq generator paytida qulfni "tirik" saqlash. */
    public static function workerLockTouch()
    {
        if (!self::$workerLockOwned) return;
        @file_put_contents(self::workerLockPath(), 'run:' . (int) getmypid() . ':' . time());
    }

    public static function workerLockRelease()
    {
        if (!self::$workerLockOwned) return;
        $path = self::workerLockPath();
        $body = is_file($path) ? (string) @file_get_contents($path) : '';
        if (strpos($body, 'run:' . (int) getmypid()) === 0) @unlink($path);
        self::$workerLockOwned = false;
    }

    /**
     * Admin so'rovini bloklamasdan fon worker ishga tushiradi.
     * Qulf tufayli bir necha parallell so'rov faqat BITTA jarayon yaratadi.
     */
    public static function spawnWorker()
    {
        if (!defined('TG_PREVIEW_ENABLED') || !TG_PREVIEW_ENABLED) return false;
        if (self::workerLockBusy()) return false;
        $lock = self::workerLockPath();
        $cli  = dirname(__DIR__) . '/cli/tg-preview.php';
        if (!is_file($cli)) return false;
        @file_put_contents($lock, 'spawn:' . time() . ':' . (int) getmypid());

        $phpBin = defined('PHP_CLI_BIN') && trim((string) PHP_CLI_BIN) !== ''
            ? trim((string) PHP_CLI_BIN) : 'php';
        $cmd = escapeshellarg($phpBin) . ' ' . escapeshellarg($cli) . ' --queue --limit=50';
        if (stripos(PHP_OS_FAMILY, 'win') === 0) {
            $fp = @popen('start /B "" ' . $cmd . ' > NUL 2>&1', 'r');
            if (!$fp) { @unlink($lock); return false; }
            @pclose($fp);
        } else {
            @exec($cmd . ' > /dev/null 2>&1 &');
        }
        return true;
    }

    // ------------------------------------------------------------------ generator

    /**
     * Bitta video uchun preview yaratadi va Telegram'ga yuklaydi.
     *
     * @param mixed  $api   ochiq MadelineProto bot sessiyasi (qulf OLINGAN bo'lishi shart)
     * @param string $ch    asl kanal
     * @param int    $post  asl post
     * @param bool   $force mavjud preview qaytadan yaratilsinmi
     * @return array{ok:bool,error?:string,preview?:array}
     */
    /**
     * Tayyor klipni preview guruhga yuklaydi (bot API uzilishlariga qarshi
     * qisqa retry). Har bir klip (19 MB intro va ~150 KB instant) alohida
     * post bo'ladi — brauzer ularni o'z sessiyasi bilan yechadi.
     *
     * @return array|null  Bot API `result` bloki yoki null (xato $err ga yoziladi)
     */
    private static function sendClip($bot, $path, $caption, &$err)
    {
        $err = '';
        for ($try = 1; $try <= 3; $try++) {
            $sent = $bot->sendVideo('@' . TG_PREVIEW_CHANNEL, $path, [
                'caption' => $caption,
                'supports_streaming' => true,
                'disable_notification' => true,
            ]);
            if (is_array($sent) && !empty($sent['result']['message_id'])) {
                return $sent;
            }
            $err = $bot->getLastError() ?: 'Bot API javobi noto\'g\'ri';
            if ($try < 3) sleep(2 * $try);   // 2s, 4s
        }
        return null;
    }

    public static function generate($api, $ch, $post, $force = false)
    {
        $ch = strtolower(trim((string) $ch));
        $post = (int) $post;

        if (!defined('TG_PREVIEW_ENABLED') || !TG_PREVIEW_ENABLED) {
            return ['ok' => false, 'error' => 'TG_PREVIEW_CHANNEL sozlanmagan'];
        }
        if (!$force) {
            $have = self::get($ch, $post);
            if ($have) return ['ok' => true, 'preview' => $have, 'already' => true];
        }
        if (!is_file(dirname(__DIR__) . '/vendor/autoload.php')) {
            return ['ok' => false, 'error' => 'MadelineProto o\'rnatilmagan'];
        }

        $url = preg_match('/^\d+$/', $ch)
            ? 'https://t.me/c/' . $ch . '/' . $post
            : 'https://t.me/' . $ch . '/' . $post;

        $work = dirname(__DIR__) . '/storage/cache/preview';
        if (!is_dir($work)) @mkdir($work, 0777, true);
        $tmpIn  = $work . '/src_' . preg_replace('/[^A-Za-z0-9_-]/', '_', $ch) . '_' . $post . '.bin';
        $tmpOut = $work . '/out_' . preg_replace('/[^A-Za-z0-9_-]/', '_', $ch) . '_' . $post . '.mp4';
        $tmpInstant = $work . '/inst_' . preg_replace('/[^A-Za-z0-9_-]/', '_', $ch) . '_' . $post . '.mp4';

        // TG_BOT_API_BASE berilgan bo'lsa — lokal Bot API server ishlatiladi:
        // 20 MB chegarasi yo'q, manba MTProto orqali yuklanmaydi.
        $localMode  = defined('TG_BOT_API_BASE') && TG_BOT_API_BASE !== '';
        $cachedPath = null;
        $grab = function ($offset, $length, $dest) use ($api, &$info, &$doc, $localMode, &$cachedPath) {
            if ($localMode) {
                self::downloadRangeLocal($api, $info, $offset, $length, $dest, $cachedPath);
            } else {
                // To'g'ridan-to'g'ri ijobiy DC: media DC (-4) dan 10+ barobar tez.
                self::downloadRangeFast($api, $info, $offset, $length, $dest);
            }
        };

        try {
            $info = TgPull::fetchDocInfo($api, $url);
            $doc  = $info['doc'];
            $size = (int) ($doc['size'] ?? 0);
            if ($size < 100 * 1024) {
                return ['ok' => false, 'error' => 'Video juda kichik'];
            }

            // 1) ASOSIY REJIM: video BOSHIDAN aniq 19 MB olib, o'z holicha
            //    yangi guruhga yuklaymiz. FFmpeg yo'q -> vaqt va CPU tejaladi.
            //    Maqsad: foydalanuvchi bosganda shu bo'lak DARHOL chiqsin.
            $clip = min($size, (int) TG_PREVIEW_CLIP_MB * 1024 * 1024);
            $grab(0, $clip, $tmpIn);

            // 2) Bo'lak o'ynalishini tekshiramiz. Ko'p MP4 faststart bo'ladi
            //    (moov boshida) -> xom bo'lak to'g'ridan-to'g'ri ishlaydi.
            $made = null;
            $probe = VideoPrep::inspect($tmpIn);
            if (!empty($probe['ok']) && !empty($probe['video'])) {
                if (@copy($tmpIn, $tmpOut)) {
                    $made = [
                        'ok' => true,
                        'w' => (int) ($probe['video']['width'] ?? $doc['w'] ?? 0),
                        'h' => (int) ($probe['video']['height'] ?? $doc['h'] ?? 0),
                        'dur' => (int) round((float) ($probe['duration'] ?? ($doc['duration'] ?? 0) / 1000)),
                    ];
                }
            }

            // 3) FALLBACK: `moov` oxirida bo'lgan nodir konteynerlar uchun.
            //    Bosh + oxirgi qismlardan SPARSE fayl yasab, FFmpeg bilan
            //    kichik faststart klip yaratamiz (xom bo'lak o'ynamaganda).
            if ((!$made || !$made['ok']) && $size > $clip) {
                @unlink($tmpOut);
                // Metadata hajmi ba'zan eski bo'ladi (wcinemauz/12: 1106 MB
                // yozilgan, aslida ~1050 MB). Noto'g'ri oxirgi ofset
                // OFFSET_INVALID beradi -> haqiqiy hajmni topamiz.
                $realSize = $size;
                if (!$localMode) {
                    try {
                        $realSize = self::actualSize($api, $info, $size);
                    } catch (\Throwable $e) {
                        $realSize = $size;
                    }
                    if ($realSize <= $clip + 1024) $realSize = $size;
                }
                $tailLen = min($realSize - $clip, 8 * 1024 * 1024);
                $tailOff = $realSize - $tailLen;
                $tmpTail = $work . '/tail_' . preg_replace('/[^A-Za-z0-9_-]/', '_', $ch) . '_' . $post . '.bin';
                $sparse  = $work . '/sparse_' . preg_replace('/[^A-Za-z0-9_-]/', '_', $ch) . '_' . $post . '.bin';
                try {
                    $grab($tailOff, $tailLen, $tmpTail);
                    self::buildSparse($tmpIn, $tmpTail, $realSize, $tailOff, $sparse);
                    $made = self::makePreview($sparse, $tmpOut);
                } catch (\Throwable $e) {
                    $made = ['ok' => false, 'error' => $e->getMessage()];
                } finally {
                    @unlink($tmpTail);
                    @unlink($sparse);
                }
            }
            if (!$made || !$made['ok']) {
                $err = (string) ($made['error'] ?? 'Video bo\'lagi o\'ynalmadi');
                self::markError($ch, $post, $err);
                return ['ok' => false, 'error' => $err];
            }

            // 2) Preview'ni ommaviy kanalga yuklaymiz. Brauzer keyin uni O'Z
            //    sessiyasi bilan yechadi — file_reference muammosi yo'q.
            //    Bot API vaqt-vaqti bilan uzilib qolishi mumkin -> qisqa retry.
            require_once __DIR__ . '/TelegramBot.php';
            $bot = new TelegramBot();
            $bot->setTimeout(180);
            $caption = 'WC preview ' . $ch . '/' . $post;
            $lastErr = '';
            $sent = self::sendClip($bot, $tmpOut, $caption, $lastErr);
            if ($sent === null) {
                self::markError($ch, $post, $lastErr);
                return ['ok' => false, 'error' => $lastErr];
            }

            // 3) INSTANT KADR: 19 MB intro ham sekin tarmoqda 2 s ichida
            //    yetib bormaydi. Allaqachon lokaldagi intro'dan 1 s, 240p,
            //    ~100–200 KB lik faststart MP4 yasab, shu guruhga yuklaymiz.
            //    Yangi Telegram bayti yuklanmaydi (faqat lokal FFmpeg).
            $instant = null;
            $instantErr = '';
            $instantMade = self::makeInstant($tmpOut, $tmpInstant);
            if (!empty($instantMade['ok'])) {
                $instantSent = self::sendClip(
                    $bot, $tmpInstant, 'WC instant ' . $ch . '/' . $post, $instantErr
                );
                if ($instantSent !== null) {
                    $instant = [
                        'instant_channel'   => TG_PREVIEW_CHANNEL,
                        'instant_post'      => (int) $instantSent['result']['message_id'],
                        'instant_size'      => (int) @filesize($tmpInstant),
                        'instant_w'         => (int) ($instantMade['w'] ?? 0),
                        'instant_h'         => (int) ($instantMade['h'] ?? 0),
                        'instant_dur'       => (int) ($instantMade['dur'] ?? 0),
                        'instant_fname'     => 'instant_' . $ch . '_' . $post . '.mp4',
                        'instant_file_id'   => (string) ($instantSent['result']['video']['file_id'] ?? ''),
                        'instant_unique_id' => (string) ($instantSent['result']['video']['file_unique_id'] ?? ''),
                    ];
                }
            }
            // Instant chiqmasa — hech qanday xato emas: pleyer eski tartibda
            // (19 MB intro -> asl video) ishlayveradi.

            $pv = [
                'preview_channel' => TG_PREVIEW_CHANNEL,
                'preview_post' => (int) $sent['result']['message_id'],
                'size' => (int) @filesize($tmpOut),
                'mime' => 'video/mp4',
                'w' => (int) ($made['w'] ?? 0),
                'h' => (int) ($made['h'] ?? 0),
                'dur' => (int) ($made['dur'] ?? 0),
                'status' => 'ok',
                // Bot API tomonidan qaytgan klip metama'lumoti ham saqlanadi.
                'bot_file_id' => (string) ($sent['result']['video']['file_id'] ?? ''),
                'bot_file_unique_id' => (string) ($sent['result']['video']['file_unique_id'] ?? ''),
                'fname' => 'preview_' . $ch . '_' . $post . '.mp4',
            ];
            if (is_array($instant)) $pv = array_merge($pv, $instant);
            self::save($ch, $post, $pv);
            return ['ok' => true, 'preview' => self::get($ch, $post)];
        } catch (\Throwable $e) {
            $err = mb_substr(trim($e->getMessage()), 0, 480);
            self::markError($ch, $post, $err);
            return ['ok' => false, 'error' => $err];
        } finally {
            @unlink($tmpIn);
            @unlink($tmpOut);
            @unlink($tmpInstant);
            // Lokal Bot API fayli har bir video uchun ~1 GB — disk to'lmasin.
            if ($cachedPath !== null && is_file($cachedPath)) @unlink($cachedPath);
        }
    }

    /**
     * To'liq hajmli SPARSE fayl yasaydi: bosh qism 0-ofsetga, oxir qism
     * o'z ofsetiga yoziladi, o'rta esa teshik (nol) bo'lib qoladi.
     * `moov` oxirida bo'lgan MP4'larda shunday qilamiz — FFmpeg atomlarni
     * oxirdan o'qiydi, kadrlarni esa boshdan oladi.
     */
    private static function buildSparse($headPath, $tailPath, $fullSize, $tailOff, $dest)
    {
        $fp = @fopen($dest, 'wb');
        if (!$fp) throw new \RuntimeException("Sparse fayl ochilmadi");
        try {
            if (!@ftruncate($fp, (int) $fullSize)) {
                throw new \RuntimeException("Sparse fayl hajmi o'rnatilmadi");
            }
            if (@fseek($fp, 0) !== 0) throw new \RuntimeException('fseek xato');
            self::copyStream($headPath, $fp);
            if (@fseek($fp, (int) $tailOff) !== 0) throw new \RuntimeException('fseek xato');
            self::copyStream($tailPath, $fp);
        } finally {
            fclose($fp);
        }
        clearstatcache(true, $dest);
    }

    /** Fayl mazmunini ochilgan stream'ga 1 MB bo'laklar bilan yozadi. */
    private static function copyStream($path, $out)
    {
        $in = @fopen($path, 'rb');
        if (!$in) throw new \RuntimeException("Vaqtinchalik fayl o'qilmadi");
        try {
            while (!feof($in)) {
                $buf = fread($in, 1024 * 1024);
                if ($buf === false || $buf === '') break;
                if (@fwrite($out, $buf) === false) {
                    throw new \RuntimeException('diskka yozib bo\'lmadi');
                }
            }
        } finally {
            fclose($in);
        }
    }

    /**
     * Lokal Bot API server orqali faylning faqat berilgan oraliq baytlarini oladi.
     * Bulutli Bot API 20 MB dan katta fayllarni bera olmaydi, lokal server
     * (`--local`) esa chegarasiz va `getFile` mahalliy yo'lni qaytaradi —
     * shuning uchun MTProto media DC muammosi butunlay chetlab o'tiladi.
     *
     * $cachedPathga server yuklab qo'ygan fayl yo'li yoziladi; ish tugagach
     * generate() uni o'chiradi (har bir video ~1 GB bo'lgani uchun disk to'lmaydi).
     */
    private static function downloadRangeLocal($api, array $info, $offset, $limit, $dest, &$cachedPath)
    {
        require_once __DIR__ . '/TelegramBot.php';
        $msg = $info['msg'] ?? null;
        if (!is_array($msg)) {
            throw new \RuntimeException('MTProto xabari topilmadi');
        }
        $botObj = $api->MTProtoToBotAPI($msg);
        $file = $botObj['video'] ?? $botObj['document'] ?? null;
        if (!is_array($file) || empty($file['file_id'])) {
            throw new \RuntimeException('Bot API file_id olinmadi');
        }

        $bot = new TelegramBot();
        $bot->setTimeout(600);
        $res = $bot->getFile($file['file_id']);
        if (!is_array($res) || empty($res['file_path'])) {
            throw new \RuntimeException('getFile xato: ' . ($bot->getLastError() ?: 'file_path yo\'q'));
        }
        $path = (string) $res['file_path'];
        // Lokal server ABSOLYUT yo'l qaytaradi. Nisbiy yo'l = bulutli server
        // (20 MB chegarasi) -> bu usul ishlamaydi.
        if ($path[0] !== '/' && !preg_match('#^[A-Za-z]:[\\\\/]#', $path)) {
            throw new \RuntimeException('Lokal Bot API sozlanmagan (file_path nisbiy)');
        }
        if (!is_file($path)) {
            throw new \RuntimeException('Bot API fayli topilmadi: ' . basename($path));
        }
        $cachedPath = $path;

        $in = @fopen($path, 'rb');
        if (!$in) throw new \RuntimeException('Bot API fayli ochilmadi');
        $out = @fopen($dest, 'wb');
        if (!$out) { fclose($in); throw new \RuntimeException('Vaqtinchalik fayl ochilmadi'); }
        $left = (int) $limit;
        try {
            if (@fseek($in, (int) $offset) !== 0) throw new \RuntimeException('fseek xato');
            while ($left > 0) {
                $buf = fread($in, min(1024 * 1024, $left));
                if ($buf === false || $buf === '') break;   // fayl tugadi
                if (@fwrite($out, $buf) === false) throw new \RuntimeException('diskka yozib bo\'lmadi');
                $left -= strlen($buf);
            }
        } finally {
            fclose($in);
            fclose($out);
        }
        if ($left > 0) throw new \RuntimeException('Bot API fayli so\'ralganga qaraganda qisqa');
    }

    /**
     * TEZ YO'L: `upload.getFile` ni PAST (ijobiy) DC ga aniq chaqiradi.
     *
     * Nima uchun: MadelineProto odatda media DC (-4) ga o'tadi va Windows'da
     * `downloadToCallable` u yerda "NothingInTheSocketException" beradi.
     * Past DC (masalan +4) bilan aynan shu method barqaror ishlaydi.
     * Sinov: +4 -> 0.64 s / 64 KB, -4 -> 7.62 s / 64 KB.
     *
     * Faqat bayt oladi — video sayt orqali o'tmaydi.
     */
    private static function downloadRangeFast($api, array $info, $offset, $limit, $dest)
    {
        $doc = $info['doc'] ?? null;
        if (!is_array($doc)) throw new \RuntimeException('Hujjat topilmadi');
        $dl = $api->getDownloadInfo($doc);
        $loc = $dl['InputFileLocation'] ?? null;
        if (!is_array($loc)) throw new \RuntimeException('InputFileLocation topilmadi');
        $dc = (int) ($loc['dc_id'] ?? 0);
        if ($dc < 0) $dc = -$dc;
        if ($dc <= 0) $dc = (int) ($doc['dc_id'] ?? 4);
        if ($dc <= 0) $dc = 4;

        // MadelineProto ichki ob'ekti: methodCallAsyncRead(..., $dc) ga
        // aniq DC berish uchun (ommaviy API da DC parametri yo'q).
        if (!class_exists(\danog\MadelineProto\InternalDoc::class)) {
            throw new \RuntimeException('MadelineProto ichki klassi topilmadi');
        }
        $ref = new \ReflectionProperty(\danog\MadelineProto\InternalDoc::class, 'wrapper');
        $ref->setAccessible(true);
        $mt = $ref->getValue($api)->getAPI();

        $from = max(0, (int) $offset);
        $total = (int) $limit;
        if ($total <= 0) throw new \RuntimeException('Noto\'g\'ri oraliq');
        // Telegram upload.getFile talablari (sinov bilan aniqlangan):
        //   * offset 64 KB (65536) ga karrali bo'lishi SHART;
        //   * limit 64 KB ning 2 darajali karralisi bo'lishi (65536, 131072,
        //     262144, ...) — 196608 kabi 3x karrali LIMIT_INVALID beradi;
        //   * fayl oxiriga yaqinlashganda katta limit ham LIMIT_INVALID beradi.
        // Eng barqaror va kafolatli variant: doimo 65536 lik bloklar.
        $block = 65536;
        $fp = @fopen($dest, 'wb');
        if (!$fp) throw new \RuntimeException('Vaqtinchalik fayl ochilmadi');
        $written = 0;
        $pos = $from;
        try {
            while ($written < $total) {
                $aligned = $pos - ($pos % $block);
                $skip = $pos - $aligned;
                $take = min($block - $skip, $total - $written);
                $off = $pos;
                $got = false;
                $lastErr = '';
                for ($try = 1; $try <= 5; $try++) {
                    try {
                        $res = $mt->methodCallAsyncRead('upload.getFile', [
                            'location' => $loc,
                            'offset' => $aligned,
                            'limit' => $block,
                            'cdn_supported' => true,
                            'floodWaitLimit' => 0,
                        ], $dc);
                        $bytes = substr((string) ($res['bytes'] ?? ''), $skip, $take);
                        if (strlen($bytes) < $take) {
                            throw new \RuntimeException('Qisqa bo\'lak: ' . strlen($bytes) . '/' . $take);
                        }
                        if (@fseek($fp, $written) !== 0) throw new \RuntimeException('fseek xato');
                        if (@fwrite($fp, $bytes) === false) throw new \RuntimeException('diskka yozib bo\'lmadi');
                        $written += $take;
                        $pos += $take;
                        $got = true;
                        self::workerLockTouch();
                        break;
                    } catch (\Throwable $e) {
                        $lastErr = $e->getMessage();
                        if ($try >= 5) break;
                        sleep(min(10, 1 + $try));   // 2,3,4... s
                    }
                }
                if (!$got) {
                    throw new \RuntimeException("Bo'lak {$off}: {$lastErr}");
                }
            }
        } finally {
            fclose($fp);
        }
        clearstatcache(true, $dest);
        if (@filesize($dest) < $total) {
            throw new \RuntimeException('Bo\'lak to\'liq yuklanmadi');
        }
    }

    /**
     * Hujjatning HAQIQIY hajmini topadi (metadata ba'zan eski/noto'g'ri bo'ladi:
     * masalan wcinemauz/12 da 1106068888 yozilgan, aslida ~1050 MB).
     * `upload.getFile` fayl oxiridan keyin 0 bayt qaytaradi — shundan foydalanib
     * ikkilik qidiruv qilamiz (6–8 so'rov, har biri ~2 s).
     */
    private static function actualSize($api, array $info, $claimedSize)
    {
        $loc = $api->getDownloadInfo($info['doc'])['InputFileLocation'] ?? null;
        if (!is_array($loc)) return (int) $claimedSize;
        $ref = new \ReflectionProperty(\danog\MadelineProto\InternalDoc::class, 'wrapper');
        $ref->setAccessible(true);
        $mt = $ref->getValue($api)->getAPI();
        $dc = (int) ($loc['dc_id'] ?? 4);
        if ($dc < 0) $dc = -$dc;
        if ($dc <= 0) $dc = 4;

        $has = function ($off) use ($mt, $loc, $dc) {
            $off = max(0, (int) $off);
            $aligned = $off - ($off % 65536);   // 64 KB ga karrali bo'lishi SHART
            try {
                $res = $mt->methodCallAsyncRead('upload.getFile', [
                    'location' => $loc, 'offset' => $aligned, 'limit' => 65536,
                    'cdn_supported' => false, 'floodWaitLimit' => 0,
                ], $dc);
                return strlen((string) ($res['bytes'] ?? '')) > 0;
            } catch (\Throwable $e) {
                return false;   // OFFSET_INVALID = fayl oxiridan o'tib ketdik
            }
        };

        $claimedSize = (int) $claimedSize;
        // 1) Agar haqiqiy fayl claimed'dan KATTA bo'lsa, yuqoriga o'sib chiqamiz.
        $hi = $claimedSize;
        for ($i = 0; $i < 5 && $has($hi); $i++) {
            $hi *= 2;
        }
        // 2) Past chegarani fraksiyalar bilan TEZ topamiz. Metadata odatda
        //    haqiqiy hajmga yaqin bo'lgani uchun 7–8 so'rov yetarli bo'ladi
        //    (0 dan boshlab ikkilik qidiruv 30+ so'rov olardi).
        $lo = 0;
        foreach ([0.99, 0.97, 0.95, 0.92, 0.88, 0.82, 0.75, 0.6, 0.4, 0.2, 0.0] as $f) {
            $o = (int) ($claimedSize * $f);
            if ($o >= $hi) continue;
            if ($has($o)) { $lo = $o + 65536; break; }
            $hi = $o;   // bu ofset fayl oxiridan keyin -> yuqori chegara
        }
        // 3) Tor oraliqda ikkilik qidiruv.
        for ($i = 0; $i < 40 && $lo < $hi; $i++) {
            $mid = intdiv($lo + $hi, 2);
            if ($has($mid)) $lo = $mid + 1; else $hi = $mid;
        }
        // 4) Aniq oxir: oxirgi 64 KB bo'lak qancha bayt qaytardi?
        $start = max(0, $lo - 65536);
        $start = $start - ($start % 65536);   // offset 64 KB ga tekis bo'lishi shart
        try {
            $res = $mt->methodCallAsyncRead('upload.getFile', [
                'location' => $loc, 'offset' => $start, 'limit' => 65536,
                'cdn_supported' => false, 'floodWaitLimit' => 0,
            ], $dc);
            $n = strlen((string) ($res['bytes'] ?? ''));
            return $start + ($n > 0 ? $n : 0);
        } catch (\Throwable $e) {
            return $lo;   // taxminiy hajm ham fallback uchun yetarli
        }
    }

    /**
     * Telegram hujjatining berilgan oraliq baytlarini diskka yozadi.
     * `cli/prefix-build.php` va `cli/hls-worker.php` dagi ISHLAYDIGAN usul:
     * to'liq `$doc` massivi to'g'ridan-to'g'ri `downloadToCallable` ga beriladi
     * (u DC almashish, CDN, file_reference, FLOOD_WAIT'ni o'zi boshqaradi).
     * 6-argument — EKSKLYUZIV oxirgi ofset (uzunlik EMAS).
     */
    private static function downloadRange($api, $doc, $offset, $limit, $dest)
    {
        $from   = max(0, (int) $offset);
        $limit  = (int) $limit;
        $end    = $from + $limit;          // eksklyuziv chegara
        $expect = $limit;
        if ($expect <= 0) {
            throw new \RuntimeException("Noto'g'ri oraliq");
        }

        $fp = @fopen($dest, 'wb');
        if (!$fp) throw new \RuntimeException('Vaqtinchalik fayl ochilmadi');
        $written = 0;
        $tries   = 0;
        try {
            while ($written < $expect) {
                $tries++;
                $base = $from + $written;  // qayta urinishda aynan shu baytdan
                try {
                    $api->downloadToCallable(
                        $doc,
                        function ($payload, $off) use ($fp, $from, $base, &$written) {
                            $payload = (string) $payload;
                            $off     = (int) $off;
                            if ($off < $base) {           // tekislash/ustma-ust bo'lak
                                $skip = $base - $off;
                                if ($skip >= strlen($payload)) return;
                                $payload = substr($payload, $skip);
                                $off     = $base;
                            }
                            if ($payload === '') return;
                            if (@fseek($fp, $off - $from) !== 0) {
                                throw new \RuntimeException('fseek xato');
                            }
                            if (@fwrite($fp, $payload) === false) {
                                throw new \RuntimeException('diskka yozib bo\'lmadi');
                            }
                            $written += strlen($payload);
                        },
                        null,                 // status callback
                        false,                // seekable — bo'laklar tartibda
                        $base,
                        $end,
                        512 * 1024            // Telegram bo'lak o'lchami
                    );
                } catch (\Throwable $e) {
                    clearstatcache(true, $dest);
                    $real = (int) @filesize($dest);
                    if ($real > $written) $written = $real;   // yozilgan baytlar yo'qolmasin
                    if ($written >= $expect) break;
                    if ($tries >= 4) throw $e;
                    sleep(min(12, 3 * $tries));   // FLOOD_WAIT himoyasi
                }
            }
        } finally {
            fclose($fp);
        }
        if (!is_file($dest) || @filesize($dest) < 100 * 1024) {
            throw new \RuntimeException('Video boshi yuklanmadi');
        }
    }

    /**
     * FFmpeg bilan kichik faststart preview yasaydi. Hajm chegarasidan
     * oshib ketsa, sifatni pasaytirib qayta urinadi.
     *
     * @return array{ok:bool,error?:string,w?:int,h?:int,dur?:int}
     */
    private static function makePreview($src, $out)
    {
        if (!function_exists('proc_open')) {
            return ['ok' => false, 'error' => 'proc_open mavjud emas'];
        }
        $ffmpeg = defined('FFMPEG_BIN') && trim((string) FFMPEG_BIN) !== ''
            ? trim((string) FFMPEG_BIN) : 'ffmpeg';
        $sec    = (int) TG_PREVIEW_SEC;
        $maxB   = (int) TG_PREVIEW_MAX_MB * 1024 * 1024;

        $tries = [
            ['h' => (int) TG_PREVIEW_HEIGHT, 'crf' => 30, 'audio' => true],
            ['h' => 360, 'crf' => 33, 'audio' => true],
            ['h' => 240, 'crf' => 36, 'audio' => false],
        ];
        $lastErr = 'ffmpeg ishlamadi';
        foreach ($tries as $t) {
            @unlink($out);
            $cmd = [
                $ffmpeg, '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
                '-i', (string) $src,
                '-t', (string) $sec,
                '-map', '0:v:0',
            ];
            if ($t['audio']) $cmd[] = '-map';
            if ($t['audio']) $cmd[] = '0:a:0?';
            $cmd = array_merge($cmd, [
                '-sn', '-dn',
                '-vf', 'scale=-2:' . (int) $t['h'],
                '-c:v', 'libx264', '-preset', 'veryfast',
                '-crf', (string) $t['crf'],
                '-g', '48', '-pix_fmt', 'yuv420p',
            ]);
            if ($t['audio']) {
                $cmd = array_merge($cmd, ['-c:a', 'aac', '-b:a', '64k', '-ac', '2']);
            } else {
                $cmd[] = '-an';
            }
            $cmd = array_merge($cmd, [
                '-movflags', '+faststart', '-f', 'mp4', (string) $out,
            ]);

            $run = self::runCmd($cmd, 600);
            if ($run['exit'] !== 0 || !is_file($out) || @filesize($out) < 50 * 1024) {
                $lastErr = self::short($run['stderr']);
                continue;
            }
            $bytes = (int) @filesize($out);
            if ($bytes > $maxB && $t['h'] > 240) continue;   // keyingi past sifat

            $probe = VideoPrep::inspect($out);
            if (empty($probe['ok']) || empty($probe['video'])) {
                $lastErr = (string) ($probe['error'] ?? 'preview o\'qilmadi');
                continue;
            }
            return [
                'ok' => true,
                'w' => (int) ($probe['video']['width'] ?? 0),
                'h' => (int) ($probe['video']['height'] ?? 0),
                'dur' => (int) round((float) ($probe['duration'] ?? 0)),
            ];
        }
        return ['ok' => false, 'error' => mb_substr($lastErr, 0, 480)];
    }

    /**
     * INSTANT KADR: 1 s, 240p, ovozsiz, `moov` boshida MP4.
     * Maqsad — sekin (2G/3G) tarmoqda ham birinchi kadr 2 s ichida chiqsin.
     * Manba sifatida ALLAQACHON olingan 19 MB intro ishlatiladi — qo'shimcha
     * Telegram yuklab olish yo'q. Hajm chegarasidan oshsa sifatni pasaytiramiz.
     *
     * @return array{ok:bool,error?:string,w?:int,h?:int,dur?:int}
     */
    private static function makeInstant($src, $out)
    {
        if (!function_exists('proc_open')) {
            return ['ok' => false, 'error' => 'proc_open mavjud emas'];
        }
        $ffmpeg = defined('FFMPEG_BIN') && trim((string) FFMPEG_BIN) !== ''
            ? trim((string) FFMPEG_BIN) : 'ffmpeg';
        $sec  = (int) TG_PREVIEW_INSTANT_SEC;
        $maxB = (int) TG_PREVIEW_INSTANT_KB * 1024;

        $tries = [
            ['h' => (int) TG_PREVIEW_INSTANT_HEIGHT, 'fps' => 12, 'kb' => 90],
            ['h' => 240, 'fps' => 10, 'kb' => 60],
            ['h' => 180, 'fps' => 10, 'kb' => 45],
        ];
        $last = count($tries) - 1;
        $lastErr = 'ffmpeg ishlamadi';
        foreach ($tries as $ti => $t) {
            @unlink($out);
            $kb = (int) $t['kb'];
            $cmd = [
                $ffmpeg, '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
                '-i', (string) $src,
                '-t', (string) $sec,
                '-map', '0:v:0', '-an', '-sn', '-dn',
                '-vf', 'scale=-2:' . (int) $t['h']
                    . ':force_original_aspect_ratio=decrease,fps=' . (int) $t['fps'],
                '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'fastdecode',
                '-profile:v', 'baseline', '-level', '3.0',
                '-b:v', $kb . 'k', '-maxrate', ($kb * 2) . 'k', '-bufsize', ($kb * 3) . 'k',
                '-g', (string) (int) $t['fps'], '-pix_fmt', 'yuv420p',
                '-movflags', '+faststart', '-f', 'mp4', (string) $out,
            ];
            $run = self::runCmd($cmd, 300);
            $bytes = is_file($out) ? (int) @filesize($out) : 0;
            if ($run['exit'] !== 0 || $bytes < 2048) {
                $lastErr = self::short($run['stderr']);
                continue;
            }
            // Oxirgi urinishda biroz oshib ketsa ham qabul qilamiz: 300 KB
            // ham sekin tarmoqda bir necha soniyada yetadi.
            if ($bytes > $maxB && $ti < $last) continue;

            $probe = VideoPrep::inspect($out);
            if (empty($probe['ok']) || empty($probe['video'])) {
                $lastErr = (string) ($probe['error'] ?? 'instant o\'qilmadi');
                continue;
            }
            return [
                'ok' => true,
                'w' => (int) ($probe['video']['width'] ?? 0),
                'h' => (int) ($probe['video']['height'] ?? 0),
                'dur' => max(1, (int) round((float) ($probe['duration'] ?? $sec))),
            ];
        }
        return ['ok' => false, 'error' => mb_substr($lastErr, 0, 480)];
    }

    /** past ustuvorlik bilan buyruq bajarish (VideoPrep::run bilan bir xil usul). */
    private static function runCmd(array $cmd, $timeout)
    {
        $outF = @tempnam(sys_get_temp_dir(), 'pvout_');
        $errF = @tempnam(sys_get_temp_dir(), 'pverr_');
        if ($outF === false || $errF === false) {
            return ['exit' => -1, 'stderr' => 'temp xato'];
        }
        $desc = [
            0 => ['pipe', 'r'],
            1 => ['file', $outF, 'w'],
            2 => ['file', $errF, 'w'],
        ];
        $pipes = [];
        $proc = @proc_open($cmd, $desc, $pipes);
        if (!is_resource($proc)) {
            @unlink($outF); @unlink($errF);
            return ['exit' => -1, 'stderr' => 'proc_open xato'];
        }
        if (isset($pipes[0]) && is_resource($pipes[0])) fclose($pipes[0]);
        $start = microtime(true);
        $prio = false;
        $exit = null;
        while (true) {
            $st = proc_get_status($proc);
            if (!$st['running']) { $exit = (int) $st['exitcode']; break; }
            if (!$prio && !empty($st['pid']) && function_exists('wc_apply_low_priority')) {
                wc_apply_low_priority((int) $st['pid']);
                $prio = true;
            }
            if ($timeout > 0 && (microtime(true) - $start) > $timeout) {
                @proc_terminate($proc, 9);
                usleep(200000);
                $exit = -1;
                break;
            }
            usleep(100000);
        }
        @proc_close($proc);
        $err = (string) @file_get_contents($errF);
        @unlink($outF); @unlink($errF);
        return ['exit' => $exit, 'stderr' => $err];
    }

    private static function short($s)
    {
        $s = trim(preg_replace('/\s+/', ' ', (string) $s) ?? '');
        return $s !== '' ? mb_substr($s, -400) : 'sabab noma\'lum';
    }
}
