<?php
// ============================================================================
// LoginGate — saytga faqat Telegram orqali kirgan odam kira oladi
// ============================================================================
// MUAMMO:
//   Kirish himoyasi faqat brauzerda edi (`localStorage` dagi `auth_key` +
//   `nav.php` / `1stlogin.php` skriptlari). Server esa hech narsani
//   tekshirmasdi: `watch.php`, `index.php` va boshqa sahifalar cookie'siz
//   ham 200 qaytarardi — ya'ni to'g'ridan-to'g'ri havola bilan kirish
//   mumkin edi.
//
// YECHIM:
//   Har bir sahifa (api/*, cli/*, includes/* va kirish sahifalaridan
//   tashqari) `clientUserId()` ni tekshiradi. U imzolangan HttpOnly
//   cookie'ni (`wc_cs`; `api/client-session.php` beradi) o'qiydi. Cookie
//   bo'lmasa — `1stlogin.php?next=...` ga yo'naltiriladi va kirgandan keyin
//   o'sha sahifaga qaytadi.
//
// NIMA UCHUN `clientUserId()`:
//   Bu funksiya PHP sessiyasi, imzolangan cookie va (moslik rejimida)
//   `tg_me` ni BIR XIL tartibda tekshiradi — yangi mantiq o'ylab
//   topilmaydi, ya'ni API va sahifalar bir xil qoida bo'yicha ishlaydi.
//
// ESLATMA: `TG_TRUST_CLIENT_ID=1` (moslik rejimi) da `tg_me` yuborib
//   boshqa odam nomidan kirish mumkin. Production'da 0 qilinadi — u holda
//   faqat initData yoki bot tokeni asosida berilgan cookie ishlaydi.
// ============================================================================

final class LoginGate
{
    /** Kirish oqimi va tizim sahifalari — hech qachon to'silmaydi. */
    private static $allow = [
        '1stlogin.php',      // splash / kirish sahifasi
        'tg-login.php',      // QR + telefon raqami bilan kirish
        'logout.php',
        'login.php',         // bot-token bilan kirish
        'check_login.php',   // login.php ning JSON so'rovlari
        'mini-app-setup.php',
        'bot.php',           // Telegram bot (o'zining CLI guard'i bor)
        'diag.php',          // o'lchov sahifasi
        'tg-proof.php',      // MTProto namoyishi
        'config.php',        // to'g'ridan-to'g'ri ochilsa hech narsa chiqarmaydi
    ];

    /** Joriy so'rovni ishga tushirgan fayl (to'liq yoki nisbiy yo'l). */
    private static function script()
    {
        $p = str_replace('\\', '/', (string) ($_SERVER['SCRIPT_FILENAME'] ?? ''));
        if ($p === '') {
            $p = str_replace('\\', '/', (string) ($_SERVER['SCRIPT_NAME'] ?? ''));
        }
        return $p;
    }

    /** Bu so'rovni to'sish kerakmi? */
    public static function isAllowed()
    {
        $p = self::script();
        if ($p === '') {
            return true;   // aniqlanmadi — to'smaymiz (saytni buzib qo'ymaylik)
        }

        // Ichki qatlam: API o'z ichida avtorizatsiya qiladi, CLI — konsol.
        if (preg_match('#/(api|cli|includes)/#i', $p)) {
            return true;
        }

        $f = strtolower(basename($p));
        if (in_array($f, self::$allow, true)) {
            return true;
        }
        // Admin panel PHP sessiyasi (wc_adm) bilan ishlaydi.
        if ($f === 'admin.php' || strpos($f, 'admin-') === 0) {
            return true;
        }
        return false;
    }

    /** Kirmagan foydalanuvchini kirish sahifasiga yo'naltiradi. */
    public static function enforce()
    {
        if (PHP_SAPI === 'cli') {
            return;
        }
        if (self::isAllowed()) {
            return;
        }
        if (clientUserId() > 0) {
            return;
        }

        // Joriy papka (sayt ildizi `/` yoki `/tele_uzdub/` bo'lishi mumkin).
        $script = str_replace('\\', '/', (string) ($_SERVER['SCRIPT_NAME'] ?? '/'));
        $base   = rtrim(dirname($script), '/');
        $to     = $base . '/1stlogin.php';

        // `next` — faqat shu sayt ichidagi manzil (1stlogin.php o'zi tekshiradi).
        $next = (string) ($_SERVER['REQUEST_URI'] ?? '');
        if ($next !== ''
            && strpos($next, '1stlogin.php') === false
            && strpos($next, 'tg-login.php') === false) {
            $to .= '?next=' . rawurlencode($next);
        }

        if (!headers_sent()) {
            header('Cache-Control: no-store');
            header('Location: ' . $to, true, 302);
        }
        exit;
    }
}
