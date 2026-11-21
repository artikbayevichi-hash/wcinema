<?php
// ============================================================================
// api/episode.php — FAQAT qism almashtirish uchun eng kam ma'lumot
// ----------------------------------------------------------------------------
// GET ?id=CONTENT_ID&episode=EPISODE_ID
//   -> { selected, playback, progress, tgEmbed, preview }
//
// NIMA UCHUN ALOHIDA ENDPOINT?
// Eski holatda `switchEpisode()` `/api/content.php` ni chaqirib, BUTUN
// kontentni (janr, tavsif, barcha qismlar, tavsiyalar...) qayta oladi va
// sahifaning yarim qismini qayta chizadi. Anime/qismlar ko'p bo'lganida bu
// "hamma narsa yangilanib ketayapti" degan taassurot beradi.
//
// Bu endpoint faqat YANGI QISMNING PLEYER MA'LUMOTINI qaytaradi.
// `watch.js` endi faqat player + tanlangan qism belgisini o'zgartiradi,
// qolgan bloklar (janr, izohlar, tavsiyalar) tinch qoladi.
//
// Video baytlari BU YERDAN O'TMAYDI — brauzer ularni to'g'ridan-to'g'ri
// Telegram'dan oladi (MTProto yoki rasmiy embed).
// ============================================================================
require_once __DIR__ . '/../includes/bootstrap.php';
require_once __DIR__ . '/../includes/TgMeta.php';     // video thumb -> poster
require_once __DIR__ . '/../includes/TgPreview.php';  // 20s tezkor preview
require_once __DIR__ . '/../includes/StreamBootstrap.php'; // SQL kesh (umumiy ma'lumotlar)

// Faqat o'qish — sessiya qulfini bo'shatamiz (parallel so'rovlar bloklanmasin).
if (session_status() === PHP_SESSION_ACTIVE) {
    session_write_close();
}

$id        = inputInt('id');
$episodeId = inputInt('episode');

if ($id <= 0) {
    fail('id kerak', 400);
}

$item = $catalog->getContent($id);
if (!$item) {
    fail('Kontent topilmadi', 404);
}

// Qoralama/arxiv — faqat admin (watch.php va content.php bilan bir xil qoida).
if (($item['status'] ?? 'published') !== 'published') {
    $isAdmin = false;
    try { $isAdmin = (bool) $auth->isAdmin(); } catch (\Throwable $e) {}
    if (!$isAdmin) {
        fail('Kontent topilmadi', 404);
    }
}

$episodes = $catalog->getEpisodes($item['id']);

// So'ralgan qism; topilmasa aniq xato (aks holda foydalanuvchi 5-qismini
// bosib 1-qismni ko'radi va chalkashadi).
$selected = null;
foreach ($episodes as $e) {
    if ((int) $e['id'] === $episodeId) {
        $selected = $e;
        break;
    }
}
if (!$selected && $episodeId > 0) {
    fail('Bunday qism topilmadi', 404);
}
if (!$selected) {
    $selected = $episodes[0] ?? null;
}

// To'liq qism qatoridan olamiz: 1080p/720p variantlari va video_url shu yerda.
$pbItem   = $selected ? $catalog->getEpisode((int) $selected['id']) : $item;
$playback = $catalog->getPlayback($pbItem);

// Video thumb -> poster (watch.php dagi bilan AYNAN bir xil).
if (is_array($playback) && ($playback['type'] ?? '') === 'telegram'
    && !empty($playback['channel']) && (int) ($playback['post'] ?? 0) > 0) {
    $thumbFile = TgMeta::thumbCachePath($playback['channel'], (int) $playback['post']);
    if (is_file($thumbFile)) {
        $__base = defined('APP_BASE_PATH') ? rtrim((string) APP_BASE_PATH, '/') : '';
        $playback['poster'] = $__base . '/api/tg-thumb.php?ch='
            . rawurlencode((string) $playback['channel'])
            . '&post=' . (int) $playback['post'];
    }
}

// "Davom etish" nuqtasi (faqat kirgan foydalanuvchilar uchun).
$progress = null;
if ($userId && $selected) {
    $p = $catalog->getProgress($userId, $item['id'], (int) $selected['id']);
    $progress = [
        'position' => (int) $p['position_seconds'],
        'duration' => (int) $p['duration_seconds'],
        'percent'  => $p['duration_seconds'] > 0
            ? (int) round($p['position_seconds'] / $p['duration_seconds'] * 100)
            : 0,
    ];
}

// Rasmiy Telegram embed faqat OMMAVIY kanal postlarida (watch.php bilan bir xil).
$tgEmbed = (is_array($playback) && ($playback['type'] ?? '') === 'telegram'
            && !empty($playback['channel'])
            && (int) ($playback['post'] ?? 0) > 0
            && preg_match('/^[A-Za-z0-9_]{3,64}$/', (string) $playback['channel'])
            && !preg_match('/^c\d+$/', (string) $playback['channel']))
           ? ['channel' => (string) $playback['channel'],
              'post'    => (int) $playback['post']]
           : null;

// Shu qismning 20 soniyali tezkor preview'i (agar tayyor bo'lsa).
$preview = null;
if (is_array($playback) && !empty($playback['channel'])
    && (int) ($playback['post'] ?? 0) > 0) {
    $pv = TgPreview::get((string) $playback['channel'], (int) $playback['post']);
    if ($pv) {
        $preview = [
            'ch'   => $pv['ch'], 'p' => $pv['p'],
            'size' => $pv['size'], 'mime' => $pv['mime'],
            'w'    => $pv['w'], 'h' => $pv['h'], 'dur' => $pv['dur'],
        ];
        // Qism almashtirishda ham tez kadr ishlashi uchun instant ma'lumoti.
        if (!empty($pv['instant'])) $preview['instant'] = $pv['instant'];
    }
}

// Shu qism uchum BARCHA umumiy ma'lumotlar BITTA SQL yozuvidan.
// Birinchi ochishda quriladi, keyingi tomoshabinlarda faqat o'qiladi —
// brauzer qo'shimcha tg-embed / doc / preview so'rovlarini yubormaydi.
$boot = is_array($playback)
    ? StreamBootstrap::load($playback, [
        'content_id' => (int) $item['id'],
        'episode_id' => $selected ? (int) $selected['id'] : 0,
    ])
    : null;

Auth::ok([
    'boot'     => $boot,
    'selected' => $selected ? [
        'id'     => (int) $selected['id'],
        'season' => (int) $selected['season'],
        'number' => (int) $selected['episode_number'],
        'title'  => $selected['title'],
    ] : null,
    'playback' => $playback,
    'progress' => $progress,
    'tgEmbed'  => $tgEmbed,
    'preview'  => $preview,
]);
