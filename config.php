<?php
// Konfiguratsiya fayli
// ============================================================================
// DIQQAT: Bu faylni ochiq repo'ga (GitHub va h.k.) yukmang!
// Bot token va DB paroli ichida. Production'da environment variable
// ishlatish uchun quyidagi HAR BIR qiymat o'zgaruvchidan o'qiladi.
// ============================================================================

/**
 * .env faylini yuklash (ixtiyoriy).
 *
 * Nima uchun kerak: Windows'da Apache bir marta ishga tushgandan keyin
 * o'zgaruvchilarni o'z-o'zidan yangilamaydi - yangisini qo'shish uchun
 * Apache'ni to'liq to'xtatib-yurgizish kerak. Bundan tashqari, bot token
 * config.php ichida qolsa, faylni GitHub'ga yukishda oshib ketish ehtimoli
 * bor. .env esa odatda .gitignore'ga qo'shiladi.
 *
 * Qo'llab-quvvatlanadigan format: KEY=VALUE, bir qatorli, '#' bilan
 * izohlanadi, qiymat '"..."' yoki "'...'" ichida bo'lishi mumkin.
 * Bo'sh qatorlar va '#' bilan boshlanuvchi qatorlar e'tiborsiz qoldiriladi.
 */
function load_env_file($path) {
    if (!is_readable($path)) {
        return;
    }
    $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#' || strpos($line, '=') === false) {
            continue;
        }
        list($k, $v) = explode('=', $line, 2);
        $k = trim($k);
        $v = trim($v);
        // "..." yoki '...' ichidagi qiymat
        if (strlen($v) >= 2
            && (($v[0] === '"' && substr($v, -1) === '"')
             || ($v[0] === "'" && substr($v, -1) === "'"))) {
            $v = substr($v, 1, -1);
        }
        if ($k === '') {
            continue;
        }
        // Atrofdagi bo'sh joylarni olib tashlaymiz (vergulli ro'yxat uchun)
        $v = trim($v);
        // .env har so'rovda qayta o'qiladi. Windows/Apache (mod_php) da
        // putenv() tizim env'ini jarayon (worker) uchun saqlab qoladi — keyingi
        // so'rovda eski putenv qiymati getenv() dan qaytadi. Shuning uchun .env
        // qiymatini har safar yangilab yozamiz (putenv + $_ENV) va o'qishda
        // $_ENV (har so'rovda yangilanadi) ustun turadi. .env da BO'LMAGAN
        // kalitlar uchun haqiqiy tizim o'zgaruvchisi ishlatiladi.
        putenv($k . '=' . $v);
        $_ENV[$k] = $v;
    }
}
load_env_file(__DIR__ . '/.env');

/**
 * Environment variable'ni o'qish, yo'q bo'lsa standart qiymatni qaytarish.
 * Manba tartibi: haqiqiy tizim o'zgaruvchisi -> .env -> standart qiymat.
 */
function env_value($key, $default = null) {
    // $_ENV har so'rovda .env dan yangilanadi — birinchi navbatda shundan
    // o'qiymiz (getenv() eski putenv qiymatini saqlab qolishi mumkin).
    if (isset($_ENV[$key]) && $_ENV[$key] !== '') {
        return $_ENV[$key];
    }
    $value = getenv($key);
    if ($value === false || $value === '') {
        $value = isset($_ENV[$key]) ? $_ENV[$key] : false;
    }
    return ($value === false || $value === '') ? $default : $value;
}

/**
 * So'rov kelgan domeninga ruxsat berilganini tekshiradi.
 * "*.example.com" kabi jokerlar qo'llab-quvvatlanadi.
 * Bu demo-login va SITE_URL avtomatik aniqlash uchun himoya: aks holda
 * hujjumchi Host header'ni o'zgartirib boshqaning o'rnidagi havolalar
 * generatsiya qila olardi (phishing).
 */
function host_matches($host, $patterns) {
    $host = strtolower(trim((string) $host));
    if ($host === '') {
        return false;
    }
    // port'ni olib tashlaymiz
    if (strpos($host, ']') !== false) {           // IPv6
        $host = substr($host, 0, strpos($host, ']') + 1);
    } elseif (strpos($host, ':') !== false) {
        $host = substr($host, 0, strpos($host, ':'));
    }

    foreach (explode(',', $patterns) as $pattern) {
        $pattern = strtolower(trim($pattern));
        if ($pattern === '') {
            continue;
        }
        if ($pattern === $host) {
            return true;
        }
        if (strpos($pattern, '*.') === 0) {
            $suffix = substr($pattern, 1);          // ".example.com"
            if (substr($host, -strlen($suffix)) === $suffix) {
                return true;
            }
        }
    }
    return false;
}

/**
 * Manzil mahalliy mi (localhost / 127.0.0.1 / ::1)?
 *
 * Host header'da IPv6 bracketli keladi: "[::1]:8080". host_matches()
 * portni olib tashlab "[::1]" qoldiradi, shuning uchun "[::1]" shaklida
 * yozamiz.
 */
function is_local_host($host) {
    return host_matches($host, 'localhost,127.0.0.1,::1,[::1],dodge-fibre-viruses-gathered.trycloudflare.com,*.ngrok.io');
}

/**
 * So'rovning tashqi manzilini (https://host/path) aniqlaydi.
 *
 * MUHIM: Bu tunnel (ngrok/cloudflared) orqali ishlash uchun kerak, chunki
 * tunnel URL'i har qayta ishga tushganda o'zgaradi. SITE_URL environment
 * variable'da berilgan bo'lsa u har doim ustunlik qiladi.
 *
 * Xavfsizlik: ruxsat etilgan domenslar ro'yxatidan o'tmagan so'rovlarda
 * localhost'ga qaytadi (fetch_site_url()).
 */
function detect_site_url() {
    $host = $_SERVER['HTTP_HOST'] ?? '';
    if ($host === '') {
        $host = ($_SERVER['SERVER_NAME'] ?? '') . (
            ($_SERVER['SERVER_PORT'] ?? '80') !== '80' ? ':' . $_SERVER['SERVER_PORT'] : ''
        );
    }

    if (!host_matches($host, ALLOWED_HOSTS)) {
        return rtrim(SITE_URL_FALLBACK, '/');
    }

    // Sxema: reverse proxy (cloudflared/ngrok) X-Forwarded-Proto yuboradi
    $https  = !empty($_SERVER['HTTPS']) && strtolower($_SERVER['HTTPS']) !== 'off';
    $scheme = $https ? 'https' : 'http';

    if (isset($_SERVER['HTTP_X_FORWARDED_PROTO'])) {
        $fwd = strtolower(trim(explode(',', $_SERVER['HTTP_X_FORWARDED_PROTO'])[0]));
        if ($fwd === 'https' || $fwd === 'http') {
            $scheme = $fwd;
        }
    }

    // Ilova sub-katalogda bo'lishi mumkin (masalan /tele_uzdub). URL yo'lini
    // topish uchun ilova ILDIZINI (__DIR__, ya'ni config.php joylashgan
    // papka) Apache DOCUMENT_ROOT bilan solishtiramiz.
    //
    // MUHIM: joriy skript papkasini emas, ILOVA papkasini solishtirish
    // kerak. Aks holda api/video.php kabi skriptlar uchun $subPath
    // "/tele_uzdub/api" bo'lib, URL'lar "api/api/stream.php" ko'rinishida
    // buziladi.
    $subPath = '';
    $docRoot = isset($_SERVER['DOCUMENT_ROOT']) ? realpath($_SERVER['DOCUMENT_ROOT']) : false;
    $appRoot = realpath(__DIR__);

    if ($docRoot && $appRoot) {
        $docRoot = str_replace('\\', '/', $docRoot);
        $appRoot = str_replace('\\', '/', $appRoot);
        if (strpos($appRoot, $docRoot) === 0) {
            $subPath = rtrim(substr($appRoot, strlen($docRoot)), '/');
        }
    }

    return $scheme . '://' . $host . $subPath;
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------
// DIQQAT: "uzdub" bazasida kino-platforma sxemasi mavjud:
//   users, categories (Kino/Anime/Multfilm), genres, content, episodes,
//   likes, watch_progress, watchlist, user_sessions, notifications
// Kod shu sxemaga moslashtirilgan. Eski sodda sxema ("uzdub_telegram" -
// videos/sessions/shares) endi ishlatilmaydi.
define('DB_HOST', env_value('DB_HOST', 'localhost'));
define('DB_NAME', env_value('DB_NAME', 'uzdub'));
define('DB_USER', env_value('DB_USER', 'root'));
define('DB_PASS', env_value('DB_PASS', ''));

// ---------------------------------------------------------------------------
// Telegram Bot
// ---------------------------------------------------------------------------
// Token .env faylida saqlanadi (config.php ni GitHub'ga yuklash xavfsiz
// bo'lishi uchun). .env yo'q bo'lsa quyidagi qiymat ishlatiladi.
define('TELEGRAM_BOT_TOKEN', env_value('TELEGRAM_BOT_TOKEN', ''));
define('TELEGRAM_BOT_USERNAME', env_value('TELEGRAM_BOT_USERNAME', 'w_cinema_uz_bot'));

// MTProto pull (Telegram'dan video nusxalash) uchun: my.telegram.org dan
// olinadi. Bo'sh bo'lsa admin paneldagi "Telegram'dan yuklab olish" tugmasi
// ishlamaydi (xatolik aniq ko'rsatiladi).
define('TG_API_ID',   (int) env_value('API_ID', ''));
define('TG_API_HASH', env_value('API_HASH', ''));

// Pull ishchi jarayoni ishlaydigan CLI PHP manzili.
// Apache (mod_php) ostida PHP_BINARY httpd.exe ni qaytaradi — shuning uchun
// aniq yo'l beriladi. PHP boshqa joyda bo'lsa, .env da PHP_CLI_BIN yozing.
define('PHP_CLI_BIN', env_value('PHP_CLI_BIN', 'C:\\xampp\\php\\php.exe'));

// initData yoshi (sekund). 1 kun.
define('TELEGRAM_AUTH_MAX_AGE', 86400);

// Faqat localhost'da demo kirish. Production'da false qiling!
//
// DIQQAT: '1'/'0' satrlar bo'lishi mumkin (PHP'da (bool)'0' === true - bu
// xato bo'lardi). Shuning uchun aniq "ha/yo'q" ni tekshiramiz.
$_demo = strtolower(trim((string) env_value('ALLOW_DEMO_LOGIN', '1')));
define('ALLOW_DEMO_LOGIN', in_array($_demo, ['1', 'true', 'yes', 'on'], true));

// ---------------------------------------------------------------------------
// Sayt
// ---------------------------------------------------------------------------
// ESDA: papka nomi "tele_uzdub" (taglik bilan) - bo'shliq emas!

// Ruxsat etilgan domenslar (vergul bilan). SITE_URL ni avtomatik aniqlash
// va demo-login faqat shu domenslarda ishlaydi.
// Tunnel qo'shilsa: ngrok-free.app, ngrok-free.dev, ngrok.app, trycloudflare.com
define('ALLOWED_HOSTS', env_value(
    'ALLOWED_HOSTS',
    'localhost,127.0.0.1,::1,192.168.1.4,'   // 192.168.1.4 = LAN/IP (uydagi tarmoq, to'liq tezlik)
    . '*.ngrok-free.app,*.ngrok-free.dev,*.ngrok.app,*.ngrok.io,'
    . '*.trycloudflare.com,*.trycloudflare.dev,'
    . 'dodge-fibre-viruses-gathered.trycloudflare.com,'
    . '*.ngrok.io'
));

// Ruxsat etilmagan so'rovlarda shu manzil ishlatiladi
define('SITE_URL_FALLBACK', env_value('SITE_URL_FALLBACK', 'http://localhost/tele_uzdub'));

// SITE_URL: environment variable berilgan bo'lsa u qat'iy ustun. Berilmasa
// so'rovdan avtomatik aniqlanadi - shunda ngrok/cloudflared tunnel URL'i
// har restartda o'zgarsada config.php'ni tahrirlash shart bo'lmaydi.
define('SITE_URL', rtrim(env_value('SITE_URL', '') ?: detect_site_url(), '/'));
define('SITE_NAME', 'W CINEMA');
define('MINI_APP_URL', SITE_URL . '/login.php');

// ---------------------------------------------------------------------------
// HLS oqim (Cloudflare edge-kesh) — filmlar uchun "nol VPS trafigi" rejimi
// ---------------------------------------------------------------------------
// HLS_ENABLED=1 (.env):  filmlar HLS segmentlarga bo'linadi. Har bir segment
//   deterministik URL'da, Cloudflare (domen + CF DNS orqali) ularni edge'da
//   keshlaydi — tomoshabinlar videoni CF edge'dan oladi, VPS trafigi minimal.
// HLS_ENABLED=0 (std):    eski jonli relay (api/live.php) ishlayveradi.
// Talab: serverda ffmpeg o'rnatilgan bo'lishi (Linux VPS: apt install ffmpeg).
define('HLS_ENABLED', in_array(
    strtolower(trim((string) env_value('HLS_ENABLED', '0'))),
    ['1', 'true', 'yes', 'on'],
    true
));
define('FFMPEG_BIN',  trim((string) env_value('FFMPEG_BIN', 'ffmpeg')));   // ffmpeg binar manzili
define('HLS_SEG_SEC', max(2, (int) env_value('HLS_SEG_SEC', '10')));         // segment uzunligi (soniya)
define('HLS_CACHE_DIR', __DIR__ . '/storage/hls_cache');                        // HLS keshi (web'dan yopiq)
define('HLS_MAX_MB',   max(256, (int) env_value('HLS_MAX_MB', '15000')));    // HLS disk kvotasi (MB)
define('HLS_TTL',      max(3600, (int) env_value('HLS_TTL', '21600')));      // HLS faolsizlik TTL (soniya)

// ---------------------------------------------------------------------------
// Fayl yuklash
// ---------------------------------------------------------------------------
define('UPLOAD_DIR', __DIR__ . '/uploads/');
define('MAX_FILE_SIZE', 100 * 1024 * 1024); // 100 MB
define('ALLOWED_VIDEO_TYPES', [
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'video/x-matroska',
    'video/mpeg',
]);

// ---------------------------------------------------------------------------
// 4-QADAM: Videoni foydalanuvchining Telegram chat'iga yuborish
// ---------------------------------------------------------------------------
// Bu BEpul va xavfsiz: bot foydalanuvchiga xabar yuboradi, fayl Telegram'da qoladi.
define('TELEGRAM_DELIVERY_ENABLED', (bool) env_value('TELEGRAM_DELIVERY_ENABLED', '1'));

// Bot foydalanuvchiga birinchi marta xabar yuborishi uchun user
// @botga /start bosishi shart. Aks holda Telegram "bot can't initiate
// conversation" (403) qaytaradi.
define('TELEGRAM_REQUIRE_START', (bool) env_value('TELEGRAM_REQUIRE_START', '1'));

// Bot API'ga fayl YUKLAB yuborish limiti
define('TELEGRAM_MAX_UPLOAD', 50 * 1024 * 1024); // 50 MB

// ---------------------------------------------------------------------------
// Katalog (content / episodes)
// ---------------------------------------------------------------------------
// Bir sahifada nechta ko'rsatiladi
define('CATALOG_PAGE_SIZE', 24);

// Boshlang'ich ekranda ko'rsatiladigan film/qismlar soni
define('CATALOG_HOME_LIMIT', 12);

// Faqat mashhur (views bo'yicha) kontentni oldinga o'tkazish
define('TRENDING_MIN_VIEWS', 1);

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------
define('SESSION_TTL_DAYS', 30);

// ---------------------------------------------------------------------------
// Reels - qisqa vertikal videolar
// ---------------------------------------------------------------------------
// Reels ikki turda bo'ladi:
//   'upload' - foydalanuvchi MP4 fayl YUKLAYDI (uploads/reels/ga)
//   'clip'   - mavjud film/qismdan bir JUDA qisqa bo'lak ("virtual reel").
//               Fayl nusxalanmaydi - faqat content_id/episode_id + start/end
//               saqlanadi. Shu sabab qo'shimcha xotira va trafik sarflanmaydi.
//
define('REEL_MAX_UPLOAD_MB', (int) env_value('REEL_MAX_UPLOAD_MB', '50'));
define('REEL_MAX_LENGTH',     (int) env_value('REEL_MAX_LENGTH', '90'));   // soniya
define('REEL_MIN_LENGTH',     (int) env_value('REEL_MIN_LENGTH', '3'));    // soniya
define('REEL_PAGE_SIZE',      (int) env_value('REEL_PAGE_SIZE', '10'));
define('REELS_DIR',           UPLOAD_DIR . 'reels');

// Kontent (film/qism) video fayllari. Reels'da maks 50 MB, kino uchun
// ko'proq ruxsat beramiz (php.ini chegarasi 256M bilan o'lchanadi).
define('CONTENT_MAX_UPLOAD_MB', (int) env_value('CONTENT_MAX_UPLOAD_MB', '200'));
define('VIDEOS_DIR',            UPLOAD_DIR . 'videos');
define('POSTERS_DIR',           UPLOAD_DIR . 'posters');

/**
 * HAQIQIY yuklash chegarasi (MB).
 *
 * Nima uchun alohida: REEL_MAX_UPLOAD_MB - bizning xohishimiz, lekin
 * server (php.ini) ham chegarani belgilaydi va odatda undan kichik
 * bo'ladi (XAMPP standarti 40M). Agar biz 50 MB deb yozsak, lekin
 * server 40 MB qabul qilsa, foydalanuvchi 45 MB fayl tanlaganda
 * server uni butunlay TIQIB tashlaydi va foydalanuvchi "Fayl tanlanmagan"
 * degan chalkash xatoni ko'radi.
 *
 * Shu sabab haqiqiy chegakichisi olinadi va brauzerga shu qiymat
 * beriladi - fayl serverga yuborilishidan OLDIN tekshiriladi.
 */
function _ini_to_bytes($v) {
    $v = trim((string) $v);
    if ($v === '' || $v === '-1') {
        return 0;
    }
    $num  = (int) $v;
    $unit = strtolower(substr($v, -1));
    if ($unit === 'g') return $num * 1024 * 1024 * 1024;
    if ($unit === 'm') return $num * 1024 * 1024;
    if ($unit === 'k') return $num * 1024;
    return $num;
}
$_srvMax = min(
    _ini_to_bytes(ini_get('upload_max_filesize')),
    _ini_to_bytes(ini_get('post_max_size'))
);
if ($_srvMax <= 0) {
    $_srvMax = REEL_MAX_UPLOAD_MB * 1024 * 1024;   // php.ini cheksiz bo'lsa
}
define('REEL_EFFECTIVE_MAX_UPLOAD_MB',
    (int) max(1, min(REEL_MAX_UPLOAD_MB, (int) round($_srvMax / 1048576))));

// Moderatsiya: yangi reel avtomatik "kutilmoqda" (status 0).
// Faqat admin tasdiqlagandan keyin (status 1) oqimda ko'rinadi.
//
// DIQQAT: (bool)'0' === true - ya'ni .env da "0" yozilsa ham moderatsiya
// yoqilib ketmasdi. Shuning uchun satrni aniq tekshiramiz.
$_reqAppr = strtolower(trim((string) env_value('REELS_REQUIRE_APPROVAL', '1')));
define('REELS_REQUIRE_APPROVAL', in_array($_reqAppr, ['1', 'true', 'yes', 'on'], true));

// ---------------------------------------------------------------------------
// Adminlar
// ---------------------------------------------------------------------------
// Telegram ID bo'yicha aniq ro'yxat, vergul bilan ajratilgan:
//   ADMIN_TELEGRAM_IDS="123456789,987654321"
//
// Nima uchun premium foydalanuvchisi emas: "premium" - to'lov qilgan
// mijoz ma'nosi, "admin" esa boshqaruv huquqi. Ularni aralashtirilsa,
// pul to'lagan oddiy foydalanuvchi ham moderatsiya paneliga kirib,
// o'zgalar reel'ini tasdiqlab, kontentni o'zgartirishi mumkin bo'ladi.
define('ADMIN_TELEGRAM_IDS', array_values(array_filter(array_map(
    'trim',
    explode(',', (string) env_value('ADMIN_TELEGRAM_IDS', ''))
))));

// Admin panel uchun KALIT (parol). Sayt MTProto orqali ishlab, serverda PHP
// sessiya bo'lmaganda admin panelga kirishning yagona ishonchli yo'li.
// .env ga yoziladi:  ADMIN_PANEL_KEY="uzun-tasodifiy-satr"
// Bo'sh bo'lsa — kalit bilan kirish o'chirilgan bo'ladi (faqat Telegram ID
// bo'yicha adminlar ishlaydi).
define('ADMIN_PANEL_KEY', trim((string) env_value('ADMIN_PANEL_KEY', '')));

// ---------------------------------------------------------------------------
// 5-QADAM: Videoni saytda oynatish
// ---------------------------------------------------------------------------
// Bazadagi videolar TASHQI manbalarda saqlanadi va turli xil:
//   'direct' - to'g'ridan-to'g'ri .mp4/.webm  -> <video src="..."> ishlaydi
//   'embed'  - vk / rutube / mover / kino websitesi sahifasi -> <iframe>
//   'file'   - bizning serverimizda (uploads/) -> <video src="api/stream.php">
//
// AUTO rejimi manzildan avtomatik aniqlaydi (Catalog::playbackType()).
define('VIDEO_PLAYBACK_MODE', env_value('VIDEO_PLAYBACK_MODE', 'auto'));

// Embed manbalari. Xavfsizlik: faqat shu domenlar <iframe> ichida
// yuklanadi, aks holda "clickjacking" (kontentni o'zgartirib yuborish)
// xavfi paydo bo'ladi.
// Embed manbalari. Xavfsizlik: faqat shu domenlar <iframe> ichida
// yuklanadi, aks holda "clickjacking" (kontentni o'zgartirib yuborish)
// xavfi paydo bo'ladi.
//
// DIQQAT: ro'yxat bazadagi REAL manbalarga asoslangan (325 ta manzildan
// olingan). Boshqa domen qo'shilganda avval uning embed sahifasi 200
// qaytarishini va X-Frame-Options bermasligini tekshirib bo'ling.
define('ALLOWED_EMBED_HOSTS', env_value(
    'ALLOWED_EMBED_HOSTS',
    // 221 ta manba - eng ko'p ishlatiladigan manba
    'uqload.is,'
    // 93 ta manba
    . 'video.sibnet.ru,sibnet.ru,'
    // 28 ta manba
    . 'mover.uz,v.mover.uz,'
    // 6 ta manba
    . 'vkvideo.ru,vk.com,'
    // 4 ta manba
    . 'fsst.online,'
    // 2 ta manba
    . 'rutube.ru,'
    // 1 ta manba
    . 'faylmovi.ru,'
    // qo'shimcha
    . 'ok.ru,my.mail.ru,youtube.com,youtu.be,kodikbd.com'
));

// ESDA: videoni server orqali proksi qilish (api/proxy-video.php) qismi
// O'CHIRILDI. Sababi: u noto'g'ri taxminga asoslangan edi.
// "Hotlink" himoyasi bor manba degan gumon qilingan, lekin tekshirilganda
// ma'lum bo'ldiki ki video.sibnet.ru/v/<hash>/<id>.mp4 havolalari 403
// qaytarish o'rniga 200 + BO'SH HTML sahifa qaytaradi - ya'ni ular
// o'lik (baza egasi xatosi), "hotlink" himoyasi emas. Referer berilsa ham
// 0 bayt bo'sh javob keladi, ya'ni proksi hech narsani tuzatmasdi, faqat
// serveringizga SSRF hujjumi uchun qo'shimcha sirt qo'shardi.
// Endi bu manbalar Catalog::playbackFromUrl() da bevosita
// shell.php?videoid=<id> sahifasiga o'tkaziladi (iframe bilan ishlaydi).

// Serverimiz orqali oqitish (Range/206) - faqat 'file' turidagi
// videolar uchun. uploads/ papkasidan.
define('STREAM_CHUNK_FREE', true);

// ---------------------------------------------------------------------------
// Session va xato
// ---------------------------------------------------------------------------
// Session sozlamalari faqat output boshlanmasidan OLDIN o'zgartirilishi mumkin
if (!headers_sent()) {
    ini_set('session.use_only_cookies', 1);
    ini_set('session.use_strict_mode', 1);
    ini_set('session.cookie_httponly', 1);
    ini_set('session.cookie_samesite', 'Lax');

    // HTTPS orqali (tunnel yoki production) kirganda Secure flag qo'yiladi.
    // DIQQAT: faqat SITE_URL ga qarab qo'yilsa, sayt lokal HTTP orqali
    // ochilganda cookie umuman saqlanmaydi (brauzer Secure cookie'ni HTTP
    // da yubormaydi) va barcha PHP sessiyalari (admin kaliti ham) ishlamaydi.
    // Shuning uchun AVVAL joriy so'rov sxemasiga qaraymiz.
    $__https = (!empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off')
        || (strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https')
        || ((string) ($_SERVER['SERVER_PORT'] ?? '') === '443')
        || (substr(SITE_URL, 0, 8) === 'https://'
            && !in_array(strtolower((string) ($_SERVER['HTTP_HOST'] ?? '')), ['localhost', '127.0.0.1'], true)
            && strpos((string) ($_SERVER['HTTP_HOST'] ?? ''), 'localhost:') !== 0
            && strpos((string) ($_SERVER['HTTP_HOST'] ?? ''), '127.0.0.1:') !== 0);
    if ($__https) {
        ini_set('session.cookie_secure', 1);
    } else {
        ini_set('session.cookie_secure', 0);
    }
    unset($__https);

    if (session_status() === PHP_SESSION_NONE) {
        session_start();
    }
}

// Production'da 0 qiling
// DIQQAT: (bool)'0' === true - ya'ni '0' yozilsa ham xato bo'lib,
// xatolar foydalanuvchiga ko'rinib turadi. Shuning uchun satrni
// aniq "ha/yo'q" ga aylantiramiz.
$_dbg = strtolower(trim((string) env_value('APP_DEBUG', '1')));
define('APP_DEBUG', in_array($_dbg, ['1', 'true', 'yes', 'on'], true));

if (APP_DEBUG) {
    error_reporting(E_ALL);
    ini_set('display_errors', 1);
} else {
    error_reporting(0);
    ini_set('display_errors', 0);
}

date_default_timezone_set(env_value('APP_TIMEZONE', 'Asia/Tashkent'));
