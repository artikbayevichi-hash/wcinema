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
require_once __DIR__ . '/../includes/AdminLog.php';

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
    global $action;
    // Audit jurnali: kim/nima qildi (xato bo'lsa ham javobni buzmaydi)
    try {
        AdminLog::add('content:' . $action, $m
            . (isset($extra['id']) ? ' #' . $extra['id'] : '')
            . (isset($_POST['title']) ? ' · ' . mb_substr((string) $_POST['title'], 0, 80) : ''));
    } catch (\Throwable $e) {
    }
    ok($extra + ['success' => true, 'message' => $m]);
}

/** URL tekshiruvi: bo'sh | uploads/... | http(s)://... Boshqasi (javascript: va h.k.) rad etiladi. */
function cleanUrl($v, $label) {
    $v = trim((string) $v);
    if ($v === '') {
        return '';
    }
    if (preg_match('#^https?://#i', $v)
        || (preg_match('#^uploads/[A-Za-z0-9_./-]+$#', $v) && strpos($v, '..') === false)) {
        return $v;
    }
    fail($label . ' manzili noto‘g‘ri (faqat http/https yoki uploads/)', 400);
}

/** Jadvalda haqiqatan mavjud ixtiyoriy ustunlar (migratsiya qilinmagan bo'lsa ham xato bermaydi). */
function existingCols($db, $table, array $want) {
    static $cache = [];
    if (!isset($cache[$table])) {
        $cache[$table] = [];
        foreach ($db->fetchAll("SHOW COLUMNS FROM `$table`") as $r) {
            $cache[$table][$r['Field']] = true;
        }
    }
    return array_intersect_key($want, $cache[$table]);
}

function idList($raw) {
    $ids = array_values(array_unique(array_filter(array_map('intval', explode(',', (string) $raw)), function ($v) {
        return $v > 0;
    })));
    return array_slice($ids, 0, 200);
}


// ---------------------------------------------------------------------------
// HTTP yordamchilari (havola tekshiruvi va Telegram import uchun)
// ---------------------------------------------------------------------------
/** SSRF himoyasi: faqat http(s) va ichki/zahiradagi IP'ga ishora qilmaydigan host. */
function isPublicHttpUrl($url) {
    $p = parse_url($url);
    if (!$p || empty($p['host']) || !in_array(strtolower($p['scheme'] ?? ''), ['http', 'https'], true)) {
        return false;
    }
    $ip = gethostbyname($p['host']);
    if ($ip === $p['host'] && !filter_var($ip, FILTER_VALIDATE_IP)) {
        return false;
    }
    return (bool) filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE);
}

/** [kod, tana, xato]. Yo'naltirishlarga ergashmaydi (SSRF), tana 400 KB bilan cheklangan. */
function httpFetch($url, $method = 'GET', $range = false, $timeout = 6) {
    if (!function_exists('curl_init')) {
        $ctx = stream_context_create(['http' => ['method' => $method, 'timeout' => $timeout, 'follow_location' => 0, 'ignore_errors' => true,
            'header' => "User-Agent: Mozilla/5.0 WCinemaAdmin\r\n" . ($range ? "Range: bytes=0-0\r\n" : '')]]);
        $body = @file_get_contents($url, false, $ctx, 0, 400000);
        $code = 0;
        if (!empty($http_response_header[0]) && preg_match('#\s(\d{3})\s#', $http_response_header[0], $m)) {
            $code = (int) $m[1];
        }
        return [$code, (string) $body, $body === false ? 'ulanib bo‘lmadi' : ''];
    }
    $ch = curl_init($url);
    $buf = '';
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST  => $method, CURLOPT_NOBODY => $method === 'HEAD',
        CURLOPT_FOLLOWLOCATION => false, CURLOPT_TIMEOUT => $timeout, CURLOPT_CONNECTTIMEOUT => 4,
        CURLOPT_USERAGENT      => 'Mozilla/5.0 WCinemaAdmin', CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_PROTOCOLS      => CURLPROTO_HTTP | CURLPROTO_HTTPS,
        CURLOPT_HTTPHEADER     => $range ? ['Range: bytes=0-0'] : [],
        CURLOPT_WRITEFUNCTION  => function ($c, $d) use (&$buf) {
            $buf .= $d;
            return strlen($buf) > 400000 ? 0 : strlen($d);
        },
    ]);
    curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);
    return [$code, $buf, $code ? '' : ($err ?: 'javob yo‘q')];
}

/** Bitta video manbasini tekshiradi: ['state' => ok|warn|bad, 'note' => ...] */
function probeSource($url) {
    $url = trim((string) $url);
    if ($url === '') {
        return ['state' => 'bad', 'note' => 'Havola bo‘sh'];
    }
    if (strpos($url, 'uploads/') === 0) {
        return is_file(__DIR__ . '/../' . $url) ? ['state' => 'ok', 'note' => 'Fayl mavjud'] : ['state' => 'bad', 'note' => 'Fayl topilmadi'];
    }
    if (!isPublicHttpUrl($url)) {
        return ['state' => 'warn', 'note' => 'Tekshirib bo‘lmaydi'];
    }
    if (preg_match('#^https?://(?:www\.)?t\.me/(?:s/)?([A-Za-z0-9_]{4,})/(\d+)#i', $url, $m)) {
        [$code, $body, $err] = httpFetch('https://t.me/' . $m[1] . '/' . $m[2] . '?embed=1&mode=tme');
        if (!$code) {
            return ['state' => 'warn', 'note' => $err];
        }
        if (stripos($body, 'tgme_widget_message_video') !== false || stripos($body, 'tgme_widget_message_roundvideo') !== false) {
            return ['state' => 'ok', 'note' => 'Telegram: video bor'];
        }
        if (stripos($body, 'tgme_widget_message_error') !== false || stripos($body, 'Post not found') !== false) {
            return ['state' => 'bad', 'note' => 'Telegram: post o‘chirilgan'];
        }
        return ['state' => 'warn', 'note' => 'Telegram: postda video topilmadi'];
    }
    [$code, , $err] = httpFetch($url, 'HEAD');
    if ($code === 405 || $code === 403 || $code === 0) {
        [$code, , $err] = httpFetch($url, 'GET', true);
    }
    if (!$code) {
        return ['state' => 'bad', 'note' => $err ?: 'Ulanib bo‘lmadi'];
    }
    if ($code < 400) {
        return ['state' => 'ok', 'note' => 'HTTP ' . $code];
    }
    if ($code === 401 || $code === 403 || $code === 429) {
        return ['state' => 'warn', 'note' => 'HTTP ' . $code];
    }
    return ['state' => 'bad', 'note' => 'HTTP ' . $code];
}

function tgChannelName($raw) {
    $raw = trim((string) $raw);
    if (preg_match('#t\.me/(?:s/)?([A-Za-z0-9_]{4,})#i', $raw, $m)) {
        return $m[1];
    }
    $raw = ltrim($raw, '@');
    return preg_match('/^[A-Za-z0-9_]{4,}$/', $raw) ? $raw : '';
}

/** Kontentni va unga tegishli mahalliy fayllarni o'chiradi. */
function purgeContent($db, $cid) {
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
                $stillUsed = $db->fetchOne("SELECT id FROM content WHERE id <> ? AND $k = ?", [$cid, $p]);
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
        // Serverda sahifalash + filtr + tartiblash (500 talik chegara yo'q)
        $per   = max(5, min(100, (int) ($_GET['per'] ?? 20)));
        $page  = max(1, (int) ($_GET['page'] ?? 1));
        $q     = trim((string) ($_GET['q'] ?? ''));
        $where = ['1=1'];
        $args  = [];
        if ($q !== '') {
            if (ctype_digit($q)) {
                $where[] = '(c.id = ? OR c.title LIKE ?)';
                $args[]  = (int) $q;
                $args[]  = '%' . $q . '%';
            } else {
                $where[] = 'c.title LIKE ?';
                $args[]  = '%' . addcslashes($q, '%_\\') . '%';
            }
        }
        $fc = (int) ($_GET['category_id'] ?? 0);
        if ($fc > 0) {
            $where[] = 'c.category_id = ?';
            $args[]  = $fc;
        }
        $fs = (string) ($_GET['status'] ?? '');
        if (in_array($fs, ['draft', 'published', 'archived'], true)) {
            $where[] = 'c.status = ?';
            $args[]  = $fs;
        }
        if (($_GET['is_series'] ?? '') !== '') {
            $where[] = 'c.is_series = ?';
            $args[]  = (int) $_GET['is_series'] ? 1 : 0;
        }
        $sorts = [
            'new' => 'c.id DESC', 'old' => 'c.id ASC', 'views' => 'c.views DESC',
            'title' => 'c.title ASC', 'rating' => 'c.rating DESC',
        ];
        $order = $sorts[(string) ($_GET['sort'] ?? 'new')] ?? $sorts['new'];
        $w     = implode(' AND ', $where);

        $trow  = $db->fetchOne("SELECT COUNT(*) AS n FROM content c WHERE $w", $args);
        $total = (int) ($trow['n'] ?? 0);
        $pages = max(1, (int) ceil($total / $per));
        $page  = min($page, $pages);
        $off   = ($page - 1) * $per;

        $rows = $db->fetchAll(
            "SELECT c.id, c.title, c.category_id, cat.name AS category_name,
                    c.poster, c.is_series, c.status, c.release_year, c.rating,
                    c.views, c.created_at,
                    (SELECT COUNT(*) FROM episodes e
                      WHERE e.content_id = c.id) AS episodes_count
             FROM content c
             JOIN categories cat ON cat.id = c.category_id
             WHERE $w
             ORDER BY $order
             LIMIT $per OFFSET $off",
            $args
        );
        $counts = ['draft' => 0, 'published' => 0, 'archived' => 0];
        foreach ($db->fetchAll("SELECT status, COUNT(*) AS n FROM content GROUP BY status") as $r) {
            $counts[(string) $r['status']] = (int) $r['n'];
        }
        ok([
            'success'    => true,
            'items'      => $rows,
            'total'      => $total,
            'page'       => $page,
            'pages'      => $pages,
            'per'        => $per,
            'counts'     => $counts,
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

    // Ixtiyoriy yangi maydonlar (faqat ustun mavjud va forma yuborgan bo'lsa)
    foreach (existingCols($db, 'content', ['original_title' => 255, 'genres' => 500, 'trailer_url' => 500]) as $k => $len) {
        if (isset($_POST[$k])) {
            $fields[$k] = input($k, '', $len) ?: null;
        }
    }
    foreach (['poster', 'banner_url', 'trailer_url'] as $k) {
        if (!empty($fields[$k]) && !preg_match('#^https?://(t\.me|telegram\.me)/#i', (string) $fields[$k])) {
            $fields[$k] = cleanUrl($fields[$k], $k);
        }
    }

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
    purgeContent($db, $cid);
    contentOk('Kontent o‘chirildi', ['id' => $cid]);
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

    foreach (['video_url', 'video_url_720p', 'video_url_1080p', 'thumbnail'] as $k) {
        if (!empty($fields[$k])) {
            $fields[$k] = cleanUrl($fields[$k], $k);
        }
    }
    foreach (existingCols($db, 'episodes', ['subtitle_url' => 500, 'audio_lang' => 30]) as $k => $len) {
        if (isset($_POST[$k])) {
            $v = input($k, '', $len);
            $fields[$k] = $v !== '' ? ($k === 'subtitle_url' ? cleanUrl($v, $k) : $v) : null;
        }
    }

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

// ============================================================================
// YANGI: ommaviy amallar, nusxa, qismlarni tartiblash, rasm yuklash, TMDB
// ============================================================================
if ($action === 'bulk_status' || $action === 'bulk_delete') {
    $ids = idList(input('ids', '', 2000));
    if (!$ids) {
        fail('Hech narsa tanlanmagan', 400);
    }
    if ($action === 'bulk_status') {
        $st = input('status', '', 20);
        if (!in_array($st, ['draft', 'published', 'archived'], true)) {
            fail('Holat noto‘g‘ri', 400);
        }
        $db->update('content', ['status' => $st], 'id IN (' . implode(',', $ids) . ')', []);
        contentOk(count($ids) . ' ta kontent holati: ' . $st, ['count' => count($ids)]);
    }
    foreach ($ids as $cid) {
        purgeContent($db, $cid);
    }
    contentOk(count($ids) . ' ta kontent o‘chirildi', ['count' => count($ids)]);
}

if ($action === 'duplicate_content') {
    $cid = inputInt('id');
    $src = $cid > 0 ? $db->fetchOne("SELECT * FROM content WHERE id = ?", [$cid]) : null;
    if (!$src) {
        fail('Kontent topilmadi', 404);
    }
    foreach (['id', 'created_at', 'updated_at'] as $k) {
        unset($src[$k]);
    }
    $src['title']   = mb_substr($src['title'] . ' (nusxa)', 0, 255);
    $src['status']  = 'draft';
    $src['views']   = 0;
    $src['user_id'] = (int) $userId;
    $base = slugUz($src['title']);
    $slug = $base;
    $n = 2;
    while ($db->fetchOne("SELECT id FROM content WHERE slug = ?", [$slug])) {
        $slug = $base . '-' . $n++;
    }
    $src['slug'] = $slug;
    $newId = $db->insert('content', $src);
    if (!$newId) {
        fail('Nusxalab bo‘lmadi', 500);
    }
    if (input('with_episodes', '0', 4) === '1') {
        foreach ($db->fetchAll("SELECT * FROM episodes WHERE content_id = ?", [$cid]) as $e) {
            unset($e['id'], $e['created_at'], $e['updated_at']);
            $e['content_id'] = (int) $newId;
            $db->insert('episodes', $e);
        }
    }
    contentOk('Nusxa yaratildi', ['id' => $newId]);
}

if ($action === 'bulk_episodes') {
    // Har qatorda bitta havola (ixtiyoriy: "havola | sarlavha"). Raqamlar ketma-ket.
    $contentId = inputInt('content_id');
    if (!$contentId || !$db->fetchOne("SELECT id FROM content WHERE id = ?", [$contentId])) {
        fail('Kontent topilmadi', 404);
    }
    $season = max(1, inputInt('season', 1));
    $type   = input('video_type', 'direct', 20);
    if (!in_array($type, $videoTypes, true) || $type === 'none') {
        fail('video_type noto‘g‘ri', 400);
    }
    $lines = preg_split('/\r\n|\r|\n/', (string) ($_POST['urls'] ?? ''));
    $items = [];
    foreach ($lines as $ln) {
        $ln = trim($ln);
        if ($ln === '') {
            continue;
        }
        $parts = array_map('trim', explode('|', $ln, 2));
        $items[] = ['url' => cleanUrl($parts[0], 'video_url'), 'title' => $parts[1] ?? ''];
    }
    if (!$items) {
        fail('Havolalar kiritilmagan', 400);
    }
    if (count($items) > 200) {
        fail('Bir martada 200 tagacha qism', 400);
    }
    $start = inputInt('start');
    if ($start < 1) {
        $mx = $db->fetchOne(
            "SELECT MAX(episode_number) AS m FROM episodes WHERE content_id = ? AND season = ?",
            [$contentId, $season]
        );
        $start = (int) ($mx['m'] ?? 0) + 1;
    }
    $taken = [];
    foreach ($db->fetchAll("SELECT episode_number FROM episodes WHERE content_id = ? AND season = ?", [$contentId, $season]) as $r) {
        $taken[(int) $r['episode_number']] = true;
    }
    foreach ($items as $i => $_) {
        if (isset($taken[$start + $i])) {
            fail('Qism raqami band: ' . $season . ' fasl, ' . ($start + $i) . '-qism', 409);
        }
    }
    $dur = max(0, inputInt('duration')) ?: null;
    $prem = in_array(input('is_premium', '0', 4), ['1', 'on', 'true', 'yes'], true) ? 1 : 0;
    foreach ($items as $i => $it) {
        $num = $start + $i;
        $db->insert('episodes', [
            'content_id' => $contentId, 'season' => $season, 'episode_number' => $num,
            'title' => $it['title'] !== '' ? mb_substr($it['title'], 0, 255) : ('Qism ' . $num),
            'video_type' => $type, 'video_url' => $it['url'],
            'duration' => $dur, 'is_premium' => $prem,
        ]);
    }
    contentOk(count($items) . ' ta qism qo‘shildi', ['id' => $contentId, 'count' => count($items)]);
}

if ($action === 'bulk_delete_episodes') {
    $ids = idList(input('ids', '', 2000));
    if (!$ids) {
        fail('Hech narsa tanlanmagan', 400);
    }
    foreach ($ids as $eid) {
        $ep = $db->fetchOne("SELECT * FROM episodes WHERE id = ?", [$eid]);
        if (!$ep) {
            continue;
        }
        $db->delete('episodes', 'id = ?', [$eid]);
        foreach (['video_url', 'video_url_720p', 'video_url_1080p', 'thumbnail'] as $k) {
            if (!empty($ep[$k])) {
                removeLocalFile($ep[$k]);
            }
        }
    }
    contentOk(count($ids) . ' ta qism o‘chirildi', ['count' => count($ids)]);
}

if ($action === 'reorder_episodes') {
    // Sudrab tartiblash: berilgan id tartibi bo'yicha qism raqamlari 1..N qilinadi.
    // (content_id, season, episode_number) unikal bo'lgani uchun avval vaqtinchalik raqam beramiz.
    $contentId = inputInt('content_id');
    $season    = max(1, inputInt('season', 1));
    $ids       = idList(input('order', '', 4000));
    if (!$contentId || !$ids) {
        fail('Noto‘g‘ri so‘rov', 400);
    }
    foreach ($ids as $eid) {
        $ok = $db->fetchOne(
            "SELECT id FROM episodes WHERE id = ? AND content_id = ? AND season = ?",
            [$eid, $contentId, $season]
        );
        if (!$ok) {
            fail('Qism bu faslga tegishli emas', 400);
        }
    }
    foreach ($ids as $i => $eid) {
        $db->update('episodes', ['episode_number' => 100000 + $i], 'id = ?', [$eid]);
    }
    foreach ($ids as $i => $eid) {
        $db->update('episodes', ['episode_number' => $i + 1], 'id = ?', [$eid]);
    }
    contentOk('Tartib saqlandi', ['id' => $contentId]);
}

if ($action === 'upload_image') {
    $f = $_FILES['file'] ?? null;
    if (!$f || ($f['error'] ?? 1) !== UPLOAD_ERR_OK || !is_uploaded_file($f['tmp_name'])) {
        fail('Fayl yuklanmadi', 400);
    }
    if ($f['size'] > 5 * 1024 * 1024) {
        fail('Rasm 5 MB dan oshmasin', 400);
    }
    $info = @getimagesize($f['tmp_name']);
    $exts = [IMAGETYPE_JPEG => 'jpg', IMAGETYPE_PNG => 'png', IMAGETYPE_WEBP => 'webp'];
    if (!$info || !isset($exts[$info[2]])) {
        fail('Faqat JPG, PNG yoki WEBP', 400);
    }
    $dir = __DIR__ . '/../uploads/posters';
    if (!is_dir($dir) && !@mkdir($dir, 0755, true)) {
        fail('uploads/posters papkasini yaratib bo‘lmadi', 500);
    }
    $name = bin2hex(random_bytes(8)) . '.' . $exts[$info[2]];
    if (!move_uploaded_file($f['tmp_name'], $dir . '/' . $name)) {
        fail('Faylni saqlab bo‘lmadi', 500);
    }
    contentOk('Rasm yuklandi', ['url' => 'uploads/posters/' . $name]);
}

if ($action === 'tmdb_search') {
    // config/.env da TMDB_API_KEY bo'lsa ishlaydi (kalit brauzerga chiqmaydi)
    if (!defined('TMDB_API_KEY') || TMDB_API_KEY === '') {
        fail('TMDB_API_KEY sozlanmagan', 400);
    }
    $q    = input('q', '', 120);
    $kind = input('kind', 'movie', 6) === 'tv' ? 'tv' : 'movie';
    if ($q === '') {
        fail('So‘rov bo‘sh', 400);
    }
    $url = 'https://api.themoviedb.org/3/search/' . $kind . '?language=ru-RU&query=' . rawurlencode($q)
         . '&api_key=' . rawurlencode(TMDB_API_KEY);
    $raw = @file_get_contents($url, false, stream_context_create(['http' => ['timeout' => 8]]));
    $j   = $raw ? json_decode($raw, true) : null;
    if (!is_array($j)) {
        fail('TMDB javob bermadi', 502);
    }
    $out = [];
    foreach (array_slice($j['results'] ?? [], 0, 8) as $r) {
        $date  = (string) ($r['release_date'] ?? $r['first_air_date'] ?? '');
        $out[] = [
            'title'          => (string) ($r['title'] ?? $r['name'] ?? ''),
            'original_title' => (string) ($r['original_title'] ?? $r['original_name'] ?? ''),
            'release_year'   => (int) substr($date, 0, 4),
            'description'    => (string) ($r['overview'] ?? ''),
            'poster'         => !empty($r['poster_path']) ? 'https://image.tmdb.org/t/p/w500' . $r['poster_path'] : '',
            'banner_url'     => !empty($r['backdrop_path']) ? 'https://image.tmdb.org/t/p/w1280' . $r['backdrop_path'] : '',
            'rating'         => round((float) ($r['vote_average'] ?? 0), 1),
            'is_series'      => $kind === 'tv' ? 1 : 0,
        ];
    }
    ok(['success' => true, 'results' => $out]);
}

if ($action === 'check_links') {
    // Qismlar havolalarini tekshiradi (paketlab: offset/limit). Natija: har bir qism uchun holat.
    $contentId = inputInt('content_id');
    $offset    = max(0, inputInt('offset'));
    $limit     = 12;
    if (!$contentId) {
        fail('Kontent ko‘rsatilmagan', 400);
    }
    $tr = $db->fetchOne("SELECT COUNT(*) AS n FROM episodes WHERE content_id = ?", [$contentId]);
    $total = (int) ($tr['n'] ?? 0);
    $rows  = $db->fetchAll(
        "SELECT id, video_url, video_type FROM episodes WHERE content_id = ?
         ORDER BY season, episode_number LIMIT $limit OFFSET $offset",
        [$contentId]
    );
    $out = [];
    foreach ($rows as $r) {
        $res = ($r['video_type'] ?? '') === 'none' ? ['state' => 'warn', 'note' => 'Manba yo‘q'] : probeSource($r['video_url']);
        $out[] = ['id' => (int) $r['id']] + $res;
    }
    ok(['success' => true, 'results' => $out, 'next' => $offset + count($rows), 'total' => $total,
        'done' => $offset + count($rows) >= $total]);
}

if ($action === 'tg_scan') {
    // Ommaviy Telegram kanal (t.me/s/<kanal>) postlarini o'qiydi: video bor/yo'qligi, sarlavha, davomiylik.
    $chan = tgChannelName(input('channel', '', 200));
    if ($chan === '') {
        fail('Kanal nomi yoki t.me havolasi noto‘g‘ri', 400);
    }
    $before = max(0, inputInt('before'));
    $pages  = max(1, min(5, inputInt('pages', 2)));
    $posts  = [];
    for ($i = 0; $i < $pages; $i++) {
        $url = 'https://t.me/s/' . $chan . ($before ? '?before=' . $before : '');
        [$code, $html, $err] = httpFetch($url, 'GET', false, 10);
        if ($code !== 200 || $html === '') {
            if (!$posts) {
                fail('Kanalni o‘qib bo‘lmadi' . ($err ? ': ' . $err : ' (HTTP ' . $code . ')') . '. Kanal ommaviy bo‘lishi kerak.', 502);
            }
            break;
        }
        $blocks = preg_split('/class="tgme_widget_message_wrap/', $html);
        array_shift($blocks);
        $minId = 0;
        foreach ($blocks as $b) {
            if (!preg_match('#data-post="' . preg_quote($chan, '#') . '/(\d+)"#i', $b, $m)) {
                continue;
            }
            $pid = (int) $m[1];
            $minId = $minId ? min($minId, $pid) : $pid;
            $hasVideo = strpos($b, 'tgme_widget_message_video') !== false || strpos($b, 'tgme_widget_message_roundvideo') !== false;
            $text = '';
            if (preg_match('#class="tgme_widget_message_text[^>]*>(.*?)</div>#s', $b, $t)) {
                $text = trim(html_entity_decode(strip_tags(preg_replace('#<br\s*/?>#i', "\n", $t[1])), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
            }
            $dur = '';
            if (preg_match('#tgme_widget_message_video_duration[^>]*>([^<]+)<#', $b, $d)) {
                $dur = trim($d[1]);
            }
            $date = '';
            if (preg_match('#<time[^>]*datetime="([^"]+)"#', $b, $d)) {
                $date = substr($d[1], 0, 10);
            }
            $first = trim(strtok($text, "\n") ?: '');
            $posts[$pid] = [
                'id' => $pid, 'url' => 'https://t.me/' . $chan . '/' . $pid, 'has_video' => $hasVideo,
                'title' => mb_substr($first, 0, 120), 'duration' => $dur, 'date' => $date,
            ];
        }
        if (!$minId || $minId <= 1) {
            break;
        }
        $before = $minId;
    }
    ksort($posts);
    ok(['success' => true, 'channel' => $chan, 'posts' => array_values($posts), 'before' => $before]);
}

fail('Noma’lum harakat: ' . htmlspecialchars($action), 400);