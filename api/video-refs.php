<?php
// ============================================================================
// api/video-refs.php — BARCHA videolarning Telegram manzili (kanal/post)
// ----------------------------------------------------------------------------
// Nima uchun kerak: saytga kirganda barcha videolarning `file_reference` ni
// foydalanuvchining O'Z sessiyasi bilan oldindan yangilab qo'yish uchun.
// Shunda videoni bosganda sekin `api/tg-doc.php?fresh=1` (3–8 s) kutilmaydi.
//
// Javob faqat kanal/post juftliklari (~30 bayt/har biri). Video baytlari va
// Telegram'ga murojaat BU YERDA YO'Q — faqat katalog ma'lumoti.
//
//   GET /api/video-refs.php
//   { success:true, items:[{ch:"wcinemauz",p:19}, ...], ts:... }
//
// Keshlash: 10 daqiqa (edge 60 s) — har sahifa ochilishida DB ga so'rov yo'q.
// ============================================================================

require_once __DIR__ . '/../includes/bootstrap.php';

// Sessiya faqat o'qish uchun — parallel so'rovlar ketma-ket kutmasin.
if (session_status() === PHP_SESSION_ACTIVE) {
    session_write_close();
}

RateLimit::enforce('read');

$out = HttpCache::json(HttpCache::key('video-refs', []), 600, 60, function () {
    $db = Database::getInstance();

    // Serialning BARCHA qismlari kerak: foydalanuvchi istalgan qismni ochishi
    // mumkin. Ko'rishlar soni bo'yicha tartib — eng ehtimoliylari avval.
    $rows = $db->fetchAll(
        "SELECT e.video_url, e.video_url_720p, e.video_url_1080p
           FROM content c
           JOIN episodes e ON e.content_id = c.id
          WHERE c.status = 'published'
            AND (e.video_url LIKE '%t.me/%' OR e.video_url_720p LIKE '%t.me/%'
                 OR e.video_url_1080p LIKE '%t.me/%')
          ORDER BY c.views DESC, c.id DESC, e.season ASC, e.episode_number ASC
          LIMIT 3000"
    );

    $items = [];
    $seen  = [];
    foreach ($rows as $r) {
        $url = trim((string) ($r['video_url_1080p'] ?: ($r['video_url_720p'] ?: $r['video_url'])));
        if ($url === '') continue;

        $ref = Catalog::tgRef($url);
        if (empty($ref['channel']) || empty($ref['post'])) continue;

        $ch = ltrim((string) $ref['channel'], '@');
        $post = (int) $ref['post'];
        if ($ch === '' || $post < 1) continue;

        $key = $ch . '/' . $post;
        if (isset($seen[$key])) continue;
        $seen[$key] = 1;

        $items[] = ['ch' => $ch, 'p' => $post];
    }

    return ['success' => true, 'items' => $items, 'ts' => time()];
});

ok($out);
