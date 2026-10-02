<?php
// ============================================================================
// Auth - Telegram initData orqali kirish
// ============================================================================
// BAZA: "uzdub" (kino-platforma sxemasi)
//
// DIQQAT: users jadvalida Telegram ID ustuni "telegram_user_id" (varchar),
// eski prototipdagi "telegram_id" (int) EMAS. Session esa alohida
// "user_sessions" jadvalida (eski "sessions" emas) saqlanadi va unda
// expires_at yo'q - faqat last_activity bor.
// ============================================================================

require_once __DIR__ . '/Database.php';
require_once __DIR__ . '/TelegramBot.php';

class Auth {
    private $db;
    private $telegram;

    public function __construct() {
        $this->db = Database::getInstance();
        $this->telegram = new TelegramBot();
    }

    // =========================================================================
    // Telegram orqali kirish
    // =========================================================================
    /**
     * @return array ['success'=>bool, 'message'=>string, ...]
     */
    public function loginWithTelegram($initData) {
        $validation = $this->telegram->validateInitData($initData);
        if ($validation !== true) {
            return ['success' => false, 'message' => $validation];
        }

        $parsed = $this->telegram->parseInitData($initData);
        $user   = $parsed['user'] ?? null;

        if (!$user || empty($user['id'])) {
            return ['success' => false, 'message' => 'initData ichida foydalanuvchi yo\'q'];
        }

        // DIQQAT: bu yerda avval "faqat bot orqali ro'yxatdan o'tgan
        // foydalanuvchilar qabul qilinadi" degan shart bor edi
        // (is_registered = 1). Bu amalda ilovani TO'LIQ YOPDI:
        //   * is_registered ustuni default 0 bo'lib, bu kod hech qachon
        //     uni 1 qilmagan;
        //   * yangi foydalanuvchi esa "avval /start bosing" deb rad
        //     qilinardi - ya'ni hech qanday foydalanuvchi kira olmasdi.
        //
        // Endi to'g'ri mantiq: XAVFSIZLIK CHEGARASI - HMAC imzosi
        // (validateInitData yuqorida allaqachon tekshirdi). U to'g'ri
        // bo'lsa, foydalanuvchi haqiqiy Telegram foydalanuvchisidir va
        // kirishga haqqi bor. "is_registered" esa asosiy saytning
        // tushunchasi; Telegram orqali kirish allaqachun ro'yxatdan
        // o'tish degani.
        $userId = $this->upsertUser($user);
        if (!$userId) {
            return ['success' => false, 'message' => 'Foydalanuvchini saqlab bo\'lmadi'];
        }

        $result = $this->startSession($userId, $user['id'], $initData);

        // Bot bilan muloqotni tekshirish - alohida, bloklamaydigan qadam.
        // Sababi: getChat faqat fayl YUBORISH uchun kerak (4-qadam).
        // Agar botni /start qilmagan bo'lsa, katalog ko'rish va o'ynash
        // to'liq ishlashi kerak - faqat "Telegram'ga yuborish" ish
        // paytida "botga /start bering" degan eslatma chiqadi.
        $result['needs_start'] = $this->checkBotAccess($userId, $user['id']);

        return $result;
    }

    /**
     * Foydalanuvchi bot bilan muloqot qila oladimi?
     *
     * @return bool true = botni /start qilgan (yuborish ishlaydi)
     *              false = yuborish ishlamaydi (interfeys ogohlantiradi)
     *
     * DIQQAT: bu hech qachon kirishni bloklamaydi. Faqat "Telegram'ga
     * saqlash" funksiyasi ishlash yoki ishlamasligini aniqlaydi.
     */
    private function checkBotAccess($userId, $telegramId) {
        try {
            $chat = $this->telegram->getChat($telegramId);
            if (!empty($chat['id'])) {
                $this->db->update('users', [
                    'telegram_chat_id' => (string) $chat['id'],
                ], 'id = ?', [(int) $userId]);
                return true;
            }
        } catch (Exception $e) {
            error_log('[Auth] getChat: ' . $e->getMessage());
        }
        return false;
    }

    // =========================================================================
    // Telegram LOGIN WIDGET (oauth.telegram.org) orqali ODDIY BRAUZERDAN kirish
    // =========================================================================
    /**
     * "Login with Telegram" vidjeti funksiyasi. Telegram'dan quyidagi
     * maydonlar keladi: id, first_name, last_name, username, photo_url,
     * auth_date, hash.
     *
     * MUHIM: Login Widget imzo algoritmi Mini App initData'sidan FARQ QILADI:
     *   initData:    secret = HMAC_SHA256(bot_token, "WebAppData")
     *   Login Widget: secret = SHA256(bot_token)
     *
     * @param array $data Vidjet callback maydonlari
     * @return array ['success'=>bool, 'message'=>string, ...]
     */
    public function loginWithTelegramWidget(array $data) {
        $hash = (string) ($data['hash'] ?? '');
        if ($hash === '' || empty($data['id'])) {
            return ['success' => false, 'message' => 'Login Widget ma\'lumotlari to\'liq emas'];
        }

        $params = $data;
        unset($params['hash']);
        ksort($params);

        $lines = [];
        foreach ($params as $k => $v) {
            $lines[] = $k . '=' . $v;
        }
        $dataCheckString = implode("\n", $lines);

        $secretKey = hash('sha256', TELEGRAM_BOT_TOKEN, true);
        $calculated = hash_hmac('sha256', $dataCheckString, $secretKey);

        if (!hash_equals($calculated, $hash)) {
            return ['success' => false, 'message' => 'Login Widget imzosi mos kelmadi'];
        }

        // Eskirgan sessiyani rad etish
        $authDate = (int) ($params['auth_date'] ?? 0);
        if ($authDate > 0 && (time() - $authDate) > TELEGRAM_AUTH_MAX_AGE) {
            return ['success' => false, 'message' => 'Telegram sessiyasi eskirgan (ilovani qayta oching)'];
        }

        $userId = $this->upsertUser([
            'id'         => (string) $data['id'],
            'first_name' => $data['first_name'] ?? 'User',
            'last_name'  => $data['last_name'] ?? '',
            'username'   => $data['username'] ?? '',
            'photo_url'  => $data['photo_url'] ?? '',
        ]);

        if (!$userId) {
            return ['success' => false, 'message' => 'Foydalanuvchini saqlab bo\'lmadi'];
        }

        $result = $this->startSession($userId, $data['id'], 'login_widget');
        $result['needs_start'] = $this->checkBotAccess($userId, $data['id']);

        return $result;
    }

    // =========================================================================
    // BOT orqali tasdiqlash-token login (brauzer uchun ishonchli yo'l)
    // =========================================================================
    /**
     * Yangi tasdiqlash tokeni yaratadi (10 daqiqa amal qiladi).
     * Foydalanuvchi t.me/bot?start=auth_TOKEN tugmasini bossa, bot
     * token'ni chat'ga bog'laydi; sayt polling orqali tasdiqlashni
     * ko'rib, loginWithBotToken() bilan sessiya ochadi.
     *
     * @return string token
     */
    public function createLoginToken($validMinutes = 10) {
        // Eski tokenlarni tozalaymiz
        $this->db->query("DELETE FROM telegram_login_tokens WHERE expires_at < NOW()");

        $token = bin2hex(random_bytes(24)); // 48 belgi
        $this->db->insert('telegram_login_tokens', [
            'token'       => $token,
            'expires_at'  => date('Y-m-d H:i:s', time() + $validMinutes * 60),
        ]);
        return $token;
    }

    /**
     * Bot tomonidan tasdiqlangan token'ni iste'mol qilib, sessiya ochadi.
     *
     * @param string $token
     * @return array ['success'=>bool, 'message'=>string, 'pending'=>bool, ...]
     */
    public function loginWithBotToken($token) {
        $token = preg_replace('/[^a-f0-9]/', '', strtolower((string) $token));
        if (strlen($token) < 32) {
            return ['success' => false, 'pending' => false, 'message' => "Token formati noto'g'ri"];
        }

        $row = $this->db->fetchOne(
            "SELECT * FROM telegram_login_tokens WHERE token = ? LIMIT 1",
            [$token]
        );

        if (!$row) {
            return ['success' => false, 'pending' => false, 'message' => 'Token topilmadi (sahifani qayta oching)'];
        }

        // Bir martalik token - allaqachon ishlatilgan
        if (!empty($row['consumed'])) {
            return ['success' => false, 'pending' => false, 'message' => 'Token allaqachon ishlatilgan (sahifani qayta oching)'];
        }

        // Vaqti o'tgan
        if (strtotime($row['expires_at']) < time()) {
            return ['success' => false, 'pending' => false, 'message' => 'Token eskirgan (sahifani qayta oching)'];
        }

        // Bot hali tasdiqlamagan - hali kutamiz
        if (empty($row['telegram_id'])) {
            return ['success' => false, 'pending' => true, 'message' => 'Botda tasdiqlash kutilmoqda'];
        }

        // Bir martalik token
        $this->db->update('telegram_login_tokens', ['consumed' => 1], 'token = ?', [$token]);

        $telegramId = (string) $row['telegram_id'];
        $userId = $this->upsertUser([
            'id'         => $telegramId,
            'first_name' => $row['first_name'] ?? 'User',
            'last_name'  => $row['last_name'] ?? '',
            'username'   => $row['username'] ?? '',
            'photo_url'  => $row['photo_url'] ?? '',
        ]);

        if (!$userId) {
            return ['success' => false, 'pending' => false, 'message' => "Foydalanuvchini saqlab bo'lmadi"];
        }

        $result = $this->startSession($userId, $telegramId, 'bot_token');
        $result['needs_start'] = false; // bot allaqachon ochilgan (token shu yo'l bilan tasdiqlandi)

        return $result;
    }

    // =========================================================================
    // Demo login (faqat localhost + ALLOW_DEMO_LOGIN)
    // =========================================================================
    public function loginAsDemo($telegramId = 123456789) {
        if (!ALLOW_DEMO_LOGIN || !$this->isLocalRequest()) {
            return ['success' => false, 'message' => 'Demo login o\'chirilgan'];
        }

        $userId = $this->upsertUser([
            'id'         => $telegramId,
            'first_name' => 'Demo',
            'last_name'  => 'User',
            'username'   => 'demo_user',
            'is_premium' => true,
        ]);

        if (!$userId) {
            return ['success' => false, 'message' => 'Demo foydalanuvchi yaratilmadi'];
        }

        return $this->startSession($userId, $telegramId, 'demo');
    }

    /**
     * Demo login faqat MAHSUL LOCAL so'rovlar uchun.
     *
     * DIQQAT: IP ga qarab tekshirish YETISHLI EMAS. ngrok/cloudflared
     * kabi tunnelar localhost'dan ulanadi, shuning uchun tuneldan kelgan
     * so'rovda ham REMOTE_ADDR = 127.0.0.1 bo'ladi. Shu sababdan Host
     * ham tekshiriladi - tunnel domaini localhost'ga teng emas.
     */
    private function isLocalRequest() {
        $ip = $_SERVER['REMOTE_ADDR'] ?? '';
        $localIp = $ip === ''
            || in_array($ip, ['127.0.0.1', '::1'], true)
            || strpos($ip, '127.') === 0;

        if (!$localIp) {
            return false;
        }

        return is_local_host($_SERVER['HTTP_HOST'] ?? '');
    }

    // =========================================================================
    // Foydalanuvchini bazaga yozish
    // =========================================================================
    private function upsertUser($tg) {
        $telegramId = (string) $tg['id'];

        $existing = $this->db->fetchOne(
            "SELECT * FROM users WHERE telegram_user_id = ? LIMIT 1",
            [$telegramId]
        );

        $firstName = $this->clean($tg['first_name'] ?? 'User', 50) ?: 'User';
        $lastName  = $this->clean($tg['last_name']  ?? '', 50);
        $username  = $this->uniqueUsername($tg['username'] ?? null, $telegramId, $existing['id'] ?? null);

        // Faqat mavjud ustunlar: language_code va last_active "uzdub"
        // jadvalida YO'Q (bular eski prototipdan qolgan).
        $fields = [
            'first_name'       => $firstName,
            'last_name'        => $lastName ?: null,
            'username'         => $username,
            'telegram_user_id' => $telegramId,
            'last_login_at'    => date('Y-m-d H:i:s'),
            'last_activity'    => date('Y-m-d H:i:s'),
        ];

        if (!empty($tg['is_premium'])) {
            $fields['is_premium'] = 1;
        }

        // Login Widget photo_url bo'lsa avatar sifatida saqlanadi
        if (!empty($tg['photo_url'])) {
            $fields['avatar'] = $this->clean($tg['photo_url'], 500);
        }

        if ($existing) {
            $this->db->update('users', $fields, 'id = ?', [$existing['id']]);
            return (int) $existing['id'];
        }

        // Yangi foydalanuvchi. users jadvalida user_id, email, password
        // NOT NULL va UNIQUE - ularni avtomatik to'ldirishimiz kerak.
        $telegramChatId = $telegramId;   // Telegram ID = chat ID (shaxsiy chat)

        $fields['user_id']   = $this->generateUserCode();
        $fields['email']     = 'tg' . $telegramId . '@miniapp.local';
        $fields['password']  = password_hash(bin2hex(random_bytes(16)), PASSWORD_DEFAULT);
        $fields['telegram_chat_id'] = $telegramChatId;
        $fields['avatar']    = null;

        $newId = $this->db->insert('users', $fields);
        if (!$newId) {
            error_log('[Auth] users ga yozilmadi');
            return 0;
        }

        // Birinchi marta kirsangiz - bildirishnoma beramiz
        $this->db->insert('notifications', [
            'user_id'     => $newId,
            'type'        => 'system',
            'title'       => 'Xush kelibsiz!',
            'message'     => 'Kino, anime va multfilmlar katalogiga xush kelibsiz.',
            'target_url'  => SITE_URL . '/index.php',
        ]);

        return (int) $newId;
    }

    /** Foydalanuvchi kodi (8 belgi), UNIQUE. */
    private function generateUserCode() {
        for ($i = 0; $i < 10; $i++) {
            $code = strtoupper(bin2hex(random_bytes(4)));
            $exists = $this->db->fetchOne("SELECT id FROM users WHERE user_id = ?", [$code]);
            if (!$exists) {
                return $code;
            }
        }
        // Juda kam uchramaydi; oxirgi urinish
        return strtoupper(bin2hex(random_bytes(4))) . 'X';
    }

    /**
     * username UNIQUE. Telegram'da bo'lmasa yoki band bo'lsa -
     * "tg_<id>" yoki uning variantlaridan foydalanamiz.
     */
    private function uniqueUsername($preferred, $telegramId, $currentUserId) {
        $base = $this->clean($preferred ?? '', 50);
        if ($base === '') {
            $base = 'tg_' . $telegramId;
        }
        // Faqat lotin harflari, raqam va _ (DB UNIQUE va havolalar uchun)
        $base = preg_replace('/[^A-Za-z0-9_]/', '', $base) ?: ('tg_' . $telegramId);
        $base = substr($base, 0, 40);

        $candidate = $base;
        $n = 1;
        while (true) {
            $row = $this->db->fetchOne("SELECT id FROM users WHERE username = ?", [$candidate]);
            if (!$row || (int) $row['id'] === (int) $currentUserId) {
                return $candidate;
            }
            $n++;
            $suffix = '_' . $n;
            $candidate = substr($base, 0, 40 - strlen($suffix)) . $suffix;
            if ($n > 50) {
                return $base . '_' . bin2hex(random_bytes(3));
            }
        }
    }

    private function clean($v, $max) {
        $v = trim((string) $v);
        if (function_exists('mb_substr')) {
            return mb_substr(strip_tags($v), 0, $max);
        }
        return substr(strip_tags($v), 0, $max);
    }

    // =========================================================================
    // Session (user_sessions jadvali)
    // =========================================================================
    private function startSession($userId, $telegramId, $initData) {
        $token = bin2hex(random_bytes(32));
        $now   = date('Y-m-d H:i:s');

        $ok = $this->db->insert('user_sessions', [
            'user_id'       => (int) $userId,
            'session_token' => $token,
            'user_agent'    => substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 250),
            'ip_address'    => $_SERVER['REMOTE_ADDR'] ?? '',
            'last_activity' => $now,
        ]);

        if (!$ok) {
            return ['success' => false, 'message' => 'Sessiya yaratilmadi'];
        }

        // Eskirgan sessiyalarni tozalash (30 kundan ko'p)
        $cutoff = date('Y-m-d H:i:s', strtotime('-' . SESSION_TTL_DAYS . ' days'));
        $this->db->query(
            "DELETE FROM user_sessions WHERE last_activity < ?", [$cutoff]
        );

        // Sessiya ID'sini yangilash - session fixation'ning oldini oladi.
        // Guard kerak: agar biror narsa allaqachon chiqargan bo'lsa
        // (CLI, yoki oldindan echo) session_regenerate_id() ogohlantiradi.
        if (session_status() === PHP_SESSION_ACTIVE && !headers_sent($file, $line)) {
            session_regenerate_id(true);
            unset($file, $line);
        }
        $_SESSION['user_id']       = $userId;
        $_SESSION['session_token'] = $token;
        $_SESSION['telegram_id']  = (int) $telegramId;

        return [
            'success'       => true,
            'user_id'       => (int) $userId,
            'telegram_id'   => (int) $telegramId,
            'session_token' => $token,
            'user'          => $this->getUserById($userId),
        ];
    }

    // =========================================================================
    // So'rovlar
    // =========================================================================
    public function getCurrentUser() {
        if (empty($_SESSION['user_id']) || empty($_SESSION['session_token'])) {
            return null;
        }

        $session = $this->db->fetchOne(
            "SELECT * FROM user_sessions WHERE user_id = ? AND session_token = ?",
            [$_SESSION['user_id'], $_SESSION['session_token']]
        );

        if (!$session) {
            $this->logout();
            return null;
        }

        // Sliding session - har so'rovda yangilanadi
        $this->db->query(
            "UPDATE user_sessions SET last_activity = ? WHERE id = ?",
            [date('Y-m-d H:i:s'), $session['id']]
        );

        return $this->getUserById($_SESSION['user_id']);
    }

    public function getUserById($userId) {
        return $this->db->fetchOne("SELECT * FROM users WHERE id = ?", [(int) $userId]);
    }

    /**
     * Joriy foydalanuvchi adminmi?
     *
     * DIQQAT: "premium" emas, aniq Telegram ID ro'yxatiga qaraladi.
     * Sababi: premium - to'lov qilgan mijoz, admin - boshqaruv huquqi.
     * Aralashtirilsa, pul to'lagan oddiy foydalanuvchi moderatsiya paneliga
     * kirib, o'zgalar reel'ini tasdiqlab bo'lardi.
     */
    public function isAdmin() {
        $u = $this->getCurrentUser();
        if (!$u || empty($u['telegram_user_id'])) {
            return false;
        }
        return in_array((string) $u['telegram_user_id'], ADMIN_TELEGRAM_IDS, true);
    }

    /** Admin bo'lmasa 403 bilan to'xtaydi (API uchun). */
    public function requireAdmin($json = true) {
        if ($this->isAdmin()) {
            return true;
        }
        if ($json) {
            self::json(['success' => false, 'message' => 'Faqat admin'], 403);
        }
        http_response_code(403);
        exit('Faqat admin');
    }

    public function getUserByTelegramId($telegramId) {
        return $this->db->fetchOne(
            "SELECT * FROM users WHERE telegram_user_id = ?", [(string) $telegramId]
        );
    }

    /** Hozirchi session foydalanuvchisining Telegram ID'si. */
    public function getCurrentTelegramId() {
        if (!empty($_SESSION['telegram_id'])) {
            return (int) $_SESSION['telegram_id'];
        }
        $user = $this->getCurrentUser();
        return $user ? (int) $user['telegram_user_id'] : null;
    }

    /** Hozirchi session foydalanuvchisining bazadagi chat ID'si. */
    public function getCurrentChatId() {
        $user = $this->getCurrentUser();
        return $user ? ($user['telegram_chat_id'] ?: $user['telegram_user_id']) : null;
    }

    public function isLoggedIn() {
        return $this->getCurrentUser() !== null;
    }

    public function logout() {
        if (!empty($_SESSION['user_id']) && !empty($_SESSION['session_token'])) {
            $this->db->query(
                "DELETE FROM user_sessions WHERE user_id = ? AND session_token = ?",
                [$_SESSION['user_id'], $_SESSION['session_token']]
            );
        }

        $_SESSION = [];

        if (ini_get('session.use_cookies')) {
            $p = session_get_cookie_params();
            setcookie(session_name(), '', time() - 42000, $p['path'], $p['domain'], $p['secure'], $p['httponly']);
        }

        if (session_status() === PHP_SESSION_ACTIVE) {
            session_destroy();
        }
    }

    /**
     * Auth middleware. $json = true bo'lsa JSON xato, aks holda login.php'ga
     * yo'naltiradi. Muvaffaqiyatsiz bo'lsa har doim to'xtaydi.
     */
    public function requireAuth($json = false) {
        if ($this->isLoggedIn()) {
            return;
        }

        if ($json) {
            self::json(['success' => false, 'message' => 'Unauthorized'], 401);
        }

        header('Location: login.php');
        exit;
    }

    public static function json($data, $status = 200) {
        if (!headers_sent()) {
            http_response_code($status);
            header('Content-Type: application/json; charset=utf-8');
            header('Cache-Control: no-store');
        }
        echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
        exit;
    }

    public static function fail($message, $status = 400) {
        self::json(['success' => false, 'message' => $message], $status);
    }

    public static function ok($data = []) {
        self::json(array_merge(['success' => true], $data));
    }
}
