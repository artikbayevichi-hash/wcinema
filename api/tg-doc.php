<?php
// ============================================================================
// api/tg-doc.php — Telegram hujjat metama'lumoti (tez ochilish uchun)
// ============================================================================
//
// NIMA UCHUN:
//   Video oqimi uchun kerak bo'lgan "maxfiy" ma'lumot — hujjat manzili:
//   id / access_hash / file_reference / dc_id. Agar brauzerda bu ma'lumot
//   oldindan bo'lsa — 5.4 MB GramJS bundle'ini yuklash umuman kerak emas:
//   25 KB li minimal MTProto klient (`assets/js/tg-mtproto.js`) yetarli.
//
//   Bu endpoint serverda hujjatni yechib, keshga saqlaydi. Keyingi so'rovlar
//   ~10 ms da javob beradi (Telegram'ga umuman murojaat qilinmaydi).
//
//   VIDEO YUKI BU YERDAN O'TMAYDI — javob har bir video uchun ~200 bayt.
//   Faqat metama'lumot.
//
// HIMOYA:
//   • faqat sayt katalogida mavjud bo'lgan (kanal, post) juftliklari uchun;
//     aks holda 404 (boshqalar Telegram hujjatlarini yecha olmaydi).
//   • natija 10 daqiqaga keshlanadi (`file_reference` muddati bilan bog'liq).
//   • katalogdan tashqariga so'rovlar `ch`/`post` ni aniq tekshiriladi.
//
// ISHLATISH:
//   GET ?ch=<kanal>&post=<post_id>
//   -> {ok, id, ah, fr, dc, size, mime, fn, w, h, dur, cached}
//
//   GET ?posts=<kanal>:<post>,<kanal>:<post>,...
//   -> {ok, items: {"<kanal>/<post>": {id, ah, fr, dc, size, ...}}}
//   Bitta HTTP so'rovi bilan ko'p video — saytga kirganda barcha videolarni
//   oldindan yuklash uchun.
// ============================================================================
require_once __DIR__ . '/../includes/bootstrap.php';

// ---------------------------------------------------------------------------
// CHIQISHNI TOZALASH
//
// MadelineProto (Windows) ogohlantirishi to'g'ri STDOUT ga yoziladi:
//
//     WARNING: MadelineProto runs around 10x slower on windows ...
//
// Bu matn JSON bodisi bilan aralashib ketadi va brauzerdagi
// `response.json()` yiqilib ketadi ("Unexpected token 'W'") — ya'ni tez yo'l
// butunlay ishlamaydi. Chiqishni bufferlab, javob chiqarilishidan OLDIN
// buffer'ni tozalaymiz.
// ---------------------------------------------------------------------------
ob_start();

function apiOk($data = []) {
    while (ob_get_level() > 0) { @ob_end_clean(); }
    ok($data);
}
function apiFail($message, $status = 400) {
    while (ob_get_level() > 0) { @ob_end_clean(); }
    fail($message, $status);
}

// Kesh format versiyasi. 2 = `file_reference` va atributlar TO'G'RI o'qiladi
// (1-versiyada `fr` har doim bo'sh qolardi).
const TG_DOC_CACHE_VER = 2;
// `file_reference` muddati bilan bog'liq. 10 daqiqa — eskirgan havola
// brauzerda FILE_REFERENCE_EXPIRED beradi va u o'zi yangilaydi, lekin
// qisqa kesh = kamroq kechikish.
const TG_DOC_CACHE_TTL = 600;
// Bitta so'rovda nechta video (Telegram flood himoyasi uchun).
const TG_DOC_MAX_BATCH  = 120;

// ---------------------------------------------------------------------------
// Kesh (disk)
// ---------------------------------------------------------------------------
function tgDocCacheFile($ch, $post) {
    $dir = dirname(__DIR__) . '/storage/tg-doc-cache';
    return [$dir, $dir . '/' . sha1(strtolower($ch) . '/' . $post) . '.json'];
}

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

// ---------------------------------------------------------------------------
// Katalog: kanal bo'yicha ruxsatli (post) raqamlari
// ---------------------------------------------------------------------------
function tgCatalogPosts($ch) {
    $ids = [];
    try {
        $db   = Database::getInstance();
        $like = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $ch) . '%';
        $re   = '#^(?:https?://)?(?:www\.)?(?:t|telegram)\.me/' . preg_quote($ch, '#')
              . '/(\d+)(?:[/?\#].*)?$#i';
        foreach (['episodes', 'reels'] as $tbl) {
            $rows = $db->fetchAll(
                "SELECT video_url FROM `{$tbl}` WHERE video_url LIKE ? LIMIT 500",
                [$like]
            );
            foreach ($rows as $r) {
                $u = (string) ($r['video_url'] ?? '');
                if ($u === '') {
                    continue;
                }
                if (preg_match($re, $u, $m)) {
                    $ids[(int) $m[1]] = true;
                }
            }
        }
    } catch (\Throwable $e) {
        return [];
    }
    return $ids;
}

// ---------------------------------------------------------------------------
// MadelineProto `document` -> javob massivi
//
// MadelineProto `document` massivining tuzilmasi (8.7.0):
//   • `file_reference` — `danog\MadelineProto\TL\Types\Bytes` OBYEKTI.
//     Ichida xom binary satr bor; uni `(string)` bilan olish kerak.
//     `is_string()` tekshiruvi `false` berardi -> `fr` har doim BO'SH
//     qolardi va `upload.getFile` Telegram tomonidan rad etilardi.
//   • atributlar `_` kalitida `documentAttributeVideo` /
//     `documentAttributeFilename` (kichik harfli) nom bilan keladi;
//     fayl nomi `file_name` (snake_case) kalitida.
// ---------------------------------------------------------------------------
function tgDocToOut($doc) {
    $fn = ''; $w = 0; $h = 0; $dur = 0;
    foreach ((array) ($doc['attributes'] ?? []) as $a) {
        if (!is_array($a)) {
            continue;
        }
        $cn = strtolower((string) ($a['className'] ?? ($a['_'] ?? '')));
        if ($cn === 'documentattributefilename') {
            $fn = (string) ($a['fileName'] ?? ($a['file_name'] ?? ''));
        } elseif ($cn === 'documentattributevideo') {
            $w   = (int) ($a['w'] ?? 0);
            $h   = (int) ($a['h'] ?? 0);
            $dur = (int) round((float) ($a['duration'] ?? 0));
        }
    }

    // `file_reference` -> xom binary satr -> base64.
    $fr = $doc['file_reference'] ?? '';
    if (is_object($fr)) {
        $fr = method_exists($fr, '__toString') ? (string) $fr : '';
    } elseif (is_array($fr)) {
        $fr = implode('', array_map('chr', array_map('intval', $fr)));
    }
    if (!is_string($fr)) {
        $fr = '';
    }

    $out = [
        'ok'     => true,
        'cached' => false,
        't'      => time(),
        'v'      => TG_DOC_CACHE_VER,
        'id'     => (string) ($doc['id'] ?? ''),
        'ah'     => (string) ($doc['access_hash'] ?? ''),
        'fr'     => $fr === '' ? '' : base64_encode($fr),
        'dc'     => (int) ($doc['dc_id'] ?? 0),
        'size'   => (int) ($doc['size'] ?? 0),
        'mime'   => (string) ($doc['mime_type'] ?? ''),
        'fn'     => $fn,
        'w'      => $w,
        'h'      => $h,
        'dur'    => $dur,
    ];

    // `fr` bo'sh bo'lsa — bu metama'lumot ISHLATILMAYDI
    // (`upload.getFile` "FILE_REFERENCE_INVALID" bilan rad etiladi).
    if ($out['id'] === '' || $out['ah'] === '' || $out['fr'] === '') {
        return null;
    }
    return $out;
}

// ---------------------------------------------------------------------------
// Kirish parametrlari
// ---------------------------------------------------------------------------
$postsParam = trim((string) input('posts', '', 8000));
$fresh      = isset($_GET['fresh']) && (string) $_GET['fresh'] === '1';

// ===================================================================
// BATCH rejimi: ?posts=kanal:post,kanal:post,...
// ===================================================================
if ($postsParam !== '') {
    $pairs = [];
    foreach (explode(',', $postsParam) as $piece) {
        $piece = trim($piece);
        if ($piece === '' || strpos($piece, ':') === false) {
            continue;
        }
        list($c, $p) = explode(':', $piece, 2);
        $c = preg_replace('/[^A-Za-z0-9_]/', '', (string) $c);
        $p = (int) $p;
        if ($c === '' || $p <= 0) {
            continue;
        }
        $pairs[$c . '/' . $p] = ['ch' => $c, 'post' => $p];
        if (count($pairs) >= TG_DOC_MAX_BATCH) {
            break;
        }
    }
    if (!$pairs) {
        apiFail('posts parametri noto\'g\'ri', 400);
    }

    // 1) Katalogdan ruxsatli juftliklar
    $allowed = [];
    foreach ($pairs as $key => $pair) {
        $ids = tgCatalogPosts($pair['ch']);
        if (isset($ids[$pair['post']])) {
            $allowed[$key] = $pair;
        }
    }
    if (!$allowed) {
        apiFail('Topilmadi', 404);
    }

    // 2) Keshdan olamiz
    $items = [];
    $need  = [];
    foreach ($allowed as $key => $pair) {
        $cached = $fresh ? null : tgDocCacheRead($pair['ch'], $pair['post']);
        if ($cached && (time() - (int) ($cached['t'] ?? 0)) < TG_DOC_CACHE_TTL) {
            $cached['cached'] = true;
            $items[$key]      = $cached;
        } else {
            $need[$key] = $pair;
        }
    }

    // 3) Keshdagi (eskirgan) nusxalarni zaxira sifatida saqlaymiz
    $stale = [];
    foreach ($need as $key => $pair) {
        $s = tgDocCacheRead($pair['ch'], $pair['post']);
        if ($s) {
            $stale[$key] = $s;
        }
    }

    // 4) Telegram'dan yechish — bitta sessiya, kanal bo'yicha bitta RPC
    if ($need) {
        try {
            TgPull::sessionLockAcquire(6);
            $api   = TgPull::openBotSession();
            $docs  = TgPull::fetchDocInfos($api, array_values($need));
            foreach ($docs as $key => $res) {
                if (empty($res['doc'])) {
                    continue;
                }
                $out = tgDocToOut($res['doc']);
                if (!$out) {
                    continue;
                }
                tgDocCacheWrite($need[$key]['ch'], $need[$key]['post'], $out);
                $items[$key] = $out;
            }
        } catch (\Throwable $e) {
            // Telegram javob bermadi — eskirgan keshlarni qaytaramiz
            foreach ($stale as $key => $s) {
                if (!isset($items[$key])) {
                    $s['stale'] = true;
                    $items[$key] = $s;
                }
            }
        } finally {
            TgPull::sessionLockRelease();
        }
    }

    // 5) Qolganlar uchun eskirgan kesh (bo'lmasa — umuman yo'q)
    foreach ($stale as $key => $s) {
        if (!isset($items[$key])) {
            $s['stale'] = true;
            $items[$key] = $s;
        }
    }

    apiOk([
        'ok'    => true,
        'items' => $items,
        'count' => count($items),
        't'     => time(),
    ]);
}

// ===================================================================
// Bitta video rejimi: ?ch=<kanal>&post=<post_id>
// ===================================================================
$ch   = input('ch', '', 80);
$post = inputInt('post', 0);

// `ch` — faqat kanal nomi (harf/raqam/underscore).
$ch = preg_replace('/[^A-Za-z0-9_]/', '', (string) $ch);
if ($ch === '' || $post <= 0) {
    apiFail('ch va post kerak', 400);
}

// ---------------------------------------------------------------- kesh (disk)
$cached = $fresh ? null : tgDocCacheRead($ch, $post);
if ($cached && (time() - (int) ($cached['t'] ?? 0)) < TG_DOC_CACHE_TTL) {
    $cached['cached'] = true;
    apiOk($cached);
}
$stale = $cached;   // Telegram javob bermasa zaxira sifatida

// ------------------------------------------------------- katalogda bormi?
$ids = tgCatalogPosts($ch);
if (!isset($ids[$post])) {
    apiFail('Topilmadi', 404);
}

// ------------------------------------------------- Telegram'dan yechish
$doc = null;
try {
    // Bot sessiyasi bitta jarayonda ishlatiladi (IPC konflikti bo'lmasligi uchun).
    // Qisqa kutamiz — worker band bo'lsa, brauzer eski yo'liga qaytadi.
    TgPull::sessionLockAcquire(4);
    $api  = TgPull::openBotSession();
    $info = TgPull::fetchDocInfo($api, 'https://t.me/' . $ch . '/' . $post);
    $doc  = is_array($info['doc'] ?? null) ? $info['doc'] : null;
} catch (\Throwable $e) {
    $doc = null;
} finally {
    TgPull::sessionLockRelease();
}

$out = $doc ? tgDocToOut($doc) : null;
if (!$out) {
    // Telegram javob bermadi (session band, tarmoq xatosi) — eskirdi
    // bo'lsa ham mavjud keshni qaytaramiz: brauzer keyin o'zi yangilaydi.
    if (is_array($stale) && !empty($stale['id']) && !empty($stale['fr'])) {
        $stale['ok']    = true;
        $stale['stale'] = true;
        apiOk($stale);
    }
    apiFail('Telegram\'dan yechib bo\'lmadi', 502);
}

// -------------------------------------------------------------- keshga yozish
tgDocCacheWrite($ch, $post, $out);

apiOk($out);
