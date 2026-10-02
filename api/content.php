<?php
// Bitta kontent: ma'lumotlar + qismlar + tanlangan qismning oqimi
require_once __DIR__ . '/../includes/bootstrap.php';

$id       = inputInt('id');
$episodeId = inputInt('episode');

// DIQQAT: "id berilmagan" (400) va "bunday kontent yo'q" (404) - boshqa
// xatolar. Aralashtirilsa, chaqiruvchi noto'g'ri manzil yozganini
// tushunmaydi.
if ($id <= 0) {
    fail('id kerak', 400);
}

$item = $catalog->getContent($id);
if (!$item) {
    fail('Kontent topilmadi', 404);
}

$episodes = $catalog->getEpisodes($item['id']);
$genres   = $catalog->getContentGenres($item['id']);

// Tanlangan qism: ?episode=..., yoki birinchi mavjud qism, yoki butun film
$selected = null;
foreach ($episodes as $e) {
    if ((int) $e['id'] === $episodeId) {
        $selected = $e;
        break;
    }
}

// DIQQAT: ?episode=N berilib, lekin bunday qism yo'q bo'lsa - jimgina
// "yo'q" deb o'tkazib yuborish XATO. Aks holda foydalanuvchi 5-qismini
// bosgan holda 1-qismni ko'radi va chalkashadi ("nima uchun boshqa
// qism ko'rsatilyapti?"). Aniq xato qaytaraman.
if (!$selected && $episodeId > 0) {
    fail('Bunday qism topilmadi', 404);
}
if (!$selected) {
    $selected = $episodes[0] ?? null;
}

$playback = $selected
    ? $catalog->getPlayback($selected)
    : $catalog->getPlayback($item);

// Progressni tiklash (agar kiringan bo'lsa)
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

// Ko'rishlar hisobi BU YERDA oshirilmaydi.
// Sababi: content.php har safar chaqiriladi - modal ochilganda, qism
// almashtirilganda, qayta ochilganda. Shu sababdan har bir chaqiruv
// sanashda ko'rishlar sun'iy oshib ketardi (bitta odam 10 marta bosgani
// 10 ko'rish hisoblanardi).
// Endi ko'rish faqat VIDEO HAQIQATAN OQLANDA oshiriladi -
// buni api/views.php qiladi (frontend shu yerda chaqiradi).

// Qismlar ro'yxasi (maxsus maydonlar bilan)
$epOut = array_map(static fn($e) => [
    'id'        => (int) $e['id'],
    'season'    => (int) $e['season'],
    'number'    => (int) $e['episode_number'],
    'title'     => $e['title'],
    'thumbnail' => $e['thumbnail'],
    'duration'  => $e['duration'],
    'is_premium'=> (int) $e['is_premium'] === 1,
    'has_video' => !empty($e['video_url']),
], $episodes);

// content-level playback (qismsiz film uchun)
$mainPlayback = $episodes ? null : $catalog->getPlayback($item);

Auth::ok([
    'content'   => array_merge($catalog->toPublicArray($item, $userId), [
        'genres' => array_map(static fn($g) => [
            'id' => (int) $g['id'], 'name' => $g['name'], 'slug' => $g['slug'],
        ], $genres),
    ]),
    'episodes'  => $epOut,
    'selected'  => $selected ? [
        'id'     => (int) $selected['id'],
        'season' => (int) $selected['season'],
        'number' => (int) $selected['episode_number'],
        'title'  => $selected['title'],
    ] : null,
    'playback'  => $playback,
    'main_playback' => $mainPlayback,
    'progress'  => $progress,
]);
