<?php
// ============================================================================
// includes/TgGateway.php — server-side MTProto gateway uchun imzolangan chipta
// ============================================================================
//
// GATEWAY NIMA QILADI?
//   Brauzer `<video src="api/tg-gateway.php?t=<chipta>">` ochadi. PHP endpoint
//   chiptani tekshiradi va so'rovni loopback'dagi `cli/tg-gateway.php`
//   jarayoniga uzatadi. O'sha jarayon Telegram bot sessiyasini USHLAB turadi
//   va har bir Range so'rovi uchun `upload.getFile(offset, limit)` bajaradi.
//   Natija — oddiy HTTP 206 Partial Content. Ya'ni brauzer uchun bu oddiy
//   fayl, MTProto/WebSocket umuman ko'rinmaydi.
//
// XAVFSIZLIK QOIDALARI:
//   • Chipta HMAC-SHA256 bilan imzolanadi. `file_reference` faqat chipta
//     ICHIDA yuradi — SQL'ga YOZILMAYDI.
//   • Chipta foydalanuvchi ID'siga bog'lanadi (`uid`) va muddati bor (`exp`).
//   • Chipta hech qachon log'ga yozilmaydi.
//   • Gateway standart holatda O'CHIQ (TG_GATEWAY_ENABLED=0).
// ============================================================================

if (!defined('TG_GATEWAY_VER')) {
    define('TG_GATEWAY_VER', 1);
}

class TgGateway
{
    /** Gateway yoqilganmi? */
    public static function enabled()
    {
        return defined('TG_GATEWAY_ENABLED') && TG_GATEWAY_ENABLED;
    }

    /** Imzo kaliti: .env dagi TG_GATEWAY_SECRET yoki hosilaviy qiymat. */
    public static function secret()
    {
        $s = defined('TG_GATEWAY_SECRET') ? trim((string) TG_GATEWAY_SECRET) : '';
        if ($s !== '') {
            return hash('sha256', 'wc-tg-gateway|' . $s, true);
        }
        // Alohida secret berilmagan bo'lsa mavjud maxfiy qiymatlardan
        // deterministik kalit hosil qilamiz. Bu qiymatlar hech qayerda
        // ko'rsatilmaydi va .env dan tashqariga chiqmaydi.
        return hash(
            'sha256',
            'wc-tg-gateway-v1|' . (defined('TG_API_HASH') ? TG_API_HASH : '')
            . '|' . (defined('TG_API_ID') ? TG_API_ID : '')
            . '|' . (defined('ADMIN_PANEL_KEY') ? ADMIN_PANEL_KEY : ''),
            true
        );
    }

    /** URL-xavfsiz base64 (padding'siz). */
    public static function b64u($bin)
    {
        return rtrim(strtr(base64_encode((string) $bin), '+/', '-_'), '=');
    }

    /** URL-xavfsiz base64 ni ochish. Xato bo'lsa null. */
    public static function unb64u($s)
    {
        $s = (string) $s;
        if ($s === '' || !preg_match('#^[A-Za-z0-9_-]+$#', $s)) {
            return null;
        }
        $pad = strlen($s) % 4;
        if ($pad) {
            $s .= str_repeat('=', 4 - $pad);
        }
        $out = base64_decode(strtr($s, '-_', '+/'), true);
        return $out === false ? null : $out;
    }

    /**
     * Chipta yasash.
     *
     * Majburiy maydonlar: ch, post, id, ah, fr, size.
     * Qo'shimcha: mime, dur, uid.
     *
     * @param array $p
     * @return string  "v1.<payload>.<mac>"
     */
    public static function sign(array $p)
    {
        $p['v'] = TG_GATEWAY_VER;
        $p['exp'] = isset($p['exp']) ? (int) $p['exp'] : (time() + (int) TG_GATEWAY_TTL);
        if (empty($p['n'])) {
            try {
                $p['n'] = bin2hex(random_bytes(8));
            } catch (\Throwable $e) {
                $p['n'] = substr(hash('sha256', uniqid('', true) . mt_rand()), 0, 16);
            }
        }
        $json = json_encode($p, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $body = self::b64u($json);
        $mac  = hash_hmac('sha256', 'v1.' . $body, self::secret(), true);
        return 'v1.' . $body . '.' . self::b64u($mac);
    }

    /**
     * Chiptani tekshirish.
     *
     * @param string   $token
     * @param int|null $uid  Berilsa, chipta aynan shu foydalanuvchiniki bo'lishi shart.
     * @return array{ok:bool,error?:string,p?:array}
     */
    public static function verify($token, $uid = null)
    {
        $token = (string) $token;
        if ($token === '' || strlen($token) > 8192) {
            return ['ok' => false, 'error' => 'Chipta bo\'sh yoki juda uzun'];
        }
        if (!preg_match('#^v1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$#', $token, $m)) {
            return ['ok' => false, 'error' => 'Chipta formati noto\'g\'ri'];
        }
        $body = $m[1];
        $mac  = self::unb64u($m[2]);
        if ($mac === null || strlen($mac) !== 32) {
            return ['ok' => false, 'error' => 'Chipta imzosi buzuq'];
        }
        $calc = hash_hmac('sha256', 'v1.' . $body, self::secret(), true);
        if (!hash_equals($calc, $mac)) {
            return ['ok' => false, 'error' => 'Chipta imzosi mos emas'];
        }
        $raw = self::unb64u($body);
        if ($raw === null) {
            return ['ok' => false, 'error' => 'Chipta mazmuni buzuq'];
        }
        $p = json_decode($raw, true);
        if (!is_array($p) || (int) ($p['v'] ?? 0) !== TG_GATEWAY_VER) {
            return ['ok' => false, 'error' => 'Chipta versiyasi mos emas'];
        }
        if ((int) ($p['exp'] ?? 0) <= time()) {
            return ['ok' => false, 'error' => 'Chipta muddati tugagan'];
        }
        foreach (['ch', 'post', 'id', 'ah', 'fr', 'size'] as $k) {
            if (!isset($p[$k]) || $p[$k] === '') {
                return ['ok' => false, 'error' => 'Chiptada "' . $k . '" yo\'q'];
            }
        }
        if ((int) $p['post'] <= 0) {
            return ['ok' => false, 'error' => 'Post raqami noto\'g\'ri'];
        }
        $size = (int) $p['size'];
        if ($size <= 0 || $size > 20 * 1024 * 1024 * 1024) {
            return ['ok' => false, 'error' => 'Fayl hajmi noto\'g\'ri'];
        }
        if ($uid !== null) {
            $tu = (int) ($p['uid'] ?? 0);
            if ($tu <= 0 || $tu !== (int) $uid) {
                return ['ok' => false, 'error' => 'Chipta boshqa foydalanuvchiga berilgan'];
            }
        }
        return ['ok' => true, 'p' => $p];
    }

    /**
     * `Range` sarlavhasini tahlil qilish (bitta oraliq).
     *
     * @return array{ok:bool,start:int,end:int,partial:bool,error?:string}
     */
    public static function parseRange($header, $size)
    {
        $size = (int) $size;
        $header = trim((string) $header);
        if ($size <= 0) {
            return ['ok' => false, 'start' => 0, 'end' => 0, 'partial' => false, 'error' => 'Fayl hajmi noma\'lum'];
        }
        if ($header === '') {
            return ['ok' => true, 'start' => 0, 'end' => $size - 1, 'partial' => false];
        }
        if (strlen($header) > 200 || strpos($header, ',') !== false) {
            // Ko'p oraliqli so'rovlar video uchun kerak emas; butun faylni
            // yuborishdan ko'ra 416 qaytarish xavfsizroq.
            return ['ok' => false, 'start' => 0, 'end' => 0, 'partial' => false, 'error' => 'Faqat bitta oraliq qo\'llanadi'];
        }
        if (!preg_match('#^bytes=(\d*)-(\d*)$#', $header, $m)) {
            return ['ok' => false, 'start' => 0, 'end' => 0, 'partial' => false, 'error' => 'Range formati noto\'g\'ri'];
        }
        $a = $m[1];
        $b = $m[2];
        if ($a === '' && $b === '') {
            return ['ok' => true, 'start' => 0, 'end' => $size - 1, 'partial' => false];
        }
        if ($a === '') {
            $len = (int) $b;
            if ($len <= 0) {
                return ['ok' => false, 'start' => 0, 'end' => 0, 'partial' => false, 'error' => 'Oraliq uzunligi noto\'g\'ri'];
            }
            $start = max(0, $size - $len);
            $end = $size - 1;
        } else {
            $start = (int) $a;
            $end = ($b === '') ? $size - 1 : (int) $b;
        }
        if ($start >= $size || $start > $end) {
            return ['ok' => false, 'start' => 0, 'end' => 0, 'partial' => false, 'error' => 'Oraliq fayl chegarasidan tashqarida'];
        }
        if ($end >= $size) {
            $end = $size - 1;
        }
        return ['ok' => true, 'start' => $start, 'end' => $end, 'partial' => true];
    }

    /**
     * Chipta ichidagi ma'lumotdan MadelineProto `downloadToStream` uchun
     * media massivini yasaydi. `file_reference` faqat shu yerda ochiladi.
     *
     * @param array $p Tekshirilgan chipta payload'i
     * @return array|null
     */
    public static function media(array $p)
    {
        $fr = self::unb64u($p['fr'] ?? '');
        if ($fr === null) {
            // TgMeta standart base64 saqlaydi (`+`, `/`, `=` bo'lishi mumkin).
            $std = base64_decode((string) ($p['fr'] ?? ''), true);
            $fr = ($std === false) ? null : $std;
        }
        if ($fr === null || $fr === '') {
            return null;
        }
        return [
            'InputFileLocation' => [
                '_'             => 'inputDocumentFileLocation',
                'id'            => (int) $p['id'],
                'access_hash'   => (int) $p['ah'],
                'file_reference'=> $fr,
                'thumb_size'    => '',
            ],
            'size' => (int) $p['size'],
            'mime' => (string) ($p['mime'] ?? 'video/mp4'),
        ];
    }

    /** Loopback gateway manzili. */
    public static function daemonUrl($path = '/')
    {
        $host = defined('TG_GATEWAY_HOST') ? TG_GATEWAY_HOST : '127.0.0.1';
        $port = defined('TG_GATEWAY_PORT') ? (int) TG_GATEWAY_PORT : 8099;
        return 'http://' . $host . ':' . $port . $path;
    }

    /** Loopback so'rovlari uchun statik kalit (chipta emas). */
    public static function daemonKey()
    {
        return hash_hmac('sha256', 'wc-gateway-loopback-v1', self::secret());
    }
}
