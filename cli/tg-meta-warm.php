<?php
// CLI-only guard — brauzerdan chaqirilishi mumkin emas (403).
if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('CLI only');
}
// ============================================================================
// cli/tg-meta-warm.php — Telegram hujjat metama'lumotini oldindan "isitish"
// ----------------------------------------------------------------------------
// NIMA UCHUN:
//   Video ochilishidagi eng katta kechikish — hujjat metama'lumoti
//   (id / access_hash / file_reference / dc_id). Sovuq keshda bitta hujjat
//   ~3-4 s (MadelineProto sessiyasi + RPC). Bu skript butun katalogni
//   BITTA sessiyada, kanal boshiga BITTA RPC bilan yechib, keshga yozadi.
//
//   Natija: foydalanuvchi qaysi videoni bosmasin — `api/tg-doc.php` ~10 ms
//   javob beradi, brauzer 5.4 MB GramJS bundle'ini yuklamaydi va video
//   DARHOL ochiladi.
//
// QANDAY ISHLATILADI (cron, har 20 daqiqada):
//   */20 * * * * /usr/bin/php /path/to/cli/tg-meta-warm.php >/dev/null 2>&1
//
// Windows (Task Scheduler) uchun:
//   C:\xampp\php\php.exe C:\xampp\htdocs\tele_uzdub\cli\tg-meta-warm.php
//
// XAVFSIZLIK: faqat `published` kontent (qoralama/arxiv isitilmaydi).
// ============================================================================
error_reporting(E_ALL & ~E_WARNING & ~E_NOTICE & ~E_DEPRECATED);
ini_set('display_errors', '0');
@set_time_limit(0);

require __DIR__ . '/../includes/bootstrap.php';
require_once __DIR__ . '/../includes/TgPull.php';

const TG_DOC_CACHE_VER = 2;
const TG_DOC_CACHE_TTL = 1800;
const TG_DOC_MAX_BATCH = 120;

function tgdCacheFile($ch, $post) {
    $dir = dirname(__DIR__) . '/storage/tg-doc-cache';
    return [$dir, $dir . '/' . sha1(strtolower($ch) . '/' . $post) . '.json'];
}

function tgdCacheRead($ch, $post) {
    list($dir, $file) = tgdCacheFile($ch, $post);
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

function tgdCacheWrite($ch, $post, array $out) {
    list($dir, $file) = tgdCacheFile($ch, $post);
    if (!is_dir($dir)) {
        @mkdir($dir, 0777, true);
    }
    $tmp = $file . '.' . getmypid() . '.tmp';
    if (@file_put_contents($tmp, json_encode($out, JSON_UNESCAPED_UNICODE)) !== false) {
        @rename($tmp, $file);
    }
}

function tgdParseUrl($u) {
    if (!preg_match('#^(?:https?://)?(?:www\.)?(?:t|telegram)\.me/([A-Za-z0-9_]+)/(\d+)#i', (string) $u, $m)) {
        return null;
    }
    $post = (int) $m[2];
    return $post > 0 ? ['ch' => $m[1], 'post' => $post] : null;
}

function tgdToOut($doc) {
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
    $fr = $doc['file_reference'] ?? '';
    if (is_object($fr)) {
        $fr = method_exists($fr, '__toString') ? (string) $fr : '';
    } elseif (is_array($fr)) {
        $fr = implode('', array_map('chr', array_map('intval', $fr)));
    }
    if (!is_string($fr) || $fr === '') {
        return null;
    }
    $out = [
        'ok'   => true,
        't'    => time(),
        'v'    => TG_DOC_CACHE_VER,
        'id'   => (string) ($doc['id'] ?? ''),
        'ah'   => (string) ($doc['access_hash'] ?? ''),
        'fr'   => base64_encode($fr),
        'dc'   => (int) ($doc['dc_id'] ?? 0),
        'size' => (int) ($doc['size'] ?? 0),
        'mime' => (string) ($doc['mime_type'] ?? ''),
        'fn'   => $fn,
        'w'    => $w,
        'h'    => $h,
        'dur'  => $dur,
    ];
    if ($out['id'] === '' || $out['ah'] === '') {
        return null;
    }
    return $out;
}

$pairs = [];
$seen  = [];
$db = Database::getInstance();
foreach ($db->fetchAll(
    "SELECT e.video_url
       FROM episodes e
       JOIN content c ON c.id = e.content_id
      WHERE c.status = 'published' AND e.video_url LIKE '%t.me/%'
      ORDER BY c.views DESC, c.id DESC, e.episode_number ASC, e.id ASC
      LIMIT 200"
) as $r) {
    $p = tgdParseUrl($r['video_url'] ?? '');
    if (!$p) {
        continue;
    }
    $k = $p['ch'] . '/' . $p['post'];
    if (isset($seen[$k])) {
        continue;
    }
    $seen[$k] = true;
    $pairs[]  = $p;
}
foreach ($db->fetchAll("SELECT video_url FROM reels WHERE video_url LIKE '%t.me/%' ORDER BY id DESC LIMIT 40") as $r) {
    $p = tgdParseUrl($r['video_url'] ?? '');
    if (!$p) {
        continue;
    }
    $k = $p['ch'] . '/' . $p['post'];
    if (isset($seen[$k])) {
        continue;
    }
    $seen[$k] = true;
    $pairs[]  = $p;
}

$need = [];
foreach ($pairs as $p) {
    $c = tgdCacheRead($p['ch'], $p['post']);
    if ($c && (time() - (int) ($c['t'] ?? 0)) < TG_DOC_CACHE_TTL) {
        continue;
    }
    $need[] = $p;
    if (count($need) >= TG_DOC_MAX_BATCH) {
        break;
    }
}

echo 'katalog: ' . count($pairs) . ', yangilash kerak: ' . count($need) . PHP_EOL;
if (!$need) {
    exit(0);
}

$t0 = microtime(true);
try {
    TgPull::sessionLockAcquire(300);
    $api  = TgPull::openBotSession();
    $docs = TgPull::fetchDocInfos($api, $need);
    $ok = 0;
    foreach ($docs as $key => $res) {
        if (empty($res['doc'])) {
            echo '  xato: ' . $key . ' (' . ($res['err'] ?? '?') . ')' . PHP_EOL;
            continue;
        }
        $out = tgdToOut($res['doc']);
        if (!$out) {
            echo '  xato: ' . $key . ' (file_reference yo\'q)' . PHP_EOL;
            continue;
        }
        list($ch, $post) = explode('/', $key, 2);
        tgdCacheWrite($ch, (int) $post, $out);
        $ok++;
    }
    echo 'ok: ' . $ok . '/' . count($need) . ' — ' . round(microtime(true) - $t0, 1) . ' s' . PHP_EOL;
} catch (\Throwable $e) {
    echo 'XATO: ' . $e->getMessage() . PHP_EOL;
    exit(1);
} finally {
    TgPull::sessionLockRelease();
}
