<?php
// ============================================================================
// cli/tg-gateway.php — server-side MTProto → HTTP Range gateway (prototip)
// ============================================================================
//
// ISHLATISH:
//   php cli/tg-gateway.php --port=8099
//
// Bu jarayon Telegram bot sessiyasini bir marta ochadi va ushlab turadi.
// `api/tg-gateway.php` undan chipta so'raydi, brauzer esa o'sha chipta bilan
// oddiy HTTP Range/206 so'rovlarini yuboradi.
//
// MUHIM:
//   • Faqat CLI. Brauzerdan ochib bo'lmaydi.
//   • Loopback (127.0.0.1) uchun mo'ljallangan; tashqi tarmoqqa ochmang.
//   • Bu prototip: so'rovlar KETMA-KET bajariladi. Ko'p tomoshabin uchun
//     bir nechta gateway jarayoni yoki async server kerak bo'ladi.
//   • `file_reference` hech qayerda saqlanmaydi — faqat xotirada va
//     imzolangan chipta ichida.
// ============================================================================

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('CLI only');
}

require __DIR__ . '/../includes/bootstrap.php';
require_once __DIR__ . '/../includes/TgGateway.php';
require_once __DIR__ . '/../includes/TgPull.php';
require_once __DIR__ . '/../includes/TgMeta.php';

$opts = getopt('', ['host::', 'port::', 'force', 'once', 'no-telegram', 'max-requests::', 'help']);
if (isset($opts['help'])) {
    fwrite(STDOUT, "Foydalanish: php cli/tg-gateway.php [--host=127.0.0.1] [--port=8099] [--force] [--no-telegram] [--once] [--max-requests=N]\n");
    exit(0);
}
if (!TgGateway::enabled() && !isset($opts['force'])) {
    fwrite(STDERR, "[tg-gateway] O'chirilgan. .env ga TG_GATEWAY_ENABLED=1 yozing yoki --force bering.\n");
    exit(1);
}

@ini_set('zlib.output_compression', '0');
@ini_set('output_buffering', '0');
@ini_set('implicit_flush', '1');
while (ob_get_level() > 0) {
    @ob_end_clean();
}
@set_time_limit(0);

$host = isset($opts['host']) && $opts['host'] !== false
    ? (string) $opts['host']
    : (defined('TG_GATEWAY_HOST') ? TG_GATEWAY_HOST : '127.0.0.1');
$port = isset($opts['port']) && $opts['port'] !== false
    ? (int) $opts['port']
    : (defined('TG_GATEWAY_PORT') ? (int) TG_GATEWAY_PORT : 8099);
if ($port < 1 || $port > 65535) {
    fwrite(STDERR, "[tg-gateway] Port noto'g'ri.\n");
    exit(1);
}

// Bir vaqtda faqat bitta gateway jarayoni. Sessiya papkasi ham alohida —
// shu bilan `live-worker` va `deliver-worker` bilan to'qnashmaydi.
$lockDir = __DIR__ . '/../storage/mtproto';
if (!is_dir($lockDir)) {
    @mkdir($lockDir, 0777, true);
}
$lockFp = @fopen($lockDir . '/gateway.lock', 'c+');
if (!$lockFp || !@flock($lockFp, LOCK_EX | LOCK_NB)) {
    fwrite(STDERR, "[tg-gateway] Boshqa gateway jarayoni allaqachon ishlayapti.\n");
    exit(1);
}
register_shutdown_function(function () use ($lockFp) {
    @flock($lockFp, LOCK_UN);
    @fclose($lockFp);
});

$srv = @stream_socket_server('tcp://' . $host . ':' . $port, $errno, $errstr);
if (!$srv) {
    fwrite(STDERR, "[tg-gateway] $host:$port ni ochib bo'lmadi: $errstr ($errno)\n");
    exit(1);
}
@stream_set_blocking($srv, true);

$sessionDir = $lockDir . '/gateway';
if (!is_dir($sessionDir)) {
    @mkdir($sessionDir, 0777, true);
}

try {
    $api = isset($opts['no-telegram']) ? null : TgPull::openBotSession($sessionDir);
} catch (\Throwable $e) {
    fwrite(STDERR, "[tg-gateway] Bot sessiyasini ochib bo'lmadi: " . $e->getMessage() . "\n");
    @fclose($srv);
    exit(1);
}

$maxReq = isset($opts['max-requests']) && $opts['max-requests'] !== false
    ? max(0, (int) $opts['max-requests'])
    : 0;
$served = 0;

if ($api === null) {
    fwrite(STDERR, "[tg-gateway] DIQQAT: --no-telegram rejimi (faqat /health).\n");
}
fwrite(STDERR, "[tg-gateway] Tayyor: http://$host:$port (faqat loopback)\n");

/** Xotiradagi hujjat keshi: "ch/post" => payload. */
$docs = [];

/**
 * HTTP so'rovini o'qish (maksimal 16 KB sarlavha).
 * @return array|null
 */
function gwReadRequest($conn)
{
    $raw = '';
    $deadline = microtime(true) + 10;
    while (strpos($raw, "\r\n\r\n") === false) {
        if (microtime(true) > $deadline || strlen($raw) > 16384) {
            return null;
        }
        $part = @fread($conn, 2048);
        if ($part === false || $part === '') {
            $meta = @stream_get_meta_data($conn);
            if (!empty($meta['timed_out'])) {
                return null;
            }
            usleep(10000);
            continue;
        }
        $raw .= $part;
    }
    $head = substr($raw, 0, strpos($raw, "\r\n\r\n"));
    $lines = preg_split("/\r\n/", $head);
    if (!$lines || !preg_match('#^([A-Z]+)\s+(\S+)\s+HTTP/1\.[01]$#', trim($lines[0]), $m)) {
        return null;
    }
    $headers = [];
    for ($i = 1; $i < count($lines); $i++) {
        $pos = strpos($lines[$i], ':');
        if ($pos === false) {
            continue;
        }
        $k = strtolower(trim(substr($lines[$i], 0, $pos)));
        $v = trim(substr($lines[$i], $pos + 1));
        $headers[$k] = $v;
    }
    $u = parse_url($m[2]);
    $query = [];
    if (!empty($u['query'])) {
        parse_str($u['query'], $query);
    }
    return [
        'method'  => strtoupper($m[1]),
        'path'    => (string) ($u['path'] ?? '/'),
        'query'   => $query,
        'headers' => $headers,
    ];
}

function gwJson($conn, $code, array $data)
{
    $body = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $status = [
        200 => 'OK', 400 => 'Bad Request', 401 => 'Unauthorized',
        403 => 'Forbidden', 404 => 'Not Found', 405 => 'Method Not Allowed',
        416 => 'Range Not Satisfiable', 500 => 'Internal Server Error',
        503 => 'Service Unavailable',
    ][$code] ?? 'Error';
    $out = "HTTP/1.1 $code $status\r\n"
        . "Content-Type: application/json; charset=utf-8\r\n"
        . 'Content-Length: ' . strlen($body) . "\r\n"
        . "Cache-Control: no-store\r\n"
        . "Connection: close\r\n\r\n" . $body;
    @fwrite($conn, $out);
}

function gwText($conn, $code, $text)
{
    $status = $code === 200 ? 'OK' : ($code === 403 ? 'Forbidden' : 'Error');
    $out = "HTTP/1.1 $code $status\r\n"
        . "Content-Type: text/plain; charset=utf-8\r\n"
        . 'Content-Length: ' . strlen($text) . "\r\n"
        . "Connection: close\r\n\r\n" . $text;
    @fwrite($conn, $out);
}

/**
 * Hujjat ma'lumotini topish: avval SQL meta (tez), keyin bot (sekin).
 * Natija FAQAT xotirada; `file_reference` SQL'ga yozilmaydi.
 */
function gwResolveDoc($api, array &$cache, $ch, $post, $url = '')
{
    $ch = trim((string) $ch);
    $post = (int) $post;
    $url = trim((string) $url);
    if ($url !== '') {
        $parsed = TgPull::parseUrl($url);
        if (!$parsed) {
            throw new \InvalidArgumentException('URL t.me havolasi emas');
        }
        $ch = (string) $parsed['label'];
        $post = (int) $parsed['id'];
        $url = (string) $url;
    } else {
        if (!preg_match('#^[A-Za-z0-9_./-]{1,120}$#', $ch) || strpos($ch, '..') !== false) {
            throw new \InvalidArgumentException('Kanal nomi noto\'g\'ri');
        }
        if ($post <= 0) {
            throw new \InvalidArgumentException('Post raqami noto\'g\'ri');
        }
        $url = 'https://t.me/' . $ch . '/' . $post;
    }

    $key = strtolower($ch) . '/' . $post;
    if (isset($cache[$key]) && (time() - (int) ($cache[$key]['t'] ?? 0)) < 3600) {
        return $cache[$key];
    }

    $out = null;
    if (strpos(strtolower($ch), 'c/') !== 0) {
        try {
            $meta = TgMeta::get($ch, $post);
        } catch (\Throwable $e) {
            $meta = null;
        }
        if ($meta) {
            $out = [
                'ch'   => (string) $ch,
                'post' => $post,
                'id'   => (string) $meta['id'],
                'ah'   => (string) $meta['ah'],
                'fr'   => (string) $meta['fr'],
                'size' => (int) $meta['size'],
                'mime' => (string) ($meta['mime'] ?: 'video/mp4'),
                'dur'  => (int) ($meta['dur'] ?? 0),
            ];
        }
    }

    if (!$out) {
        $info = TgPull::fetchDocInfo($api, $url);
        $doc  = $info['doc'] ?? [];
        $fr   = $doc['file_reference'] ?? '';
        if (is_object($fr)) {
            $fr = method_exists($fr, '__toString') ? (string) $fr : '';
        } elseif (is_array($fr)) {
            $fr = implode('', array_map('chr', array_map('intval', $fr)));
        }
        if (!is_string($fr) || $fr === '') {
            throw new \RuntimeException('file_reference olinmadi');
        }
        $out = [
            'ch'   => (string) $ch,
            'post' => $post,
            'id'   => (string) ($doc['id'] ?? ''),
            'ah'   => (string) ($doc['access_hash'] ?? ''),
            'fr'   => base64_encode($fr),
            'size' => (int) ($info['size'] ?? 0),
            'mime' => (string) (($info['mime'] ?? '') ?: 'video/mp4'),
            'dur'  => (int) round((float) ($info['duration'] ?? 0)),
        ];
    }

    if ($out['id'] === '' || $out['ah'] === '' || $out['size'] <= 0) {
        throw new \RuntimeException('Video hujjati to\'liq emas');
    }
    $out['t'] = time();
    $cache[$key] = $out;
    return $out;
}

function gwServeRange($conn, array $req, $api, array $p)
{
    $size = (int) $p['size'];
    $rangeHdr = (string) ($req['headers']['range'] ?? '');
    $r = TgGateway::parseRange($rangeHdr, $size);
    if (empty($r['ok'])) {
        $out = "HTTP/1.1 416 Range Not Satisfiable\r\n"
            . 'Content-Range: bytes */' . $size . "\r\n"
            . "Content-Length: 0\r\nConnection: close\r\n\r\n";
        @fwrite($conn, $out);
        return;
    }

    $start = (int) $r['start'];
    $end   = (int) $r['end'];
    $len   = $end - $start + 1;
    $mime  = (string) ($p['mime'] ?? 'video/mp4');
    if ($mime === '') {
        $mime = 'video/mp4';
    }

    $code = !empty($r['partial']) ? '206 Partial Content' : '200 OK';
    $headers = 'HTTP/1.1 ' . $code . "\r\n"
        . 'Content-Type: ' . $mime . "\r\n"
        . 'Content-Length: ' . $len . "\r\n"
        . "Accept-Ranges: bytes\r\n"
        . "Cache-Control: private, no-store\r\n"
        . "X-WC-Gateway: 1\r\n"
        . "Connection: close\r\n";
    if (!empty($r['partial'])) {
        $headers .= 'Content-Range: bytes ' . $start . '-' . $end . '/' . $size . "\r\n";
    }
    $headers .= "\r\n";
    $GLOBALS['gw_stream_started'] = true;
    if (@fwrite($conn, $headers) === false) {
        return;
    }

    if (strtoupper((string) $req['method']) === 'HEAD') {
        return;
    }

    $media = TgGateway::media($p);
    if (!$media) {
        return;
    }
    // `downloadToStream` oxiri EKSKLYUZIV: [start, end + 1).
    $api->downloadToStream($media, $conn, null, $start, $end + 1);
}

// ---------------------------------------------------------------------------
// Asosiy sikl
// ---------------------------------------------------------------------------
while (true) {
    $conn = @stream_socket_accept($srv, 5);
    if (!$conn) {
        continue;
    }
    @stream_set_timeout($conn, 15);
    $GLOBALS['gw_stream_started'] = false;
    $req = gwReadRequest($conn);
    if (!$req) {
        @fclose($conn);
        continue;
    }

    try {
        $path = $req['path'];
        if ($path === '/health') {
            gwJson($conn, 200, [
                'ok'      => true,
                'gateway' => 1,
                'cached'  => count($docs),
                'time'    => time(),
            ]);
        } elseif ($path === '/ticket') {
            $key = (string) ($req['headers']['x-gw-key'] ?? '');
            if ($key === '' || !hash_equals(TgGateway::daemonKey(), $key)) {
                gwJson($conn, 403, ['ok' => false, 'error' => 'Loopback kaliti noto\'g\'ri']);
            } elseif ($api === null) {
                gwJson($conn, 503, ['ok' => false, 'error' => 'Telegram sessiyasi yoqilmagan (--no-telegram)']);
            } else {
                $q = $req['query'];
                $uid = (int) ($q['uid'] ?? 0);
                if ($uid <= 0) {
                    gwJson($conn, 400, ['ok' => false, 'error' => 'uid kerak']);
                } else {
                    $doc = gwResolveDoc(
                        $api,
                        $docs,
                        (string) ($q['ch'] ?? $q['channel'] ?? ''),
                        (int) ($q['post'] ?? 0),
                        (string) ($q['url'] ?? '')
                    );
                    $p = [
                        'ch'   => $doc['ch'],
                        'post' => (int) $doc['post'],
                        'id'   => $doc['id'],
                        'ah'   => $doc['ah'],
                        'fr'   => $doc['fr'],
                        'size' => (int) $doc['size'],
                        'mime' => $doc['mime'],
                        'dur'  => (int) $doc['dur'],
                        'uid'  => $uid,
                        'exp'  => time() + (int) TG_GATEWAY_TTL,
                    ];
                    $ticket = TgGateway::sign($p);
                    gwJson($conn, 200, [
                        'ok'     => true,
                        'ticket' => $ticket,
                        'size'   => (int) $p['size'],
                        'mime'   => $p['mime'],
                        'dur'    => (int) $p['dur'],
                        'exp'    => (int) $p['exp'],
                    ]);
                }
            }
        } elseif ($path === '/stream') {
            if ($api === null) {
                gwJson($conn, 503, ['ok' => false, 'error' => 'Telegram sessiyasi yoqilmagan (--no-telegram)']);
            } else {
                $v = TgGateway::verify((string) ($req['query']['t'] ?? ''));
                if (empty($v['ok'])) {
                    gwJson($conn, 403, ['ok' => false, 'error' => $v['error'] ?? 'Chipta noto\'g\'ri']);
                } else {
                    gwServeRange($conn, $req, $api, $v['p']);
                }
            }
        } else {
            gwText($conn, 404, 'Not found');
        }
    } catch (\Throwable $e) {
        // Chipta va file_reference log'ga tushmaydi.
        fwrite(STDERR, '[tg-gateway] ' . $e->getMessage() . "\n");
        if (empty($GLOBALS['gw_stream_started'])) {
            try {
                gwJson($conn, 500, ['ok' => false, 'error' => 'Gateway xatosi']);
            } catch (\Throwable $e2) {
            }
        }
    }

    @fclose($conn);
    $served++;
    if (isset($opts['once']) || ($maxReq > 0 && $served >= $maxReq)) {
        break;
    }
}
