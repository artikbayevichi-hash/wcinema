<?php
// ============================================================================
// api/content-admin.php - Kontent va qismlar boshqaruvi (faqat ADMIN)
// ============================================================================
// Bu panel CONTENT (film/serial meta-ma'lumot) va EPISODES (video manbalar)
// jadvallarini boshqaradi. Bunga qadar bazaga kontent faqat SQL orqali
// qo'shilar edi - endi admin brauzerda qila oladi.
//
// GET  ?list=1          -> hamma kontent (qismlar soni bilan) + kategoriyalar
// GET  ?id=N            -> bitta kontent + qismlari (playback aniqlangan)
//
// POST action=...
//   create_content  /  update_content  /  delete_content
//   add_episode     /  update_episode  /  delete_episode
// ============================================================================
require_once __DIR__ . '/../includes/bootstrap.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST' && empty($_GET['list']) && empty($_GET['id'])) {
    fail('Parametr kerak', 400);
}

requireAdmin();

$cat = new Catalog();
$db  = Database::getInstance();

// -------- kategoriyalar ----------------
function contentCategories($db) {
    return $db->fetchAll("SELECT id, name, slug FROM categories ORDER BY id");
}

function contentOk($m, $extra = []) {
    ok($extra + ['success' => true, 'message' => $m]);
}

/**
 * Sarlavhadan SEO-slug yasaydi: "O'zbekcha Kino 2!" -> "ozbekcha-kino-2"
 *
 * Nima uchun shaxsiy funksiya: slug'ni server (va ba'zan DB) yaratgan.
 * Harflarni lotincha asosga o'tkazamiz (ASCII), qolgani pastki chiziqcha.
 */
function slugUz($s) {
    $s = mb_strtolower(trim((string) $s), 'UTF-8');
    $map = [
        'o‘' => 'o', "o'" => 'o', 'ó' => 'o', 'ö' => 'o',
        'g‘' => 'g', "g'" => 'g', 'ğ' => 'g', 'ġ' => 'g',
        'q'  => 'q', 'ʻ' => '',
        '‘'  => '', "'" => '', '’' => '',
        'á' => 'a', 'à' => 'a', 'â' => 'a', 'ä' => 'a', 'ă' => 'a', 'ā' => 'a',
        'é' => 'e', 'è' => 'e', 'ê' => 'e', 'ë' => 'e', 'ē' => 'e',
        'í' => 'i', 'ì' => 'i', 'î' => 'i', 'ï' => 'i', 'ī' => 'i', 'ı' => 'i',
        'ú' => 'u', 'ù' => 'u', 'û' => 'u', 'ü' => 'u', 'ū' => 'u',
        'ç' => 'c', 'č' => 'c', 'ć' => 'c',
        'š' => 's', 'ş' => 's', 'ń' => 'n', 'ñ' => 'n',
        'ý' => 'y', 'ž' => 'z', 'ż' => 'z',
        'ð' => 'd',
    ];
    $s = strtr($s, $map);
    $s = preg_replace('/[^a-z0-9]+/u', '-', $s);
    $s = trim($s, '-');
    return $s !== '' ? $s : ('kontent-' . substr(bin2hex(random_bytes(4)), 0, 6));
}

// -------- GET: ro'yxat ----------------
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET') {
    if (isset($_GET['list'])) {
        $rows = $db->fetchAll(
            "SELECT c.id, c.title, c.category_id, cat.name AS category_name,
                    c.poster, c.is_series, c.status, c.release_year, c.rating,
                    c.views, c.created_at,
                    (SELECT COUNT(*) FROM episodes e
                      WHERE e.content_id = c.id) AS episodes_count
             FROM content c
             JOIN categories cat ON cat.id = c.category_id
             ORDER BY c.id DESC
             LIMIT 500"
        );
        ok([
            'success'    => true,
            'items'      => $rows,
            'categories' => contentCategories($db),
            'statuses'   => ['draft', 'published', 'archived'],
        ]);
    }

    if (isset($_GET['id'])) {
        $id = inputInt('id');
        $item = $cat->getContent($id);
        if (!$item) {
            fail('Kontent topilmadi', 404);
        }
        $eps = $cat->getEpisodes($id);
        foreach ($eps as &$e) {
            $e['playback'] = $cat->getPlayback($e);
        }
        unset($e);
        ok([
            'success'    => true,
            'item'       => $item,
            'episodes'   => $eps,
            'categories' => contentCategories($db),
            'statuses'   => ['draft', 'published', 'archived'],
        ]);
    }
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    fail('POST so‘raladi', 405);
}

$action = input('action', '', 30);

// ============================================================================
// CONTENT
// ============================================================================
if (in_array($action, ['create_content', 'update_content'], true)) {
    $title = input('title', '', 255);
    if ($title === '') {
        fail('Sarlavha kerak', 400);
    }

    $categoryId = inputInt('category_id');
    $catRow = $categoryId > 0
        ? $db->fetchOne("SELECT id FROM categories WHERE id = ?", [$categoryId])
        : null;
    if (!$catRow) {
        fail('Kategoriya noto‘g‘ri', 400);
    }

    $isSeries = in_array(input('is_series', '0', 4), ['1', 'on', 'true', 'yes'], true) ? 1 : 0;
    $releaseYear = inputInt('release_year');
    if ($releaseYear > 0 && ($releaseYear < 1895 || $releaseYear > 2100)) {
        fail('Yil noto‘g‘ri (1895-2100)', 400);
    }
    $rating = (float) input('rating', '0', 10);
    if ($rating < 0 || $rating > 10) {
        fail('Baholash 0-10 oralig‘ida', 400);
    }

    $duration = max(0, inputInt('duration'));
    $status   = in_array(input('status', 'published', 20), ['draft', 'published', 'archived'], true)
        ? input('status', 'published', 20) : 'published';

    $slug = input('slug', '', 255);
    if ($slug === '') {
        $slug = slugUz($title);
    }
    // ziddiyat bo'lsa -N qo'shamiz
    $baseSlug = $slug;
    $n = 2;
    $where = $action === 'update_content' ? " AND id <> " . (int) inputInt('id') : '';
    while ($db->fetchOne("SELECT id FROM content WHERE slug = ?$where", [$slug])) {
        $slug = $baseSlug . '-' . $n++;
    }

    $fields = [
        'title'        => $title,
        'slug'         => $slug,
        'category_id'  => $categoryId,
        'is_series'    => $isSeries,
        'description'  => input('description', '', 5000) ?: null,
        'poster'       => input('poster', '', 500) ?: null,
        'banner_url'   => input('banner_url', '', 500) ?: null,
        'release_year' => $releaseYear ?: null,
        'rating'       => $rating,
        'duration'     => $duration ?: null,
        'studio'       => input('studio', '', 255) ?: null,
        'director'     => input('director', '', 255) ?: null,
        'actors'       => input('actors', '', 2000) ?: null,
        'country'      => input('country', '', 100) ?: null,
        'language'     => input('language', '', 50) ?: null,
        'status'       => $status,
        'total_episodes' => max(0, inputInt('total_episodes')),
    ];

    // Poster bo'sh bo'lsa — video URL (t.me post) ni poster manzili qilib
    // qo'yamiz. Rasm SERVERGA YUKLAB OLINMAYDI: ko'rsatish paytida
    // Catalog::posterSrc() uni api/tg-resolve.php?mode=img ga o'giradi,
    // u esa CDN rasmiga 302 qaytaradi. Shu bilan diskka rasm yozilmaydi.
    if (empty($fields['poster'])) {
        $srcUrl = trim(input('first_episode_url', '', 1000));
        if ($srcUrl === '' && $action === 'update_content') {
            $cid0 = inputInt('id');
            if ($cid0 > 0) {
                $ep = $db->fetchOne(
                    "SELECT video_url FROM episodes
                      WHERE content_id = ? AND video_url LIKE '%t.me%'
                      ORDER BY season ASC, episode_number ASC LIMIT 1",
                    [$cid0]
                );
                if ($ep) {
                    $srcUrl = (string) $ep['video_url'];
                }
            }
        }
        if ($srcUrl !== ''
            && preg_match('#(^|\.)(t\.me|telegram\.me)$#i',
                (string) parse_url($srcUrl, PHP_URL_HOST))) {
            $fields['poster'] = $srcUrl;
        }
    }

    if ($action === 'create_content') {
        $fields['user_id'] = (int) $userId;
        $id = $db->insert('content', $fields);
        if (!$id) {
            fail('Bazaga saqlab bo‘lmadi', 500);
        }
        // Kino/Multfilm: nom va video URL shu yerda kiritiladi — 1-qism
        // sifatida darhol saqlaymiz. Anime/Serial'da esa video keyin
        // qismlar bo'limida qo'shiladi (bu maydon bo'sh keladi).
        $firstUrl = trim(input('first_episode_url', '', 1000));
        if ($firstUrl !== '') {
            $db->insert('episodes', [
                'content_id'     => (int) $id,
                'season'         => 1,
                'episode_number' => 1,
                'title'          => '1-qism',
                'video_type'     => 'direct',
                'video_url'      => $firstUrl,
                'duration'       => max(0, inputInt('first_episode_duration')) ?: null,
            ]);
        }
        contentOk('Kontent yaratildi', ['id' => $id]);
    } else {
        $cid = inputInt('id');
        $exists = $cid > 0 ? $db->fetchOne("SELECT id FROM content WHERE id = ?", [$cid]) : null;
        if (!$exists) {
            fail('Kontent topilmadi', 404);
        }
        $db->update('content', $fields, 'id = ?', [$cid]);
        contentOk('Kontent yangilandi', ['id' => $cid]);
    }
}

/**
 * Mahalliy (uploads/ ichidagi) faylni diskdan o'chiradi.
 * URL faqat "uploads/..." ko'rinishida bo'lsa ishlaydi — tashqi (http,
 * t.me, CDN) manzillarga tegmaydi. Windows'da fayl band bo'lsa qisqa
 * kutib qayta urinadi (Reels::unlinkWithRetry bilan bir xil g'oya).
 */
function removeLocalFile($url) {
    $url = trim((string) $url);
    if ($url === '' || preg_match('#^https?://#i', $url)) {
        return; // tashqi manba — o'chirmaymiz
    }
    if (!preg_match('#^uploads/[A-Za-z0-9_./-]+$#', $url) || strpos($url, '..') !== false) {
        return; // xavfsizlik: faqat uploads/ ichidagi oddiy yo'llar
    }
    $abs = __DIR__ . '/../' . $url;
    if (!is_file($abs)) {
        return;
    }
    for ($i = 0; $i < 6; $i++) {
        if (@unlink($abs)) {
            return;
        }
        clearstatcache(true, $abs);
        if ($i < 5) {
            usleep(250000); // 0.25s — Windows fayl qulfi ko'tarilishi uchun
        }
    }
}

if ($action === 'delete_content') {
    $cid = inputInt('id');
    $exists = $cid > 0 ? $db->fetchOne("SELECT id FROM content WHERE id = ?", [$cid]) : null;
    if (!$exists) {
        fail('Kontent topilmadi', 404);
    }

    // Diskdan o'chirish uchun avval fayllarni yig'amiz (CASCADE'gacha):
    //  - qism videolari/thumbnail'lar (video_url, 720p, 1080p)
    //  - kontent posteri/banner'i (agar boshqa kontent ishlatmasa)
    $files = [];
    $epRows = $db->fetchAll(
        "SELECT video_url, video_url_720p, video_url_1080p, thumbnail FROM episodes WHERE content_id = ?",
        [$cid]
    );
    foreach ($epRows as $r) {
        foreach (['video_url', 'video_url_720p', 'video_url_1080p', 'thumbnail'] as $k) {
            if (!empty($r[$k])) {
                $files[] = $r[$k];
            }
        }
    }
    $row = $db->fetchOne("SELECT poster, banner_url FROM content WHERE id = ?", [$cid]);
    if ($row) {
        foreach (['poster', 'banner_url'] as $k) {
            $p = trim((string) ($row[$k] ?? ''));
            if ($p !== '' && strpos($p, 'uploads/') === 0) {
                // boshqa kontent ham shu faylni ishlatsa — o'chirmaymiz
                $stillUsed = $db->fetchOne(
                    "SELECT id FROM content WHERE id <> ? AND $k = ?",
                    [$cid, $p]
                );
                if (!$stillUsed) {
                    $files[] = $p;
                }
            }
        }
    }

    $db->delete('content', 'id = ?', [$cid]);
    foreach ($files as $f) {
        removeLocalFile($f);
    }
    contentOk('Kontent o‘chirildi');
}

// ============================================================================
// EPISODES (qismlar)
// ============================================================================
$videoTypes = ['direct', 'embed', 'file', 'hls', 'none'];

if (in_array($action, ['add_episode', 'update_episode'], true)) {
    if ($action === 'add_episode') {
        $contentId = inputInt('content_id');
        $exists = $contentId > 0
            ? $db->fetchOne("SELECT id FROM content WHERE id = ?", [$contentId])
            : null;
        if (!$exists) {
            fail('Kontent topilmadi', 404);
        }
    } else {
        $epId   = inputInt('id');
        $epRow  = $epId > 0 ? $db->fetchOne("SELECT * FROM episodes WHERE id = ?", [$epId]) : null;
        if (!$epRow) {
            fail('Qism topilmadi', 404);
        }
        $contentId = (int) $epRow['content_id'];
    }

    $season = max(1, inputInt('season', 1));
    $num    = max(1, inputInt('episode_number'));
    $url    = trim(input('video_url', '', 1000));
    $type   = input('video_type', 'direct', 20);
    if (!in_array($type, $videoTypes, true)) {
        fail('video_type noto‘g‘ri', 400);
    }

    // Qism raqami takrorlansa xato (unique key)
    $dupWhere = $action === 'update_episode' ? " AND id <> " . (int) $epId : '';
    $dup = $db->fetchOne(
        "SELECT id FROM episodes WHERE content_id = ? AND season = ? AND episode_number = ?$dupWhere",
        [$contentId, $season, $num]
    );
    if ($dup) {
        fail('Bu qism raqami band (' . $season . ' fasl, ' . $num . '-qism)', 409);
    }

    // 'none' dan boshqa barcha turlar uchun manba kerak
    if ($type !== 'none' && $url === '') {
        fail('Video manzili kerak (video_type: ' . $type . ')', 400);
    }

    $fields = [
        'season'         => $season,
        'episode_number' => $num,
        'title'          => input('title', '', 255) ?: ('Qism ' . $num),
        'description'    => input('description', '', 2000) ?: null,
        'thumbnail'      => input('thumbnail', '', 500) ?: null,
        'video_type'     => $type,
        'video_url'      => $url ?: null,
        'video_url_720p' => input('video_url_720p', '', 1000) ?: null,
        'video_url_1080p'=> input('video_url_1080p', '', 1000) ?: null,
        'duration'       => max(0, inputInt('duration')) ?: null,
        'is_premium'     => in_array(input('is_premium', '0', 4), ['1', 'on', 'true', 'yes'], true) ? 1 : 0,
    ];

    if ($action === 'add_episode') {
        $fields['content_id'] = $contentId;
        $epId = $db->insert('episodes', $fields);
        if (!$epId) {
            fail('Bazaga saqlab bo‘lmadi', 500);
        }
    } else {
        $db->update('episodes', $fields, 'id = ?', [$epId]);
    }

    $pb = $cat->getPlayback($cat->getEpisode($epId));

    // Telegram post havolasi bo'lsa — postda HAQIQIY video bor/yo'qligini
    // serverda tekshiramiz (6 soat kesh) va javobga qo'shamiz. E'lon/rasm
    // postida video bo'lmaydi — admin panel foydalanuvchiga aniq xabar beradi.
    $tg = null;
    if ($url !== '' && preg_match('#(?:^|[/.])(t\.me|telegram\.me)(?:/|$)#i', $url)) {
        try {
            $tg = (new TgResolve())->resolve($url);
        } catch (\Throwable $e) {
            $tg = null;
        }
    }

    contentOk(($action === 'add_episode' ? 'Qism qo‘shildi' : 'Qism yangilandi'), [
        'id' => $epId,
        'playback' => $pb,
        'tg' => $tg,
    ]);
}

if ($action === 'delete_episode') {
    $epId = inputInt('id');
    $ep = $epId > 0 ? $db->fetchOne("SELECT * FROM episodes WHERE id = ?", [$epId]) : null;
    if (!$ep) {
        fail('Qism topilmadi', 404);
    }
    // Qism bilan birga uning video fayllarini ham diskdan o'chirib,
    // "o'lik fayl" to'planib qolishining oldini olamiz.
    $files = [];
    foreach (['video_url', 'video_url_720p', 'video_url_1080p', 'thumbnail'] as $k) {
        if (!empty($ep[$k])) {
            $files[] = $ep[$k];
        }
    }
    $db->delete('episodes', 'id = ?', [$epId]);
    foreach ($files as $f) {
        removeLocalFile($f);
    }
    contentOk('Qism o‘chirildi');
}

fail('Noma’lum harakat: ' . htmlspecialchars($action), 400);