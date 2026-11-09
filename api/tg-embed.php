<?php
// ============================================================================
// api/tg-embed.php — Telegram rasmiy embed pleyeri bu postni o'ynata oladimi?
// ----------------------------------------------------------------------------
// NIMA UCHUN KERAK
//   `t.me/<kanal>/<post>?embed=1` sahifasi video baytlarini Telegram CDN'idan
//   beradi — ya'ni Telegram Web'dagi kabi tez va sayt serveriga yuk tushmaydi.
//   LEKIN Telegram ommaviy (anonim) ko'ruvchiga faqat KICHIK fayllarni
//   oqizadi. Katta filmlar uchun embed sahifasi video o'rniga shunday
//   yozuv chiqaradi: "Media is too big — VIEW IN TELEGRAM".
//
//   Buni HTML'dan aniqlash mumkin:
//     • o'ynaydigan post  -> ichida `<video src="https://cdnX.telesco.pe/...">`
//     • juda katta fayl   -> `message_media_not_supported_label` = "Media is too big"
//     • yo'q/o'chirilgan  -> "Post not found"
//
//   Shu sababli sahifa embed'ni faqat shu tekshiruv `playable: true` deganda
//   taklif qiladi. Katta kinolarda esa bizning MTProto pleyerimiz ishlaydi.
//
// KESHLASH
//   6 soat (`storage/cache/tg-embed-<sha1>.json`). Har ko'rishda t.me ga
//   so'rov ketmaydi — millionlab ko'ruvchida ham bitta fayl o'qish.
//
//   GET ?channel=wcinemauz&post=4
//   -> { success:true, playable:false, reason:"too_big" }
// ============================================================================

require_once __DIR__ . '/../includes/bootstrap.php';

$channel = strtolower(trim((string) input('channel', '', 64)));
$post    = inputInt('post', 0);

// Kanal nomi Telegram qoidasi bo'yicha: harflar, raqamlar, pastki chiziq.
// Qat'iy tekshiruv — aks holda bu endpoint tashqi so'rov generatoriga aylanadi.
if (!preg_match('/^[a-z0-9_]{3,64}$/', $channel) || $post <= 0) {
    fail('channel va post kerak', 422);
}

$cacheDir  = dirname(__DIR__) . '/storage/cache';
$cacheFile = $cacheDir . '/tg-embed-' . sha1($channel . '/' . $post) . '.json';
$ttl       = 21600; // 6 soat

if (is_file($cacheFile) && (time() - (int) @filemtime($cacheFile)) < $ttl) {
    $raw = @file_get_contents($cacheFile);
    if ($raw !== false) {
        $data = json_decode($raw, true);
        if (is_array($data) && isset($data['playable'])) {
            $data['cached'] = true;
            ok($data);
        }
    }
}

$url  = 'https://t.me/' . rawurlencode($channel) . '/' . $post
      . '?embed=1&mode=tme&discussion=0';
$html = '';
$ua   = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      . '(KHTML, like Gecko) Chrome/122.0 Safari/537.36';

if (function_exists('curl_init')) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS      => 3,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_TIMEOUT        => 5,
        CURLOPT_USERAGENT      => $ua,
        CURLOPT_ENCODING       => '',
        CURLOPT_SSL_VERIFYPEER => true,
    ]);
    $html = (string) curl_exec($ch);
    curl_close($ch);
} else {
    $ctx  = stream_context_create(['http' => [
        'timeout' => 5,
        'header'  => "User-Agent: {$ua}\r\n",
    ]]);
    $html = (string) @file_get_contents($url, false, $ctx);
}

$playable = false;
$reason   = 'fetch_failed';

if ($html !== '') {
    if (preg_match('/Post not found/i', $html)) {
        $reason = 'not_found';                 // o'chirilgan yoki yopiq kanal
    } elseif (preg_match('/message_media_not_supported_label[^>]*>\s*Media is too big/i', $html)) {
        $reason = 'too_big';                   // katta fayl — embed oqizmaydi
    } elseif (preg_match('/<video[^>]+src="https?:\/\/[^"]+"/i', $html)) {
        $playable = true;
        $reason   = 'ok';
    } else {
        $reason = 'no_video';                  // post'da video yo'q (matn/rasm)
    }
}

$out = [
    'success'  => true,
    'playable' => $playable,
    'reason'   => $reason,
    'channel'  => $channel,
    'post'     => $post,
    'ts'       => time(),
];

// Faqat aniq javoblarni keshlaymiz: tarmoq xatosi ("fetch_failed") 6 soat
// davomida embed'ni o'chirib qo'ymasin.
if ($reason !== 'fetch_failed') {
    if (!is_dir($cacheDir)) @mkdir($cacheDir, 0775, true);
    if (is_dir($cacheDir) && is_writable($cacheDir)) {
        @file_put_contents($cacheFile, json_encode($out, JSON_UNESCAPED_UNICODE), LOCK_EX);
    }
}

ok($out);
