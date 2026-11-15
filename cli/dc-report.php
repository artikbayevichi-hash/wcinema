<?php
// CLI-only guard — brauzerdan chaqirilishi mumkin emas (403).
if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('CLI only');
}
// ============================================================================
// cli/dc-report.php — videolar QAYSI Telegram DC'da turishini ko'rsatish
// ----------------------------------------------------------------------------
// NIMA UCHUN:
//   Telegram fayli qaysi DC'da saqlansa, yuklab olish aynan o'sha serverga
//   boradi. O'zbekistonga eng yaqin: DC4 (Amsterdam) va DC5 (Singapur).
//   DC1/DC3 (Miami) — har so'rovga ~200–400 ms qo'shimcha RTT.
//
//   Bu skript katalogdagi har bir (kanal, post) uchun `tg-doc-cache` JSON'ini
//   o'qiydi va `dc` maydonini chiqaradi. Telegram'ga murojaat QILMAYDI
//   (faqat diskdagi kesh).
//
// ISHLATISH:
//   php cli/dc-report.php              # jadval
//   php cli/dc-report.php --json       # mashina o'qiydigan JSON
//   php cli/dc-report.php --all        # katalogda yo'q kesh fayllari ham
//   php cli/dc-report.php --far        # faqat uzoq DC (1/3) dagilar
//
// QAYTA YUKLASHNI TEKSHIRISH (bitta video, avval sinov):
//   uzoq DC'dagi videoni yaqin DC'dagi kanalga qo'lda yuklab, shu skript
//   bilan `dc` o'zgarganini tasdiqlang — shundan keyingina ommaviy ko'chirish.
// ============================================================================

require_once __DIR__ . '/../includes/bootstrap.php';
require_once __DIR__ . '/../includes/TgDocCache.php';

$optJson = in_array('--json', $argv, true);
$optAll  = in_array('--all', $argv, true);
$optFar  = in_array('--far', $argv, true);

// DC raqami -> mintaqa. Telegram hujjat `dc_id` shu raqamlarni beradi.
function dcRegion($dc) {
    switch ((int) $dc) {
        case 1: return 'Miami';
        case 2: return 'Amsterdam';
        case 3: return 'Miami';
        case 4: return 'Amsterdam';
        case 5: return 'Singapore';
        default: return 'noma\'lum';
    }
}

// Yaqin (O'zbekiston uchun) DC'lar: 4 va 5. 2 ham Amsterdamda.
function dcIsNear($dc) {
    return in_array((int) $dc, [2, 4, 5], true);
}

// t.me havolasidan kanal + post.
function dcParseUrl($u) {
    $u = trim((string) $u);
    if ($u === '') {
        return null;
    }
    if (!preg_match('#t\.me/(?:s/)?([A-Za-z0-9_]+)/(\d+)#', $u, $m)) {
        return null;
    }
    return ['ch' => '@' . $m[1], 'post' => (int) $m[2]];
}

function dcHuman($bytes) {
    $b = (float) $bytes;
    if ($b >= 1073741824) {
        return round($b / 1073741824, 2) . ' GB';
    }
    if ($b >= 1048576) {
        return round($b / 1048576, 1) . ' MB';
    }
    if ($b >= 1024) {
        return round($b / 1024) . ' KB';
    }
    return (int) $b . ' B';
}

// ------------------------------------------------------------------ katalog
$db = Database::getInstance();
$pairs = [];        // "ch/post" -> meta
$seen  = [];

function dcAddPair(&$pairs, &$seen, $p, $meta) {
    if (!$p) {
        return;
    }
    $k = strtolower($p['ch']) . '/' . $p['post'];
    if (isset($seen[$k])) {
        return;                       // birinchi (eng ko'p ko'rilgan) qoladi
    }
    $seen[$k] = true;
    $pairs[$k] = $meta + ['ch' => $p['ch'], 'post' => $p['post']];
}

try {
    foreach ($db->fetchAll(
        "SELECT e.video_url, e.content_id, c.title, c.status
           FROM episodes e
           JOIN content c ON c.id = e.content_id
          WHERE e.video_url LIKE '%t.me/%'
          ORDER BY c.views DESC, c.id DESC, e.season ASC, e.episode_number ASC"
    ) as $r) {
        dcAddPair($pairs, $seen, dcParseUrl($r['video_url'] ?? ''), [
            'kind'    => 'episode',
            'content' => (int) ($r['content_id'] ?? 0),
            'title'   => (string) ($r['title'] ?? ''),
            'status'  => (string) ($r['status'] ?? ''),
        ]);
    }
    foreach ($db->fetchAll("SELECT video_url, id, title FROM reels WHERE video_url LIKE '%t.me/%' ORDER BY id DESC") as $r) {
        dcAddPair($pairs, $seen, dcParseUrl($r['video_url'] ?? ''), [
            'kind'    => 'reel',
            'content' => (int) ($r['id'] ?? 0),
            'title'   => (string) ($r['title'] ?? ''),
            'status'  => 'reel',
        ]);
    }
} catch (\Throwable $e) {
    fwrite(STDERR, 'DB xato: ' . $e->getMessage() . PHP_EOL);
    exit(1);
}

// ------------------------------------------------------------------ kesh
list($cacheDir) = tgDocCacheFile('@x', 0);
$rows    = [];
$matched = [];

foreach ($pairs as $key => $m) {
    $c = tgDocCacheRead($m['ch'], $m['post']);
    $file = $cacheDir . '/' . sha1(strtolower($m['ch']) . '/' . $m['post']) . '.json';
    if (is_file($file)) {
        $matched[sha1(strtolower($m['ch']) . '/' . $m['post']) . '.json'] = true;
    }
    $rows[] = [
        'channel' => $m['ch'],
        'post'    => $m['post'],
        'kind'    => $m['kind'],
        'content' => $m['content'],
        'title'   => $m['title'],
        'status'  => $m['status'],
        'cached'  => $c ? true : false,
        'dc'      => $c ? (int) ($c['dc'] ?? 0) : 0,
        'region'  => $c ? dcRegion($c['dc'] ?? 0) : '',
        'near'    => $c ? dcIsNear($c['dc'] ?? 0) : false,
        'size'    => $c ? (int) ($c['size'] ?? 0) : 0,
        'age_min' => $c ? (int) floor((time() - (int) ($c['t'] ?? 0)) / 60) : null,
        'dur'     => $c ? (int) ($c['dur'] ?? 0) : 0,
    ];
}

// `--all`: katalogda uchramagan kesh fayllari (masalan, o'chirilgan postlar).
if ($optAll) {
    $files = glob($cacheDir . '/*.json');
    if ($files) {
        foreach ($files as $f) {
            $base = basename($f);
            if (isset($matched[$base])) {
                continue;
            }
            $j = json_decode((string) @file_get_contents($f), true);
            if (!is_array($j)) {
                continue;
            }
            $rows[] = [
                'channel' => '',
                'post'    => 0,
                'kind'    => 'orphan',
                'content' => 0,
                'title'   => 'katalogda topilmadi',
                'status'  => '',
                'cached'  => true,
                'dc'      => (int) ($j['dc'] ?? 0),
                'region'  => dcRegion($j['dc'] ?? 0),
                'near'    => dcIsNear($j['dc'] ?? 0),
                'size'    => (int) ($j['size'] ?? 0),
                'age_min' => (int) floor((time() - (int) ($j['t'] ?? 0)) / 60),
                'dur'     => (int) ($j['dur'] ?? 0),
                'file'    => $base,
            ];
        }
    }
}

if ($optFar) {
    $rows = array_values(array_filter($rows, function ($r) {
        return $r['cached'] && !$r['near'];
    }));
}

// ------------------------------------------------------------------ xulosa
$summary = [
    'total'   => count($rows),
    'cached'  => 0,
    'missing' => 0,
    'by_dc'   => [],
    'near'    => 0,
    'far'     => 0,
    'bytes'   => 0,
    'far_bytes' => 0,
];
foreach ($rows as $r) {
    if (!$r['cached']) {
        $summary['missing']++;
        continue;
    }
    $summary['cached']++;
    $dc = (int) $r['dc'];
    if (!isset($summary['by_dc'][$dc])) {
        $summary['by_dc'][$dc] = ['dc' => $dc, 'region' => $r['region'], 'videos' => 0, 'bytes' => 0];
    }
    $summary['by_dc'][$dc]['videos']++;
    $summary['by_dc'][$dc]['bytes'] += (int) $r['size'];
    $summary['bytes'] += (int) $r['size'];
    if ($r['near']) {
        $summary['near']++;
    } else {
        $summary['far']++;
        $summary['far_bytes'] += (int) $r['size'];
    }
}
ksort($summary['by_dc']);
$summary['by_dc'] = array_values($summary['by_dc']);

if ($optJson) {
    echo json_encode([
        'ok'      => true,
        'at'      => date('c'),
        'summary' => $summary,
        'rows'    => $rows,
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT) . PHP_EOL;
    exit(0);
}

// ------------------------------------------------------------------ jadval
echo 'W CINEMA — Telegram DC hisoboti (' . date('Y-m-d H:i') . ')' . PHP_EOL;
echo str_repeat('-', 92) . PHP_EOL;
printf("%-8s %-5s %-11s %-10s %-18s %s\n", 'DC', 'near', 'mintaqa', 'hajm', 'kanal/post', 'nomi');
echo str_repeat('-', 92) . PHP_EOL;

foreach ($rows as $r) {
    if (!$r['cached']) {
        printf("%-8s %-5s %-11s %-10s %-18s %s\n",
            '—', '—', 'kesh yo\'q', '—',
            $r['channel'] . '/' . $r['post'],
            mb_substr($r['title'], 0, 40));
        continue;
    }
    printf("%-8s %-5s %-11s %-10s %-18s %s\n",
        'DC' . $r['dc'],
        $r['near'] ? 'yaqin' : 'UZOQ',
        $r['region'],
        dcHuman($r['size']),
        ($r['channel'] !== '' ? $r['channel'] . '/' . $r['post'] : (isset($r['file']) ? $r['file'] : '—')),
        mb_substr($r['title'], 0, 40));
}

echo str_repeat('-', 92) . PHP_EOL;
echo 'Jami: ' . $summary['total'] . ' ta manba, keshda ' . $summary['cached']
    . ', keshsiz ' . $summary['missing'] . PHP_EOL;
foreach ($summary['by_dc'] as $g) {
    echo '  DC' . $g['dc'] . ' (' . $g['region'] . '): ' . $g['videos']
        . ' ta, ' . dcHuman($g['bytes']) . PHP_EOL;
}
echo 'Yaqin DC (2/4/5): ' . $summary['near'] . ' ta · uzoq DC (1/3): ' . $summary['far']
    . ' ta, ' . dcHuman($summary['far_bytes']) . PHP_EOL;

if ($summary['far'] > 0) {
    echo PHP_EOL . 'TAVSIYA: avval BITTA uzoq DC\'dagi videoni yaqin DC\'dagi kanalga'
        . ' qayta yuklab, shu skript bilan `dc` o\'zgarganini tasdiqlang.' . PHP_EOL;
}
exit(0);
