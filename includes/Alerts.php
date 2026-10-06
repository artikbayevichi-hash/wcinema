<?php
// ============================================================================
// Alerts.php — Telegram Bot orqali INSTANT bildirishnomalar
// ---------------------------------------------------------------------------
// Ikki katta hodisa foydalanuvchiga Telegram orqali darhol yetkaziladi:
//   · login  — hisobga kirish xabarnomasi (qayerdan, qachon, qurilma);
//   · follow — yangi kuzatuvchi.
//
// Har ikkala hodisa ham bitta joyga yoziladi:
//   1) `notifications` jadvali  -> sayt ichidagi qalqon (🔴) va notifications.php;
//   2) Telegram Bot API shaxsiy chat -> "instant" ogohlantirish.
//
// Nima uchun ikki marta? Sayt ichida bildirishnoma faqat sahifa ochiqligida
// ko'rinadi; Telegram esa foydalanuvchi boshqa ilovada yoki sayt yopiq
// holatda ham xabar oladi.
//
// Xususiyatlar:
//   · Deduplik — BIR QURILMADA faqat BIR MARTA xabar yuboriladi (jumladan
//     `login`); `login_devices` jadvali qurilmani eslab qoladi. Vaqt oynasi
//     faqat "qurilma kaliti topilmadi" holatida zaxira sifatida ishlaydi;
//   · Spam himoyasi — bloklagan foydalanuvchiga yuborilmaydi;
//   · Xatolar jim yutiladi (bildirishnoma yuborilmasa sayt buzilmaydi).
// ============================================================================

class Alerts
{
    /** Zaxira vaqt oynasi (daqiqa) — faqat qurilma kaliti aniqlanmasa. */
    const DEDUP_WINDOW = 5;

    /** Bot ishga tushirilmagan bo'lsa yuborish o'chiriladi. */
    const ENABLED = true;

    /** @var Database */
    private $db;

    /** @var TelegramBot|null (kech va sinxron nusxa) */
    private $bot = null;

    /** @var bool|null `login_devices` jadvali tayyorligi (bir marta tekshiriladi) */
    private $devReady = null;

    public function __construct($db = null)
    {
        $this->db = $db ?: Database::getInstance();
    }

    // =====================================================================
    // Kirish xabarnomasi
    // =====================================================================

    /**
     * Hisobga kirish hodisasi.
     *
     * DEDUPLIK: har bir qurilmadan FAQAT BIR MARTA xabar yuboriladi.
     * Sababi: `tg-stream.js` sahifa har yuklanganda `action=hello` so'rovi
     * yuboradi (u `ensureSession` ichidan chaqiriladi). Avvalgi 5 daqiqalik
     * oyna yetarli emas edi — foydalanuvchi 5 daqiqadan keyin yana
     * refresh qilsa, xabar YANA kelardi. Endi `login_devices` jadvalida
     * qurilma bir marta ko'rilgan bo'lsa, darhol qaytaramiz.
     *
     * @param int    $userId bazadagi users.id
     * @param array  $meta   ['ip'=>string,'ua'=>string,'city'=>string,'first'=>bool]
     * @return array{created:int, pushed:bool, known:bool} `known` — qurilma
     *         allaqachon ko'rilganmi (diagnostika uchun)
     */
    public function login($userId, array $meta = [])
    {
        $userId = (int) $userId;
        if ($userId <= 0) {
            return ['created' => 0, 'pushed' => false, 'known' => false];
        }

        $user = $this->user($userId);
        if (!$user) {
            return ['created' => 0, 'pushed' => false, 'known' => false];
        }

        $when = date('Y-m-d H:i');
        $ip   = $this->clip($meta['ip'] ?? '', 45);
        $ua   = $this->clip($meta['ua'] ?? '', 160);

        // ---- 0) Deduplik: bir qurilmada — bir marta -----------------------
        //
        // `null` — qaror qabul qilib bo'lmadi (jadval yo'qi yoki kalit yo'qi):
        //   keyin vaqt oynasi bilan yurishimiz mumkin.
        // `true` — bu qurilma allaqachon ko'rilgan: HECH NARSA yubormaymiz.
        $known = null;
        $key   = $this->deviceKey($ua, $ip);
        if ($key !== '') {
            $known = $this->deviceSeen($userId, $key, $ua, $ip);
        }
        if ($known === true) {
            return ['created' => 0, 'pushed' => false, 'known' => true];
        }
        if ($known === null && $this->recently('login', $userId, self::DEDUP_WINDOW)) {
            return ['created' => 0, 'pushed' => false, 'known' => false];
        }

        $lines = [];
        $lines[] = '📍 ' . ($this->clip($meta['city'] ?? '', 60) ?: 'Noma\'lum joy');
        if ($ip !== '') {
            $lines[] = '🌐 IP: ' . $ip;
        }
        if ($ua !== '') {
            $lines[] = '📱 ' . $ua;
        }
        $detail = implode("\n", $lines);

        // ---- 1) Sayt ichidagi bildirishnoma
        $created = 0;
        try {
            $ntf = new Notifications($this->db);
            $created = $ntf->add($userId, 'login', [
                'group_key' => 'login',
                'title'     => 'Hisobga kirdingiz',
                'message'   => $detail,
                'url'       => $this->siteUrl('/settings.php'),
            ]);
        } catch (Exception $e) {
            error_log('[Alerts] login notify: ' . $e->getMessage());
        }

        // ---- 2) Telegram orqali
        $pushed = $this->push($userId,
            "🔐 <b>Hisobga kirdingiz</b>\n\n" .
            $detail . "\n\n" .
            "Agar bu siz bo'lmasa, darhol parolni almashtiring va " .
            "<a href=\"" . $this->esc($this->siteUrl('/settings.php')) . "\">xavfsizlik sozlamalariga</a> o'ting.",
            '🔐 Kirish'
        );

        return ['created' => $created, 'pushed' => $pushed, 'known' => false];
    }

    // =====================================================================
    // Qurilma eslash (kirish xabarining dedupligi)
    // =====================================================================
    //
    // NIMA UCHUN alohida jadval: `notifications` jadvalidan o'qib tekshirish
    // ishardi, lekin u shunga qarab to'g'rilmaydi — foydalanuvchi "bildirish-
    // nomalarni tozalash" qo'shganda kirish xabari ham yo'qolardi va keyin
    // HAR SAFAR yana kelib turardi. Bu jadval faqat "bu qurilma allaqachon
    // xabar oldimi?" savoliga javob beradi.
    //
    // `CREATE TABLE IF NOT EXISTS` — `TgTopics` kabi, migratsiya skriptisiz.

    /** Jadval mavjudligini bir marta tekshiradi va kerusida yaratadi. */
    private function devicesReady()
    {
        if ($this->devReady !== null) {
            return $this->devReady;
        }
        $this->devReady = false;
        try {
            $this->db->query(
                "CREATE TABLE IF NOT EXISTS login_devices (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    user_id INT NOT NULL,
                    device_key VARCHAR(90) NOT NULL,
                    user_agent VARCHAR(200) NOT NULL DEFAULT '',
                    ip_address VARCHAR(45) NOT NULL DEFAULT '',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                        ON UPDATE CURRENT_TIMESTAMP,
                    UNIQUE KEY uniq_user_device (user_id, device_key),
                    KEY idx_user (user_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
            );
            $this->devReady = true;
        } catch (Throwable $e) {
            error_log('[Alerts] login_devices jadvali yaratilmadi - ' . $e->getMessage());
            $this->devReady = false;
        }
        return $this->devReady;
    }

    /**
     * Qurilma kaliti.
     *
     * Versiya raqamlarini OLIB TASHLAYMIZ: brauzer o'zi avtomatik yangilanadi
     * (Chrome 141 -> 142) va aks holda foydalanuvchi O'Z qurilmasida ham har
     * oy "yangi qurilmadan kirdi" xabarini olardi — bu uning maqsadiga zid.
     *
     * @return string bo'sh bo'lsa — kalit aniqlanmadi
     */
    private function deviceKey($ua, $ip)
    {
        $norm = preg_replace('/\d+(\.\d+)*/u', 'x', (string) $ua);
        $norm = preg_replace('/\s+/u', ' ', strtolower(trim((string) $norm)));
        if ($norm !== '') {
            return 'ua:' . sha1($norm);
        }
        // User-Agent yo'q (curl, server-side so'rov) — IP bo'yicha.
        $ip = trim((string) $ip);
        if ($ip !== '') {
            return 'ip:' . sha1($ip);
        }
        return '';
    }

    /**
     * Bu qurilma allaqachon ko'rilganmi?
     *
     * @return bool|null true = ko'rilgan (yubormaslik), false = YANGI,
     *                   null = qaror qilinolmadi (jadval yo'q)
     */
    private function deviceSeen($userId, $key, $ua, $ip)
    {
        if (!$this->devicesReady()) {
            return null;
        }
        // `INSERT IGNORE`: kalit UNIQUE bo'lgani uchun takror so'rov jimgina
        // rad etiladi (xato chiqmaydi) — bu aynan bizga kerak bo'lgan holat.
        $st = $this->db->query(
            'INSERT IGNORE INTO login_devices
                (user_id, device_key, user_agent, ip_address, last_seen_at)
             VALUES (?, ?, ?, ?, NOW())',
            [(int) $userId, $key, (string) $ua, (string) $ip]
        );
        if ($st === false) {
            return null;      // jadval yo'q / DB xatosi — eski yo'lga qaytamiz
        }
        if ($st->rowCount() > 0) {
            return false;     // YANGI qurilma — xabar yuboriladi
        }
        // Allaqachon ko'rilgan: "oxirgi ko'rilgan"ni yangilab qo'yamiz.
        $this->db->query(
            'UPDATE login_devices SET last_seen_at = NOW(), ip_address = ?
              WHERE user_id = ? AND device_key = ?',
            [(string) $ip, (int) $userId, $key]
        );
        return true;
    }

    // =====================================================================
    // Yangi kuzatuvchi
    // =====================================================================

    /**
     * @param int $targetId kuzatuvchi qabul qiluvchi
     * @param int $actorId  kuzatuvchi bo'lgan foydalanuvchi
     * @return array{created:int, pushed:bool}
     */
    public function follow($targetId, $actorId)
    {
        $targetId = (int) $targetId;
        $actorId  = (int) $actorId;
        if ($targetId <= 0 || $actorId <= 0 || $targetId === $actorId) {
            return ['created' => 0, 'pushed' => false];
        }

        $actor = $this->user($actorId);
        if (!$actor) {
            return ['created' => 0, 'pushed' => false];
        }
        $name = $this->displayName($actor);
        $link = $this->siteUrl('/profile.php?user_id=' . $actorId);

        // ---- 1) Sayt ichidagi bildirishnoma
        $created = 0;
        try {
            $ntf = new Notifications($this->db);
            $created = $ntf->notifyFollow($targetId, $actorId);
        } catch (Exception $e) {
            error_log('[Alerts] follow notify: ' . $e->getMessage());
        }

        // ---- 2) Telegram orqali
        $pushed = $this->push($targetId,
            "👤 <b>Yangi kuzatuvchi</b>\n\n" .
            $name . " sizni kuzata boshladi.\n" .
            '<a href="' . $this->esc($link) . '">Profilni ko\'rish →</a>',
            '👤 Kuzatuvchi'
        );

        return ['created' => $created, 'pushed' => $pushed];
    }

    // =====================================================================
    // Ichki: Telegram push
    // =====================================================================

    /**
     * Foydalanuvchining shaxsiy chat'iga xabar yuboradi.
     *
     * @return bool true — yuborildi, false — yuborilmadi (jim).
     */
    private function push($userId, $html, $topic = 'Bildirishnoma')
    {
        if (!self::ENABLED) {
            return false;
        }
        $userId = (int) $userId;
        $chatId = $this->chatId($userId);
        if ($chatId === '') {
            return false;
        }
        // Blokdan o'tgan foydalanuvchiga yubormaymiz.
        if ($this->isBlocked($userId)) {
            return false;
        }

        try {
            $bot = $this->bot();
            $ok  = $bot->sendMessage($chatId, $html, 'HTML', [
                'disable_web_page_preview' => true,
                'disable_notification'    => false,
            ]);
            return !empty($ok);
        } catch (Throwable $e) {
            // Bildirishnoma yuborilmasa sayt ishlashda davom etadi.
            error_log('[Alerts] push: ' . $e->getMessage());
            return false;
        }
    }

    /** Bot nusxasi (bitta marta yaratiladi). */
    private function bot()
    {
        if ($this->bot === null) {
            $this->bot = new TelegramBot();
        }
        return $this->bot;
    }

    // =====================================================================
    // Yordamchilar
    // =====================================================================

    private function user($userId)
    {
        return $this->db->fetchOne(
            'SELECT id, first_name, last_name, username, telegram_user_id,
                    telegram_chat_id, avatar
               FROM users WHERE id = ? LIMIT 1',
            [(int) $userId]
        );
    }

    /** Bot uchun chat id (shaxsiy chat = foydalanuvchi id). */
    private function chatId($userId)
    {
        $u = $this->db->fetchOne(
            'SELECT telegram_chat_id, telegram_user_id FROM users WHERE id = ? LIMIT 1',
            [(int) $userId]
        );
        if (!$u) {
            return '';
        }
        $id = trim((string) ($u['telegram_chat_id'] ?: ''));
        if ($id === '') {
            $id = trim((string) ($u['telegram_user_id'] ?: ''));
        }
        return ctype_digit($id) ? $id : '';
    }

    /** Foydalanuvchi botni bloklaganmi? */
    private function isBlocked($userId)
    {
        $u = $this->db->fetchOne(
            'SELECT is_bot_blocked FROM users WHERE id = ? LIMIT 1',
            [(int) $userId]
        );
        return !empty($u['is_bot_blocked']);
    }

    /** Shu turdagi oxirgi bildirishnoma `$minutes` daqiqadan yangi bo'lsa true. */
    private function recently($type, $userId, $minutes)
    {
        try {
            $row = $this->db->fetchOne(
                'SELECT id FROM notifications
                  WHERE user_id = ? AND type = ?
                    AND created_at > (NOW() - INTERVAL ? MINUTE)
                  ORDER BY id DESC LIMIT 1',
                [(int) $userId, (string) $type, (int) $minutes]
            );
        } catch (Throwable $e) {
            return false;   // `login` turi yo'q bo'lsa — tekshiruvni o'tkazib yuboramiz
        }
        return !empty($row);
    }

    private function displayName(array $u)
    {
        $n = trim(($u['first_name'] ?? '') . ' ' . ($u['last_name'] ?? ''));
        if ($n !== '') {
            return $this->esc($n);
        }
        if (!empty($u['username'])) {
            return '@' . $this->esc($u['username']);
        }
        return 'Foydalanuvchi';
    }

    private function siteUrl($path)
    {
        $base = defined('SITE_URL') ? rtrim((string) SITE_URL, '/') : '';
        return $base . '/' . ltrim((string) $path, '/');
    }

    private function esc($text)
    {
        return htmlspecialchars((string) $text, ENT_QUOTES, 'UTF-8');
    }

    private function clip($v, $max)
    {
        $v = trim((string) $v);
        if ($v === '') {
            return '';
        }
        return function_exists('mb_substr') ? mb_substr($v, 0, $max) : substr($v, 0, $max);
    }
}