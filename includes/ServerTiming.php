<?php
// ============================================================================
// ServerTiming — Server-Timing sarlavhasini chiqarish (observability)
// ----------------------------------------------------------------------------
// MAQSAD: "video nega sekin ochilyapti?" degan savolga SERVER tomondan
// aniq javob berish. Brauzer tomondagi o'lchov (ttfb / canplay / first_frame)
// `assets/js/tg-perf.js` + `api/perf.php` da allaqachon bor; bu yerdagi
// raqamlar faqat PHP tomonining vaqtini ko'rsatadi (DB, kesh, doc resolve).
//
// XAVFSIZLIK:
//   • faqat vaqt (ms) va qisqa tavsif yuboriladi — hech qanday maxfiy qiymat,
//     token, foydalanuvchi ma'lumoti yo'q.
//   • `header_register_callback` orqali sarlavha AYNAN header'lar yuborilish-
//     dan oldin qo'shiladi. Shuning uchun `ob_start()` / `headers_sent()`
//     muammosi yo'q va mavjud chiqish mantig'iga tegmaymiz.
//
// ISHLATISH (birinchi qatorlarda):
//   require_once __DIR__ . '/includes/ServerTiming.php';
//   ServerTiming::init('wc-page', 'bootstrap + catalog + boot');
//
//   ixtiyoriy oraliq o'lchov:
//   $t = ServerTiming::mark('db');
//   ... ish ...
//   ServerTiming::span('wc-db', $t, 'SQL bootstrap');
// ============================================================================

if (!class_exists('ServerTiming')) {
final class ServerTiming
{
    /** @var float|null */
    private static $start = null;
    /** @var array<string,array{0:string,1:float,2:string}> tugallangan o'lchovlar */
    private static $spans = [];
    /** @var array<string,array{0:string,1:string}> yakuniy (flush paytida hisoblanadi) */
    private static $totals = [];
    /** @var bool */
    private static $registered = false;

    /**
     * O'lchovni boshlash. $name — Server-Timing'da ko'rinadigan nom.
     * $desc — ixtiyoriy qisqa izoh (faqat harflar/raqamlar, 64 belgigacha).
     */
    public static function init($name = 'wc', $desc = 'request total')
    {
        if (self::$start === null) {
            self::$start = microtime(true);
        }
        self::total($name, $desc);

        if (!self::$registered && function_exists('header_register_callback')) {
            self::$registered = true;
            // Callback xato bersa ham sahifani buzmasligi kerak.
            @header_register_callback([__CLASS__, 'flush']);
        }
    }

    /** Hozirgi vaqtni o'lchov nuqtasi sifatida qaytaradi. */
    public static function mark()
    {
        return microtime(true);
    }

    /** $mark dan hozirgacha bo'lgan vaqtni o'lchov sifatida saqlaydi. */
    public static function span($name, $mark, $desc = '')
    {
        if (!is_numeric($mark)) return;
        self::$spans[$name] = [$name, (microtime(true) - (float) $mark) * 1000, $desc];
    }

    /** init() dan header yuborilgungacha bo'lgan umumiy vaqt. */
    public static function total($name, $desc = '')
    {
        self::$totals[$name] = [$name, $desc];
    }

    /** Sarlavha yuborilishidan oldin avtomatik chaqiriladi. */
    public static function flush()
    {
        if (headers_sent() || (empty(self::$spans) && empty(self::$totals))) return;

        $parts = [];
        foreach (self::$spans as $m) {
            $parts[] = self::format($m[0], $m[1], $m[2]);
        }
        if (self::$start !== null) {
            $ms = (microtime(true) - self::$start) * 1000;
            foreach (self::$totals as $m) {
                $parts[] = self::format($m[0], $ms, $m[1]);
            }
        }
        if ($parts) {
            header('Server-Timing: ' . implode(', ', $parts));
        }
    }

    private static function format($name, $ms, $desc)
    {
        // Nomi faqat xavfsiz belgilardan iborat bo'lishi shart (spec talabi).
        $name = (string) $name;
        if (!preg_match('/^[A-Za-z0-9_-]{1,40}$/', $name)) $name = 'wc';
        $s = $name . ';dur=' . round(max(0, (float) $ms), 1);
        if ($desc !== '') {
            $d = substr((string) $desc, 0, 64);
            $d = str_replace(['\\', '"'], ['\\\\', '\\"'], $d);
            $s .= ';desc="' . $d . '"';
        }
        return $s;
    }
}
}
