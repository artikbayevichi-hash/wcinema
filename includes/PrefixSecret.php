<?php
// ============================================================================
// PrefixSecret — mahalliy prefiks keshining imzo kaliti
// ----------------------------------------------------------------------------
// Ilgari PREFIX_SECRET/R2_SIGN_SECRET bo'lmaganda ADMIN_PANEL_KEY ishlatilar
// edi. `api/r2-sign.php?info=1` ochiq holda ma'lum exp uchun HMAC qaytaradi —
// qisqa admin kaliti shunday imzodan oflayn tiklanib, soxtalashtirilgan
// `wc_adm` cookie yaratishga imkon berardi. Shuning uchun admin kaliti HECH
// qachon prefiks imzosi uchun ishlatilmaydi: o'rniga alohida tasodifiy kalit
// `storage/prefix/.secret` da saqlanadi (papka HTTP dan yopiq, git'ga kirmaydi).
//
// Aniq PREFIX_SECRET / R2_SIGN_SECRET berilsa, ular ustunlik qiladi — bu
// Worker/R2 bilan mavjud moslikni buzmaydi.
// ============================================================================

final class PrefixSecret
{
    /** @var string|null */
    private static $cached = null;

    public static function get(): string
    {
        if (self::$cached !== null) return self::$cached;

        foreach (['PREFIX_SECRET', 'R2_SIGN_SECRET'] as $name) {
            $v = trim((string) env_value($name, ''));
            if ($v !== '') return self::$cached = $v;
        }

        $dir  = dirname(__DIR__) . '/storage/prefix';
        $file = $dir . '/.secret';

        // Avval o'qib ko'ramiz: parallel so'rovlar yangi kalit yaratmasligi
        // kerak — aks holda bir so'rovning imzosi ikkinchisida rad etiladi.
        $existing = self::read($file);
        if ($existing !== '') return self::$cached = $existing;

        if (!is_dir($dir)) @mkdir($dir, 0700, true);
        $fresh = bin2hex(random_bytes(32));
        $fh = @fopen($file, 'xb');           // faqat bir jarayon yozadi
        if ($fh) {
            @fwrite($fh, $fresh);
            @fclose($fh);
            @chmod($file, 0600);
            return self::$cached = $fresh;
        }

        // Boshqa jarayon oldin yaratib ulgurgan bo'lsa — unikini olamiz.
        $existing = self::read($file);
        return self::$cached = $existing;
    }

    private static function read(string $file): string
    {
        $v = trim((string) @file_get_contents($file));
        return preg_match('/^[a-f0-9]{64}$/', $v) ? $v : '';
    }
}
