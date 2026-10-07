<?php
// ============================================================================
// includes/DM.php - shaxsiy (1:1) xabarlar yadrosi
// ============================================================================
// MUHIM: xabarlar SERVERDA saqlanadi (dm_messages), Telegram DM emas.
//
// Nima uchun: avval shaxsiy chat butunlay brauzerdagi MTProto orqali
// yuborilardi - qabul qiluvchi foydalanuvchi uchun Telegram tomonida
// mos keladigan sessiya/access-hash bo'lmasa, xabar YETIB BORMASDI.
// Endi har bir xabar bazaga yoziladi va ikkinchi tomon uni ochganda
// (yoki ochiq chatda poll qilganda) albatta oladi.
//
// Shaxsiy suhbat = foydalanuvchilar juftligi (sender_id, recipient_id).
// Alohida "thread" jadvali kerak emas - juftlik o'zi mavzu hisoblanadi.
// Bloklangan foydalanuvchilar `Blocks` orqali filtrlanadi.
// ============================================================================

require_once __DIR__ . '/Uploader.php';
require_once __DIR__ . '/Blocks.php';

class DM
{
    /** @var Database */
    private $db;

    /** Bitta xabar matnining maksimal uzunligi. */
    const MAX_LEN = 4000;

    /** Bitta sahifada qaytariladigan xabar soni. */
    const PAGE = 200;

    /** Media saqlanadigan papka. */
    const MEDIA_DIR = UPLOAD_DIR . 'dm';

    /** Jadval tekshiruvi (klass darajasida bir marta). */
    private static $schemaReady = null;

    public function __construct(?Database $db = null)
    {
        $this->db = $db ?: Database::getInstance();
        $this->ensureSchema();
    }

    // ==================================================================
    //  Sxema
    // ==================================================================

    /**
     * `dm_messages` jadvalini (kerak bo'lsa) yaratadi.
     *
     * Nima uchun `TgTopics` kabi o'z-o'zidan: migratsiya skriptini unutib
     * qo'yish xatosi butun chatni ishlamay qo'yishiga olib keladi. Jadval
     * `CREATE TABLE IF NOT EXISTS` bilan arzon yaratiladi.
     */
    private function ensureSchema()
    {
        if (self::$schemaReady !== null) {
            return self::$schemaReady;
        }
        self::$schemaReady = false;
        try {
            $this->db->query(
                "CREATE TABLE IF NOT EXISTS dm_messages (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    sender_id INT NOT NULL,
                    recipient_id INT NOT NULL,
                    body TEXT NULL,
                    kind VARCHAR(16) NOT NULL DEFAULT 'text',
                    media_url VARCHAR(500) NULL,
                    mime VARCHAR(120) NULL,
                    duration INT NOT NULL DEFAULT 0,
                    width INT NOT NULL DEFAULT 0,
                    height INT NOT NULL DEFAULT 0,
                    client_id VARCHAR(64) NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    read_at DATETIME NULL,
                    UNIQUE KEY uniq_dm_client (sender_id, client_id),
                    INDEX idx_dm_pair (sender_id, recipient_id, id),
                    INDEX idx_dm_recv (recipient_id, read_at)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
            );
            // Yozmoqda... holati uchun kichik yordamchi jadval.
            $this->db->query(
                "CREATE TABLE IF NOT EXISTS dm_typing (
                    user_id INT NOT NULL,
                    peer_id INT NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    PRIMARY KEY (user_id, peer_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
            );
            // `ref` ustuni keyinchalik qo'shildi: ulashilgan video kartasi
            // (reel/kino) uchun oqim ma'lumotlari (JSON) shu yerda saqlanadi.
            // Eski jadvalda bo'lmasa - qo'shamiz (CREATE ... IF NOT EXISTS
            // mavjud jadvalga ustun qo'shmaydi).
            $hasRef = $this->db->fetchOne("SHOW COLUMNS FROM dm_messages LIKE 'ref'");
            if (!$hasRef) {
                $this->db->query("ALTER TABLE dm_messages ADD COLUMN ref TEXT NULL AFTER media_url");
            }
            self::$schemaReady = true;
        } catch (Throwable $e) {
            error_log('DM: jadval yaratilmadi - ' . $e->getMessage());
            self::$schemaReady = false;
        }
        return self::$schemaReady;
    }

    // ==================================================================
    //  Yuborish
    // ==================================================================

    /**
     * Oddiy matnli xabar yuboradi.
     *
     * @return array{ok:bool, error?:string, message?:array, duplicate?:bool}
     */
    public function send($from, $to, $body, $clientId = null)
    {
        $from = (int) $from;
        $to   = (int) $to;

        if ($from <= 0 || $to <= 0) {
            return ['ok' => false, 'error' => 'Foydalanuvchi aniqlanmadi'];
        }
        if ($from === $to) {
            return ['ok' => false, 'error' => 'O‘zingizga xabar yubora olmaysiz'];
        }

        $body = is_string($body) ? trim($body) : '';
        if ($body === '') {
            return ['ok' => false, 'error' => 'Xabar bo‘sh'];
        }
        if (mb_strlen($body) > self::MAX_LEN) {
            $body = mb_substr($body, 0, self::MAX_LEN);
        }

        $perm = $this->permission($from, $to);
        if (!$perm['ok']) {
            return ['ok' => false, 'error' => $perm['reason']];
        }

        // Qabul qiluvchi mavjudligini tekshiramiz (FK xatosidan oldin).
        if (!$this->userExists($to)) {
            return ['ok' => false, 'error' => 'Foydalanuvchi topilmadi'];
        }

        // Takroriy yuborishga qarshi: klient yuborgan `client_id` allaqachon
        // bo'lsa, o'sha xabarni qaytaramiz (tarmoq qayta urinishida dublikat
        // bo'lmasin).
        $clientId = $this->cleanClientId($clientId);
        if ($clientId !== null) {
            $dup = $this->db->fetchOne(
                "SELECT * FROM dm_messages WHERE sender_id = ? AND client_id = ? LIMIT 1",
                [$from, $clientId]
            );
            if ($dup) {
                return ['ok' => true, 'duplicate' => true, 'message' => $this->normalize($dup, $from)];
            }
        }

        $id = $this->db->insert('dm_messages', [
            'sender_id'    => $from,
            'recipient_id' => $to,
            'body'         => $body,
            'kind'         => 'text',
            'client_id'    => $clientId,
            'created_at'   => date('Y-m-d H:i:s'),
        ]);
        if (!$id) {
            return ['ok' => false, 'error' => 'Xabar yuborilmadi'];
        }

        $this->touchContacts($from, $to);
        $row = $this->db->fetchOne("SELECT * FROM dm_messages WHERE id = ? LIMIT 1", [(int) $id]);
        return ['ok' => true, 'message' => $this->normalize($row, $from)];
    }

    /**
     * Media (rasm / ovozli xabar) yuboradi.
     *
     * @param string $kind  'photo' | 'voice'
     * @return array{ok:bool, error?:string, message?:array}
     */
    public function sendMedia($from, $to, $kind, $url, $mime, $duration = 0, $width = 0, $height = 0, $caption = '')
    {
        $from = (int) $from;
        $to   = (int) $to;
        $kind = in_array($kind, ['photo', 'voice'], true) ? $kind : 'photo';

        if ($from <= 0 || $to <= 0 || $from === $to) {
            return ['ok' => false, 'error' => 'Xabar yuborilmadi'];
        }
        $perm = $this->permission($from, $to);
        if (!$perm['ok']) {
            return ['ok' => false, 'error' => $perm['reason']];
        }
        if (!$this->userExists($to)) {
            return ['ok' => false, 'error' => 'Foydalanuvchi topilmadi'];
        }
        $url = trim((string) $url);
        if ($url === '' || strpos($url, 'uploads/dm/') !== 0) {
            return ['ok' => false, 'error' => 'Fayl saqlanmadi'];
        }
        $caption = mb_substr(trim((string) $caption), 0, self::MAX_LEN);

        $id = $this->db->insert('dm_messages', [
            'sender_id'    => $from,
            'recipient_id' => $to,
            'body'         => $caption,
            'kind'         => $kind,
            'media_url'    => $url,
            'mime'         => mb_substr((string) $mime, 0, 120),
            'duration'     => max(0, (int) $duration),
            'width'        => max(0, (int) $width),
            'height'       => max(0, (int) $height),
            'created_at'   => date('Y-m-d H:i:s'),
        ]);
        if (!$id) {
            return ['ok' => false, 'error' => 'Xabar yuborilmadi'];
        }
        $this->touchContacts($from, $to);
        $row = $this->db->fetchOne("SELECT * FROM dm_messages WHERE id = ? LIMIT 1", [$id]);
        return ['ok' => true, 'message' => $this->normalize($row, $from)];
    }

    /**
     * Ulashilgan video kartasini yuboradi (chatga "reel/kino" tashlash).
     *
     * Tashqi video fayl yuklanmaydi: video Telegram kanalida turadi, shuning
     * uchun faqat oqim ma'lumotlari (`ref`) + poster + sarlavha saqlanadi.
     * Qabul qiluvchi chatda kartani bosib videoni o'sha yerda ko'radi.
     *
     * @param array $data {
     *   title, poster, duration,
     *   type: 'telegram'|'direct'|'file'|'hls'|'embed',
     *   id, episode, channel, post, url, deep, link
     * }
     * @return array{ok:bool, error?:string, message?:array}
     */
    public function sendShare($from, $to, array $data)
    {
        $from = (int) $from;
        $to   = (int) $to;
        if ($from <= 0 || $to <= 0 || $from === $to) {
            return ['ok' => false, 'error' => 'Xabar yuborib bo\u{2018}lmaydi'];
        }
        $perm = $this->permission($from, $to);
        if (!$perm['ok']) {
            return ['ok' => false, 'error' => $perm['reason']];
        }
        if (!$this->userExists($to)) {
            return ['ok' => false, 'error' => 'Foydalanuvchi topilmadi'];
        }

        $title  = trim((string) ($data['title'] ?? ''));
        $poster = trim((string) ($data['poster'] ?? ''));

        // Oqim ma'lumotlari: faqat kerakli maydonlar, uzunlik cheklangan.
        $type = strtolower((string) ($data['type'] ?? ''));
        $type = preg_replace('/[^a-z_]/', '', $type);
        $ref = [
            'type'    => substr((string) $type, 0, 20),
            'id'      => max(0, (int) ($data['id'] ?? 0)),
            'episode' => max(0, (int) ($data['episode'] ?? 0)),
            'channel' => substr((string) ($data['channel'] ?? ''), 0, 120),
            'post'    => max(0, (int) ($data['post'] ?? 0)),
            'url'     => substr((string) ($data['url'] ?? ''), 0, 500),
            'deep'    => substr((string) ($data['deep'] ?? ''), 0, 500),
            'link'    => substr((string) ($data['link'] ?? ''), 0, 500),
        ];
        // Bo'sh maydonlarni tashlab ketamiz (JSON kichik bo'lsin).
        $ref = array_filter($ref, static function ($v) {
            return $v !== '' && $v !== 0;
        });

        $id = $this->db->insert('dm_messages', [
            'sender_id'    => $from,
            'recipient_id' => $to,
            'body'         => mb_substr($title, 0, self::MAX_LEN),
            'kind'         => 'video',
            'media_url'    => $poster !== '' ? mb_substr($poster, 0, 500) : null,
            'ref'          => $ref ? json_encode($ref, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) : null,
            'duration'     => max(0, (int) ($data['duration'] ?? 0)),
            'created_at'   => date('Y-m-d H:i:s'),
        ]);
        if (!$id) {
            return ['ok' => false, 'error' => 'Xabar yuborilmadi'];
        }
        $this->touchContacts($from, $to);
        $row = $this->db->fetchOne("SELECT * FROM dm_messages WHERE id = ? LIMIT 1", [(int) $id]);
        return ['ok' => true, 'message' => $this->normalize($row, $from)];
    }

    // ==================================================================
    //  O'qish
    // ==================================================================

    /**
     * Ikki foydalanuvchi o'rtasidagi xabarlar.
     *
     * @param int $afterId  >0 bo'lsa faqat shundan keyingilar (poll)
     * @param int $beforeId >0 bo'lsa faqat shundan oldingilar (eskiroq tarix)
     * @return array<int,array<string,mixed>>
     */
    public function messages($me, $peer, $afterId = 0, $limit = self::PAGE, $beforeId = 0)
    {
        $me   = (int) $me;
        $peer = (int) $peer;
        if ($me <= 0 || $peer <= 0 || $me === $peer) {
            return [];
        }
        $limit = max(1, min(self::PAGE, (int) $limit));

        // Bloklangan bo'lsa ham tarixni ko'rsatamiz (blok faqat YUBORISHNI
        // to'xtatadi) - aks holda eski suhbat "yo'qolib" qolardi.
        $params = [$me, $peer, $peer, $me];
        $sql = "SELECT * FROM dm_messages
                 WHERE ((sender_id = ? AND recipient_id = ?)
                     OR (sender_id = ? AND recipient_id = ?))";
        if ($afterId > 0) {
            $sql .= " AND id > ?";
            $params[] = (int) $afterId;
        }
        if ($beforeId > 0) {
            $sql .= " AND id < ?";
            $params[] = (int) $beforeId;
        }
        $sql .= " ORDER BY id DESC LIMIT " . $limit;

        $rows = $this->db->fetchAll($sql, $params);
        $rows = array_reverse(is_array($rows) ? $rows : []);

        $out = [];
        foreach ($rows as $r) {
            $out[] = $this->normalize($r, $me);
        }
        return $out;
    }

    /** Mendan boshqa foydalanuvchilarga kelgan yangi xabarlar (global poll). */
    public function incoming($me, $afterId = 0, $limit = 100)
    {
        $me = (int) $me;
        if ($me <= 0) {
            return [];
        }
        $limit = max(1, min(self::PAGE, (int) $limit));
        $rows = $this->db->fetchAll(
            "SELECT * FROM dm_messages WHERE recipient_id = ? AND id > ?
              ORDER BY id ASC LIMIT " . $limit,
            [$me, (int) $afterId]
        );
        $out = [];
        foreach ((array) $rows as $r) {
            $out[] = $this->normalize($r, $me);
        }
        return $out;
    }

    /** Suhbatdagi o'qilmagan xabarlarni o'qilgan deb belgilaydi. */
    public function markRead($me, $peer)
    {
        $me   = (int) $me;
        $peer = (int) $peer;
        if ($me <= 0 || $peer <= 0) {
            return false;
        }
        $this->db->query(
            "UPDATE dm_messages SET read_at = ?
              WHERE recipient_id = ? AND sender_id = ? AND read_at IS NULL",
            [date('Y-m-d H:i:s'), $me, $peer]
        );
        return true;
    }

    /** Jami o'qilmagan xabarlar soni (navbadge uchun). */
    public function unreadCount($me)
    {
        $me = (int) $me;
        if ($me <= 0) {
            return 0;
        }
        $row = $this->db->fetchOne(
            "SELECT COUNT(*) AS n FROM dm_messages WHERE recipient_id = ? AND read_at IS NULL",
            [$me]
        );
        return $row ? (int) $row['n'] : 0;
    }

    /** "Yozmoqda..." holatini yangilaydi. */
    public function setTyping($me, $peer)
    {
        $me   = (int) $me;
        $peer = (int) $peer;
        if ($me <= 0 || $peer <= 0 || $me === $peer) {
            return false;
        }
        $this->db->query(
            "INSERT INTO dm_typing (user_id, peer_id, updated_at) VALUES (?, ?, NOW())
             ON DUPLICATE KEY UPDATE updated_at = NOW()",
            [$me, $peer]
        );
        return true;
    }

    /** Suhbatdosh hozir yozmoqdami? (oxirgi 6 soniya). */
    public function isTyping($me, $peer)
    {
        $me   = (int) $me;
        $peer = (int) $peer;
        if ($me <= 0 || $peer <= 0) {
            return false;
        }
        $row = $this->db->fetchOne(
            "SELECT 1 FROM dm_typing
              WHERE user_id = ? AND peer_id = ? AND updated_at > (NOW() - INTERVAL 6 SECOND)
              LIMIT 1",
            [$peer, $me]
        );
        return !empty($row);
    }

    // ==================================================================
    //  Suhbatlar ro'yxati
    // ==================================================================

    /**
     * Shaxsiy chat ro'yxati: kontaktlar + DM ishtirokchilari, oxirgi xabar,
     * o'qilmaganlar soni bilan. Bloklanganlar chiqarib tashlanadi.
     *
     * @return array<int,array<string,mixed>>
     */
    public function threads($me)
    {
        $me = (int) $me;
        if ($me <= 0) {
            return [];
        }

        $blocks = new Blocks($this->db);
        $hidden = $blocks->hiddenIds($me);

        // Juftliklar: "chat ochgan" kontaktlar + DM yozishganlar.
        $rows = $this->db->fetchAll(
            "SELECT peer_id FROM chat_contacts WHERE owner_id = ?
              UNION
             SELECT recipient_id FROM dm_messages WHERE sender_id = ?
              UNION
             SELECT sender_id FROM dm_messages WHERE recipient_id = ?",
            [$me, $me, $me]
        );
        $ids = [];
        foreach ((array) $rows as $r) {
            $pid = (int) ($r['peer_id'] ?? 0);
            if ($pid > 0 && $pid !== $me && !isset($hidden[$pid])) {
                $ids[$pid] = true;
            }
        }
        $ids = array_keys($ids);
        if (!$ids) {
            return [];
        }

        $in = implode(',', array_fill(0, count($ids), '?'));
        $users = $this->db->fetchAll(
            "SELECT id, first_name, last_name, username, avatar, is_premium, telegram_user_id
               FROM users WHERE id IN ($in)",
            $ids
        );
        $byId = [];
        foreach ((array) $users as $u) {
            $byId[(int) $u['id']] = $u;
        }

        // Har bir juftlik uchun oxirgi xabar.
        $last = [];
        $lrows = $this->db->fetchAll(
            "SELECT m.* FROM dm_messages m
               JOIN (
                     SELECT MAX(id) AS mid FROM dm_messages
                      WHERE sender_id = ? OR recipient_id = ?
                      GROUP BY LEAST(sender_id, recipient_id),
                               GREATEST(sender_id, recipient_id)
                    ) t ON t.mid = m.id",
            [$me, $me]
        );
        foreach ((array) $lrows as $m) {
            $other = ((int) $m['sender_id'] === $me)
                ? (int) $m['recipient_id'] : (int) $m['sender_id'];
            $last[$other] = $m;
        }

        // O'qilmaganlar soni (peer bo'yicha).
        $unread = [];
        $urows = $this->db->fetchAll(
            "SELECT sender_id, COUNT(*) AS c FROM dm_messages
              WHERE recipient_id = ? AND read_at IS NULL
              GROUP BY sender_id",
            [$me]
        );
        foreach ((array) $urows as $r) {
            $unread[(int) $r['sender_id']] = (int) $r['c'];
        }

        $out = [];
        foreach ($ids as $pid) {
            if (!isset($byId[$pid])) {
                continue;
            }
            $u  = $byId[$pid];
            $lm = $last[$pid] ?? null;
            $out[] = [
                'id'               => $pid,
                'first_name'       => $u['first_name'] ?: 'Foydalanuvchi',
                'last_name'        => $u['last_name'] ?: '',
                'username'         => $u['username'] ?: null,
                'avatar'           => $u['avatar'] ?: null,
                'premium'          => (int) ($u['is_premium'] ?? 0),
                'telegram_user_id' => $u['telegram_user_id'] ? (string) $u['telegram_user_id'] : null,
                'unread'           => $unread[$pid] ?? 0,
                'last'             => $lm ? $this->preview($lm, $me) : null,
                'last_id'          => $lm ? (int) $lm['id'] : 0,
            ];
        }

        // Oxirgi xabari borlar tepada; bo'lmasa - nom bo'yicha.
        usort($out, function ($a, $b) {
            $ai = (int) $a['last_id'];
            $bi = (int) $b['last_id'];
            if ($ai === $bi) {
                return strcasecmp((string) $a['first_name'], (string) $b['first_name']);
            }
            return $bi - $ai;
        });

        return $out;
    }

    /** Umumiy o'qilmagan xabarlar soni (navbadge). */
    public function unreadTotal($me)
    {
        return $this->unreadCount($me);
    }

    // ==================================================================
    //  Huquqlar
    // ==================================================================

    /**
     * @return array{ok:bool, reason:string, i_blocked:bool, blocked_me:bool}
     */
    public function permission($from, $to)
    {
        $from = (int) $from;
        $to   = (int) $to;
        if ($from <= 0 || $to <= 0 || $from === $to) {
            return ['ok' => false, 'reason' => 'Xabar yuborib bo‘lmaydi',
                    'i_blocked' => false, 'blocked_me' => false];
        }
        $blocks    = new Blocks($this->db);
        $iBlocked  = $blocks->blocksViewing($from, $to);
        $blockedMe = $blocks->blocksViewing($to, $from);
        $ok = !$iBlocked && !$blockedMe;
        return [
            'ok'         => $ok,
            'reason'     => $ok ? '' : ($iBlocked
                ? 'Siz bu foydalanuvchini bloklagansiz'
                : 'Bu foydalanuvchi sizni bloklagan'),
            'i_blocked'  => $iBlocked,
            'blocked_me' => $blockedMe,
        ];
    }

    // ==================================================================
    //  Media saqlash
    // ==================================================================

    /**
     * Yuklangan faylni `uploads/dm/` ga saqlaydi.
     *
     * @param int   $userId
     * @param array $file   $_FILES['file']
     * @param string $kind  'photo' | 'voice'
     * @return array{ok:bool, error?:string, url?:string, mime?:string, width?:int, height?:int}
     */
    public static function saveUpload($userId, array $file, $kind)
    {
        self::ensureMediaDir();

        if ($kind === 'voice') {
            $limit    = 25 * 1024 * 1024;
            $allowExt = ['webm', 'ogg', 'oga', 'mp4', 'm4a', 'mp3', 'wav'];
            $allowMime = [
                'audio/webm', 'video/webm', 'audio/ogg', 'video/ogg',
                'application/ogg', 'application/x-ogg', 'audio/opus',
                'audio/mp4', 'video/mp4', 'audio/x-m4a', 'audio/aac',
                'audio/mpeg', 'audio/wav', 'audio/x-wav',
                'video/quicktime', 'application/octet-stream',
            ];
        } else {
            $limit    = 12 * 1024 * 1024;
            $allowExt = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
            $allowMime = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        }

        $err = Uploader::checkFile($file, $limit, $allowExt, $allowMime, $kind === 'voice' ? 'ovoz' : 'rasm');
        if ($err !== null) {
            return ['ok' => false, 'error' => $err];
        }

        $ext = strtolower(pathinfo((string) ($file['name'] ?? ''), PATHINFO_EXTENSION));
        if ($ext === '' || !in_array($ext, $allowExt, true)) {
            $ext = $kind === 'voice' ? 'webm' : 'jpg';
        }
        $name = 'u' . (int) $userId . '_' . bin2hex(random_bytes(8)) . '.' . $ext;
        $dest = self::MEDIA_DIR . '/' . $name;
        if (!@move_uploaded_file($file['tmp_name'], $dest)) {
            return ['ok' => false, 'error' => 'Faylni saqlab bo‘lmadi'];
        }
        @chmod($dest, 0644);

        $out = [
            'ok'   => true,
            'url'  => Uploader::urlFor($dest),
            'mime' => (string) ($file['type'] ?? ''),
        ];
        if ($kind !== 'voice') {
            $size = @getimagesize($dest);
            $out['width']  = (int) ($size[0] ?? 0);
            $out['height'] = (int) ($size[1] ?? 0);
            $out['mime']   = (string) ($size['mime'] ?? $out['mime']);
        }
        return $out;
    }

    /** Papka + `.htaccess` himoyasi (bir marta). */
    private static function ensureMediaDir()
    {
        if (!is_dir(self::MEDIA_DIR)) {
            @mkdir(self::MEDIA_DIR, 0755, true);
        }
        $ht = rtrim(self::MEDIA_DIR, '/\\') . '/.htaccess';
        if (is_dir(self::MEDIA_DIR) && !is_file($ht)) {
            @file_put_contents($ht,
                "Options -Indexes\n"
              . "<FilesMatch \"\\.(php|phtml|php3|php4|php5|phar)$\">\n"
              . "    Require all denied\n</FilesMatch>\n");
        }
    }

    // ==================================================================
    //  Ichki yordamchilar
    // ==================================================================

    /** Xabarni klientga mos (JSON) ko'rinishga keltiradi. */
    private function normalize($row, $me)
    {
        $me   = (int) $me;
        $mine = ((int) ($row['sender_id'] ?? 0) === $me);
        $ts   = 0;
        if (!empty($row['created_at'])) {
            $ts = (int) strtotime((string) $row['created_at']);
        }
        return [
            'id'         => (int) ($row['id'] ?? 0),
            'peer_id'    => $mine ? (int) ($row['recipient_id'] ?? 0) : (int) ($row['sender_id'] ?? 0),
            'sender_id'  => (int) ($row['sender_id'] ?? 0),
            'recipient_id' => (int) ($row['recipient_id'] ?? 0),
            'body'       => (string) ($row['body'] ?? ''),
            'kind'       => (string) ($row['kind'] ?? 'text'),
            'media_url'  => $row['media_url'] ?? null,
            'mime'       => $row['mime'] ?? null,
            'ref'        => $this->decodeRef($row['ref'] ?? null),
            'duration'   => (int) ($row['duration'] ?? 0),
            'width'      => (int) ($row['width'] ?? 0),
            'height'     => (int) ($row['height'] ?? 0),
            'mine'       => $mine,
            'read'       => !empty($row['read_at']),
            'ts'         => $ts,
            'created_at' => (string) ($row['created_at'] ?? ''),
        ];
    }

    /** Ro'yxatdagi qisqa ko'rinish (oxirgi xabar). */
    private function preview($row, $me)
    {
        $body = (string) ($row['body'] ?? '');
        $kind = (string) ($row['kind'] ?? 'text');
        if ($body === '') {
            if ($kind === 'photo') {
                $body = '📷 Rasm';
            } elseif ($kind === 'voice') {
                $body = '🎤 Ovozli xabar';
            } elseif ($kind === 'video') {
                $body = '🎬 Video';
            }
        }
        // Video kartasida sarlavha bo'lsa - oldiga belgi qo'yamiz.
        if ($kind === 'video' && $body !== '' && mb_substr($body, 0, 1) !== '🎬') {
            $body = '🎬 ' . $body;
        }
        return [
            'body' => mb_substr($body, 0, 140),
            'kind' => $kind,
            'mine' => ((int) ($row['sender_id'] ?? 0) === (int) $me),
            'ts'   => !empty($row['created_at']) ? (int) strtotime((string) $row['created_at']) : 0,
        ];
    }

    /** Ikkala tomonga ham kontakt yozuvi (ro'yxat tartibi uchun). */
    private function touchContacts($a, $b)
    {
        foreach ([[$a, $b], [$b, $a]] as $pair) {
            $this->db->query(
                "INSERT INTO chat_contacts (owner_id, peer_id, last_at)
                 VALUES (?, ?, NOW())
                 ON DUPLICATE KEY UPDATE last_at = NOW()",
                $pair
            );
        }
    }

    private function userExists($id)
    {
        return (bool) $this->db->fetchOne("SELECT id FROM users WHERE id = ? LIMIT 1", [(int) $id]);
    }

    /** Ochiq tekshiruv (API uchun). */
    public function exists($id)
    {
        return $this->userExists($id);
    }

    /** `ref` JSON ni massivga aylantiradi (noto'g'ri/bo'sh bo'lsa - null). */
    private function decodeRef($raw)
    {
        if (!is_string($raw) || $raw === '') {
            return null;
        }
        $d = json_decode($raw, true);
        return is_array($d) ? $d : null;
    }

    /** client_id ni xavfsiz shaklga keltiradi (null - ishlatilmaydi). */
    private function cleanClientId($id)
    {
        $id = (string) $id;
        if ($id === '') {
            return null;
        }
        $id = preg_replace('/[^A-Za-z0-9_\-]/', '', $id);
        $id = substr((string) $id, 0, 64);
        return $id === '' ? null : $id;
    }
}