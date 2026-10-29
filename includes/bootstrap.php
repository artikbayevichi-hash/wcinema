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
require_once __DIR__ . '/../includes/ClientSessions.php';
require_once __DIR__ . '/../includes/TelegramBot.php';
require_once __DIR__ . '/../includes/Auth.php';
require_once __DIR__ . '/../includes/Catalog.php';
require_once __DIR__ . '/../includes/TgPull.php';
require_once __DIR__ . '/../includes/TgResolve.php';
require_once __DIR__ . '/../includes/Reels.php';
// Ko'rish sahifasi videolari uchun izohlar mavzulari (reels'dan alohida).
require_once __DIR__ . '/../includes/TgTopics.php';
require_once __DIR__ . '/../includes/TelegramDelivery.php';
// Account Privacy: profil maxfiyligi + bloklangan foydalanuvchilar
require_once __DIR__ . '/../includes/Blocks.php';
require_once __DIR__ . '/../includes/Settings.php';
require_once __DIR__ . '/../includes/Notifications.php';
// Kontent yuklash (Reels / Image Post / Long Video + thumbnail)
require_once __DIR__ . '/../includes/Uploader.php';

$auth    = new Auth();
$catalog = new Catalog();
$reels   = new Reels();
$user    = $auth->getCurrentUser();
$userId  = $user ? (int) $user['id'] : null;

// ---------------------------------------------------------------------------
// TEXNIK ISH REJIMI (admin panel → Sozlamalar)
//
// Yoqilgan bo'lsa oddiy foydalanuvchi saytni ko'rmaydi. Adminlar, admin
// paneli va login sahifasi ishlashda davom etadi (o'chirish uchun yo'l kerak).
// ---------------------------------------------------------------------------
if (!defined('WC_SKIP_MAINTENANCE')) {
    require_once __DIR__ . '/SiteSettings.php';
    if ((int) SiteSettings::get('maintenance', 0) === 1 && !$auth->isAdmin()) {
        $uri = (string) ($_SERVER['REQUEST_URI'] ?? '');
        $isApi = strpos($uri, '/api/') !== false;
        $allow = $isApi
            || strpos($uri, 'admin-login.php') !== false
            || strpos($uri, 'admin-panel.php') !== false
            || strpos($uri, 'admin.php') !== false;

        if (!$allow) {
            http_response_code(503);
            header('Retry-After: 600');
            header('Content-Type: text/html; charset=utf-8');
            echo '<!doctype html><html lang="uz"><head><meta charset="utf-8">'
                . '<meta name="viewport" content="width=device-width,initial-scale=1">'
                . '<title>Texnik ish</title></head>'
                . '<body style="margin:0;min-height:100vh;display:flex;align-items:center;'
                . 'justify-content:center;background:#0f0d15;color:#eae6f2;'
                . 'font:16px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;text-align:center;padding:24px">'
                . '<div><div style="font-size:44px;margin-bottom:10px">🛠</div>'
                . '<h1 style="font-size:22px;margin:0 0 8px">Texnik ish davom etmoqda</h1>'
                . '<p style="color:#9b93ad;margin:0">Tez orada qaytamiz. Sabr qilganingiz uchun rahmat.</p>'
                . '</div></body></html>';
            exit;
        }
    }
}


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
        Auth::fail('Avval tizimga kiring', 401);
    }
    return $user;
}

/**
 * Joriy foydalanuvchi ID'si (0 bo'lsa — aniqlanmadi).
 *
 * Aniqlash tartibi:
 *   1) PHP sessiyasi (`$user`) — login.php / bot-token orqali kirilgan bo'lsa;
 *   2) IMZOLANGAN cookie (`wc_cs`) — brauzerdagi MTProto login paytida
 *      api/client-session.php bergan token. Bazada faqat SHA-256 hash
 *      saqlanadi, shuning uchun cookie'ni qo'lda o'zgartirish befoyda;
 *   3) `tg_me` — FAQAT `TG_TRUST_CLIENT_ID=1` (moslik rejimi) bo'lganda.
 *      Production'da 0 qilinadi: u holda faqat 1 va 2 ishlaydi.
 *
 * XAVFSIZLIK: 3-band o'chirilganda boshqa odamning Telegram ID'sini yozib,
 * uning nomidan ish qilish mumkin emas — token egasi bo'lish kerak.
 */
function clientUserId() {
    global $user, $auth;
    if ($user) {
        return (int) $user['id'];
    }

    // (2) Server bergan imzolangan token (HttpOnly cookie).
    $uid = ClientSessions::currentUserId();
    if ($uid > 0) {
        return $uid;
    }

    // (3) Vaqtinchalik moslik rejimi — o'chirilgan bo'lsa, tamom.
    if (!TG_TRUST_CLIENT_ID) {
        return 0;
    }

    $raw = input('tg_me', '', 2000);
    if ($raw === '' || $raw[0] !== '{') {
        return 0;
    }
    $tg = json_decode($raw, true);
    if (!is_array($tg) || empty($tg['id'])) {
        return 0;
    }
    return (int) $auth->ensureUserFromClient($tg);
}

/**
 * Reels yuklash uchun joriy foydalanuvchi ID'si (0 bo'lsa — aniqlanmadi).
 *
 * `clientUserId()` bilan bir xil; nom tarixiy sabab bilan saqlangan
 * (reels/reel-upload/notifications shu nomni chaqiradi).
 */
function reelUserId() {
    return clientUserId();
}

/** Faqat admin. JSON API uchun (boshqa joyda esa sahifa 403). */
function requireAdmin($json = true) {
    global $auth;
    return $auth->requireAdmin($json);
}
