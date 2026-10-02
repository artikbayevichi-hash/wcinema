<?php
// ============================================================================
// API uchun umumiy kirish qatlami
// ============================================================================
// Har bir api/*..php fayli shuni require qiladi. Ichida:
//   $auth     - Auth obyekti
//   $catalog  - Catalog obyekti
//   $user     - joriy foydalanuvchi yoki null
//   input() / inputInt() - so'rov parametrlarini toza olish
//   fail() / ok()  - JSON javob
// ============================================================================

// ---------------------------------------------------------------------------
// API javoblarida PHP ogohlantirishlari JSON ni BUZMASLIGI kerak.
//
// Nima uchun: agar biror joyda (masalan, "Undefined array key") ogohlantirish
// chiqsa va display_errors=1 bo'lsa, ogohlantirish HTML si JSON bodi bilan
// aralashib ketadi - mijoz json_decode qila olmaydi va "items" yo'qoladi.
// Ogohlantirishlar hali ham error_log ga yoziladi, faqat brauzerga
// ko'rsatilmaydi. Sahifalar (reels.php va h.k.) uchun display_errors
// o'z holicha qoladi - ular JSON chiqarmaydi.
//
// DIQQAT: SCRIPT_NAME ba'zi Apache konfiguratsiyalarida bo'sh yoki yo'q
// bo'ladi (URL rewrite, PHP_FORBIDDEN va h.k.). Ishonchli aniqlash uchun
// SCRIPT_FILENAME va REQUEST_URI dan ham tekshiramiz.
$__script = str_replace('\\', '/', (string) ($_SERVER['SCRIPT_FILENAME'] ?? $_SERVER['SCRIPT_NAME'] ?? ''));
$__isApi  = strpos($__script, '/api/') !== false
         || strpos((string) ($_SERVER['REQUEST_URI'] ?? ''), '/api/') !== false;
if ($__isApi) {
    ini_set('display_errors', '0');
}
unset($__script, $__isApi);

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../includes/Database.php';
require_once __DIR__ . '/../includes/TelegramBot.php';
require_once __DIR__ . '/../includes/Auth.php';
require_once __DIR__ . '/../includes/Catalog.php';
require_once __DIR__ . '/../includes/TgPull.php';
require_once __DIR__ . '/../includes/TgResolve.php';
require_once __DIR__ . '/../includes/Reels.php';
require_once __DIR__ . '/../includes/TelegramDelivery.php';

$auth    = new Auth();
$catalog = new Catalog();
$reels   = new Reels();
$user    = $auth->getCurrentUser();
$userId  = $user ? (int) $user['id'] : null;

/**
 * GET/POST parametrni toza olish (trim + uzunlik cheklovi).
 */
function input($key, $default = '', $max = 200) {
    $v = $_GET[$key] ?? $_POST[$key] ?? $default;
    if (is_array($v)) {
        return $default;
    }
    $v = trim((string) $v);
    if (function_exists('mb_substr')) {
        return mb_substr(strip_tags($v), 0, $max);
    }
    return substr(strip_tags($v), 0, $max);
}

function inputInt($key, $default = 0) {
    $v = $_GET[$key] ?? $_POST[$key] ?? $default;
    return is_numeric($v) ? (int) $v : (int) $default;
}

/**
 * "id" yoki "content_id" - qaysi bo'lsa shuni oladi.
 *
 * Nima uchun: API da "content id" ni oladigan endpointlar ikki xil nom
 * ishlatgan (like/view/watchlist -> "id", progress -> "content_id"). Bu
 * chalkashtiradi: chaqiruvchi bitta nomni yuborsa, butunlay jim qoladi
 * va xato "id kerak" deb chiqadi, garchi haqiqiy muammo boshqacha.
 * Shu sababli ikkala nom ham qabul qilinadi.
 */
function contentIdInput() {
    $v = inputInt('id', 0);
    return $v > 0 ? $v : inputInt('content_id', 0);
}

/**
 * php.ini hajmlarini baytga aylantiradi: "40M" -> 41943040.
 *
 * Nima uchun kerak: fayl yuklash chegarasini ikki joyda tekshirish
 * kerak - birinchisi php.ini (server, kodga tegilmagan), ikkinchisi
 * bizning REEL_MAX_UPLOAD_MB (config). Ularni taqqoslash uchun
 * ikkalasini ham baytga o'tkazish kerak. "Noto'g'ri qiymat" qaytib
 * kelsa, 0 qaytaramiz - "min(0, ...)" butun chegarani 0 qilib
 * qo'yadi va har qanday fayl rad etilardi.
 */
function ini_bytes($v) {
    $v = trim((string) $v);
    if ($v === '' || $v === '-1') {
        return 0;
    }
    $unit = strtolower(substr($v, -1));
    $num  = (int) $v;
    switch ($unit) {
        case 'g': return $num * 1024 * 1024 * 1024;
        case 'm': return $num * 1024 * 1024;
        case 'k': return $num * 1024;
        default:  return $num;
    }
}

/**
 * HTML xavfsiz chiqarish uchun yagona nuqta.
 *
 * Nima uchun: sahifalarda sepga chiqarishdan oldin har bir satrni
 * htmlspecialchars dan o'tkazish kerak (XSS). Ba'zi joylarda bu
 * qisqa nom (esc) bilan kutilgan, lekin funksiya aniqlanmagan edi -
 * admin-reels.php "Call to undefined function esc()" bilan falaj
 * bo'lib, butun sahifa tushib qolar edi.
 */
function esc($s) {
    return htmlspecialchars((string) ($s ?? ''), ENT_QUOTES, 'UTF-8');
}

function ok($data = []) {
    Auth::ok($data);
}

function fail($message, $status = 400) {
    Auth::fail($message, $status);
}

/** Ro'yxatdan chiqarishdan oldin foydalanuvchi kerak. */
function requireUser() {
    global $user;
    if (!$user) {
        Auth::fail('Telegram orqali kiring', 401);
    }
    return $user;
}

/** Faqat admin. JSON API uchun (boshqa joyda esa sahifa 403). */
function requireAdmin($json = true) {
    global $auth;
    return $auth->requireAdmin($json);
}
