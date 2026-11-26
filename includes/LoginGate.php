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

    /** Admin kirish nuqtalari — ular `wc_adm` ni O'ZI tekshiradi. */
    private static $admin = [
        'admin.php', 'admin-login.php', 'admin-panel.php', 'admin-content.php',
        'admin-notify.php', 'admin-feedback.php', 'admin-users.php', 'admin-reels.php',
    ];

    /** Bu so'rovni to'sish kerakmi? */
    public static function isAllowed()
    {
        $p = self::script();
        if ($p === '') {
            // HTTP so'rovda manzil noma'lum bo'lsa, ochiq qoldirmaymiz.
            return PHP_SAPI === 'cli';
        }

        // Ichki qatlam: FAQAT BU saytning api/cli/includes papkalari.
        // Ilgari `preg_match('#/(api|cli)/#')` butun yo'ldagi ixtiyoriy
        // '/api/' bo'lagini topib, begona skriptlarni ham o'tkazib yuborardi.
        $appRoot = realpath(__DIR__ . '/..');
        $real = realpath($p);
        if ($appRoot && $real) {
            $rel = str_replace('\\', '/', substr($real, strlen($appRoot)));
            if (preg_match('#^/(api|cli|includes)/#i', $rel)) {
                return true;
            }
        }

        $f = strtolower(basename($p));
        if (in_array($f, self::$allow, true)) {
            return true;
        }
        if (in_array($f, self::$admin, true)) {
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
