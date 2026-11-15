<?php
// ============================================================================
// includes/VideoPrep.php — videoni strimingga tayyorlash (tekshirish + tuzatish)
// ============================================================================
// Maqsad: HAR BIR video brauzerda birinchi so'rovdanoq o'ynasin:
//   * H.264 (video) + AAC (audio) — barcha brauzer/telefon qo'llab-quvvatlaydi;
//   * `moov` atomi fayl boshida (faststart) — pleyer kutmasdan boshlaydi;
//   * kalit kadr har 2 soniyada (-g 48 @24fps) — seek tez, HLS segmentlari toza;
//   * 1080p dan baland emas, bitrate cheklangan — sekin internetda ham oqadi;
//   * MP4 konteyner — hamma joyda ishlaydi.
//
// Rejimlar (.env: VIDEO_PREP):
//   off        — hech narsa qilmaydi (tekshirish ham yo'q);
//   faststart  — faqat moov'ni boshiga ko'chiradi (qayta kodlamaydi);
//   remux      — konteynerni MP4'ga o'giradi, oqimlarni nusxalaydi (tez);
//   normalize  — to'liq H.264/AAC transcode (sekin, eng ishonchli);
//   auto       — CLI: normalize, web: faststart (standart).
//
// MUHIM: HTTP so'rov ichida uzoq transcode qilish saytni sekinlashtiradi.
// Shuning uchun web rejimida transcode faqat kichik fayllarga ruxsat etiladi
// (VIDEO_PREP_WEB_MAX_MB / VIDEO_PREP_WEB_MAX_SEC), aks holda asl fayl
// o'zgarishsiz qoladi va `php cli/video-prep.php --fix` bilan tunda tuzatiladi.
//
// ffmpeg har doim past ustuvorlikda ishlaydi (cli/proc-priority.php).
// ============================================================================

require_once __DIR__ . '/FastStart.php';

if (is_file(__DIR__ . '/../cli/proc-priority.php')) {
    require_once __DIR__ . '/../cli/proc-priority.php';
}

final class VideoPrep
{
    public const MODE_OFF = 'off';
    public const MODE_FASTSTART = 'faststart';
    public const MODE_REMUX = 'remux';
    public const MODE_NORMALIZE = 'normalize';

    /** @var string|null CLI `--mode=` uchun vaqtinchalik rejim */
    private static $modeOverride = null;

    /** Amaldagi rejim (env VIDEO_PREP; `auto` CLI/web bo'yicha yechiladi). */
    public static function mode(): string
    {
        if (self::$modeOverride !== null) {
            return self::$modeOverride;
        }
        $raw = defined('VIDEO_PREP') ? strtolower(trim((string) VIDEO_PREP)) : 'auto';
        if (!in_array($raw, ['off', 'faststart', 'remux', 'normalize', 'auto'], true)) {
            $raw = 'auto';
        }
        if ($raw !== 'auto') {
            return $raw;
        }
        return PHP_SAPI === 'cli' ? self::MODE_NORMALIZE : self::MODE_FASTSTART;
    }

    /** CLI `--mode=` uchun bir martalik rejim (config'dagi VIDEO_PREP'ni bosadi). */
    public static function setMode(string $mode): void
    {
        $mode = strtolower(trim($mode));
        self::$modeOverride = in_array($mode, ['off', 'faststart', 'remux', 'normalize'], true)
            ? $mode
            : null;
    }

    /**
     * ffprobe/atomlar orqali videoning holatini o'qiydi.
     *
     * @return array{ok:bool,path:string,size:int,container:string,duration:float,
     *               flat:bool,video:?array,audio:?array,faststart:bool,
     *               gop_max:?float,error:?string}
     */
    public static function inspect($path, array $opts = []): array
    {
        $path = (string) $path;
        $info = [
            'ok' => false,
            'path' => $path,
            'size' => is_file($path) ? (int) @filesize($path) : 0,
            'container' => '',
            'duration' => 0.0,
            'video' => null,
            'audio' => null,
            'faststart' => false,
            'gop_max' => null,
            'error' => null,
        ];

        if (!is_file($path) || $info['size'] <= 0) {
            $info['error'] = 'fayl topilmadi';
            return $info;
        }
        if (!self::binary('FFPROBE_BIN', 'ffprobe') || !function_exists('proc_open')) {
            $info['error'] = 'ffprobe mavjud emas';
            return $info;
        }

        $probe = self::run([
            self::binary('FFPROBE_BIN', 'ffprobe'),
            '-v', 'error',
            '-hide_banner',
            '-print_format', 'json',
            '-show_format',
            '-show_streams',
            $path,
        ], 120);

        if ($probe['exit'] !== 0 || trim($probe['stdout']) === '') {
            $info['error'] = 'ffprobe: ' . self::shortError($probe['stderr']);
            return $info;
        }

        $data = json_decode($probe['stdout'], true);
        if (!is_array($data)) {
            $info['error'] = 'ffprobe javobi o\'qilmadi';
            return $info;
        }

        $format = is_array($data['format'] ?? null) ? $data['format'] : [];
        $info['container'] = strtolower((string) ($format['format_name'] ?? ''));
        $info['duration'] = (float) ($format['duration'] ?? 0);

        foreach (($data['streams'] ?? []) as $stream) {
            if (!is_array($stream)) {
                continue;
            }
            $type = (string) ($stream['codec_type'] ?? '');
            if ($type === 'video' && ($stream['disposition']['attached_pic'] ?? 0) != 1 && $info['video'] === null) {
                $info['video'] = [
                    'codec' => strtolower((string) ($stream['codec_name'] ?? '')),
                    'width' => (int) ($stream['width'] ?? 0),
                    'height' => (int) ($stream['height'] ?? 0),
                    'pix_fmt' => strtolower((string) ($stream['pix_fmt'] ?? '')),
                    'fps' => self::fps((string) ($stream['avg_frame_rate'] ?? $stream['r_frame_rate'] ?? '')),
                    'bitrate' => (int) ($stream['bit_rate'] ?? 0),
                    'profile' => (string) ($stream['profile'] ?? ''),
                ];
                if ($info['duration'] <= 0) {
                    $info['duration'] = (float) ($stream['duration'] ?? 0);
                }
            } elseif ($type === 'audio' && $info['audio'] === null) {
                $info['audio'] = [
                    'codec' => strtolower((string) ($stream['codec_name'] ?? '')),
                    'channels' => (int) ($stream['channels'] ?? 0),
                    'sample_rate' => (int) ($stream['sample_rate'] ?? 0),
                    'bitrate' => (int) ($stream['bit_rate'] ?? 0),
                ];
            }
        }

        if ($info['video'] === null) {
            $info['error'] = 'video oqimi yo\'q';
            return $info;
        }

        // Butun fayl bitrate'i: MP4'da ko'pincha stream bit_rate bo'sh bo'ladi.
        if ($info['video']['bitrate'] <= 0) {
            $total = (int) ($format['bit_rate'] ?? 0);
            if ($total > 0) {
                $audioRate = (int) ($info['audio']['bitrate'] ?? 0);
                $info['video']['bitrate'] = max(0, $total - $audioRate);
            }
        }

        $isMp4 = self::isMp4Container($info['container']);
        if ($isMp4) {
            $info['faststart'] = FastStart::hasFastStart($path);
        }

        // Kalit kadrlar oralig'i faqat kerak bo'lganda o'lchanadi (sekinroq).
        if (!empty($opts['gop']) && $info['video']['codec'] === 'h264' && $info['duration'] > 0) {
            $info['gop_max'] = self::measureGop(
                $path,
                min(12.0, max(2.0, $info['duration'])),
                $info['video']['fps']
            );
        }

        $info['ok'] = true;
        return $info;
    }

    /**
     * Fayl uchun kerakli amal: `ok` | `remux` | `transcode` | `unsupported`.
     *
     * @return array{action:string,reasons:array<int,string>}
     */
    public static function judge(array $info, array $opts = []): array
    {
        $reasons = [];
        if (empty($info['ok'])) {
            return ['action' => 'unsupported', 'reasons' => [$info['error'] ?: 'o\'qilmadi']];
        }
        if (empty($info['video'])) {
            return ['action' => 'unsupported', 'reasons' => ['video oqimi yo\'q']];
        }

        $maxHeight = (int) ($opts['max_height'] ?? self::cfg('VIDEO_PREP_HEIGHT', 1080));
        $maxKbps   = max(400, (int) ($opts['max_kbps'] ?? self::cfg('VIDEO_PREP_BITRATE', 2800)));
        $gopSec    = max(1.0, (float) ($opts['gop_sec'] ?? self::cfg('VIDEO_PREP_GOP_SEC', 2)));

        $v = $info['video'];
        $a = $info['audio'];

        if ($v['codec'] !== 'h264') {
            $reasons[] = 'video kodek ' . ($v['codec'] !== '' ? $v['codec'] : '?') . ' (H.264 kerak)';
        }
        if ($v['pix_fmt'] !== '' && !in_array($v['pix_fmt'], ['yuv420p', 'yuvj420p'], true)) {
            $reasons[] = 'pixel formati ' . $v['pix_fmt'] . ' (yuv420p kerak)';
        }
        if ($v['height'] > $maxHeight) {
            $reasons[] = 'balandligi ' . $v['height'] . 'p (<= ' . $maxHeight . 'p kerak)';
        }
        if ($v['bitrate'] > 0 && $v['bitrate'] > $maxKbps * 1350) {   // +35% zapas
            $reasons[] = 'bitrate ' . round($v['bitrate'] / 1000) . 'k (<= ' . $maxKbps . 'k kerak)';
        }
        if ($a !== null && $a['codec'] !== 'aac') {
            $reasons[] = 'audio kodek ' . ($a['codec'] !== '' ? $a['codec'] : '?') . ' (AAC kerak)';
        }
        if ($info['gop_max'] !== null && $info['gop_max'] > $gopSec * 1.25) {
            $reasons[] = 'kalit kadr oralig\'i ' . round($info['gop_max'], 1) . 's (> ' . $gopSec . 's)';
        }

        if ($reasons !== []) {
            return ['action' => 'transcode', 'reasons' => $reasons];
        }

        $reasons = [];
        if (!self::isMp4Container($info['container'])) {
            $reasons[] = 'konteyner ' . ($info['container'] !== '' ? $info['container'] : '?') . ' (MP4 kerak)';
        }
        if (empty($info['faststart'])) {
            $reasons[] = 'moov atomi fayl oxirida (faststart kerak)';
        }
        if ($reasons !== []) {
            return ['action' => 'remux', 'reasons' => $reasons];
        }

        return ['action' => 'ok', 'reasons' => []];
    }

    /**
     * Videoni tayyorlaydi. Manba o'zgarmaydi — natija vaqtinchalik faylda
     * (yoki o'zgarish kerak bo'lmasa, manbaning o'zi qaytadi).
     *
     * @return array{path:string,name:string,optimized:bool,temporary:bool,
     *               mode:string,action:string,reasons:array<int,string>,
     *               info:?array,elapsed:float,error:?string}
     */
    public static function prepare($source, $originalName, array $opts = []): array
    {
        $source = (string) $source;
        $originalName = (string) $originalName;
        $result = [
            'path' => $source,
            'name' => $originalName,
            'optimized' => false,
            'temporary' => false,
            'mode' => self::mode(),
            'action' => 'skip',
            'reasons' => [],
            'info' => null,
            'elapsed' => 0.0,
            'error' => null,
        ];

        if ($result['mode'] === self::MODE_OFF || !is_file($source)) {
            return $result;
        }
        if (!function_exists('proc_open') || !self::binary('FFMPEG_BIN', 'ffmpeg')) {
            $result['error'] = 'ffmpeg mavjud emas';
            return $result;
        }
        if (isset($opts['max_bytes']) && (int) $opts['max_bytes'] > 0
            && (int) @filesize($source) > (int) $opts['max_bytes']) {
            $result['error'] = 'fayl juda katta';
            return $result;
        }

        $info = self::inspect($source, ['gop' => true]);
        $result['info'] = $info;
        $judge = self::judge($info, $opts);
        $action = $judge['action'];
        $result['reasons'] = $judge['reasons'];
        $result['action'] = $action;

        if ($action === 'unsupported' || $action === 'ok') {
            return $result;
        }

        // Rejim amalni cheklaydi: faststart/remux o'zi qayta kodlamaydi.
        // Transcode faqat quyidagilarda ruxsat etiladi:
        //   * mode=normalize;
        //   * opts['transcode'] (CLI majburiy rejimi);
        //   * mode=faststart + web so'rovi + fayl kichik (WEB_MAX_MB/SEC);
        //   * opts['allow_upgrade'] (chaqiruvchi ochiq ruxsat bergan).
        if ($action === 'transcode') {
            $webUpgrade = $result['mode'] === self::MODE_FASTSTART
                && !empty($opts['web'])
                && self::webCanTranscode($info, $opts);
            $allowed = $result['mode'] === self::MODE_NORMALIZE
                || !empty($opts['transcode'])
                || !empty($opts['allow_upgrade'])
                || $webUpgrade;

            if (!$allowed) {
                // Qayta kodlash mumkin emas — nusxalash xavfsiz bo'lsa, hech
                // bo'lmasa faststart/MP4'ni tuzatamiz (sabablar saqlanadi).
                if (self::copySafe($info)) {
                    $action = 'remux';
                    $result['action'] = 'remux';
                } else {
                    $result['action'] = 'skip';
                    $result['reasons'][] = 'qayta kodlash bu rejimda taqiqlangan'
                        . ' — `php cli/video-prep.php --fix` bilan tuzating';
                    return $result;
                }
            } else {
                $action = 'transcode';
            }
        }

        $output = @tempnam(dirname($source), 'vprep_');
        if ($output === false) {
            $result['error'] = 'vaqtinchalik fayl yaratilmadi';
            return $result;
        }

        $timeout = (int) ($opts['timeout'] ?? (PHP_SAPI === 'cli'
            ? 0
            : self::cfg('VIDEO_PREP_TIMEOUT', 240)));

        $cmd = $action === 'transcode'
            ? self::normalizeCommand($source, $output, $info, $opts)
            : self::remuxCommand($source, $output);

        $started = microtime(true);
        $run = self::run($cmd, $timeout);
        $result['elapsed'] = round(microtime(true) - $started, 2);

        if ($run['exit'] !== 0 || !is_file($output) || (int) @filesize($output) <= 0) {
            @unlink($output);
            $result['action'] = 'skip';
            $result['error'] = $run['timed_out']
                ? 'ffmpeg vaqti tugadi (' . $timeout . 's)'
                : 'ffmpeg xatosi: ' . self::shortError($run['stderr']);
            error_log('[VideoPrep] ' . basename($source) . ' (' . $action . '): ' . $result['error']);
            return $result;
        }

        // Natijani tekshiramiz: faststart + H.264 (+ AAC, <=1080p) bo'lmasa — qabul qilmaymiz.
        $check = self::inspect($output, ['gop' => false]);
        $bad = null;
        if (empty($check['ok']) || empty($check['video'])) {
            $bad = 'natija o\'qilmadi';
        } elseif ($check['video']['codec'] !== 'h264') {
            $bad = 'natija H.264 emas';
        } elseif (empty($check['faststart'])) {
            $bad = 'natijada faststart yo\'q';
        } elseif ($action === 'transcode' && $check['audio'] !== null && $check['audio']['codec'] !== 'aac') {
            $bad = 'natijada audio AAC emas';
        } elseif ($action === 'transcode'
            && $check['video']['height'] > (int) ($opts['max_height'] ?? self::cfg('VIDEO_PREP_HEIGHT', 1080))) {
            $bad = 'natija balandligi chegaradan katta';
        }

        if ($bad !== null) {
            @unlink($output);
            $result['action'] = 'skip';
            $result['error'] = $bad;
            error_log('[VideoPrep] ' . basename($source) . ': ' . $bad);
            return $result;
        }

        $result['path'] = $output;
        $result['name'] = pathinfo($originalName, PATHINFO_FILENAME) . '.mp4';
        $result['optimized'] = true;
        $result['temporary'] = true;
        $result['action'] = $action;
        return $result;
    }

    /**
     * Tayyorlangan faylni joyida almashtiradi. `to_mp4` bo'lsa kengaytma ham
     * `.mp4`ga o'zgaradi (mov/mkv -> mp4). Xatoda asl fayl tiklanadi.
     *
     * @return array{ok:bool,changed:bool,path:string,mode:string,action:string,error:?string}
     */
    public static function optimizeInPlace($path, array $opts = []): array
    {
        $path = (string) $path;
        $res = [
            'ok' => true,
            'changed' => false,
            'path' => $path,
            'mode' => self::mode(),
            'action' => 'skip',
            'error' => null,
        ];

        $prepared = self::prepare($path, basename($path), $opts);
        $res['mode'] = $prepared['mode'];
        $res['action'] = $prepared['action'];
        $res['error'] = $prepared['error'];
        if (empty($prepared['optimized'])) {
            return $res;
        }

        $target = $path;
        if (!empty($opts['to_mp4']) || strtolower(pathinfo($path, PATHINFO_EXTENSION)) !== 'mp4') {
            $target = dirname($path) . '/' . pathinfo($path, PATHINFO_FILENAME) . '.mp4';
        }

        $backup = $path . '.vprep-backup-' . bin2hex(random_bytes(5));
        if (!@rename($path, $backup)) {
            self::cleanup($prepared);
            $res['ok'] = false;
            $res['error'] = 'manbani zaxiralash imkonsiz';
            return $res;
        }
        if (!@rename($prepared['path'], $target)) {
            @rename($backup, $path);
            self::cleanup($prepared);
            $res['ok'] = false;
            $res['error'] = 'natijani joylashtirish imkonsiz';
            return $res;
        }

        @unlink($backup);
        $res['changed'] = true;
        $res['path'] = $target;
        return $res;
    }

    /** Vaqtinchalik tayyorlangan nusxani o'chiradi. */
    public static function cleanup(array $prepared): void
    {
        if (!empty($prepared['temporary']) && !empty($prepared['path']) && is_file($prepared['path'])) {
            @unlink($prepared['path']);
        }
    }

    // ---------------------------------------------------------------- ichki

    /** remux: oqimlarni nusxalash + moov boshiga (qayta kodlash yo'q). */
    private static function remuxCommand($source, $output): array
    {
        return [
            self::binary('FFMPEG_BIN', 'ffmpeg'),
            '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
            '-i', (string) $source,
            '-map', '0:v:0',
            '-map', '0:a:0?',
            '-c', 'copy',
            '-movflags', '+faststart',
            '-f', 'mp4',
            (string) $output,
        ];
    }

    /** normalize: H.264 + AAC, 2s kalit kadr, <=1080p, faststart. */
    private static function normalizeCommand($source, $output, array $info, array $opts): array
    {
        $maxHeight = max(240, (int) ($opts['max_height'] ?? self::cfg('VIDEO_PREP_HEIGHT', 1080)));
        $maxKbps   = max(400, (int) ($opts['max_kbps'] ?? self::cfg('VIDEO_PREP_BITRATE', 2800)));
        $gopSec    = max(1.0, (float) ($opts['gop_sec'] ?? self::cfg('VIDEO_PREP_GOP_SEC', 2)));
        $crf       = max(16, min(32, (int) ($opts['crf'] ?? 21)));

        $fps = (float) ($info['video']['fps'] ?? 0);
        if ($fps <= 0 || $fps > 240) {
            $fps = 24.0;
        }
        $gop = max(12, min(300, (int) round($fps * $gopSec)));

        $scale = "scale=w='min(1920,iw)':h='min(" . $maxHeight . ",ih)'"
            . ':force_original_aspect_ratio=decrease:force_divisible_by=2';

        return [
            self::binary('FFMPEG_BIN', 'ffmpeg'),
            '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
            '-i', (string) $source,
            '-map', '0:v:0',
            '-map', '0:a:0?',
            '-sn', '-dn',
            '-c:v', 'libx264',
            '-preset', 'veryfast',
            '-crf', (string) $crf,
            '-maxrate', $maxKbps . 'k',
            '-bufsize', ($maxKbps * 2) . 'k',
            '-vf', $scale,
            '-g', (string) $gop,
            '-keyint_min', (string) max(1, (int) round($gop / 2)),
            '-sc_threshold', '0',
            '-force_key_frames', 'expr:gte(t,n_forced*' . self::num($gopSec) . ')',
            '-pix_fmt', 'yuv420p',
            '-c:a', 'aac',
            '-b:a', '128k',
            '-ac', '2',
            '-ar', '48000',
            '-movflags', '+faststart',
            '-f', 'mp4',
            (string) $output,
        ];
    }

    /**
     * Qayta kodlamasdan nusxalash xavfsizmi? (oqimlar H.264/AAC/yuv420p)
     * Faqat shu holatda faststart/remux amali transcode o'rniga bajariladi.
     */
    private static function copySafe(array $info): bool
    {
        $v = $info['video'] ?? null;
        if (!is_array($v) || $v['codec'] !== 'h264') {
            return false;
        }
        if ($v['pix_fmt'] !== '' && !in_array($v['pix_fmt'], ['yuv420p', 'yuvj420p'], true)) {
            return false;
        }
        $a = $info['audio'] ?? null;
        if (is_array($a) && $a['codec'] !== 'aac') {
            return false;
        }
        return true;
    }

    /** Web so'rov ichida transcode xavfsizmi (kichik va qisqa fayl). */
    private static function webCanTranscode(array $info, array $opts = []): bool
    {
        $maxMb  = max(1, (int) ($opts['web_max_mb'] ?? self::cfg('VIDEO_PREP_WEB_MAX_MB', 150)));
        $maxSec = max(10, (int) ($opts['web_max_sec'] ?? self::cfg('VIDEO_PREP_WEB_MAX_SEC', 1800)));
        if ((int) ($info['size'] ?? 0) > $maxMb * 1024 * 1024) {
            return false;
        }
        $duration = (float) ($info['duration'] ?? 0);
        return $duration <= 0 || $duration <= $maxSec;
    }

    /** Kalit kadrlar orasidagi eng katta masofa (soniya). */
    private static function measureGop($path, $span, $fps): ?float
    {
        $probe = self::run([
            self::binary('FFPROBE_BIN', 'ffprobe'),
            '-v', 'error',
            '-hide_banner',
            '-read_intervals', '%+' . self::num((float) $span),
            '-select_streams', 'v:0',
            '-show_entries', 'frame=key_frame,pts_time',
            '-print_format', 'json',
            (string) $path,
        ], 120);

        if ($probe['exit'] !== 0) {
            return null;
        }
        $data = json_decode($probe['stdout'], true);
        if (!is_array($data) || !is_array($data['frames'] ?? null)) {
            return null;
        }

        $keys = [];
        foreach ($data['frames'] as $frame) {
            if (is_array($frame) && (int) ($frame['key_frame'] ?? 0) === 1
                && isset($frame['pts_time']) && is_numeric($frame['pts_time'])) {
                $keys[] = (float) $frame['pts_time'];
            }
        }
        if (count($keys) < 2) {
            return null;   // bitta kalit kadr — hukm chiqarib bo'lmaydi
        }

        $max = 0.0;
        for ($i = 1; $i < count($keys); $i++) {
            $max = max($max, $keys[$i] - $keys[$i - 1]);
        }
        return round($max, 3);
    }

    /**
     * Buyruqni vaqtinchalik fayllarga yozib ishga tushiradi (deadlock yo'q),
     * past ustuvorlik beradi va timeout bilan to'xtatadi.
     *
     * @return array{exit:int,stdout:string,stderr:string,timed_out:bool}
     */
    private static function run(array $cmd, int $timeout = 0): array
    {
        $outFile = @tempnam(sys_get_temp_dir(), 'vprep_out_');
        $errFile = @tempnam(sys_get_temp_dir(), 'vprep_err_');
        if ($outFile === false || $errFile === false) {
            return ['exit' => -1, 'stdout' => '', 'stderr' => 'temp fayl xatosi', 'timed_out' => false];
        }

        $descriptors = [
            0 => ['pipe', 'r'],
            1 => ['file', $outFile, 'w'],
            2 => ['file', $errFile, 'w'],
        ];
        $pipes = [];
        $proc = @proc_open($cmd, $descriptors, $pipes);
        if (!is_resource($proc)) {
            @unlink($outFile);
            @unlink($errFile);
            return ['exit' => -1, 'stdout' => '', 'stderr' => 'proc_open xatosi', 'timed_out' => false];
        }
        if (isset($pipes[0]) && is_resource($pipes[0])) {
            fclose($pipes[0]);
        }

        $started = microtime(true);
        $timedOut = false;
        $lowPriority = false;
        $exitCode = null;

        while (true) {
            $status = proc_get_status($proc);
            if (!$status['running']) {
                $exitCode = (int) $status['exitcode'];
                break;
            }
            if (!$lowPriority && !empty($status['pid']) && function_exists('wc_apply_low_priority')) {
                wc_apply_low_priority((int) $status['pid']);
                $lowPriority = true;
            }
            if ($timeout > 0 && (microtime(true) - $started) > $timeout) {
                $timedOut = true;
                @proc_terminate($proc, 9);
                usleep(200000);
                break;
            }
            usleep(100000);
        }

        $closeCode = @proc_close($proc);
        if ($exitCode === null || $exitCode === -1) {
            $exitCode = (int) $closeCode;
        }
        if ($timedOut) {
            $exitCode = -1;
        }

        $stdout = (string) @file_get_contents($outFile);
        $stderr = (string) @file_get_contents($errFile);
        @unlink($outFile);
        @unlink($errFile);

        return [
            'exit' => $exitCode,
            'stdout' => $stdout,
            'stderr' => $stderr,
            'timed_out' => $timedOut,
        ];
    }

    private static function binary(string $constant, string $fallback): string
    {
        $value = defined($constant) ? trim((string) constant($constant)) : '';
        return $value !== '' ? $value : $fallback;
    }

    private static function cfg(string $constant, $default)
    {
        return defined($constant) ? constant($constant) : $default;
    }

    private static function isMp4Container(string $container): bool
    {
        if ($container === '') {
            return false;
        }
        foreach (explode(',', $container) as $name) {
            $name = trim($name);
            if ($name === 'mp4' || $name === 'mov' || $name === 'm4a' || $name === 'm4v'
                || $name === '3gp' || $name === '3g2' || $name === 'mj2') {
                return true;
            }
        }
        return false;
    }

    private static function fps(string $rate): float
    {
        $rate = trim($rate);
        if ($rate === '' || $rate === '0/0') {
            return 0.0;
        }
        if (strpos($rate, '/') !== false) {
            [$num, $den] = array_pad(explode('/', $rate, 2), 2, '1');
            $den = (float) $den;
            return $den > 0 ? (float) $num / $den : 0.0;
        }
        return (float) $rate;
    }

    private static function num(float $value): string
    {
        $s = rtrim(rtrim(number_format($value, 2, '.', ''), '0'), '.');
        return $s === '' ? '0' : $s;
    }

    private static function shortError(string $stderr): string
    {
        $text = trim(preg_replace('/\s+/', ' ', $stderr) ?? '');
        return $text === '' ? 'sabab noma\'lum' : mb_substr($text, -400);
    }
}
