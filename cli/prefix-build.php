<?php
// CLI-only guard — brauzerdan chaqirilishi mumkin emas (403).
if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('CLI only');
}
// ============================================================================
// cli/prefix-build.php — video BOSH va DUM (`moov`) qismini serverga yozadi
// ----------------------------------------------------------------------------
// NIMA UCHUN:
//   Telegram MP4 fayllari "faststart" EMAS: `moov` indeksi faylning OXIRIDA.
//   Brauzer birinchi kadr uchun avval indeksni, keyin boshni o'qiydi — ikkisi
//   ham Telegram DC'dan kelsa, birinchi kadr 10–40 s kutadi (begona DC'da).
//
//   Bu skript faylning boshini (standart 4 MB) va oxirini (standart 6 MB)
//   BITTA marta Telegram'dan yuklab, `storage/prefix/` ga yozadi. Keyin
//   `api/prefix.php` ularni Range bilan bir zumda beradi, qolgani avvalgidek
//   Telegram'dan oqadi. Fayl bayt-bayt bir xil — qayta kodlash YO'Q.
//
// ISHLATISH:
//   php cli/prefix-build.php --url=https://t.me/wcinemauz/12
//   php cli/prefix-build.php --channel=wcinemauz --post=12
//   php cli/prefix-build.php --all                  (katalogdagi barcha t.me videolar)
//   php cli/prefix-build.php --list                 (manifestni ko'rsatish)
//   php cli/prefix-build.php --verify                (prefiks fayllarini tekshirish)
//   php cli/prefix-build.php --all --force           (qayta yozish)
//   php cli/prefix-build.php --url=... --head=2097152 --tail=4194304
//
// .env (ixtiyoriy):
//   PREFIX_HEAD_BYTES=4194304   PREFIX_TAIL_BYTES=6291456
// ============================================================================

require_once __DIR__ . '/../includes/bootstrap.php';

$opt = [
    'url'     => '',
    'channel' => '',
    'post'    => 0,
    'all'     => false,
    'list'    => false,
    'verify'  => false,
    'force'   => false,
    'json'    => false,
    'quiet'   => false,
    'limit'   => 0,
    'head'    => (int) env_value('PREFIX_HEAD_BYTES', '4194304'),
    'tail'    => (int) env_value('PREFIX_TAIL_BYTES', '6291456'),
];

foreach (array_slice($argv, 1) as $arg) {
    if ($arg === '--all') {
        $opt['all'] = true;
    } elseif ($arg === '--list') {
        $opt['list'] = true;
    } elseif ($arg === '--verify') {
        $opt['verify'] = true;
    } elseif ($arg === '--force') {
        $opt['force'] = true;
    } elseif ($arg === '--json') {
        $opt['json'] = true;
    } elseif ($arg === '--quiet') {
        $opt['quiet'] = true;
    } elseif (strpos($arg, '--url=') === 0) {
        $opt['url'] = trim(substr($arg, 6));
    } elseif (strpos($arg, '--channel=') === 0) {
        $opt['channel'] = trim(substr($arg, 10));
    } elseif (strpos($arg, '--post=') === 0) {
        $opt['post'] = (int) substr($arg, 7);
    } elseif (strpos($arg, '--head=') === 0) {
        $opt['head'] = (int) substr($arg, 7);
    } elseif (strpos($arg, '--tail=') === 0) {
        $opt['tail'] = (int) substr($arg, 7);
    } elseif (strpos($arg, '--limit=') === 0) {
        $opt['limit'] = (int) substr($arg, 8);
    } else {
        fwrite(STDERR, "Noma'lum argument: {$arg}\n");
        exit(2);
    }
}

$root    = dirname(__DIR__);
$dir     = $root . '/storage/prefix';
$manifest = $dir . '/manifest.json';

$headBytes = max(4096, min(64 * 1024 * 1024, (int) $opt['head']));
$tailBytes = max(0, min(64 * 1024 * 1024, (int) $opt['tail']));
$headBytes -= $headBytes % 4096;
$tailBytes -= $tailBytes % 4096;

if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
    fwrite(STDERR, "Papka yaratilmadi: {$dir}\n");
    exit(1);
}

$t0 = microtime(true);

// ------------------------------------------------------------------ yordamchi
function px_say($msg)
{
    global $opt;
    if (!$opt['quiet']) {
        fwrite(STDOUT, $msg . PHP_EOL);
    }
}

/** `file_reference` ni xom satrga aylantiradi (MadelineProto obyekt/array). */
function px_fr($fr)
{
    if (is_object($fr)) {
        return method_exists($fr, '__toString') ? (string) $fr : '';
    }
    if (is_array($fr)) {
        return implode('', array_map('chr', array_map('intval', $fr)));
    }
    return is_string($fr) ? $fr : '';
}

function px_manifest_read($file)
{
    $raw = @file_get_contents($file);
    $m = $raw !== false ? json_decode((string) $raw, true) : null;
    if (!is_array($m)) {
        return ['v' => 1, 'docs' => []];
    }
    if (!isset($m['docs']) || !is_array($m['docs'])) {
        $m = ['v' => 1, 'docs' => $m];      // eski tekis format
    }
    if (!isset($m['docs']) || !is_array($m['docs'])) {
        $m['docs'] = [];
    }
    $m['v'] = 1;
    return $m;
}

/** Manifestni flock ostida atomik yangilaydi. */
function px_manifest_put($file, array $entry)
{
    $lock = @fopen($file . '.lock', 'c+');
    if (!$lock) {
        return false;
    }
    @flock($lock, LOCK_EX);
    $m = px_manifest_read($file);
    $m['docs'][(string) $entry['doc']] = [
        'size' => (int) $entry['size'],
        'head' => (int) $entry['head'],
        'tail' => (int) $entry['tail'],
        'at'   => time(),
    ];
    $tmp = $file . '.' . getmypid() . '.tmp';
    $ok = @file_put_contents(
        $tmp,
        json_encode($m, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)
    ) !== false;
    if ($ok) {
        $ok = @rename($tmp, $file);
    }
    if (!$ok) {
        @unlink($tmp);
    }
    @flock($lock, LOCK_UN);
    fclose($lock);
    return $ok;
}

/** Manifestdan hujjatni flock ostida olib tashlaydi (atomik). */
function px_manifest_del($file, $doc)
{
    $lock = @fopen($file . '.lock', 'c+');
    if (!$lock) {
        return false;
    }
    @flock($lock, LOCK_EX);
    $m = px_manifest_read($file);
    if (!isset($m['docs'][(string) $doc])) {
        @flock($lock, LOCK_UN);
        fclose($lock);
        return true;
    }
    unset($m['docs'][(string) $doc]);
    $tmp = $file . '.' . getmypid() . '.tmp';
    $ok = @file_put_contents(
        $tmp,
        json_encode($m, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)
    ) !== false;
    if ($ok) {
        $ok = @rename($tmp, $file);
    }
    if (!$ok) {
        @unlink($tmp);
    }
    @flock($lock, LOCK_UN);
    fclose($lock);
    return $ok;
}

/**
 * DUM prefiksi `moov` indeksini TO'LIQ qoplaydimi?
 *
 * `moov` — MP4 indeksi. Telegram fayllarida u oxirida turadi, ya'ni birinchi
 * kadr uchun aynan shu qism kerak. Agar indeks 6 MB lik dum ichiga sig'masa,
 * prefiks foyda bermaydi — buni build paytida aytib qo'yamiz.
 *
 * Qaytaradi: ['start'=>..., 'size'=>...] | false (topilmadi) | null (dum yo'q).
 */
function px_moov_in_tail($tailFile, $tailLen, $size)
{
    if ($tailLen <= 0 || $size <= 0) {
        return null;
    }
    $tail = @file_get_contents($tailFile);
    if ($tail === false || strlen($tail) !== $tailLen) {
        return null;
    }
    $tailStart = $size - $tailLen;
    $pos = 0;
    $fallback = false;
    while (($pos = strpos($tail, 'moov', $pos)) !== false) {
        if ($pos >= 4) {
            $sz = 0;
            $hdr = substr($tail, $pos - 4, 4);
            if (strlen($hdr) === 4) {
                $u = unpack('N', $hdr);
                $sz = (int) ($u[1] ?? 0);
            }
            $start = $tailStart + $pos - 4;
            // Eng ishonchli belgi: quti AYNAN fayl oxirida tugaydi.
            if ($sz >= 4096 && $start + $sz === $size) {
                return ['start' => $start, 'size' => $sz];
            }
            if ($sz >= 4096 && !$fallback) {
                $fallback = ['start' => $start, 'size' => $sz];
            }
        }
        $pos += 4;
    }
    return $fallback;
}

/**
 * Faylning [from, to) oralig'ini `path` ga yozadi.
 *
 * MadelineProto 8.x da `upload.getFile` ni to'g'ridan-to'g'ri chaqirish
 * TA'QIQLANGAN (blacklist) — kutubxona o'zi tavsiya qiladigan
 * `downloadToCallable` ishlatiladi: u DC almashish, CDN, file_reference,
 * FLOOD_WAIT va parallel bo'laklarni o'zi boshqaradi.
 *
 * Uzun yuklamalarda (2–3 GB fayllar, sekin DC) kutubxona ba'zan
 * `The operation was cancelled` bilan uziladi. Shu sababli yozilgan
 * baytdan DAVOM etib qayta urinamiz — boshidan yuklash shart emas.
 *
 * Qaytaradi: yozilgan baytlar soni.
 */
function px_download($api, array $doc, $from, $to, $path)
{
    $from   = max(0, (int) $from);
    $to     = (int) $to;
    $expect = $to - $from;
    if ($expect <= 0) {
        return 0;
    }

    $fp = @fopen($path, 'wb');
    if (!$fp) {
        throw new RuntimeException('faylni ochib bo\'lmadi: ' . $path);
    }

    $written = 0;
    $t0 = microtime(true);
    $tries = 0;
    $maxTries = 5;

    try {
        while ($written < $expect) {
            $tries++;
            // Qayta urinishda aynan yozilgan joydan boshlaymiz.
            $base = $from + $written;
            try {
                // `seekable = false` — bo'laklar qat'iy tartibda keladi, ya'ni
                // callback'da faqat ketma-ket yozamiz (fayl teshik qolmaydi).
                $api->downloadToCallable(
                    $doc,
                    function (string $payload, int $off) use ($fp, $from, $base, &$written, $t0) {
                        if ($off < $base) {             // tekislash/ustma-ust bo'lak
                            $payload = substr($payload, $base - $off);
                            $off = $base;
                        }
                        if ($payload === '') {
                            return;
                        }
                        if (@fseek($fp, $off - $from) !== 0) {
                            throw new RuntimeException('fseek xato');
                        }
                        if (@fwrite($fp, $payload) === false) {
                            throw new RuntimeException('diskka yozib bo\'lmadi');
                        }
                        $written += strlen($payload);
                        $mb = $written / 1048576;
                        if ($mb >= 1) {
                            px_say('    ' . round($mb, 1) . ' MB · '
                                . round($written / 1048576 / max(0.001, microtime(true) - $t0), 1) . ' MB/s');
                        }
                    },
                    null,            // status callback
                    false,           // seekable
                    $base,
                    $to,             // eksklyuziv (kutubxona shunday hisoblaydi)
                    512 * 1024       // Telegram bo'lak o'lchami
                );
            } catch (\Throwable $e) {
                clearstatcache(true, $path);
                $real = @filesize($path);
                if ($real !== false && $real > $written) {
                    $written = $real;           // faylga tushgan baytlar yo'qolmasin
                }
                if ($written >= $expect) {
                    break;
                }
                if ($tries >= $maxTries) {
                    throw $e;
                }
                $wait = min(20, 3 * $tries);
                px_say('  … uzildi (' . $e->getMessage() . ') — '
                    . round($written / 1048576, 1) . ' MB dan davom, '
                    . $wait . ' s kutamiz [' . $tries . '/' . $maxTries . ']');
                sleep($wait);
            }
        }
    } finally {
        fclose($fp);
    }

    return $written;
}

// ------------------------------------------------------------------- --list
if ($opt['list']) {
    $m = px_manifest_read($manifest);
    if ($opt['json']) {
        fwrite(STDOUT, json_encode($m, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL);
        exit(0);
    }
    if (!$m['docs']) {
        px_say('manifest bo\'sh');
        exit(0);
    }
    foreach ($m['docs'] as $d => $e) {
        px_say(sprintf(
            '%s  size=%s  head=%s  tail=%s  at=%s',
            $d,
            number_format((float) ($e['size'] ?? 0), 0, '.', ' '),
            number_format((float) ($e['head'] ?? 0), 0, '.', ' '),
            number_format((float) ($e['tail'] ?? 0), 0, '.', ' '),
            date('Y-m-d H:i', (int) ($e['at'] ?? 0))
        ));
    }
    exit(0);
}

// ----------------------------------------------------------------- --verify
if ($opt['verify']) {
    $m = px_manifest_read($manifest);
    $bad = 0;
    foreach ($m['docs'] as $d => $e) {
        $size = (int) ($e['size'] ?? 0);
        $hd   = (int) ($e['head'] ?? 0);
        $tl   = (int) ($e['tail'] ?? 0);
        $hf   = $dir . '/' . $d . '.head';
        $tf   = $dir . '/' . $d . '.tail';
        $lines = [];
        if (!is_file($hf) || filesize($hf) !== $hd) {
            $lines[] = '! head fayl noto\'g\'ri';
        }
        if ($tl > 0 && (!is_file($tf) || filesize($tf) !== $tl)) {
            $lines[] = '! tail fayl noto\'g\'ri';
        }
        $moov = px_moov_in_tail($tf, $tl, $size);
        if ($tl <= 0) {
            $lines[] = '! dum yo\'q';
        } elseif (!is_array($moov)) {
            $lines[] = '! `moov` topilmadi';
        } elseif ($moov['start'] < $size - $tl) {
            $lines[] = '! `moov` dumga sig\'magan';
        } else {
            $lines[] = '✓ `moov` ' . round($moov['size'] / 1048576, 1) . ' MB dum ichida';
        }
        if (($hd % 524288) !== 0 || ($tl > 0 && (($size - $tl) % 524288) !== 0)) {
            $lines[] = '! chegara 512 KB ga tekis emas (qayta qurish tavsiya)';
        }
        if ($lines && strpos(implode(' ', $lines), '!') !== false) {
            $bad++;
        }
        px_say($d . '  size=' . number_format($size, 0, '.', ' ') . '  ' . implode(' · ', $lines));
    }
    if (!$m['docs']) {
        px_say('manifest bo\'sh');
    }
    exit($bad > 0 ? 1 : 0);
}

// ------------------------------------------------------------------ ish ro'yxati
$urls = [];
if ($opt['url'] !== '') {
    $urls[] = $opt['url'];
} elseif ($opt['channel'] !== '' && $opt['post'] > 0) {
    $urls[] = 'https://t.me/' . $opt['channel'] . '/' . $opt['post'];
} elseif ($opt['all']) {
    $db = Database::getInstance();
    $seen = [];
    $rows = $db->fetchAll(
        "SELECT e.video_url
           FROM episodes e
           JOIN content c ON c.id = e.content_id
          WHERE c.status = 'published' AND e.video_url LIKE '%t.me/%'
          ORDER BY c.views DESC, c.id DESC, e.episode_number ASC, e.id ASC
          LIMIT 500"
    );
    if (!$rows) {
        $rows = [];
    }
    $reels = $db->fetchAll(
        "SELECT video_url FROM reels WHERE video_url LIKE '%t.me/%' ORDER BY id DESC LIMIT 100"
    );
    if ($reels) {
        $rows = array_merge($rows, $reels);
    }
    foreach ($rows as $r) {
        $u = trim((string) ($r['video_url'] ?? ''));
        $p = TgPull::parseUrl($u);
        if (!$p) {
            continue;
        }
        $k = strtolower($p['label']) . '/' . $p['id'];
        if (isset($seen[$k])) {
            continue;
        }
        $seen[$k] = true;
        $urls[] = $u;
    }
    if ($opt['limit'] > 0) {
        $urls = array_slice($urls, 0, $opt['limit']);
    }
}

if (!$urls) {
    fwrite(STDERR, "Ishlatish:\n"
        . "  php cli/prefix-build.php --url=https://t.me/kanal/12\n"
        . "  php cli/prefix-build.php --channel=kanal --post=12\n"
        . "  php cli/prefix-build.php --all [--limit=20] [--force]\n"
        . "  php cli/prefix-build.php --list [--json]\n");
    exit(2);
}

px_say('Hujjatlar: ' . count($urls) . ' · bosh ' . ($headBytes / 1048576)
    . ' MB · dum ' . ($tailBytes / 1048576) . ' MB');

$results = [];
$okCount = 0;
$skipCount = 0;
$errCount = 0;

TgPull::sessionLockAcquire(1800);
try {
    $api = TgPull::openBotSession();

    foreach ($urls as $url) {
        $parsed = TgPull::parseUrl($url);
        $label = $parsed ? ($parsed['label'] . '/' . $parsed['id']) : $url;
        try {
            $info = TgPull::fetchDocInfo($api, $url);
            $doc  = $info['doc'] ?? null;
            if (!$doc || empty($doc['id'])) {
                throw new RuntimeException('document topilmadi');
            }
            $docId = (string) $doc['id'];
            $size  = (int) ($doc['size'] ?? 0);
            $fr    = px_fr($doc['file_reference'] ?? '');
            if ($fr === '' || $size <= 0) {
                throw new RuntimeException('file_reference yoki hajm yo\'q');
            }

            $headLen = min($headBytes, $size);
            $headLen -= $headLen % 4096;
            if ($headLen < 4096) {
                throw new RuntimeException('fayl juda kichik (' . $size . ' bayt)');
            }
            // Prefiks chegaralari 512 KB ga TEKISLANADI (SW shunday o'qiydi):
            // Service Worker bo'laklarni 512 KB oynalarda, oynani pastga
            // tekislab so'raydi. Chegara tekis bo'lmasa, chegara ustidagi oyna
            // prefiksga sig'may Telegram'ga ketardi.
            $al = 512 * 1024;
            if ($headLen < $size && ($headLen % $al) !== 0) {
                $up = $headLen + ($al - $headLen % $al);
                if ($up < $size) {
                    $headLen = $up;
                }
            }
            if ($headLen >= $size) {
                $headLen = $size;                 // butun fayl boshga sig'adi
                $tailLen = 0;
            } else {
                $tailLen = min($tailBytes, $size - $headLen);
                $tailLen -= $tailLen % 4096;
                $tStart = $size - $tailLen;
                if ($tStart > 0 && ($tStart % $al) !== 0) {
                    $tStart -= $tStart % $al;
                    $tailLen = $size - $tStart;
                }
                if ($tailLen < 4096) {
                    $tailLen = 0;
                }
            }

            $headFile = $dir . '/' . $docId . '.head';
            $tailFile = $dir . '/' . $docId . '.tail';

            $m = px_manifest_read($manifest);
            $old = $m['docs'][$docId] ?? null;
            $same = $old
                && (int) ($old['size'] ?? 0) === $size
                && (int) ($old['head'] ?? 0) === $headLen
                && (int) ($old['tail'] ?? 0) === $tailLen
                && is_file($headFile)
                && ($tailLen === 0 || is_file($tailFile))
                && filesize($headFile) == $headLen
                && ($tailLen === 0 || filesize($tailFile) == $tailLen);

            if ($same && !$opt['force']) {
                $skipCount++;
                px_say('= ' . $label . ' — allaqachon tayyor (' . $docId . ')');
                $results[] = ['url' => $url, 'doc' => $docId, 'skip' => true];
                continue;
            }

            px_say('↓ ' . $label . ' · doc ' . $docId . ' · ' . round($size / 1048576, 1)
                . ' MB · dc ' . (int) ($doc['dc_id'] ?? 0));

            // ---- BOSH ----
            $tmp = $headFile . '.' . getmypid() . '.tmp';
            px_say('  bosh 0–' . round($headLen / 1048576, 1) . ' MB');
            $got = px_download($api, $doc, 0, $headLen, $tmp);
            clearstatcache(true, $tmp);
            if ($got !== $headLen || @filesize($tmp) !== $headLen) {
                @unlink($tmp);
                throw new RuntimeException('bosh qism to\'liq kelmadi (' . $got . '/' . $headLen . ')');
            }

            // ---- DUM (`moov`) ----
            if ($tailLen > 0) {
                $tailStart = $size - $tailLen;
                $tmpT = $tailFile . '.' . getmypid() . '.tmp';
                px_say('  dum ' . round($tailStart / 1048576, 1) . '–'
                    . round($size / 1048576, 1) . ' MB');
                $gotT = px_download($api, $doc, $tailStart, $size, $tmpT);
                clearstatcache(true, $tmpT);
                if ($gotT !== $tailLen || @filesize($tmpT) !== $tailLen) {
                    @unlink($tmpT);
                    throw new RuntimeException('dum qism to\'liq kelmadi (' . $gotT . '/' . $tailLen . ')');
                }
            }

            // Ikkala fayl ham yozildi — endi ularni o'z nomiga ko'chiramiz.
            // AVVAL manifestdan olib tashlaymiz: almashtirish paytida eski
            // yozuv qolib ketsa, `api/prefix.php` yangi fayldan eski siljish
            // bilan noto'g'ri bayt berishi mumkin (bir lahzaga bo'lsa ham).
            px_manifest_del($manifest, $docId);

            @chmod($tmp, 0644);
            if (!@rename($tmp, $headFile)) {
                @unlink($tmp);
                if (isset($tmpT)) {
                    @unlink($tmpT);
                }
                throw new RuntimeException('head faylini almashtirib bo\'lmadi');
            }
            if ($tailLen > 0 && isset($tmpT)) {
                @chmod($tmpT, 0644);
                if (!@rename($tmpT, $tailFile)) {
                    @unlink($tmpT);
                    throw new RuntimeException('tail faylini almashtirib bo\'lmadi');
                }
            } elseif (is_file($tailFile)) {
                @unlink($tailFile);
            }

            // ---- TEKSHIRUV: `moov` indeksi dum ichidami? ----
            // Aks holda prefiks birinchi kadrni tezlashtirmaydi (indeks
            // Telegram'dan kelishi kerak bo'ladi).
            $moov = px_moov_in_tail($tailFile, $tailLen, $size);
            if ($tailLen <= 0) {
                px_say('  ! dum yo\'q — `moov` Telegram\'dan keladi (--tail=6291456 tavsiya)');
            } elseif (!is_array($moov)) {
                px_say('  ! dum ichida `moov` topilmadi — ehtimol faststart fayl');
            } elseif ($moov['start'] < $size - $tailLen) {
                px_say('  ! `moov` dum ichiga sig\'madi — --tail=' . (2 * $tailLen) . ' bilan qayta quring');
            } else {
                px_say('  ✓ `moov` ' . round($moov['size'] / 1048576, 1)
                    . ' MB — dum prefiksi ichida');
            }

            if (!px_manifest_put($manifest, [
                'doc'  => $docId,
                'size' => $size,
                'head' => $headLen,
                'tail' => $tailLen,
            ])) {
                throw new RuntimeException('manifest yozilmadi');
            }

            $okCount++;
            $results[] = [
                'url'  => $url,
                'doc'  => $docId,
                'size' => $size,
                'head' => $headLen,
                'tail' => $tailLen,
            ];
            px_say('  ✓ tayyor · ' . round((microtime(true) - $t0), 1) . ' s');
        } catch (\Throwable $e) {
            $errCount++;
            $results[] = ['url' => $url, 'error' => $e->getMessage()];
            px_say('  ✗ ' . $label . ': ' . $e->getMessage());
        }
    }
} catch (\Throwable $e) {
    fwrite(STDERR, 'XATO: ' . $e->getMessage() . PHP_EOL);
    TgPull::sessionLockRelease();
    exit(1);
} finally {
    TgPull::sessionLockRelease();
}

if ($opt['json']) {
    fwrite(STDOUT, json_encode([
        'ok'    => $okCount,
        'skip'  => $skipCount,
        'error' => $errCount,
        'items' => $results,
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . PHP_EOL);
} else {
    px_say('Jami: ' . $okCount . ' yozildi · ' . $skipCount . ' tayyor edi · '
        . $errCount . ' xato · ' . round((microtime(true) - $t0), 1) . ' s');
}

exit($errCount > 0 ? 1 : 0);
