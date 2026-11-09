<?php
// ============================================================================
// cli/hls-progressive.php - "avval boshi" rejimi: film YUKLANAYOTGAN PAYTDA
// ffmpeg uni parallel HLS segmentlarga bo'ladi (api/hls.php index.m3u8 ni
// o'sib borayotgan holda beradi) - tomoshabin film to'liq yuklanishini
// KUTMAYDI: birinchi 10-15 soniya bir necha soniyada tayyor bo'ladi.
//
// Qanday ishlaydi:
//   1) source.mp4 yuklanib borayotganda UZLUKSIZ (teshiksiz) boshi head.mp4 ga
//      ko'chiriladi. (Parallel yuklashda fayl ichida hali yozilmagan "teshik"
//      bo'lishi mumkin - ular nol bayt bo'lib ko'rinadi. Shuning uchun faqat
//      nol bo'lmagan to'liq bloklar olinadi: ffmpeg hech qachon axlat o'qimaydi.)
//   2) ffmpeg head.mp4 ni "-follow 1" bilan o'qiydi (fayl o'sishini kutadi) va
//      -hls_playlist_type event bilan segmentlarni darhol chiqaradi.
//   3) MP4 o'z moov atomi orqali tugaganini biladi: oxirgi namuna o'qilgach
//      ffmpeg O'ZI to'g'ri tugaydi va #EXT-X-ENDLIST yozadi.
//   4) Fayl "faststart" bo'lmasa (moov oxirida) ffmpeg darhol xato beradi -
//      bu holda hls-worker eski (to'liq yuklab, keyin bo'laklash) usulga o'tadi.
//
// Sinov (Linux, ffmpeg 6.1): tartibsiz parallel yuklashda ham natija asl
// nusxa bilan bayt-bayt bir xil; birinchi segmentlar 0.15 s da chiqdi.
// ============================================================================

/** Yangi progressive holat. */
function hlsProgNew($hlsDir, $source, $ffBin, $segSec)
{
    $head = $hlsDir . '/head.mp4';
    @unlink($head);
    return [
        'dir' => $hlsDir, 'src' => $source, 'head' => $head,
        'ff' => $ffBin, 'seg' => (int) $segSec,
        'wm' => 0,            // head.mp4 ga ko'chirilgan uzluksiz bayt
        'out' => null,        // head.mp4 yozuv handle
        'proc' => null, 'started' => false, 'failed' => false,
        'exit' => null,
    ];
}

/** ffmpeg hali ishlayaptimi? (chiqish kodi birinchi marta saqlanadi) */
function hlsProgPoll(array &$pg)
{
    if (!is_resource($pg['proc'])) {
        return false;
    }
    $st = @proc_get_status($pg['proc']);
    if (is_array($st) && !empty($st['running'])) {
        return true;
    }
    if ($pg['exit'] === null) {
        $pg['exit'] = is_array($st) ? (int) $st['exitcode'] : -1;
    }
    return false;
}

function hlsProgStart(array &$pg)
{
    $pg['started'] = true;
    if (PHP_VERSION_ID < 70400) {          // massiv-buyruq (shell'siz) kerak
        $pg['failed'] = true;
        return;
    }
    foreach (glob($pg['dir'] . '/seg_*.ts') ?: [] as $f) {
        @unlink($f);
    }
    @unlink($pg['dir'] . '/index.m3u8');
    $args = [
        $pg['ff'], '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
        '-follow', '1', '-i', 'file:head.mp4',
        '-c', 'copy',
        '-f', 'hls', '-hls_time', (string) $pg['seg'], '-hls_list_size', '0',
        '-hls_playlist_type', 'event',
        '-hls_segment_filename', 'seg_%05d.ts',
        'index.m3u8',
    ];
    $nul  = (DIRECTORY_SEPARATOR === '\\') ? 'NUL' : '/dev/null';
    $desc = [0 => ['file', $nul, 'r'], 1 => ['file', $nul, 'w'], 2 => ['file', $pg['dir'] . '/ffmpeg.log', 'w']];
    $proc = @proc_open($args, $desc, $pipes, $pg['dir']);
    if (!is_resource($proc)) {
        $pg['failed'] = true;
        return;
    }
    $pg['proc'] = $proc;
}

/**
 * source.mp4 ning yangi uzluksiz qismini head.mp4 ga ko'chiradi va (1 MB dan
 * keyin) ffmpeg ni ishga tushiradi. Yuklash callback'idan tez-tez chaqiriladi.
 * $final=true: yuklash tugadi - qolgan hammasini (nol bloklar ham) ko'chiradi.
 */
function hlsProgPump(array &$pg, $final = false)
{
    if ($pg['failed']) {
        return;
    }
    // ffmpeg erta yiqilgan bo'lsa (masalan moov oxirida) - behuda ko'chirmaymiz
    if ($pg['proc'] && !hlsProgPoll($pg) && $pg['exit'] !== 0) {
        $pg['failed'] = true;
        return;
    }
    clearstatcache(true, $pg['src']);
    $sz = (int) @filesize($pg['src']);
    if ($sz > $pg['wm']) {
        $in = @fopen($pg['src'], 'rb');
        if (!$in) {
            return;
        }
        if (!$pg['out']) {
            $pg['out'] = @fopen($pg['head'], 'ab');
            if (!$pg['out']) {
                $pg['failed'] = true;
                fclose($in);
                return;
            }
        }
        fseek($in, $pg['wm']);
        $B = 262144;
        $moved = 0;
        while ($moved < 96 * 1048576) {
            $chunk = fread($in, $B);
            if ($chunk === false || $chunk === '') {
                break;
            }
            $len = strlen($chunk);
            if (!$final) {
                if ($len < $B) {
                    break;                          // oxirgi to'liq bo'lmagan blok - keyingi safar
                }
                if (strspn($chunk, "\0") === $len) {
                    break;                          // nol blok = hali yozilmagan teshik
                }
            }
            fwrite($pg['out'], $chunk);
            $pg['wm'] += $len;
            $moved     += $len;
        }
        fclose($in);
        fflush($pg['out']);
    }
    if (!$pg['started'] && ($pg['wm'] >= 1048576 || ($final && $pg['wm'] > 0))) {
        hlsProgStart($pg);
    }
}

/** ffmpeg o'zi tugashini kutadi. true = to'liq HLS (ENDLIST bilan) tayyor. */
function hlsProgFinish(array &$pg, $timeoutSec = 300)
{
    if ($pg['failed'] || !is_resource($pg['proc'])) {
        return false;
    }
    $t0 = time();
    while (hlsProgPoll($pg)) {
        if ((time() - $t0) > $timeoutSec) {
            hlsProgAbort($pg);
            return false;
        }
        usleep(300000);
    }
    if ($pg['exit'] !== 0) {
        $pg['failed'] = true;
        return false;
    }
    $m = @file_get_contents($pg['dir'] . '/index.m3u8');
    return is_string($m) && strpos($m, '#EXT-X-ENDLIST') !== false;
}

/** ffmpeg ni to'xtatadi, chala natijalarni tozalaydi (eski usulga o'tishdan oldin). */
function hlsProgAbort(array &$pg)
{
    if (is_resource($pg['proc'])) {
        @proc_terminate($pg['proc']);
        usleep(300000);
        @proc_close($pg['proc']);
    }
    $pg['proc']   = null;
    $pg['failed'] = true;
    hlsProgCleanup($pg, true);
}

/** head.mp4 ni (va $partial bo'lsa chala segmentlarni) o'chiradi. */
function hlsProgCleanup(array &$pg, $partial = false)
{
    if ($pg['out']) {
        @fclose($pg['out']);
        $pg['out'] = null;
    }
    @unlink($pg['head']);
    if ($partial) {
        foreach (glob($pg['dir'] . '/seg_*.ts') ?: [] as $f) {
            @unlink($f);
        }
        @unlink($pg['dir'] . '/index.m3u8');
    }
}
