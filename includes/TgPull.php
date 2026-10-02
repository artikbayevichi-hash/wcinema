<?php
// ============================================================================
// includes/TgPull.php - Telegram'dan video nusxalab yuklab olish
// ============================================================================
// MAQSAD: t.me/kanal/postid manzilidagi video (HAR QANDAY HAJMDAGI) to'g'ri-
// dan-to'g'ri Telegram kanalidan serverga yuklab olinadi, so'ng sayt o'zi
// oqimlaydi (api/stream.php, Range/206) - tomoshabinlar soni cheksiz.
//
// NEGA KERAK: Telegram veb-prevyusi (t.me embed) faqat kichik videolarni
// (~20MB gacha) anonim tomoshabinga oqimlaydi. Katta video (to'liq film)
// "Media is too big" deb yashiriladi - unga na CDN havola, na Cloudflare
// Worker yordam bermaydi. Yagona ishonchli yo'l: MTProto (MadelineProto)
// orqali BOT bilan kanaldan faylni serverga tushirish.
//
// SOZLASH:
//   .env da:  API_ID=<my.telegram.org dan olingan son>
//             API_HASH=<my.telegram.org dan olingan kalit>
//             TELEGRAM_BOT_TOKEN=<allaqachon bor>
//   Bot kanalga ADMIN bo'lib qo'shilgan bo'lishi SHART. Shunda istalgan
//   post (retroaktiv: oldin yozilganlar ham) o'qiladi.
//   Kutubxona: composer require danog/madelineproto  (vendor/ da).
// ============================================================================

class TgPull {

    private $sessionDir;
    private $outDir;

    public function __construct() {
        $this->sessionDir = dirname(__DIR__) . '/storage/mtproto';
        $this->outDir     = (defined('VIDEOS_DIR') && VIDEOS_DIR !== '')
            ? VIDEOS_DIR
            : (dirname(__DIR__) . '/uploads/videos');
        if (!is_dir($this->outDir)) {
            @mkdir($this->outDir, 0777, true);
        }
    }

    /** MadelineProto kutubxonasi o'rnatilganmi (composer)? */
    public static function libraryReady() {
        return is_file(dirname(__DIR__) . '/vendor/autoload.php');
    }

    /** API ID / Hash / token to'ldirilganmi? */
    public static function credentialsReady() {
        return TG_API_ID > 0 && TG_API_HASH !== '' && TELEGRAM_BOT_TOKEN !== '';
    }

    /** Yetishmayotgan sozlamalar ro'yxati (xabar uchun). */
    public static function missingConfig() {
        $miss = [];
        if (TG_API_ID <= 0)          $miss[] = 'API_ID';
        if (TG_API_HASH === '')      $miss[] = 'API_HASH';
        if (TELEGRAM_BOT_TOKEN === '') $miss[] = 'TELEGRAM_BOT_TOKEN';
        return $miss;
    }

    /**
     * t.me havolani parse qiladi.
     *   https://t.me/kanal/123   -> peer='kanal', id=123
     *   https://t.me/c/123456/7  -> peer=123456 (xususiy kanal soni), id=7
     * @return array|null
     */
    public static function parseUrl($url) {
        if (!preg_match('~^(?:https?://)?(?:www\.)?(?:t\.me|telegram\.me)/([^/?#]+)/(\d+)~i', (string) $url, $m)) {
            return null;
        }
        $peer = $m[1];
        if (preg_match('~^c/(\d+)$~', $peer, $cm)) {
            return ['peer' => (int) $cm[1], 'id' => (int) $m[2], 'label' => 'c' . $cm[1]];
        }
        return ['peer' => $peer, 'id' => (int) $m[2], 'label' => preg_replace('/[^a-zA-Z0-9_]/', '', $peer)];
    }

    /**
     * Bot MTProto (MadelineProto) sessiyasini ochadi.
     * Api/live.php va cli workerlari shu orqali bitta sessiyani ishlatadi.
     *
     * @return \danog\MadelineProto\API
     * @throws \Throwable  — xato matni o'zbekcha emas (worker qo'lga oladi)
     */
    public static function openBotSession($sessionDir = null) {
        if (!class_exists(\danog\MadelineProto\API::class)) {
            require_once dirname(__DIR__) . '/vendor/autoload.php';
        }
        $dir = $sessionDir ?: dirname(__DIR__) . '/storage/mtproto';
        if (!is_dir($dir)) {
            @mkdir($dir, 0777, true);
        }
        $settings = new \danog\MadelineProto\Settings;
        $settings->getAppInfo()->setApiId(TG_API_ID)->setApiHash(TG_API_HASH);
        // Windows tezligi uchun keraksiz yuklamalarni o'chiramiz
        $settings->getPeer()->setFullFetch(false)->setCacheAllPeersOnStartup(false);
        $api = new \danog\MadelineProto\API($dir . '/bot_pull', $settings);
        if ($api->getAuthorization() === 0) {
            $auth = $api->botLogin(TELEGRAM_BOT_TOKEN);
            if (empty($auth) || !is_array($auth)) {
                throw new \RuntimeException('Bot tokenni qabul qilmadi. @BotFather dan tokenni tekshiring.');
            }
        } else {
            $api->start();
        }
        return $api;
    }

    // Bot sessiyasini BIR VAQTDA faqat bitta jarayon ishlatishi uchun global
    // mutex (storage/mtproto/worker.lock). MadelineProto ikki jarayon bir
    // sessiyani birga ochsa, ikkinchisi "Could not connect to MadelineProto"
    // (IPC) xatosi bilan tushadi — workerlar bo'shaguncha KUTIB turamiz.
    private static $sessionLockFp = null;
    private static $sessionLockRegistered = false;

    /**
     * Global sessiya qulfini oladi. Boshqa worker ishlayotgan bo'lsa —
     * bo'shaguncha kutadi (default 30 daqiqa). Jarayon tugasa (exit/error)
     * avtomatik bo'shatiladi.
     *
     * @throws \RuntimeException — juda uzoq kutib qolinsa
     */
    public static function sessionLockAcquire($timeoutSec = 1800) {
        if (self::$sessionLockFp !== null) {
            return self::$sessionLockFp; // shu jarayonda allaqachon olingan
        }
        if (!self::$sessionLockRegistered) {
            self::$sessionLockRegistered = true;
            register_shutdown_function(function () {
                TgPull::sessionLockRelease();
            });
        }
        $dir = dirname(__DIR__) . '/storage/mtproto';
        if (!is_dir($dir)) {
            @mkdir($dir, 0777, true);
        }
        $fp = @fopen($dir . '/worker.lock', 'c+');
        if (!$fp) {
            throw new \RuntimeException('Bot sessiya qulfini ochib bo\'lmadi.');
        }
        $deadline = time() + (int) $timeoutSec;
        while (!@flock($fp, LOCK_EX | LOCK_NB)) {
            if (time() > $deadline) {
                @fclose($fp);
                throw new \RuntimeException('Bot sessiyasi hozir band — boshqa yuklash jarayoni ishlayapti. Bir necha daqiqadan so\'ng qayta urining.');
            }
            fwrite(STDERR, '[TgPull] Bot sessiyasi band — bo\'shashini kutamiz...' . "\n");
            sleep(2);
        }
        self::$sessionLockFp = $fp;
        return $fp;
    }

    public static function sessionLockRelease() {
        if (self::$sessionLockFp !== null) {
            @flock(self::$sessionLockFp, LOCK_UN);
            @fclose(self::$sessionLockFp);
            self::$sessionLockFp = null;
        }
    }

    /**
     * t.me postidagi VIDEO document haqida to'liq ma'lumotni qaytaradi.
     * Qayta yuklash (pull) va jonli oqim (live) uchun umumiy boshlanish nuqtasi.
     *
     * @return array{url:string,label:string,post:int,msg:array,media:array,doc:array,
     *               size:int,mime:string,duration:?float,file_name:?string}
     * @throws \Throwable
     */
    public static function fetchDocInfo($api, $url) {
        $parsed = self::parseUrl($url);
        if (!$parsed) {
            throw new \InvalidArgumentException('Havola "t.me/kanal/postid" ko\'rinishida emas.');
        }

        $chatNumeric = $parsed['peer'];
        try {
            $info = $api->getPwrChat($parsed['peer'], true);
            $chatNumeric = $info['chat_id'] ?? $info['id'] ?? $parsed['peer'];
        } catch (\Throwable $e) {
            // username bilan ham urinamiz (ochiq kanal)
        }

        try {
            $msgs = $api->channels->getMessages(channel: $chatNumeric, id: [(int) $parsed['id']]);
        } catch (\Throwable $e) {
            $msgs = $api->channels->getMessages(channel: $parsed['peer'], id: [(int) $parsed['id']]);
        }

        $msg  = null;
        $list = is_array($msgs) ? ($msgs['messages'] ?? null) : null;
        if (is_array($list)) {
            foreach ($list as $m) {
                if (is_array($m) && (int) ($m['id'] ?? 0) === (int) $parsed['id']) {
                    $msg = $m;
                    break;
                }
            }
            if ($msg === null) {
                $msg = $list[0] ?? null;
            }
        }
        if (!$msg) {
            throw new \RuntimeException('Post topilmadi — t.me manzilidagi post raqamini tekshiring.');
        }
        if (($msg['_'] ?? '') === 'messageEmpty') {
            throw new \RuntimeException('Bot bu postni ko\'ra olmayapti. Bot kanalga ADMIN bo\'lib qo\'shilganini va «Xabarlarni o\'qish» huquqi yoqilganini tekshiring (Telegram → kanal → Administrators → bot).');
        }
        if (($msg['_'] ?? '') === 'messageService') {
            throw new \RuntimeException('Bu post xizmat xabari (masalan kino almashgan), video emas.');
        }

        $media = is_array($msg) ? ($msg['media'] ?? null) : null;
        if (!$media) {
            throw new \RuntimeException('Bu postda media yo\'q (o\'chirilgan yoki matnli post).');
        }
        $doc = $media['document'] ?? null;
        if (!$doc) {
            $kind = (string) ($media['_'] ?? 'noma\'lum media');
            throw new \RuntimeException('Bu post VIDEO emas (' . $kind . ').');
        }

        $fileName = null;
        $mime     = (string) ($doc['mime_type'] ?? '');
        $duration = null;
        foreach (($doc['attributes'] ?? []) as $attr) {
            $t = (string) ($attr['_'] ?? '');
            if ($t === 'documentAttributeFilename' && !empty($attr['file_name'])) {
                $fileName = (string) $attr['file_name'];
            }
            if ($t === 'documentAttributeVideo' && isset($attr['duration'])) {
                $duration = (float) $attr['duration'];
            }
        }

        return [
            'url' => $url, 'label' => (string) $parsed['label'], 'post' => (int) $parsed['id'],
            'msg'  => $msg, 'media' => $media, 'doc' => $doc,
            'size' => (int) ($doc['size'] ?? 0), 'mime' => $mime,
            'duration' => $duration, 'file_name' => $fileName,
        ];
    }

    /**
     * Bitta t.me havoladagi videoni Telegram'dan uploads/videos/ga tushiradi.
     *
     * @param string   $url     t.me/kanal/postid
     * @param callable|null $cb progress callback($progress, $speed, $time)
     * @return array{ok:bool, error?:string, path?:string, size?:int,
     *               mime?:string, duration?:float, file_name?:string}
     */
    public function pull($url, $cb = null) {
        set_time_limit(0);
        ini_set('memory_limit', '-1');

        if (!self::libraryReady()) {
            return ['ok' => false, 'error' => 'MadelineProto o\'rnatilmagan — vendor/ papkasi yo\'q. Composer kerak: "composer require danog/madelineproto".'];
        }
        if (!self::credentialsReady()) {
            return ['ok' => false, 'error' => 'Sozlanishi kerak: ' . implode(', ', self::missingConfig())
                . '. Buni olish oson: my.telegram.org → "API development tools" → "Create application" (2 daqiqa), so\'ng .env ga yozing.'];
        }

        $parsed = self::parseUrl($url);
        if (!$parsed) {
            return ['ok' => false, 'error' => 'Havola "t.me/kanal/postid" ko\'rinishida emas.'];
        }

        if (!class_exists(\danog\MadelineProto\API::class)) {
            require_once dirname(__DIR__) . '/vendor/autoload.php';
        }

        try {
        $settings = new \danog\MadelineProto\Settings;
        $settings->getAppInfo()->setApiId(TG_API_ID)->setApiHash(TG_API_HASH);
        // Windows tezligi uchun keraksiz yuklamalarni o'chiramiz
        $settings->getPeer()->setFullFetch(false)->setCacheAllPeersOnStartup(false);

        if (!is_dir($this->sessionDir)) {
            @mkdir($this->sessionDir, 0777, true);
        }
        $session = $this->sessionDir . '/bot_pull';

        // ---------- 1) Bot sessiyasi ----------
        // Global qulf: boshqa worker (live/deliver) sessiyani ishlatayotgan
        // bo'lsa bo'shaguncha kutamiz — aks holda IPC xatosi tushadi.
        TgPull::sessionLockAcquire();
        try {
            $api = new \danog\MadelineProto\API($session, $settings);
            if ($api->getAuthorization() === 0) {
                $auth = $api->botLogin(TELEGRAM_BOT_TOKEN);
                if (empty($auth)) {
                    return ['ok' => false, 'error' => 'Bot tokenni qabul qilmadi. @BotFather dan tokenni tekshiring.'];
                }
            } else {
                $api->start();
            }
        } catch (\Throwable $e) {
            return ['ok' => false, 'error' => $this->friendly($e, 'Botga ulanishda xato')];
        }

        // ---------- 2) Postni olish ----------
        try {
            $resolved = false;
            try {
                $info = $api->getPwrChat($parsed['peer'], true);
                $chatNumeric = $info['chat_id'] ?? $info['id'] ?? $parsed['peer'];
                $resolved = true;
            } catch (\Throwable $e) {
                $chatNumeric = $parsed['peer'];
            }

            if ($resolved) {
                $msgs = $api->channels->getMessages(channel: $chatNumeric, id: [$parsed['id']]);
            } else {
                // username bilan ham urinib ko'ramiz (public kanal)
                $msgs = $api->channels->getMessages(channel: $parsed['peer'], id: [$parsed['id']]);
            }
        } catch (\Throwable $e) {
            return ['ok' => false, 'error' => $this->friendly($e,
                'Post o\'qilmadi. Bot kanalga ADMIN bo\'lib qo\'shilganini tekshiring (Telegram → kanal → Administrators → bot)'
                . ', post id esa t.me manzilidagi son ekanligini tasdiqlang.')];
        }

        $msg   = null;
        $list  = is_array($msgs) ? ($msgs['messages'] ?? null) : null;
        if (is_array($list)) {
            foreach ($list as $m) {
                if (is_array($m) && (int) ($m['id'] ?? 0) === $parsed['id']) {
                    $msg = $m;
                    break;
                }
            }
            if ($msg === null) {
                $msg = $list[0] ?? null;
            }
        }
        $media = is_array($msg) ? ($msg['media'] ?? null) : null;
        if (!$media) {
            $tur = (string) ($msg['_'] ?? '');
            if ($tur === 'messageEmpty') {
                return ['ok' => false, 'error' => 'Bot bu postni ko\'ra olmayapti (post bot qo\'shilgunga qadar joylangan bo\'lishi mumkin). '
                    . 'Telegram → kanal → Administrators → bot ni ADMIN qiling va «Xabarlarni o\'qish» huquqi yoqilganini tekshiring. '
                    . 'Yangi video post joylab, uning havolasini qayta kiriting.'];
            }
            return ['ok' => false, 'error' => 'Bu postda media yo\'q (post o\'chirilgan yoki pochta/announce bo\'lishi mumkin).'];
        }

        // ---------- 3) Video document olish ----------
        $doc = $media['document'] ?? null;
        if (!$doc) {
            $kind = (string) ($media['_'] ?? 'noma\'lum media');
            return ['ok' => false, 'error' => 'Bu post VIDEO emas (' . $kind . '). Video post havolasini qo\'ying.'];
        }

        $fileName = null;
        $mime     = (string) ($doc['mime_type'] ?? '');
        $duration = null;
        foreach (($doc['attributes'] ?? []) as $attr) {
            $t = (string) ($attr['_'] ?? '');
            if ($t === 'documentAttributeFilename' && !empty($attr['file_name'])) {
                $fileName = (string) $attr['file_name'];
            }
            if ($t === 'documentAttributeVideo' && isset($attr['duration'])) {
                $duration = (float) $attr['duration'];
            }
        }

        $ext = $fileName ? strtolower(pathinfo($fileName, PATHINFO_EXTENSION)) : '';
        if (!in_array($ext, ['mp4', 'webm', 'mkv', 'mov', 'm4v', 'avi'], true)) {
            $ext = 'mp4';
        }

        $name = 'tele_' . $parsed['label'] . '_' . $parsed['id'] . ($ext ? '.' . $ext : '');
        $target = rtrim($this->outDir, '/\\') . '/' . $name;

        // ---------- 4) Disk tekshiruvi ----------
        $size = (int) ($doc['size'] ?? 0);
        $free = function_exists('disk_free_space') ? @disk_free_space($this->outDir) : false;
        if ($free !== false && $free < $size * 1.05) {
            return ['ok' => false, 'error' => 'Diskda joy yetarli emas: fayl ' . $this->fmtSize($size)
                . ', bo\'sh joy ' . $this->fmtSize((int) $free) . '.'];
        }

        // ---------- 5) Yuklab olish ----------
        if (is_file($target)) {
            return [
                'ok' => true, 'already' => true, 'path' => 'uploads/videos/' . $name,
                'size' => (int) filesize($target), 'mime' => $mime, 'duration' => $duration,
                'file_name' => $fileName, 'message' => 'Fayl allaqachon yuklab olingan edi.',
            ];
        }

        try {
            if ($cb && is_callable($cb)) {
                $path = $api->downloadToFile($media['document'], $target, $cb);
            } else {
                $path = $api->downloadToFile($media['document'], $target);
            }
        } catch (\Throwable $e) {
            @unlink($target);
            return ['ok' => false, 'error' => $this->friendly($e, 'Yuklab olishda xato')];
        }

        if (!is_file($target) || filesize($target) < 1024 * 512) {
            @unlink($target);
            return ['ok' => false, 'error' => 'Yuklangan fayl juda kichik yoki to\'liq emas — qayta urinib ko\'ring.'];
        }

        return [
            'ok' => true, 'already' => false, 'path' => 'uploads/videos/' . $name,
            'size' => (int) filesize($target), 'mime' => $mime, 'duration' => $duration,
            'file_name' => $fileName ?: $name,
            'message' => 'Video yuklab olindi: ' . $this->fmtSize((int) filesize($target)),
        ];
        } catch (\Throwable $e) {
            return ['ok' => false, 'error' => $this->friendly($e, 'Kutilmagan xato')];
        }
    }

    /** Telecram xatolarini tushunarli matnga aylantiradi. */
    private function friendly(\Throwable $e, $prefix) {
        $msg = trim((string) $e->getMessage());
        $low = mb_strtolower($msg);

        if (strpos($low, 'channel_private') !== false || strpos($low, 'access_denied') !== false
            || strpos($low, 'channel_invalid') !== false || strpos($low, 'chat_admin_required') !== false) {
            return 'Bot kanalga ulana olmadi (kanal yopiq yoki bot unga qo\'shilmagan).'
                . ' Kanal → "Administrators" → botni ADMIN qilib qo\'shing, so\'ng qayta bosing.';
        }
        if (strpos($low, 'username_not_occupied') !== false) {
            return 'Bunday kanal topilmadi (username xato yozilgan).';
        }
        if (strpos($low, 'message_id_invalid') !== false || strpos($low, 'message_not_found') !== false) {
            return 'Bunday post topilmadi — t.me manzilidagi post raqamini tekshiring.';
        }
        if (strpos($low, 'migration') !== false || strpos($low, 'peer_id_invalid') !== false) {
            return 'Kanal identifikatori o\'zgardi — t.me havolani yangilab ko\'ring.';
        }
        if (strpos($low, 'flood') !== false) {
            return 'Telegram so\'rovlarni chekladi (flood wait) — bir necha daqiqadan so\'ng qayta bosing.';
        }
        if (strpos($low, 'connection') !== false) {
            return 'Telegram bilan ulanish uzildi — internetni tekshirib, qayta bosing: ' . $msg;
        }
        if ($prefix && $msg) {
            return $prefix . ': ' . $msg;
        }
        return $msg !== '' ? $msg : 'Noma\'lum xato.';
    }

    private function fmtSize($bytes) {
        $bytes = (float) $bytes;
        if ($bytes >= 1073741824) return number_format($bytes / 1073741824, 2, '.', ' ') . ' GB';
        if ($bytes >= 1048576)    return number_format($bytes / 1048576, 1, '.', ' ') . ' MB';
        if ($bytes >= 1024)       return number_format($bytes / 1024, 0, '.', ' ') . ' KB';
        return (int) $bytes . ' B';
    }
}