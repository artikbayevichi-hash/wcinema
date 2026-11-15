<?php
// CLI-only guard — brauzerdan chaqirilishi mumkin emas (403).
if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('CLI only');
}
// ============================================================================
// cli/video-prep.php — mahalliy videolarni strimingga tayyorlash (tekshirish/fix)
// ============================================================================
// Har bir video quyidagi talablarga javob berishi kerak:
//   H.264 + AAC, MP4, faststart (moov boshida), kalit kadr har 2 soniyada,
//   <= 1080p va cheklangan bitrate.
//
// Ishlatish:
//   php cli/video-prep.php                     # tekshirish (hech narsa o'zgarmaydi)
//   php cli/video-prep.php --check             # xuddi shunday
//   php cli/video-prep.php --fix               # tuzatish (joyida almashtiradi)
//   php cli/video-prep.php --fix --mode=remux  # faqat konteyner/faststart (tez)
//   php cli/video-prep.php --fix --mode=normalize   # to'liq H.264/AAC transcode
//   php cli/video-prep.php --file=uploads/videos/x.mkv --fix
//   php cli/video-prep.php --dir=uploads/videos --fix --json
//
// Muhim: `--fix` faylni JOYIDA almashtiradi (zaxira nusxa xato bo'lsagina
// tiklanadi). Tunda ishga tushiring — ffmpeg past ustuvorlikda ishlaydi.
//
// .env: VIDEO_PREP, FFPROBE_BIN, FFMPEG_BIN, VIDEO_PREP_HEIGHT,
//       VIDEO_PREP_BITRATE, VIDEO_PREP_GOP_SEC (config.php izohlariga qarang).
// ============================================================================
error_reporting(E_ALL);
ini_set('display_errors', '1');
set_time_limit(0);
ini_set('memory_limit', '-1');

require __DIR__ . '/../config.php';
require_once __DIR__ . '/../includes/VideoPrep.php';

$args = array_slice($argv, 1);
$opt = [
    'fix' => false,
    'json' => false,
    'quiet' => false,
    'dir' => __DIR__ . '/../uploads/videos',
    'file' => '',
    'mode' => '',
    'timeout' => 0,
    'max' => 0,
    'recursive' => true,
];

foreach ($args as $arg) {
    if ($arg === '--fix' || $arg === '--in-place') {
        $opt['fix'] = true;
    } elseif ($arg === '--check' || $arg === '--dry-run') {
        $opt['fix'] = false;
    } elseif ($arg === '--json') {
        $opt['json'] = true;
    } elseif ($arg === '--quiet' || $arg === '-q') {
        $opt['quiet'] = true;
    } elseif ($arg === '--no-recursive') {
        $opt['recursive'] = false;
    } elseif (strpos($arg, '--mode=') === 0) {
        $opt['mode'] = strtolower(trim(substr($arg, 7)));
    } elseif (strpos($arg, '--dir=') === 0) {
        $opt['dir'] = substr($arg, 6);
    } elseif (strpos($arg, '--file=') === 0) {
        $opt['file'] = substr($arg, 7);
    } elseif (strpos($arg, '--timeout=') === 0) {
        $opt['timeout'] = max(0, (int) substr($arg, 10));
    } elseif (strpos($arg, '--max=') === 0) {
        $opt['max'] = max(1, (int) substr($arg, 6));
    } elseif ($arg === '--help' || $arg === '-h') {
        fwrite(STDOUT, "Ishlatish: php cli/video-prep.php [--fix] [--mode=normalize|remux|faststart]\n"
            . "           [--dir=PAPKA] [--file=FAYL] [--json] [--timeout=SONIYA] [--max=N]\n");
        exit(0);
    } elseif ($arg !== '' && $arg[0] !== '-' && $opt['file'] === '') {
        $opt['file'] = $arg;
    }
}

if ($opt['mode'] !== '') {
    if (!in_array($opt['mode'], ['off', 'faststart', 'remux', 'normalize'], true)) {
        fwrite(STDERR, "Noto'g'ri --mode: {$opt['mode']}\n");
        exit(2);
    }
    VideoPrep::setMode($opt['mode']);
}

$exts = ['mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', '3gp', 'ts', 'mts', 'm2ts'];

/** Papka/fayl ro'yxati (zaxira va vaqtinchalik fayllarsiz). */
function vp_collect(string $dir, bool $recursive, array $exts): array
{
    if (!is_dir($dir)) {
        return [];
    }
    $out = [];
    $flags = FilesystemIterator::SKIP_DOTS;
    $it = $recursive
        ? new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, $flags))
        : new IteratorIterator(new DirectoryIterator($dir));
    foreach ($it as $item) {
        /** @var SplFileInfo $item */
        if (!$item->isFile()) {
            continue;
        }
        $name = $item->getFilename();
        if (strpos($name, '.vprep-backup-') !== false || strpos($name, '.faststart-backup-') !== false) {
            continue;
        }
        if (strpos($name, 'vprep_') === 0) {
            continue;
        }
        if (!in_array(strtolower($item->getExtension()), $exts, true)) {
            continue;
        }
        $out[] = $item->getPathname();
    }
    sort($out, SORT_NATURAL | SORT_FLAG_CASE);
    return $out;
}

function vp_size(int $bytes): string
{
    if ($bytes >= 1073741824) {
        return round($bytes / 1073741824, 2) . ' GB';
    }
    if ($bytes >= 1048576) {
        return round($bytes / 1048576, 1) . ' MB';
    }
    if ($bytes >= 1024) {
        return round($bytes / 1024) . ' KB';
    }
    return $bytes . ' B';
}

function vp_desc(array $info): string
{
    $v = $info['video'] ?? null;
    if (!is_array($v)) {
        return '-';
    }
    $a = $info['audio'] ?? null;
    $bits = [
        (string) ($v['codec'] ?: '?') . ' ' . (int) $v['width'] . 'x' . (int) $v['height'],
        'fps ' . round((float) $v['fps'], 2),
        $v['bitrate'] > 0 ? round($v['bitrate'] / 1000) . 'k' : '?k',
        $a ? (string) ($a['codec'] ?: '?') : 'audio yo\'q',
        !empty($info['faststart']) ? 'faststart' : 'moov oxirida',
        $info['gop_max'] !== null ? 'gop ' . round((float) $info['gop_max'], 1) . 's' : 'gop ?',
    ];
    if ((float) ($info['duration'] ?? 0) > 0) {
        $bits[] = gmdate('H:i:s', (int) $info['duration']);
    }
    if ((int) ($info['extra_tracks'] ?? 0) > 0) {
        $bits[] = 'qo\'shimcha trek ' . (int) $info['extra_tracks'];
    }
    return implode(' | ', $bits);
}

$mode = VideoPrep::mode();
$files = [];
if ($opt['file'] !== '') {
    $file = $opt['file'];
    if (!preg_match('#^([a-zA-Z]:[\\\\/]|/)#', $file)) {
        $file = getcwd() . '/' . $file;
    }
    if (is_file($file)) {
        $files[] = $file;
    }
} else {
    $files = vp_collect($opt['dir'], $opt['recursive'], $exts);
}
if ($opt['max'] > 0) {
    $files = array_slice($files, 0, $opt['max']);
}

if ($files === []) {
    if ($opt['json']) {
        fwrite(STDOUT, json_encode([
            'mode' => $mode,
            'dir' => $opt['dir'],
            'files' => [],
            'summary' => ['total' => 0, 'ok' => 0, 'needs_fix' => 0, 'fixed' => 0, 'failed' => 0],
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n");
    } elseif (!$opt['quiet']) {
        fwrite(STDOUT, "Video topilmadi: {$opt['dir']}\n");
    }
    exit(0);
}

$rows = [];
$summary = ['total' => 0, 'ok' => 0, 'needs_fix' => 0, 'fixed' => 0, 'failed' => 0];

foreach ($files as $file) {
    $summary['total']++;
    $before = VideoPrep::inspect($file, ['gop' => true]);
    $judge = VideoPrep::judge($before);
    $row = [
        'file' => $file,
        'size' => (int) ($before['size'] ?? 0),
        'action' => $judge['action'],
        'reasons' => $judge['reasons'],
        'info' => [
            'container' => $before['container'],
            'duration' => round((float) $before['duration'], 2),
            'faststart' => (bool) $before['faststart'],
            'gop_max' => $before['gop_max'],
            'audio_count' => (int) ($before['audio_count'] ?? 0),
            'subtitle_count' => (int) ($before['subtitle_count'] ?? 0),
            'data_count' => (int) ($before['data_count'] ?? 0),
            'extra_tracks' => (int) ($before['extra_tracks'] ?? 0),
            'video' => $before['video'],
            'audio' => $before['audio'],
            'error' => $before['error'],
        ],
        'fixed' => false,
        'result' => null,
        'error' => $before['error'],
    ];

    if ($judge['action'] === 'ok') {
        $summary['ok']++;
    } else {
        $summary['needs_fix']++;
    }

    if ($opt['fix'] && $judge['action'] !== 'ok') {
        $res = VideoPrep::optimizeInPlace($file, [
            'to_mp4' => true,
            'timeout' => $opt['timeout'],
        ]);
        $row['result'] = $res;
        $row['file'] = $res['path'];
        if ($res['changed']) {
            $after = VideoPrep::inspect($res['path'], ['gop' => true]);
            $afterJudge = VideoPrep::judge($after);
            $row['after'] = [
                'action' => $afterJudge['action'],
                'reasons' => $afterJudge['reasons'],
                'info' => [
                    'container' => $after['container'],
                    'duration' => round((float) $after['duration'], 2),
                    'faststart' => (bool) $after['faststart'],
                    'gop_max' => $after['gop_max'],
                    'video' => $after['video'],
                    'audio' => $after['audio'],
                ],
            ];
            if ($afterJudge['action'] === 'ok') {
                $summary['fixed']++;
                $row['fixed'] = true;
            } else {
                $summary['failed']++;
            }
        } else {
            $summary['failed']++;
            $row['error'] = $res['error'] ?: 'o\'zgartirilmadi';
        }
    }

    if (!$opt['json'] && !$opt['quiet']) {
        $mark = $row['fixed'] ? 'FIX' : ($judge['action'] === 'ok' ? 'OK ' : 'BAD');
        fwrite(STDOUT, sprintf("[%s] %s  %s\n", $mark, vp_size($row['size']), basename($row['file'])));
        fwrite(STDOUT, '      ' . vp_desc($before) . "\n");
        if ($judge['reasons'] !== []) {
            fwrite(STDOUT, '      sabab: ' . implode('; ', $judge['reasons']) . "\n");
        }
        if (!empty($row['result']['action']) && $row['result']['action'] !== 'skip') {
            fwrite(STDOUT, '      amal: ' . $row['result']['action']
                . (!empty($row['result']['mode']) ? ' (' . $row['result']['mode'] . ')' : '')
                . ', ' . (!empty($row['result']['changed']) ? 'almashtirildi' : 'o\'zgarmadi'));
            fwrite(STDOUT, "\n");
        }
        if (!empty($row['after'])) {
            fwrite(STDOUT, '      natija: ' . $row['after']['action']);
            if ($row['after']['reasons'] !== []) {
                fwrite(STDOUT, ' — ' . implode('; ', $row['after']['reasons']));
            }
            fwrite(STDOUT, "\n      " . vp_desc($row['after']['info']) . "\n");
        }
        if (!empty($row['error'])) {
            fwrite(STDOUT, '      xato: ' . $row['error'] . "\n");
        }
    }

    $rows[] = $row;
}

if ($opt['json']) {
    $clean = [];
    foreach ($rows as $row) {
        unset($row['info']['error']);
        $clean[] = $row;
    }
    fwrite(STDOUT, json_encode([
        'mode' => $mode,
        'dir' => $opt['file'] !== '' ? dirname($opt['file']) : $opt['dir'],
        'fix' => $opt['fix'],
        'files' => $clean,
        'summary' => $summary,
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n");
} elseif (!$opt['quiet']) {
    fwrite(STDOUT, sprintf(
        "\nJami: %d | OK: %d | tuzatish kerak: %d | tuzatildi: %d | xato: %d\n",
        $summary['total'],
        $summary['ok'],
        $summary['needs_fix'],
        $summary['fixed'],
        $summary['failed']
    ));
}

$ok = $opt['fix']
    ? ($summary['failed'] === 0 && ($summary['needs_fix'] === 0 || $summary['fixed'] === $summary['needs_fix']))
    : ($summary['needs_fix'] === 0);
exit($ok ? 0 : 1);
