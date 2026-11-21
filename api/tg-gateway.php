<?php
// ============================================================================
// api/tg-gateway.php — server-side MTProto gateway (chipta + HTTP Range proxy)
// ============================================================================
//
// 1) CHIPTA OLISH (faqat kirgan foydalanuvchi):
//      GET api/tg-gateway.php?action=ticket&channel=wcinemauz&post=33
//      yoki
//      GET api/tg-gateway.php?action=ticket&url=https://t.me/wcinemauz/33
//
//    Javob: { ok:true, ticket:"v1...", size, mime, dur, exp }
//
// 2) VIDEO OQIMI (chipta bilan):
//      GET api/tg-gateway.php?t=<chipta>
//      Range: bytes=0-1048575
//
//    Javob: 206 Partial Content (yoki 200 to'liq fayl).
//
// Gateway standart holatda O'CHIQ. Yoqish uchun .env:
//   TG_GATEWAY_ENABLED=1
// va alohida jarayon:
//   php cli/tg-gateway.php --port=8099
//
// MUHIM: video baytlari server orqali o'tadi. Bu zaxira yo'l — asosiy
// tezlik yo'li emas. Batafsil: docs/production-streaming.md.
// ============================================================================

require_once __DIR__ . '/../includes/bootstrap.php';
require_once __DIR__ . '/../includes/TgGateway.php';

/** JSON javob va chiqish. */
function gwOut($code, array $data)
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

if (!TgGateway::enabled()) {
    gwOut(503, [
        'ok'    => false,
        'error' => 'Server gateway o\'chirilgan (TG_GATEWAY_ENABLED=0).',
    ]);
}

$uid = (int) clientUserId();
if ($uid <= 0) {
    gwOut(401, ['ok' => false, 'error' => 'Avval Telegram orqali kiring.']);
}

$action = input('action', '', 20);

// ---------------------------------------------------------------------------
// 1) Chipta
// ---------------------------------------------------------------------------
if ($action === 'ticket') {
    $ch   = input('channel', '', 120);
    $post = inputInt('post');
    $url  = input('url', '', 300);

    if ($ch === '' && $url === '') {
        gwOut(400, ['ok' => false, 'error' => 'channel+post yoki url kerak.']);
    }
    if ($url !== '' && !preg_match('#^https?://(t\.me|telegram\.me)/#i', $url)) {
        gwOut(400, ['ok' => false, 'error' => 'Faqat t.me havolasi qabul qilinadi.']);
    }
    if ($url === '' && ($post <= 0 || $ch === '')) {
        gwOut(400, ['ok' => false, 'error' => 'Post raqami noto\'g\'ri.']);
    }

    $qs = http_build_query([
        'ch'   => $ch,
        'post' => $post,
        'url'  => $url,
        'uid'  => $uid,
    ]);
    $ctx = stream_context_create([
        'http' => [
            'method'        => 'GET',
            'timeout'       => 30,
            'ignore_errors' => true,
            'header'        => "X-GW-Key: " . TgGateway::daemonKey() . "\r\n"
                . "Accept: application/json\r\n"
                . "Connection: close\r\n",
        ],
    ]);
    $raw  = @file_get_contents(TgGateway::daemonUrl('/ticket?' . $qs), false, $ctx);
    $code = 0;
    foreach (($http_response_header ?? []) as $h) {
        if (preg_match('#^HTTP/\S+\s+(\d{3})#', $h, $m)) {
            $code = (int) $m[1];
        }
    }
    $j = is_string($raw) ? json_decode($raw, true) : null;
    if ($code !== 200 || !is_array($j) || empty($j['ok']) || empty($j['ticket'])) {
        $msg = is_array($j) && !empty($j['error'])
            ? (string) $j['error']
            : 'Gateway ishlamayapti. `php cli/tg-gateway.php` jarayonini tekshiring.';
        gwOut(502, ['ok' => false, 'error' => $msg]);
    }
    gwOut(200, $j);
}

// ---------------------------------------------------------------------------
// 2) Video oqimi
// ---------------------------------------------------------------------------
$ticket = input('t', '', 8192);
if ($action === 'stream' || $ticket !== '') {
    if ($ticket === '') {
        gwOut(400, ['ok' => false, 'error' => 'Chipta (t) kerak.']);
    }
    $v = TgGateway::verify($ticket, $uid);
    if (empty($v['ok'])) {
        gwOut(403, ['ok' => false, 'error' => $v['error'] ?? 'Chipta noto\'g\'ri.']);
    }

    // PHP sessiyasi oqim davomida boshqa so'rovlarni bloklamasin.
    if (function_exists('session_status') && session_status() === PHP_SESSION_ACTIVE) {
        @session_write_close();
    }
    @set_time_limit(0);
    @ini_set('zlib.output_compression', '0');
    while (ob_get_level() > 0) {
        @ob_end_clean();
    }

    $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    $range  = (string) ($_SERVER['HTTP_RANGE'] ?? '');
    $headers = [
        'X-GW-Key: ' . TgGateway::daemonKey(),
        'Accept: */*',
        'Connection: close',
    ];
    if ($range !== '') {
        $headers[] = 'Range: ' . $range;
    }

    header('X-WC-Gateway: 1');
    header('Cache-Control: private, no-store');

    $status = 0;
    $ch = curl_init(TgGateway::daemonUrl('/stream?t=' . rawurlencode($ticket)));
    $opts = [
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_TIMEOUT        => 0,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_HEADERFUNCTION => function ($c, $line) use (&$status) {
            $len = strlen($line);
            if (preg_match('#^HTTP/\S+\s+(\d{3})#', $line, $m)) {
                $status = (int) $m[1];
                http_response_code($status);
                return $len;
            }
            $pos = strpos($line, ':');
            if ($pos === false) {
                return $len;
            }
            $k = strtolower(trim(substr($line, 0, $pos)));
            $v = trim(substr($line, $pos + 1));
            if (in_array($k, [
                'content-type', 'content-length', 'content-range', 'accept-ranges',
                'cache-control', 'etag', 'last-modified', 'x-wc-gateway',
            ], true)) {
                header($k . ': ' . $v, false);
            }
            return $len;
        },
        CURLOPT_WRITEFUNCTION  => function ($c, $data) {
            if ($data === '') {
                return 0;
            }
            echo $data;
            @flush();
            return strlen($data);
        },
    ];
    if ($method === 'HEAD') {
        $opts[CURLOPT_NOBODY] = true;
    } else {
        $opts[CURLOPT_HTTPGET] = true;
    }
    curl_setopt_array($ch, $opts);
    $ok = curl_exec($ch);
    $err = curl_error($ch);
    curl_close($ch);

    if ($ok === false && $status === 0) {
        http_response_code(503);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode([
            'ok'    => false,
            'error' => 'Gateway javob bermadi' . ($err !== '' ? ': ' . $err : ''),
        ], JSON_UNESCAPED_UNICODE);
    }
    exit;
}

gwOut(400, [
    'ok'    => false,
    'error' => 'action=ticket yoki t=<chipta> kerak.',
]);
