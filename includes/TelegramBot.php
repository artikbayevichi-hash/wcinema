<?php
// Telegram Bot API integration class

class TelegramBot {
    private $botToken;
    private $botUsername;
    private $apiUrl;
    private $lastError = null;
    private $curlTimeout;

    public function __construct($botToken = null) {
        $this->botToken = $botToken ?: TELEGRAM_BOT_TOKEN;
        $this->botUsername = TELEGRAM_BOT_USERNAME;
        $this->apiUrl = "https://api.telegram.org/bot" . $this->botToken;
        $this->curlTimeout = 60;
    }

    public function getLastError() {
        return $this->lastError;
    }

    /** Katta fayl yuklash uchun cURL kutish vaqtini o'zgartirish (soniya). */
    public function setTimeout($seconds) {
        $this->curlTimeout = max(5, (int) $seconds);
    }

    /**
     * API bazaviy manzili. Token bilan.
     * DIQQAT: fayl havolasi yasash uchun ishlatiladi - URL'ni
     * HTML/JS'ga chiqarmasligingiz kerak.
     */
    public function apiUrl() {
        return $this->apiUrl;
    }

    // -------------------------------------------------------------------------
    // API so'rov yuborish
    // -------------------------------------------------------------------------
    /**
     * @param string $method Bot API metodi
     * @param array  $data   Parameterlar (qiymatlar string bo'lishi kerak)
     * @return array|null    Telegram javobi, yoki null (xato bo'lsa)
     */
    private function request($method, $data = []) {
        $url = $this->apiUrl . "/" . $method;
        $this->lastError = null;

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $data,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_SSL_VERIFYPEER => true,   // avvalgi kodda o'chirilgan edi
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT        => $this->curlTimeout,
            CURLOPT_FOLLOWLOCATION => false,
        ]);

        $result = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = curl_error($ch);
        curl_close($ch);

        if ($result === false) {
            $this->lastError = "Tarmoq xatosi ({$method}): " . ($curlError ?: 'noma\'lum');
            error_log("[TelegramBot] {$method}: curl error - {$curlError}");
            return null;
        }

        $decoded = json_decode($result, true);

        if (!is_array($decoded) || !isset($decoded['ok'])) {
            $this->lastError = "Telegram javobini tushunib bo'lmadi ({$method}): " . substr((string) $result, 0, 300);
            return null;
        }

        if ($decoded['ok'] === false) {
            $code = $decoded['error_code'] ?? 0;
            $desc = $decoded['description'] ?? 'noma\'lum xato';
            $this->lastError = "Telegram xatosi ({$code}): {$desc}";
            error_log("[TelegramBot] {$method}: {$code} {$desc}");
            return null;
        }

        if ($httpCode >= 400) {
            $this->lastError = "HTTP {$httpCode} ({$method})";
            return null;
        }

        return $decoded;
    }

    // -------------------------------------------------------------------------
    // initData parsing va validatsiyasi
    // -------------------------------------------------------------------------

    /**
     * initData'ni rasmiy Telegram algoritmi bo'yicha tekshirish.
     *
     * 1) hash'ni chiqarib, qolgan parametrlarni kalit bo'yicha tartiblab
     *    "key=value\n..." qatori yasash
     * 2) secret = HMAC_SHA256(data=bot_token, key="WebAppData")
     * 3) HMAC_SHA256(data=data_check_string, key=secret) === hash
     *
     * @return bool|string true yoki xabar
     */
    public function validateInitData($initData) {
        if (empty($initData) || !is_string($initData)) {
            return 'initData bo\'sh';
        }

        $params = [];
        parse_str($initData, $params);

        $hash = $params['hash'] ?? null;
        if (!$hash) {
            return 'initData ichida hash yo\'q';
        }

        // hash tekshiruvga kirmaydi.
        //
        // DIQQAT: `signature` HISOBGA OLINADI. Telegram'ning yangi
        // klientlari initData imzosini `signature` maydoni ham
        // data_check_string ichida bo'lgan holda hisoblaydi. Avvalgi
        // kod signature'ni unset qilardi - shuning uchun barcha yangi
        // initData "imzosi mos kelmadi" deb rad etilardi (eski klientlar
        // signature yubormagani uchun eski kod ishlab qolgandi).
        unset($params['hash']);

        // data_check_string
        ksort($params);
        $checkLines = [];
        foreach ($params as $key => $value) {
            $checkLines[] = $key . '=' . $value;
        }
        $dataCheckString = implode("\n", $checkLines);

        $secretKey = hash_hmac('sha256', $this->botToken, 'WebAppData', true);
        $calculated = hash_hmac('sha256', $dataCheckString, $secretKey);

        if (!hash_equals($calculated, (string) $hash)) {
            return 'initData imzosi mos kelmadi';
        }

        // Eskirgan initData'ni rad etish
        $authDate = (int) ($params['auth_date'] ?? 0);
        if ($authDate > 0 && (time() - $authDate) > TELEGRAM_AUTH_MAX_AGE) {
            return 'initData eskirgan (qo\'lda kirish uchun Telegram\'ni qayta oching)';
        }

        return true;
    }

    /**
     * initData'dan foydalanuvchi ma'lumotlarini olish.
     */
    public function parseInitData($initData) {
        $params = [];
        parse_str($initData, $params);

        $user = null;
        if (!empty($params['user'])) {
            $user = json_decode($params['user'], true);
        }

        return [
            'query_id'  => $params['query_id'] ?? null,
            'user'     => $user,
            'auth_date' => isset($params['auth_date']) ? (int) $params['auth_date'] : null,
            'start_param' => $params['start_param'] ?? null,
            'chat_instance' => $params['chat_instance'] ?? null,
            'hash'      => $params['hash'] ?? null,
        ];
    }

    // -------------------------------------------------------------------------
    // Yuborish
    // -------------------------------------------------------------------------
    public function sendMessage($chatId, $text, $parseMode = 'HTML', $replyMarkup = null) {
        $data = [
            'chat_id'    => $chatId,
            'text'       => $text,
            'parse_mode' => $parseMode,
        ];

        if ($replyMarkup) {
            $data['reply_markup'] = json_encode($replyMarkup, JSON_UNESCAPED_UNICODE);
        }

        return $this->request('sendMessage', $data);
    }

    /**
     * Forum-guruh (topics) ichida xabar yuborish.
     *
     * @param string   $chatId
     * @param int      $threadId  topic id (message_thread_id)
     * @param string   $text
     * @param string   $parseMode
     * @param array|null $replyMarkup
     * @return array|null
     */
    public function sendMessageToTopic($chatId, $threadId, $text, $parseMode = 'HTML', $replyMarkup = null) {
        $data = [
            'chat_id'           => $chatId,
            'message_thread_id' => (int) $threadId,
            'text'              => $text,
            'parse_mode'        => $parseMode,
        ];
        if ($replyMarkup) {
            $data['reply_markup'] = json_encode($replyMarkup, JSON_UNESCAPED_UNICODE);
        }
        return $this->request('sendMessage', $data);
    }

    /**
     * Forum-guruhda yangi MAVZU (topic) ochish.
     *
     * Bot guruhda ADMIN bo'lishi va "Manage Topics" huquqi bo'lishi shart.
     *
     * @return array|null ['message_thread_id'=>, 'name'=>, ...]
     */
    public function createForumTopic($chatId, $name, $iconColor = null) {
        $data = [
            'chat_id' => $chatId,
            'name'    => mb_substr(trim((string) $name), 0, 128),
        ];
        if ($iconColor !== null) {
            $data['icon_color'] = (int) $iconColor;
        }
        $res = $this->request('createForumTopic', $data);
        return $res['result'] ?? null;
    }

    /**
     * Mavzuni qayta nomlash.
     */
    public function editForumTopic($chatId, $threadId, $name) {
        $res = $this->request('editForumTopic', [
            'chat_id'           => $chatId,
            'message_thread_id' => (int) $threadId,
            'name'              => mb_substr(trim((string) $name), 0, 128),
        ]);
        return $res['result'] ?? null;
    }

    /**
     * Guruh a'zosining holati (admin mi?).
     *
     * @return array|null ['status'=>'administrator'|'member'|'creator'|...,'user'=>...]
     */
    public function getChatMember($chatId, $userId) {
        $res = $this->request('getChatMember', [
            'chat_id' => $chatId,
            'user_id' => (int) $userId,
        ]);
        return $res['result'] ?? null;
    }

    /**
     * Stiker yuborish (file_id yoki CURLFile).
     */
    public function sendSticker($chatId, $sticker, $options = []) {
        $data = [
            'chat_id' => $chatId,
            'sticker' => $this->prepareFileArgument($sticker),
        ];
        if (!empty($options['message_thread_id'])) {
            $data['message_thread_id'] = (int) $options['message_thread_id'];
        }
        return $this->request('sendSticker', $data);
    }

    /**
     * GIF (animation) yuborish (file_id yoki CURLFile).
     */
    public function sendAnimation($chatId, $animation, $options = []) {
        $data = [
            'chat_id'   => $chatId,
            'animation' => $this->prepareFileArgument($animation),
        ];
        if (!empty($options['message_thread_id'])) {
            $data['message_thread_id'] = (int) $options['message_thread_id'];
        }
        if (!empty($options['caption'])) {
            $data['caption'] = mb_substr($options['caption'], 0, 1024);
        }
        return $this->request('sendAnimation', $data);
    }

    /**
     * Rasm yuborish (file_id yoki CURLFile).
     */
    public function sendPhoto($chatId, $photo, $options = []) {
        $data = [
            'chat_id' => $chatId,
            'photo'   => $this->prepareFileArgument($photo),
        ];
        if (!empty($options['message_thread_id'])) {
            $data['message_thread_id'] = (int) $options['message_thread_id'];
        }
        if (!empty($options['caption'])) {
            $data['caption'] = mb_substr($options['caption'], 0, 1024);
        }
        return $this->request('sendPhoto', $data);
    }

    /**
     * Video yuborish.
     *
     * @param string $chatId
     * @param string $video  file_id YOKI serverdagi fayl yo'li yoki HTTP URL
     * @param array  $options
     *        caption, parse_mode, reply_markup, protect_content, disable_notification,
     *        spoiler (bool), supports_streaming (bool)
     * @return array|null
     */
    public function sendVideo($chatId, $video, $options = []) {
        $data = [
            'chat_id'  => $chatId,
            'video'    => $this->prepareFileArgument($video),
            'supports_streaming' => !empty($options['supports_streaming']) ? 'true' : 'false',
        ];

        if (!empty($options['caption'])) {
            $data['caption'] = mb_substr($options['caption'], 0, 1024);
        }
        if (!empty($options['parse_mode'])) {
            $data['parse_mode'] = $options['parse_mode'];
        }
        if (!empty($options['reply_markup'])) {
            $data['reply_markup'] = json_encode($options['reply_markup'], JSON_UNESCAPED_UNICODE);
        }
        if (!empty($options['protect_content'])) {
            $data['protect_content'] = 'true';
        }
        if (!empty($options['disable_notification'])) {
            $data['disable_notification'] = 'true';
        }
        if (!empty($options['spoiler'])) {
            $data['has_spoiler'] = 'true';
        }

        return $this->request('sendVideo', $data);
    }

    /**
     * Hujjat (document) sifatida yuborish.
     *
     * sendVideo ba'zi konteynerlarni (.mkv/.mov) qabul qilmasa — shu zaxira
     * ishlatiladi. Fayl baribir Telegram serverida qoladi, bizda saqlanmaydi.
     *
     * @param string $chatId
     * @param string|CURLFile $document
     * @param array  $options caption, parse_mode, disable_notification
     * @return array|null
     */
    public function sendDocument($chatId, $document, $options = []) {
        $data = [
            'chat_id'  => $chatId,
            'document' => $this->prepareFileArgument($document),
        ];
        if (!empty($options['caption'])) {
            $data['caption'] = mb_substr($options['caption'], 0, 1024);
        }
        if (!empty($options['parse_mode'])) {
            $data['parse_mode'] = $options['parse_mode'];
        }
        if (!empty($options['disable_notification'])) {
            $data['disable_notification'] = 'true';
        }
        return $this->request('sendDocument', $data);
    }

    /**
     * Xabarni o'chirish (masalan, bot chatiga kelgan vaqtinchalik videoni
     * kanalga ko'chirgach tozalash uchun).
     */
    public function deleteMessage($chatId, $messageId) {
        return $this->request('deleteMessage', [
            'chat_id'    => $chatId,
            'message_id' => (int) $messageId,
        ]);
    }

    /**
     * Fayl argumentini tayyorlash: lokal yo'l bo'lsa CURLFile ga aylantiramiz.
     */
    private function prepareFileArgument($file) {
        if (is_string($file) && $file !== '' && @is_file($file) && strlen($file) < 4096) {
            $mime = $this->guessMimeType($file);
            return new CURLFile($file, $mime, basename($file));
        }
        return $file;
    }

    private function guessMimeType($path) {
        $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
        $map = [
            'mp4'  => 'video/mp4',
            'webm' => 'video/webm',
            'mov'  => 'video/quicktime',
            'mkv'  => 'video/x-matroska',
            'avi'  => 'video/x-msvideo',
            'mpeg' => 'video/mpeg',
            'mpg'  => 'video/mpeg',
        ];
        return $map[$ext] ?? 'application/octet-stream';
    }

    // -------------------------------------------------------------------------
    // Fayl / fayl URL
    // -------------------------------------------------------------------------

    /**
     * getFile - fayl haqida ma'lumot (faqat 20 MB gacha).
     *
     * @return array|null ['file_id'=>, 'file_unique_id'=>, 'file_size'=>, 'file_path'=>]
     */
    public function getFile($fileId) {
        if (empty($fileId)) {
            $this->lastError = 'file_id bo\'sh';
            return null;
        }

        $res = $this->request('getFile', ['file_id' => $fileId]);
        return $res['result'] ?? null;
    }

    /**
     * To'g'ridan-to'g'ri yuklab olish havolasi.
     *
     * DIQQAT: Bu URL ichida BOT TOKEN bor. Uni HTML/JS'ga qo'ysangiz
     * har bir tashrifchi tokeni ko'radi va sizning botni boshqarishi mumkin.
     * Faqat server-side (proxy) ishlatish yoki maxfiy kontent uchun.
     */
    public function getFileDirectUrl($fileId) {
        $file = $this->getFile($fileId);
        if (!$file || empty($file['file_path'])) {
            return null;
        }
        return $this->apiUrl . "/" . $file['file_path'];
    }

    /**
     * Server-side: faylni o'z serverimizga yuklab oladi (TRAFik O'ZIMIZDA).
     * @return bool|null null = xato bo'ldi
     */
    public function downloadFile($fileId, $destination) {
        $file = $this->getFile($fileId);
        if (!$file || empty($file['file_path'])) {
            return null;
        }

        if (isset($file['file_size']) && $file['file_size'] > TELEGRAM_MAX_DOWNLOAD) {
            $this->lastError = 'Fayl 20 MB dan katta (Telegram getFile cheklovi)';
            return null;
        }

        $url = $this->apiUrl . "/" . $file['file_path'];
        $fp = @fopen($destination, 'wb');
        if (!$fp) {
            $this->lastError = 'Maqsadli faylni ochib bo\'olmadi';
            return null;
        }

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_FILE           => $fp,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT        => 300,
            CURLOPT_FOLLOWLOCATION => true,
        ]);
        $ok = curl_exec($ch);
        $err = curl_error($ch);
        curl_close($ch);
        fclose($fp);

        if ($ok === false) {
            @unlink($destination);
            $this->lastError = 'Yuklab olish xatosi: ' . $err;
            return null;
        }

        return true;
    }

    // -------------------------------------------------------------------------
    // Chat / foydalanuvchi
    // -------------------------------------------------------------------------

    /**
     * Bot bu chat'ga xabar yubora oladimi?
     * @return array|null getChat natijasi
     */
    public function getChat($chatId) {
        $res = $this->request('getChat', ['chat_id' => $chatId]);
        return $res['result'] ?? null;
    }

    /**
     * Bot bu chat'ga xabar yubora oladimi?
     *
     * qaytaradi:
     *   'ok'         - yuborish mumkin
     *   'need_start' - foydalanuvchi botga /start bosmagan
     *   'error'      - boshqa xato (batafsil matn $lastError da)
     */
    public function checkChatAccess($chatId) {
        $res = $this->request('getChat', ['chat_id' => $chatId]);

        if ($res) {
            return 'ok';
        }

        $err  = (string) $this->lastError;
        $desc = $err;

        // "chat not found" = foydalanuvchi hech qachon botga murojaat qilmagan
        if (stripos($desc, 'chat not found') !== false) {
            return 'need_start';
        }

        // "bot can't initiate conversation" = /start bosilmagan
        if (stripos($desc, "can't initiate conversation") !== false) {
            return 'need_start';
        }

        // Guruh/kanalga bot qo'shilmagan
        if (stripos($desc, 'bot is not a member') !== false) {
            return 'need_start';
        }

        if (stripos($desc, 'user not found') !== false) {
            return 'error';
        }

        return 'error';
    }

    /**
     * Eski nom - moslik uchun saqlangan.
     */
    public function requiresStart($chatId) {
        return $this->checkChatAccess($chatId) === 'need_start';
    }

    public function getMe() {
        $res = $this->request('getMe');
        return $res['result'] ?? null;
    }

    // -------------------------------------------------------------------------
    // Webhook
    // -------------------------------------------------------------------------
    public function setWebhook($url, $secretToken = null) {
        $data = ['url' => $url];
        if ($secretToken) {
            $data['secret_token'] = $secretToken;
        }
        return $this->request('setWebhook', $data);
    }

    public function deleteWebhook() {
        return $this->request('deleteWebhook');
    }

    public function getWebhookInfo() {
        $res = $this->request('getWebhookInfo');
        return $res['result'] ?? null;
    }

    /**
     * Bot token ochiq qolmasligi uchun yordamchi:
     * HTML/JS chiqishida token ko'rinmasin.
     */
    public static function maskToken($token) {
        if (strlen($token) < 12) {
            return '***';
        }
        return substr($token, 0, 7) . '...' . substr($token, -4);
    }
}
