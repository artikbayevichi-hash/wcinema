<?php
// ============================================================================
// SiteSettings.php - sayt sozlamalari (admin panel → Sozlamalar)
// ============================================================================
// `storage/settings.json` da saqlanadi (web'dan yopiq papka).
// Baza kerak emas — config.php ham buni o'qiy oladi (SITE_NAME uchun).
// ============================================================================

class SiteSettings
{
    /** Standart qiymatlar. */
    private static $defaults = [
        'site_name'    => '',        // bo'sh = config dagi SITE_NAME
        'notice'       => '',        // sayt tepasidagi e'lon (0-300 belgi)
        'notice_link'  => '',        // e'lon havolasi
        'maintenance'  => 0,         // 1 = texnik ish (faqat admin ko'radi)
        'banner_url'   => '',        // ixtiyoriy banner rasm
        // Donat: admin to'ldirgacha tugma o'chiq turmaydi — bot orqali
        // bog'lanish doimo ishlaydi, karta faqat kiritilganda ko'rinadi.
        'donate_card'     => '',     // masalan 8600 1234 5678 9012
        'donate_holder'   => '',     // karta egasi
        'donate_telegram' => '',     // @username (bo'sh = asosiy bot)
    ];

    private static $cache = null;

    public static function path()
    {
        return dirname(__DIR__) . '/storage/settings.json';
    }

    /** Barcha sozlamalar (fayl + standart). */
    public static function all()
    {
        if (self::$cache !== null) {
            return self::$cache;
        }
        $data = self::$defaults;
        $f = self::path();
        if (is_file($f)) {
            $raw = @file_get_contents($f);
            $j = $raw ? json_decode($raw, true) : null;
            if (is_array($j)) {
                foreach (self::$defaults as $k => $v) {
                    if (array_key_exists($k, $j)) {
                        $data[$k] = is_int($v) ? (int) $j[$k] : (string) $j[$k];
                    }
                }
            }
        }
        self::$cache = $data;
        return $data;
    }

    public static function get($key, $default = null)
    {
        $all = self::all();
        return array_key_exists($key, $all) ? $all[$key] : $default;
    }

    /**
     * Qiymatlarni yangilaydi va faylga yozadi.
     * @return array{ok:bool, error?:string, settings?:array}
     */
    public static function set(array $patch)
    {
        $cur = self::all();

        if (array_key_exists('site_name', $patch)) {
            $v = trim(strip_tags((string) $patch['site_name']));
            if (mb_strlen($v) > 60) {
                return ['ok' => false, 'error' => 'Sayt nomi 60 belgidan oshmasin'];
            }
            $cur['site_name'] = $v;
        }
        if (array_key_exists('notice', $patch)) {
            $v = trim(strip_tags((string) $patch['notice']));
            if (mb_strlen($v) > 300) {
                return ['ok' => false, 'error' => 'E’lon 300 belgidan oshmasin'];
            }
            $cur['notice'] = $v;
        }
        if (array_key_exists('notice_link', $patch)) {
            $v = trim((string) $patch['notice_link']);
            if ($v !== '' && !preg_match('#^https?://#i', $v) && $v[0] !== '/') {
                return ['ok' => false, 'error' => 'Havola http(s):// yoki / bilan boshlansin'];
            }
            $cur['notice_link'] = mb_substr($v, 0, 500);
        }
        if (array_key_exists('banner_url', $patch)) {
            $v = trim((string) $patch['banner_url']);
            $cur['banner_url'] = mb_substr($v, 0, 500);
        }
        if (array_key_exists('maintenance', $patch)) {
            $cur['maintenance'] = (int) $patch['maintenance'] === 1 ? 1 : 0;
        }
        if (array_key_exists('donate_card', $patch)) {
            $v = preg_replace('/[^\d]/', '', (string) $patch['donate_card']);
            if ($v !== '' && (mb_strlen($v) < 12 || mb_strlen($v) > 20)) {
                return ['ok' => false, 'error' => 'Karta raqami 12–20 ta raqamdan iborat bo‘lishi kerak'];
            }
            $cur['donate_card'] = mb_substr((string) $v, 0, 20);
        }
        if (array_key_exists('donate_holder', $patch)) {
            $cur['donate_holder'] = mb_substr(trim(strip_tags((string) $patch['donate_holder'])), 0, 80);
        }
        if (array_key_exists('donate_telegram', $patch)) {
            $v = ltrim(trim(strip_tags((string) $patch['donate_telegram'])), '@');
            if ($v !== '' && !preg_match('/^[A-Za-z0-9_]{3,32}$/', $v)) {
                return ['ok' => false, 'error' => 'Telegram username noto‘g‘ri'];
            }
            $cur['donate_telegram'] = $v;
        }

        $f = self::path();
        $dir = dirname($f);
        if (!is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }
        $json = json_encode($cur, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
        if (@file_put_contents($f, $json, LOCK_EX) === false) {
            return ['ok' => false, 'error' => 'Faylga yozib bo‘lmadi (storage/ huquqi)'];
        }
        self::$cache = $cur;
        return ['ok' => true, 'settings' => $cur];
    }
}
