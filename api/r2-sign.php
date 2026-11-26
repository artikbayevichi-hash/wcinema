<?php
// ============================================================================
// api/r2-sign.php — R2 prefiks keshi uchun ruxsatnoma (imzo)
// ----------------------------------------------------------------------------
// Cloudflare R2 dagi prefikslarni o'qish OCHIQ (maxfiy ma'lumot emas —
// bu videoning birinchi 5 MB i). Yozish (PUT) esa IMZO talab qiladi:
// imzoni faqat shu endpoint beradi, shuning uchun bucket'ga begona odam
// hech narsa yozolmaydi.
//
// So'rovlar:
//   GET ?info=1            -> { success, enabled, base, prefix, put, ttl }
//                             (5 daqiqa keshlanadi; SW bir marta so'raydi)
//   GET ?doc=<id>          -> { success, enabled, put:"<imzolangan URL>", exp }
//                             (imzo 15 daqiqa amal qiladi, javob keshlanmaydi)
//   GET ?stats=1&key=...   -> admin uchun holat hisoboti
//
// .env sozlamalari:
//   R2_ENABLED=1
//   R2_WORKER_URL=https://wc-prefix.<account>.workers.dev   (PUT uchun SHART)
//   R2_PUBLIC_BASE=https://cdn-r2.saytingiz.uz              (ixtiyoriy, tezroq)
//   R2_SIGN_SECRET=<uzun tasodifiy satr>                    (Worker bilan bir xil)
//   R2_PREFIX_BYTES=4194304                                 (4 MB)
//   R2_PUT_AUTH=1                                           (yozish uchun login)
//   R2_IP_DAY=20        R2_GLOBAL_DAY=2000                  (kunlik limitlar)
//
// XAVFSIZLIK: imzo faqat "PUT\n/p/<doc>\n<exp>" matniga beriladi. Ya'ni
// imzolangan URL bilan boshqa obyektga yozib bo'lmaydi.
// ============================================================================

require_once __DIR__ . '/../includes/bootstrap.php';
require_once __DIR__ . '/../includes/ServerTiming.php';
require_once __DIR__ . '/../includes/PrefixStore.php';
require_once __DIR__ . '/../includes/PrefixSecret.php';
ServerTiming::init('wc-r2', 'r2 info resolve');

// ------------------------------------------------------------------ sozlama
function r2_env($key, $default = '')
{
    $v = env_value($key, $default);
    return $v === null ? $default : trim((string) $v);
}

$r2Worker   = rtrim(r2_env('R2_WORKER_URL'), '/');
$r2Public   = rtrim(r2_env('R2_PUBLIC_BASE'), '/');
$r2Secret   = r2_env('R2_SIGN_SECRET');
$r2Enabled  = filter_var(r2_env('R2_ENABLED', '0'), FILTER_VALIDATE_BOOLEAN);
$r2Prefix   = (int) r2_env('R2_PREFIX_BYTES', '4194304');
$r2PutAuth  = filter_var(r2_env('R2_PUT_AUTH', '1'), FILTER_VALIDATE_BOOLEAN);
$r2IpDay    = max(1, (int) r2_env('R2_IP_DAY', '20'));
$r2AllDay   = max(1, (int) r2_env('R2_GLOBAL_DAY', '2000'));

$r2Prefix  = max(1024 * 1024, min(8 * 1024 * 1024, $r2Prefix));
$r2Prefix -= $r2Prefix % 4096;              // Telegram blok tekisligi

// ------------------------------------------------- MAHALLIY PREFIKS (R2'siz)
// R2 sozlanmagan bo'lsa ham prefiks ishlashi kerak: fayllar serverning o'zida
// (`storage/prefix/`) saqlanadi (cli/prefix-build.php yozadi). SW uchun shartnoma
// bir xil — `base` + `prefix` (+ `tail` va `docs`), faqat manzil boshqa.
$pxEnabled = filter_var(r2_env('PREFIX_LOCAL', '1'), FILTER_VALIDATE_BOOLEAN);
$pxHead    = (int) r2_env('PREFIX_HEAD_BYTES', '4194304');
$pxTail    = (int) r2_env('PREFIX_TAIL_BYTES', (string) (6 * 1024 * 1024));
$pxTtl     = max(600, (int) r2_env('PREFIX_TTL', '43200'));   // 12 soat
$pxHead    = max(0, min(64 * 1024 * 1024, $pxHead));
$pxTail    = max(0, min(64 * 1024 * 1024, $pxTail));
$pxHead   -= $pxHead % 4096;
$pxTail   -= $pxTail % 4096;

// ADMIN_PANEL_KEY admin cookie'larini imzolaydi — ochiq `info=1` javobidagi
// HMAC orqali uni tiklash mumkin edi. Alohida kalit ishlatamiz.
$pxSecret = PrefixSecret::get();

/** storage/prefix/manifest.json — muddati tugaganlar ko'rsatilmaydi. */
function px_manifest()
{
    return PrefixStore::visible();
}

/** Joriy so'rovning o'z manzili (SW same-origin fetch qilishi uchun). */
function px_self_dir()
{
    // Proksi (tunnel/nginx) orqasida `HTTPS` bo'sh bo'lishi mumkin, lekin
    // sahifa https bo'lsa SW ham https so'rashi SHART (aks holda aralash
    // kontent bloklanadi). Shuning uchun yo'naltirilgan sarlavhalarni ham
    // hisobga olamiz.
    $proto = strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? ''));
    $https = (!empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off')
        || $proto === 'https'
        || (string) ($_SERVER['SERVER_PORT'] ?? '') === '443';
    $scheme = $https ? 'https' : 'http';
    $host = (string) ($_SERVER['HTTP_HOST'] ?? 'localhost');
    $dir  = str_replace('\\', '/', (string) dirname((string) ($_SERVER['SCRIPT_NAME'] ?? '/api/x.php')));
    return $scheme . '://' . $host . rtrim($dir, '/');
}

/** Mahalliy prefiks yozish URL'i: faqat doc+size+part+exp uchun imzolanadi. */
function px_put_url($doc, $size, $part, $exp, $secret, $self)
{
    $plain = "PUTPX\n" . $doc . "\n" . $size . "\n" . $part . "\n" . $exp;
    $sig = hash_hmac('sha256', $plain, $secret);
    return $self . '/prefix-save.php?doc=' . rawurlencode((string) $doc)
        . '&size=' . (int) $size . '&part=' . rawurlencode($part)
        . '&exp=' . (int) $exp . '&sig=' . $sig;
}

// O'qish uchun baza: custom domain bo'lsa — u (Workers limitini tejaydi),
// aks holda Worker'ning o'zi. O'qish (GET) uchun imzo SHART EMAS — prefiks
// ochiq obyekt; imzo faqat yozish (PUT) uchun kerak. Shu sababli oldindan
// yuklangan prefikslar faqat R2_PUBLIC_BASE bilan ham ishlaydi.
$r2ReadBase = $r2Public !== '' ? $r2Public : $r2Worker;
$r2Read  = $r2Enabled && $r2ReadBase !== '';
$r2Write = $r2Read && $r2Worker !== '' && $r2Secret !== '';

/** Imzo: HMAC-SHA256(secret, "PUT\n/p/<doc>\n<exp>") — Worker bilan bir xil. */
function r2_sign($secret, $doc, $exp)
{
    return hash_hmac('sha256', "PUT\n/p/" . $doc . "\n" . $exp, $secret);
}

/**
 * Kunlik hisoblagich (fayl + flock). Limitdan oshsa `false`.
 * Kalit fayl nomi — IP hash'i, shuning uchun fayllar orasida IP ko'rinmaydi.
 */
function r2_bump($file, $limit)
{
    $dir = dirname(__DIR__) . '/storage/cache';
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }
    if (!is_dir($dir) || !is_writable($dir)) {
        return true;                         // yozib bo'lmasa — bloklamaymiz
    }
    $path = $dir . '/' . $file;
    $fp = @fopen($path, 'c+');
    if (!$fp) {
        return true;
    }
    $ok = true;
    if (@flock($fp, LOCK_EX)) {
        $raw = stream_get_contents($fp);
        $st  = json_decode((string) $raw, true);
        if (!is_array($st)) {
            $st = ['n' => 0, 't' => time()];
        }
        if (time() - (int) ($st['t'] ?? 0) > 86400) {
            $st = ['n' => 0, 't' => time()];
        }
        if ((int) ($st['n'] ?? 0) >= $limit) {
            $ok = false;
        } else {
            $st['n'] = (int) ($st['n'] ?? 0) + 1;
            $st['t'] = (int) ($st['t'] ?? time());
            ftruncate($fp, 0);
            rewind($fp);
            fwrite($fp, json_encode($st));
            fflush($fp);
        }
        @flock($fp, LOCK_UN);
    }
    fclose($fp);
    return $ok;
}

$method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
if ($method !== 'GET') {
    fail('Faqat GET', 405);
}

// ------------------------------------------------------------------ ADMIN
if (isset($_GET['stats'])) {
    $key    = (string) ($_GET['key'] ?? '');
    $secret = defined('ADMIN_PANEL_KEY') ? (string) ADMIN_PANEL_KEY : (string) env_value('ADMIN_PANEL_KEY', '');
    if ($secret === '' || !hash_equals($secret, $key)) {
        fail('Ruxsat yo\'q', 403);
    }
    $cacheDir = dirname(__DIR__) . '/storage/cache';
    $ipFiles  = glob($cacheDir . '/r2ip-*.json') ?: [];
    $allFiles = glob($cacheDir . '/r2all-*.json') ?: [];
    $sum = 0;
    foreach ($allFiles as $f) {
        $j = json_decode((string) @file_get_contents($f), true);
        $sum += (int) ($j['n'] ?? 0);
    }
    ok([
        'enabled'       => $r2Read,
        'write'         => $r2Write,
        'read_base'     => $r2ReadBase,
        'write_base'    => $r2Worker,
        'prefix_bytes'  => $r2Prefix,
        'put_auth'      => $r2PutAuth,
        'ip_day_limit'  => $r2IpDay,
        'all_day_limit' => $r2AllDay,
        'uploads_today' => $sum,
        'ip_files'      => count($ipFiles),
    ]);
}

// ------------------------------------------------------------------- INFO
if (isset($_GET['info'])) {
    header('Cache-Control: public, max-age=300');

    // ---- MAHALLIY PREFIKS: R2 yo'q bo'lsa ham birinchi kadr tez bo'lsin ----
    //
    // `docs` xaritasi muhim: SW hujjat prefiksi BORLIGINI darhol biladi va
    // yo'q hujjat uchun 404 so'rovini yubormaydi (birinchi bayt yo'lida
    // ortiqcha RTT bo'lmasin).
    if (!$r2Read && $pxEnabled && $pxSecret !== '') {
        $localDocs = [];
        foreach (px_manifest() as $d => $e) {
            $d = preg_replace('/[^0-9]/', '', (string) $d);
            if ($d === '' || !is_array($e)) {
                continue;
            }
            $sz = (int) ($e['size'] ?? 0);
            $hs = (int) ($e['head'] ?? 0);
            $ts = (int) ($e['tail'] ?? 0);
            if ($sz <= 0 || $hs <= 0) {
                continue;
            }
            $localDocs[$d] = [
                'head' => min($hs, $pxHead > 0 ? $pxHead : $hs),
                'tail' => $ts,
                'size' => $sz,
            ];
            if (count($localDocs) >= 500) {
                break;
            }
        }
        if ($localDocs) {
            $exp = time() + $pxTtl;
            $sig = hash_hmac('sha256', "PREFIX\n" . $exp, $pxSecret);
            ok([
                'enabled' => true,
                'base'    => px_self_dir() . '/prefix.php?doc={doc}&exp=' . $exp . '&sig=' . $sig,
                'prefix'  => $pxHead,
                'tail'    => $pxTail,
                'docs'    => $localDocs,
                'local'   => true,
                // Birinchi tomoshabin bosh/dum oynalarini mahalliy keshga
                // yozishi mumkin (imzosi ?doc=... dan olinadi). Bu R2 emas,
                // lekin SW uchun shartnoma bir xil.
                'put'     => true,
                'ttl'     => $pxTtl,
                'min'     => 4096,
            ]);
        }
    }

    ok([
        'enabled' => $r2Read,
        'base'    => $r2ReadBase,
        'prefix'  => $r2Read ? $r2Prefix : 0,
        'put'     => $r2Write,
        'ttl'     => 900,
        'min'     => 4096,
    ]);
}

// -------------------------------------------------------- PUT RUXSATNOMASI
$doc = inputInt('doc', 0);
if ($doc <= 0) {
    fail('doc kerak', 400);
}
$pxSize = inputInt('size', 0);

if (!$r2Write) {
    // R2 yo'q bo'lsa ham Birinchi tomoshabin mahalliy prefiks yozishi kerak.
    // Bu kontent keshi: faqat doc_id + hajm + qism (head/tail). Foydalanuvchi
    // yoki sessiya ma'lumoti bu yerga kirmaydi.
    if ($pxEnabled && $pxSecret !== '' && $pxSize >= 1024 * 1024
        && $pxSize <= 4 * 1024 * 1024 * 1024) {
        $ip    = (string) ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
        $day   = gmdate('Ymd');
        $ipKey = 'pxip-' . substr(sha1($ip . '|' . $day . '|' . $pxSecret), 0, 24) . '.json';
        $allKey = 'pxall-' . $day . '.json';
        if (!r2_bump($allKey, 20000) || !r2_bump($ipKey, 200)) {
            header('Retry-After: 3600');
            fail('Bugungi prefiks limiti tugadi', 429);
        }
        $exp  = time() + 900;
        $self = px_self_dir();
        header('Cache-Control: no-store');
        ok([
            'enabled' => true,
            'local'   => true,
            'doc'     => $doc,
            'size'    => $pxSize,
            'put'     => px_put_url($doc, $pxSize, 'head', $exp, $pxSecret, $self),
            'putTail' => px_put_url($doc, $pxSize, 'tail', $exp, $pxSecret, $self),
            'exp'     => $exp,
            'max'     => 64 * 1024 * 1024,
        ]);
    }
    ok(['enabled' => false, 'reason' => 'R2 yozish sozlanmagan']);
}

// Yozish uchun login talab qilinadi (R2_PUT_AUTH=1 bo'lsa).
// Sababi: aks holda har kim bucket'ga 8 MB gacha axlat yozib, bepul
// limitni (10 GB) to'ldirib qo'yishi mumkin.
if ($r2PutAuth && !$user) {
    ok(['enabled' => false, 'reason' => 'login_required', 'put' => false]);
}

$ip    = (string) ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
$day   = gmdate('Ymd');
$ipKey = 'r2ip-' . substr(sha1($ip . '|' . $day . '|' . $r2Secret), 0, 24) . '.json';
$allKey = 'r2all-' . $day . '.json';

if (!r2_bump($allKey, $r2AllDay) || !r2_bump($ipKey, $r2IpDay)) {
    header('Retry-After: 3600');
    fail('Bugungi limit tugadi. Keyinroq urinib ko\'ring.', 429);
}

$exp = time() + 900;                       // 15 daqiqa
$sig = r2_sign($r2Secret, $doc, $exp);
$put = $r2Worker . '/p/' . rawurlencode((string) $doc)
     . '?exp=' . $exp . '&sig=' . $sig;

header('Cache-Control: no-store');
ok([
    'enabled' => true,
    'doc'     => $doc,
    'put'     => $put,
    'exp'     => $exp,
    'max'     => 8 * 1024 * 1024,
]);
