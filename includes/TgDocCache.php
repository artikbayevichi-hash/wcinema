<?php
// ============================================================================
// TgDocCache — Telegram hujjat metama'lumoti uchun disk keshi (bitta manba)
// ============================================================================
//
// NIMA UCHUN UMUMIY FAYL:
//   Bu keshni ikki joy ishlatadi:
//     1) `api/tg-doc.php`  — brauzerga metama'lumot beradi va keshni isitadi;
//     2) `watch.php`       — joriy videoning metama'lumotini HTML ichiga
//                            qo'shadi (brauzer alohida HTTP so'rov yubormasin).
//   Format bitta joyda saqlansa, `sha1` kaliti va versiya hech qachon
//   bir-biridan farq qilib qolmaydi.
//
// MUHIM: bu yerda Telegram'ga murojaat YO'Q — faqat `storage/tg-doc-cache`
// ichidagi tayyor JSON o'qiladi/yoziladi. Video baytlari bu yerdan o'tmaydi.
// ============================================================================

// Kesh formati versiyasi. 2 = `file_reference` va atributlar TO'G'RI o'qiladi
// (1-versiyada `fr` har doim bo'sh qolardi).
if (!defined('TG_DOC_CACHE_VER')) {
    define('TG_DOC_CACHE_VER', 2);
}

// `file_reference` muddati bilan bog'liq. 30 daqiqa: shu vaqt ichida qayta
// ochilgan film/metadata uchun Telegram'ga UMUMAN murojaat bo'lmaydi.
if (!defined('TG_DOC_CACHE_TTL')) {
    define('TG_DOC_CACHE_TTL', 1800);
}

if (!function_exists('tgDocCacheFile')) {
    /**
     * Kesh fayli yo'li. Kalit — kanal (kichik harflar) + post raqami.
     *
     * @return array{0:string,1:string} [papka, fayl]
     */
    function tgDocCacheFile($ch, $post) {
        $dir = dirname(__DIR__) . '/storage/tg-doc-cache';
        return [$dir, $dir . '/' . sha1(strtolower($ch) . '/' . $post) . '.json'];
    }

    /**
     * Keshdan o'qish. Buzilgan/eski formatdagi fayl `null` qaytaradi.
     */
    function tgDocCacheRead($ch, $post) {
        list($dir, $file) = tgDocCacheFile($ch, $post);
        if (!is_file($file)) {
            return null;
        }
        $raw = @file_get_contents($file);
        $j   = $raw ? json_decode($raw, true) : null;
        if (!is_array($j) || empty($j['id']) || empty($j['fr'])
            || (int) ($j['v'] ?? 0) !== TG_DOC_CACHE_VER) {
            return null;
        }
        return $j;
    }

    /**
     * Keshga atomik yozish (temp fayl + rename).
     */
    function tgDocCacheWrite($ch, $post, $out) {
        list($dir, $file) = tgDocCacheFile($ch, $post);
        if (!is_dir($dir)) {
            @mkdir($dir, 0777, true);
        }
        $tmp = $file . '.' . getmypid() . '.tmp';
        if (@file_put_contents($tmp, json_encode($out, JSON_UNESCAPED_UNICODE)) !== false) {
            @rename($tmp, $file);      // atomik almashtirish
            @chmod($file, 0644);
        }
    }
}
