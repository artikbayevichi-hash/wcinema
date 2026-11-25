<?php
// ============================================================================
// watch.php - YouTube uslubidagi ko'rish sahifasi
// ============================================================================
// Video chapda (keng), uning ostida izohlar va "Boshqa kinolar, animelar
// va multfilmlar" setkasi. Serial/anime bo'lsa o'ngda QISMLAR paneli
// (vertikal skroll); kino/multfilmda o'ng panel umuman yo'q.
//
// DIQQAT: izohlar reels moduli bilan BIR XIL ishlaydi (tg-comments.js) -
// farq faqat mavzu endpointi: reels uchun `api/reel-topic.php`
// (`reels.id`), shu sahifa uchun `api/video-topic.php` (kalit - `content.id`,
// ya'ni serial/anime qismlari BITTA izohlar mavzusini bo'lishadi).
// ============================================================================
require_once __DIR__ . '/includes/bootstrap.php';

// Server-Timing: sahifa tayyorlanish vaqti (faqat ms, maxfiy ma'lumot yo'q).
// Brauzer tomonidagi video_start o'lchovi tg-perf.js da alohida yuboriladi.
require_once __DIR__ . '/includes/ServerTiming.php';
ServerTiming::init('wc-page', 'bootstrap + catalog + boot');

require_once __DIR__ . '/includes/MediaFlow.php';
$mediaflowEnabled = MediaFlow::isEnabled();
require_once __DIR__ . '/includes/TgPreview.php'; // kichik faststart preview (agar tayyor)
require_once __DIR__ . '/includes/StreamBootstrap.php'; // qo'shimcha so'rovlar SQL keshi

$user   = $auth->getCurrentUser();
$userId = $user ? (int) $user['id'] : null;

// ---------------------------------------------------------------------------
// Chuqur havola: watch.php?c=12&e=40 (yoki faqat e=40 - kontent topiladi)
//
// `ep=` ham qabul qilinadi (YouTube shakli: `?c=2&ep=3`) va qiymat qism
// ID'si bo'lishi SHART EMAS - agar bunday id yo'q bo'lsa, u 1-fasl
// `episode_number` sifatida qaraladi (qism raqami). Masalan:
//
//   ?c=2&e=41   -> 41-idli qism (to'g'ri)
//   ?c=2&ep=3    -> id 3 yo'q -> 3-qism (1-fasl)
//   ?e=41        -> kontentni qismdan aniqlaymiz
// ---------------------------------------------------------------------------
$cId  = (int) ($_GET['c'] ?? 0);
$eId  = (int) ($_GET['e'] ?? $_GET['ep'] ?? 0);
// Havoladagi ASLI qiymat (qaysi qism so'ralgani) - pastda kanonik 302
// uchun ishlatiladi, chunki `$eId` topilmagan qismda 0 ga tozalanadi.
$eReq = $eId;

if ($cId <= 0 && $eId > 0) {
    $ep = $catalog->getEpisode($eId);
    if ($ep) {
        $cId = (int) $ep['content_id'];
    } else {
        // Ehtimol bu qism RAQAMI. Uni kontent qilish uchun qidiramiz
        // (faqat bitta qismli bo'lmasa - birinchi topilganini olamiz).
        $byNum = $catalog->getEpisodeByNumber($eId);
        if ($byNum) {
            $cId = (int) $byNum['content_id'];
        }
    }
}

$item = $cId > 0 ? $catalog->getContent($cId) : null;

// Status 'draft' bo'lsa faqat admin ko'radi (index.php bilan bir xil qoida).
$canViewDraft = false;
if ($item && ($item['status'] ?? 'published') !== 'published') {
    $canViewDraft = $user && !empty($user['is_admin']);
    if (!$canViewDraft) {
        $item = null;
    }
}

// ---------------------------------------------------------------------------
// Ma'lumotlar
// ---------------------------------------------------------------------------
$episodes = [];
$selected = null;
$playback = null;
$genres   = [];
$related  = [];
$relatedHasMore = false;
$progress = null;
$hasPlaylist = false;

if ($item) {
    // DIQQAT: maydon nomlari `api/content.php` bilan BIR XIL bo'lishi shart
    // (`number`, `has_video`, ...). Qism almashtirishda `S.episodes` endi
    // almashtirilmaydi (faqat player yangilanadi), lekin `prefetch()`,
    // `epRow()` va sarlavha shu maydonlarga tayanadi — shuning uchun
    // birinchi ochilishdagi format keyingi holat bilan bir xil bo'lishi
    // shart (aks holda qism raqamlari "undefined" bo'lib qolardi).
    //
    // `tg_channel` + `tg_post` ham shu yerda kerak: birinchi ochilishda
    // `watch.js` darhol KEYINGI qismni oldindan yuklashi (`TgStream.prefetch`)
    // uchun Telegram post manzilini bilishi lozim.
    $episodes = array_map(static function ($e) {
        $ref = Catalog::tgRef($e['video_url'] ?? '');
        return [
            'id'         => (int) $e['id'],
            'season'     => (int) $e['season'],
            'number'     => (int) $e['episode_number'],
            'title'      => $e['title'],
            'thumbnail'  => $e['thumbnail'],
            'duration'   => $e['duration'],
            'is_premium' => (int) $e['is_premium'] === 1,
            'has_video'  => !empty($e['video_url']),
            'tg_channel' => $ref['channel'],
            'tg_post'    => $ref['post'],
        ];
    }, $catalog->getEpisodes($item['id']));

    $genres   = $catalog->getContentGenres($item['id']);

    // Tanlangan qism: ?e=/?ep=... bo'yicha ID, so'ng RAQAM (1-fasl),
    // keyin birinchi mavjud qism yoki butun film (kontentning o'zida
    // video_url bo'lishi mumkin).
    $eMatched = false;
    foreach ($episodes as $e) {
        if ((int) $e['id'] === $eId) {
            $selected = $e;
            $eMatched = true;
            break;
        }
    }
    if (!$selected && $eId > 0) {
        foreach ($episodes as $e) {
            if ((int) $e['season'] === 1 && (int) $e['number'] === $eId) {
                $selected = $e;
                $eMatched = true;
                break;
            }
        }
    }
    if (!$selected) {
        $eId      = 0;
        $selected = $episodes[0] ?? null;
    }

    /* Kanonik havola: `?ep=3` (raqam) yoki umuman topilmagan qism
       ishlatilgan bo'lsa, brauzer manzilini `?c=..&e=<qism id>` shakliga
       yo'naltiramiz. Shu bilan "Ulashish", "orqaga" va qism
       almashgandagi `pushState` bitta xil ko'rinishga ega bo'ladi
       (hamda `?e=`/`?ep=` chalkashligi butun sayt bo'ylab yo'qoladi). */
    if ($selected && $eReq > 0 && !$eMatched) {
        // Skript yo'li (`watch.php`) yoki atribut/proksi (`/watch.php`) -
        // nima bo'lsa ham o'shandan foydalanamiz.
        $self = explode('?', (string) ($_SERVER['REQUEST_URI'] ?? '/watch.php'), 2)[0];
        $qs   = 'c=' . (int) $item['id'] . '&e=' . (int) $selected['id'];
        header('Location: ' . $self . '?' . $qs, true, 302);
        exit;
    }
    // Oqim HAQIQIY episodes qatoridan olinadi (`is_premium`, 1080p/720p
    // variantlari ham shu yerda) - `$episodes` allaqachin qisqa qilingan.
    $playback = $selected ? $catalog->getPlayback($catalog->getEpisode((int) $selected['id']))
                          : $catalog->getPlayback($item);

    // Telegram posteri endi `Catalog::getPlayback()` ichida tanlanadi:
    // har bir video uchun uning O'Z thumb'i (`api/tg-thumb.php`) ishlatiladi,
    // kesh bor-yo'qligini bu yerda tekshirish shart emas — endpoint o'zi
    // tiklaydi. Bu ham oddiy film, ham anime qismlari uchun bir xil.

    // Pleer orqasidagi POSTER (YouTube uslubi).
    // Videо yuklanmaganda pleer qora quti bo'lib qolmasligi uchun kontent
    // posteri fon qilinadi — video o'zi chiqqanda esa u ustini yopadi.
    // Bitta `resolvePoster()` orqali olinadi: lokal fayl, t.me proksi yoki
    // avtomatik SVG fallback — hammasi bir xil ishlaydi.
    $watchPoster = '';
    if ($item) {
        $watchPoster = Catalog::resolvePoster(
            $item['poster'] ?? '',
            $item['title'] ?? '',
            $item['category_slug'] ?? '',
            $item['category_name'] ?? ''
        );
    }

    // "Davom etish": qayerda to'xtagan edi (faqat kirgan foydalanuvchilar uchun).
    if ($userId) {
        $p = $catalog->getProgress($userId, $item['id'], $selected ? (int) $selected['id'] : 0);
        $progress = [
            'position' => (int) $p['position_seconds'],
            'duration' => (int) $p['duration_seconds'],
            'percent'  => $p['duration_seconds'] > 0
                ? (int) round($p['position_seconds'] / $p['duration_seconds'] * 100)
                : 0,
        ];
    }

    /* Yon paneldagi aralash tavsiyalar - YouTube uslubidagi LAZY LOAD.
     *
     * Barchasini bir marta yubarmaslik kerak: sahifa tez ochilishi uchun
     * faqat BIR sahifa (RELATED_PAGE_SIZE) yuboriladi, qolgani
     * `api/related.php` orqali foydalanuvchi pastga tushganda keladi.
     *
     * `has_more` uchun `limit + 1` so'raymiz: qo'shimcha qator bo'lsa yana
     * sahifa bor (qo'shimcha `COUNT(*)` so'rovi kerak bo'lmaydi). */
    $relRows     = $catalog->getRelated($item, RELATED_PAGE_SIZE + 1, 0);
    $relatedHasMore = count($relRows) > RELATED_PAGE_SIZE;
    if ($relatedHasMore) {
        array_pop($relRows);
    }
    foreach ($relRows as $r) {
        $related[] = $catalog->toPublicArray($r, $userId);
    }

    /* Yon panelda QISMLAR ko'rsatiladimi?
     *
     * YouTube uslubi: film (kino/multfilm) uchun playlist yo'q - o'rniga
     * "boshqa videolar" chiqadi. Bitta qismli serial esa (anime, 1-qism)
     * ro'yxatga ega bo'lishi kerak - shuning uchun `is_series` ham hisobga
     * olinadi.
     */
    $hasPlaylist = !empty($item['is_series']) || count($episodes) > 1;
}

// ---------------------------------------------------------------------------
// JSON - frontend uchun. Bitta so'rovda hamma narsa (sahifa tez ochiladi).
// ---------------------------------------------------------------------------
// DIQQAT: `roomHint` yo'q - bu sahifada chat yo'q (chat.php da bor).
$WATCH = [
    'base'      => rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/\\'),
    'botName'   => TELEGRAM_BOT_USERNAME,
    'miniApp'   => MINI_APP_URL,
    'loggedIn'  => (bool) $user,
    // YouTube uslubidagi kanal qatori uchun: kanal nomi (SITE_NAME) va
    // "N ta foydalanuvchi" (saytda ro'yxatdan o'tganlar soni). Serverda
    // hisoblanadi - frontend qo'shimcha so'rov yubormaydi.
    'siteName'  => SITE_NAME,
    'subscribers' => $catalog->getSubscriberCount(),
    'content'   => $item ? $catalog->toPublicArray($item, $userId) : null,
    'genres'    => $genres,
    'episodes'  => $episodes,
    'selectedId' => $selected ? (int) $selected['id'] : 0,
    'playback'  => $playback,
    // Telegram RASMIY embed pleyeri — FAQAT OMMAVIY kanal postlarida.
    // Video baytlari to'g'ridan-to'g'ri Telegram CDN'dan brauzerga keladi
    // (sayt origin'i ularni KO'RMAYDI) — bu eng tez yo'l.
    // Katta fayllarda Telegram embed "Media is too big" beradi, shuning
    // uchun `api/tg-embed.php` bir marta tekshiradi va `watch.js` o'z
    // pleyerimizga (MTProto + SW) avtomatik qaytadi.
    // XUSUSIY kanal (`t.me/c/<id>/<post>`) da `channel` null bo'ladi —
    // bunday postlarda embed UMUMAN yoqilmaydi, faqat MTProto ishlaydi
    // (`api/tg-embed.php` ham faqat username formatini qabul qiladi).
    'tgEmbed'   => (is_array($playback) && ($playback['type'] ?? '') === 'telegram'
                    && !empty($playback['channel'])
                    && (int) ($playback['post'] ?? 0) > 0
                    && preg_match('/^[A-Za-z0-9_]{3,64}$/', (string) $playback['channel'])
                    && !preg_match('/^c\d+$/', (string) $playback['channel']))
                   ? ['channel' => (string) $playback['channel'],
                      'post'    => (int) $playback['post']]
                   : null,
    'progress'  => $progress,
    'hasPlaylist' => $hasPlaylist,
    'related'   => $related,
    // Lazy load uchun holat: nechta yuklandi, yana bormi.
    'relatedOffset'   => count($related),
    'relatedHasMore'  => $relatedHasMore,
    'relatedPageSize' => RELATED_PAGE_SIZE,
];

// ---------------------------------------------------------------------------
// JORIY VIDEO METAMA'LUMOTI — FAQAT FOYDALANUVCHI (gram) HAVOLASI INLINE
// ---------------------------------------------------------------------------
// 2026-11-12 da BOT sessiyasi olgan `file_reference` HTML ichiga qo'shilganida
// tomoshabbin akkauntida `FILE_REFERENCE_INVALID` chiqqan edi. Endi FAQAT
// `source='gram'` yozuvlari olinadi — ular aynan foydalanuvchining O'Z
// sessiyasida yaratilgan va `tg-meta-write.php` orqali bazaga yozilgan.
// Bot manbali yozuvlar `tg-stream.js` da allaqachon rad etiladi, shuning
// uchun ularni yuborish ham xavfsiz emas, ham ma'nosiz.
//
// NATIJA: birinchi video ochilishidagi `api/tg-doc.php` so'rovi (1 RTT)
// yo'qoladi — ma'lumot tayyor holda HTML bilan birga keladi. Qo'shni qismlar
// ham qo'shiladi: keyingi qismga o'tganda yana so'rov kerak bo'lmaydi.
$__inlineDocMeta = [];
// Qisqa preview manzillari ham HTML bilan birga keladi — `api/tg-preview.php`
// ga alohida so'rov kerak bo'lmaydi. Preview yo'q bo'lsa bo'sh massiv.
$__inlinePreview = [];
if ($item) {
    $__tgRefs = [];
    if (is_array($playback) && !empty($playback['channel'])
        && (int) ($playback['post'] ?? 0) > 0) {
        $__tgRefs[] = [$playback['channel'], (int) $playback['post']];
    }
    foreach ($episodes as $e) {
        if (!empty($e['tg_channel']) && (int) ($e['tg_post'] ?? 0) > 0) {
            $__tgRefs[] = [$e['tg_channel'], (int) $e['tg_post']];
        }
    }
    $__seenRef = [];   // gram doc meta (og'irroq) — 20 ta
    $__seenPv  = [];   // preview (engil) — barcha qismlar uchun
    foreach ($__tgRefs as $r) {
        $ch = (string) $r[0]; $po = (int) $r[1];
        // Kalit tg-stream.js dagi `String(channel) + '/' + post` bilan AYNAN
        // bir xil bo'lishi shart — kanal nomini kichik harfga o'zgartirmaymiz.
        $kk = $ch . '/' . $po;
        if (isset($__seenPv[$kk])) continue;
        $__seenPv[$kk] = 1;

        // Preview ALOHIDA Telegram posti — asl video file_reference'iga
        // BOG'LIQ EMAS. Shuning uchun uni `source='gram'` tekshiruvidan
        // QAT'I NAZAR qo'shamiz (bot meta bo'lsa ham ishlayveradi).
        // 200 tagacha inline qilamiz: anime/serialning istalgan qismi bosilsa
        // ham preview uchun qo'shimcha so'rov kerak bo'lmaydi.
        if (count($__inlinePreview) < 200) {
            $pv = TgPreview::get($ch, $po);
            if ($pv) {
                $__inlinePreview[$kk] = [
                    'ch' => $pv['ch'], 'p' => $pv['p'],
                    'size' => $pv['size'], 'mime' => $pv['mime'],
                    'w' => $pv['w'], 'h' => $pv['h'], 'dur' => $pv['dur'],
                ];
                // 1 s lik instant kadr — 19 MB intro'dan OLDIN o'ynatiladi.
                // U ham alohida Telegram posti, baytlar saytdan o'tmaydi.
                if (!empty($pv['instant'])) {
                    $__inlinePreview[$kk]['instant'] = $pv['instant'];
                }
            }
        }

        // FAQAT foydalanuvchi havolasi: bot yoki disk keshidan kelgani
        // brauzerda rad etiladi — uni yubormaymiz. HTML hajmini cheklash
        // uchun faqat dastlabki 20 ta noyob ref olinadi.
        if (isset($__seenRef[$kk]) || count($__seenRef) >= 20) continue;
        $__seenRef[$kk] = 1;
        $m = TgMeta::get($ch, $po);
        if (!$m || ($m['source'] ?? '') !== 'gram'
            || empty($m['fr']) || empty($m['id'])) continue;
        $t = (int) ($m['t'] ?? 0);
        if ($t <= 0) $t = time();
        $__inlineDocMeta[$kk] = [
            't'      => $t * 1000,              // server SONIYA -> brauzer MS
            'id'     => (string) $m['id'],
            'ah'     => (string) ($m['ah'] ?? ''),
            'fr'     => (string) $m['fr'],
            'dc'     => (int) ($m['dc'] ?? 0),
            'size'   => (int) ($m['size'] ?? 0),
            'mime'   => (string) ($m['mime'] ?? ''),
            'fn'     => (string) ($m['fn'] ?? ''),
            'w'      => (int) ($m['w'] ?? 0),
            'h'      => (int) ($m['h'] ?? 0),
            'dur'    => (int) ($m['dur'] ?? 0),
            'source' => 'gram',
        ];
    }
}

// ---------------------------------------------------------------------------
// VIDEO BOOTSTRAP: barcha umumiy ma'lumotlar BITTA SQL yozuvida.
// Birinchi ochishda quriladi, keyingilarida faqat o'qiladi — brauzer endi
// tg-embed / r2-info / doc / preview so'rovlarini yubormaydi.
// E'TIJOR: $__inlineDocMeta (chiptali, faqat shu foydalanuvchiniki) alohida.
// ---------------------------------------------------------------------------
$__boot = is_array($playback)
    ? StreamBootstrap::load($playback, [
        'content_id' => $item ? (int) $item['id'] : 0,
        'episode_id' => $selected ? (int) $selected['id'] : 0,
    ])
    : null;

$NAV_ACTIVE = 'home';
?>
<!DOCTYPE html>
<html lang="uz">
<head>
    <link rel="icon" type="image/png" href="assets/img/favicon.png?v=<?php echo @filemtime(__DIR__ . '/assets/img/favicon.png') ?: 1; ?>">
    <link rel="apple-touch-icon" href="assets/img/apple-touch-icon.png?v=<?php echo @filemtime(__DIR__ . '/assets/img/apple-touch-icon.png') ?: 1; ?>">
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title><?php echo $item ? htmlspecialchars($item['title']) . ' — W CINEMA' : 'Ko‘rish — W CINEMA'; ?></title>
    <?php /* preconnect + Service Worker'ni erta ro'yxatdan o'tkazish + metrika.
             Boshqa sahifalarda bu allaqachon bor edi; watch sahifasida
             yo'q edi — birinchi video ochilishidagi eng katta kechikish
             shu yerdan kelardi. */ ?>
    <?php
    /* POSTER PRELOAD — "birinchi kadr"ning eng arzon qismi.
     *
     * Pleer ochilishida foydalanuvchi birinchi bo'lib posterni ko'radi.
     * Uni HTML parse paytida `fetchpriority=high` bilan oldindan yuklasak,
     * qora ekran va keyingi layout siljishi (CLS) yo'qoladi. Manba:
     *   1) Telegram video thumb'i (`api/tg-thumb.php` yoki lokal kesh);
     *   2) bo'lmasa — kontent posteri (`Catalog::resolvePoster`).
     *
     * `perf-head.php` faqat `https://`, `//`, `/...` va `uploads/...`
     * manzillarni preload qiladi — `data:` SVG fallback jimgina o'tkazib
     * yuboriladi, ya'ni bu yerda qo'shimcha tekshiruv shart emas. */
    $PERF_POSTER = '';
    if (is_array($playback) && !empty($playback['poster'])) {
        $PERF_POSTER = (string) $playback['poster'];
    } elseif ($watchPoster !== '') {
        $PERF_POSTER = (string) $watchPoster;
    }
    ?>
    <?php require __DIR__ . '/includes/perf-head.php'; ?>
    <?php require __DIR__ . '/includes/tv-head.php'; ?>
    <link rel="stylesheet" href="assets/css/style.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/style.css') ?: 1; ?>">
    <link rel="stylesheet" href="assets/css/instagram.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/instagram.css') ?: 1; ?>">
    <link rel="stylesheet" href="assets/css/reels.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/reels.css') ?: 1; ?>">
    <?php /* DIQQAT: `chat.css` UCHUN LINK YO'Q - bu sahifada chat blok yo'q
             (chat alohida `chat.php` da). Chat uslublarini kiritish kerak
             bo'lsa, chat.php dagi ro'yxatdan ko'chirish kerak. */ ?>
    <link rel="stylesheet" href="assets/css/player.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/player.css') ?: 1; ?>">
    <?php /* tg-stream.css - Telegram CDN playeri uchun; tg-format.css - matn
             formatlash (bold/italic/kod/havola/...) va formatlash menyusi;
             voice.css - mikrofon zanjiri (tez bosish / skripka / uzoq ushlanish). */ ?>
    <link rel="stylesheet" href="assets/css/tg-stream.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/tg-stream.css') ?: 1; ?>">
    <link rel="stylesheet" href="assets/css/tg-format.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/tg-format.css') ?: 1; ?>">
    <link rel="stylesheet" href="assets/css/voice.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/voice.css') ?: 1; ?>">
    <link rel="stylesheet" href="assets/player/player.css?v=<?php echo @filemtime(__DIR__ . '/assets/player/player.css') ?: 1; ?>">
    <link rel="stylesheet" href="assets/css/watch.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/watch.css') ?: 1; ?>">
    <link rel="stylesheet" href="assets/css/tv-watch.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/tv-watch.css') ?: 1; ?>">
    <?php /* YouTube uslubidagi dizayn qatlami (watch.css ustidan). Eski uslubga
             qaytish kerak bo'lsa shu bitta qatorni o'chirish kifoya. */ ?>
    <link rel="stylesheet" href="assets/css/watch-yt.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/watch-yt.css') ?: 1; ?>">
    <link rel="stylesheet" href="assets/css/uz-loader.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/uz-loader.css') ?: 1; ?>">
    <?php /* Qora fonli bloklar (Qismlar, izoh yozish, stiker/GIF) + Ambient light uslubi.
             Eng OXIRIDA turishi shart. Qaytarish uchun shu qatorni olib tashlang. */ ?>
    <link rel="stylesheet" href="assets/css/watch-dark.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/watch-dark.css') ?: 1; ?>">
    <?php /* GramJS bundle (5.4 MB / 718 KB gzip) ENDI OLDINDAN YUKLANMAYDI.

        Nima uchun: video oqimining 99% holatida 25 KB li `tg-mtproto.js`
        yetadi (`upload.getFile` uchun GramJS'ning butun API qatlami kerak
        emas). 718 KB ni har bir watch sahifasida majburan yuklash sekin
        tarmoqda video baytlaridan oldin kanalni egallab, birinchi kadrni
        sekinlashtirardi.

        Endi bundle faqat haqiqatan kerak bo'lganda — `ensureSession()`
        ichida `loadBundle()` orqali — yuklanadi. Ya'ni:
          • ommaviy post + anonim CDN  -> umuman yuklanmaydi;
          • tez MTProto klient ishlagan -> umuman yuklanmaydi;
          • faqat tez yo'l rad etganda (masalan, eski `file_reference`
            yoki DC kaliti yo'q bo'lsa) -> o'sha paytda yuklanadi. */ ?>
    <?php /* Oqim zanjiri skriptlari pastda (nav va kontentdan keyin) turadi.
             Preload ularni HTML parse bilan PARALLEL yuklaydi — pleer mount'i
             bir necha yuz millisekundga erta boshlanadi. */ ?>
    <link rel="preload" as="script" fetchpriority="high"
          href="assets/js/tg-mtproto.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/tg-mtproto.js') ?: 1; ?>">
    <link rel="preload" as="script"
          href="assets/js/tg-stream.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/tg-stream.js') ?: 1; ?>">
    <link rel="preload" as="script"
          href="assets/js/watch.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/watch.js') ?: 1; ?>">
    <link rel="preload" as="script"
          href="assets/player/player.js?v=<?php echo @filemtime(__DIR__ . '/assets/player/player.js') ?: 1; ?>">
    <?php /* hls.js ni OLDINDAN yuklash — Telegram Web K modeli.
             Web K hls.js ni o'z build'iga kiritib, `modulepreload` orqali
             sahifa ochilishidayin brauzer keshiga yuklaydi. Natijada "play"
             bosilganda pleyer TAYYOR turadi.

             Bizda avval hls.js faqat "play" bosilganda, uchinchi tomon CDN
             dan yuklanardi — ya'ni aynan foydalanuvchi kutayotgan paytda
             +620 KB va uchinchi tomon TLS handshake (0.9-1.4 s). Endi:
               * fayl LOKAL (`assets/vendor/hls.min.js`) — o'z serverimizdan,
                 uchinchi tomonga so'rov umuman yo'q;
               * faqat HLS kontentida preload qilinadi — MP4/Telegram
                 videolarda bu 415 KB behuda sarflanmaydi;
               * `?v=` va `window.__WC_HLS_URL` bir xil manzilni beradi,
                 aks holda brauzer faylni IKKI MARTA yuklaydi. */
    $__hlsType = is_array($playback) ? (string) ($playback['type'] ?? '') : '';
    /* Pleyer siyosati (config.php: HLS_MODE). Telegram — asosiy yo'l, HLS —
       zaxira. Bu qiymatlar watch.js `raceHlsTelegram()` da o'qiladi. */
    ?>
    <script>window.__WC_HLS_MODE = <?php echo json_encode(HLS_MODE); ?>;
            window.__WC_HLS_FALLBACK_MS = <?php echo (int) HLS_FALLBACK_MS; ?>;</script>
    <?php
    // HLS_MODE=off bo'lsa hls.js umuman kerak emas — 415 KB yuklanmaydi.
    if ($__hlsType === 'hls' && HLS_MODE !== 'off') {
        $__hlsV = (int) (@filemtime(__DIR__ . '/assets/vendor/hls.min.js') ?: 1);
        $__hlsUrl = 'assets/vendor/hls.min.js?v=' . $__hlsV;
        ?>
        <link rel="preload" as="script" fetchpriority="low" href="<?php echo htmlspecialchars($__hlsUrl, ENT_QUOTES); ?>">
        <script>window.__WC_HLS_URL = <?php echo json_encode($__hlsUrl); ?>;</script>
    <?php } ?>
</head>
<body class="ig-shell watch-body">

<?php require __DIR__ . '/includes/nav.php'; ?>

<?php if (!$item): ?>
    <main class="ig-page watch-page">
        <div class="watch-404">
            <h1>😕 Video topilmadi</h1>
            <p>Bu havola noto‘g‘ri yoki kontent o‘chirilgan bo‘lishi mumkin.</p>
            <a class="watch-404-btn" href="index.php"><?php echo ig_svg('home'); ?> Bosh sahifaga</a>
        </div>
    </main>
<?php else: ?>
<main class="ig-page watch-page">

    <?php /* YouTube uslubidagi 2 USTUNLI freymvork (batafsil watch.css):
               CHAP  (~73%) -> video + sarlavha/statistika + IZOHLAR
               O'NG  (~27%) -> QISMLAR (faqat anime/serial) va uning ostida
                               aralash tavsiyalar (sarlavhasiz, lazy load)

             Yon panel HAR DOIM chiziladi. Kino/multfilmda qismlar bloki
             `hidden` bo'ladi va tavsiyalar butun o'ng ustunni egallaydi -
             shuning uchun bo'sh ustun qolmaydi. */ ?>
    <div class="watch-grid">

        <!-- ============================ CHAP USTUN ============================ -->
        <div class="watch-main">

            <!-- Video -->
            <div class="watch-player" id="watchPlayer"
                 style="<?php echo $watchPoster !== '' ? '--wposter:url(&quot;' . esc($watchPoster) . '&quot;)' : ''; ?>"></div>

            <?php /* Pleyer tanlash paneli olib tashlandi: saytda faqat o'z
                     MTProto pleyerimiz ishlaydi. */ ?>

            <!-- Sarlavha + YouTube uslubidagi meta qatori

     YouTube YERLAŞUVI (desktop):
         <h1> Sarlavha
         ┌──────────────────────────────────────────────────────┐
         │ [av] Kanal nomi        ★ 8.0  2024                 │
         │      N ta foydalanuvchi [👍 3,9 ming][👎] [📚] [🔗] [📋] │
         └──────────────────────────────────────────────────────┘
         📅 1,2 ming ko'rildi · 3 kun oldin

     Ya'ni kanal bloki CHAPDA, harakat tugmalari O'NGDA, ko'rish/vaqt
     esa IKKINCHI qatorda (YouTube'dagi kabi). "Obuna" tugmasi yo'q -
     uning o'rnida kino ma'lumoti (reyting + yil). -->
            <div class="watch-head">
                <!-- Kino / anime / multfilm ID si har doim ko'rinib turadi.
                     Qism tanlangan bo'lsa uning ID si ham qo'shiladi. -->
                <div class="watch-id-row" title="Kontent identifikatori">
                    <span class="watch-id-chip">ID&nbsp;<?php echo (int) ($item['id'] ?? 0); ?></span>
                    <?php if (!empty($selected['id'])): ?>
                        <span class="watch-id-chip">Qism&nbsp;ID&nbsp;<?php echo (int) $selected['id']; ?></span>
                    <?php endif; ?>
                </div>
                <h1 class="watch-title" id="watchTitle"></h1>
                <div class="watch-meta">

                    <!-- CHAP: kanal + statistika -->
                    <div class="watch-meta-l">
                        <div class="watch-channel">
                            <span class="watch-channel-av">
                                <?php echo wc_logo_img(SITE_NAME, 'width="40" height="40"'); ?>
                            </span>
                            <span class="watch-channel-tx">
                                <a class="watch-channel-name" href="index.php"><?php
                                    echo htmlspecialchars(SITE_NAME);
                                ?></a>
                                <span class="watch-channel-subs" id="watchSubs"></span>
                            </span>
                        </div>
                    </div>

                    <!-- O'NG: kinomanba ma'lumoti + harakat tugmalari -->
                    <div class="watch-meta-r">
                        <div class="watch-actions" id="watchActions"></div>
                    </div>
                </div>
            </div>

            <!-- Qisqa tavsif -->
            <?php /* YouTube'dagi "ta'rif kartasi": ko'rishlar soni + vaqt (+ reyting/yil),
                     bosilganda kengayadi. Ichki id'lar watch.js (renderHead) uchun. */ ?>
            <div class="watch-desc" id="watchDesc" tabindex="0" role="button" aria-expanded="false">
                <div class="watch-desc-top">
                    <div class="watch-sub" id="watchSub"></div>
                    <div class="watch-badges" id="watchBadges"></div>
                </div>
                <div class="watch-desc-body" id="watchDescBody" hidden></div>
            </div>

            <!-- ============================ IZOHLAR ============================ -->
            <section class="watch-block">
                <h2 class="watch-block-h">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 12a8.4 8.4 0 0 1-11.9 7.6L3.5 20.5l1-4.9A8.4 8.4 0 1 1 20.5 12z"/></svg>
                    <span class="watch-block-t">Izohlar <span id="commentsCount"></span></span>
                    <?php /* YouTube'dagi "Saralash": ro'yxatni yangi / eng yaxshi / eski tartibda ko'rsatadi. */ ?>
                    <span class="watch-sort" id="watchSort">
                        <button type="button" class="watch-sort-btn" id="watchSortBtn" aria-haspopup="true" aria-expanded="false">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h10M4 17h5"/></svg>
                            <span>Saralash</span>
                        </button>
                        <div class="watch-sort-menu" id="watchSortMenu" hidden>
                            <button type="button" class="watch-sort-item on" data-sort="new">Yangilari birinchi</button>
                            <button type="button" class="watch-sort-item" data-sort="top">Eng yaxshilari</button>
                            <button type="button" class="watch-sort-item" data-sort="old">Eskilari birinchi</button>
                        </div>
                    </span>
                </h2>

                <?php /* Bu qatlay `position: relative` - formatlash menyusi
                         (`.tg-fmt`, tg-format.css) shu konteynerga bog'lanadi.
                         reels.php da bu rolni `.reels-comments-box` bajaradi. */ ?>
                <div class="watch-comments-wrap">
                <?php /* YouTube uslubida: yozish maydoni izohlar ro'yxatidan
                         OLDIN turadi, shuning uchun kompyuterda foydalanuvchi
                         izoh yozish uchun ro'yxat oxirigacha scroll qilmaydi. */ ?>
                <div class="watch-compose">
                <span class="watch-cav" id="watchCav" aria-hidden="true"></span>
                <form class="reels-comments-form" id="commentForm" autocomplete="off">
                    <button type="button" class="reels-c-tool tg-fmt-btn" id="cFmtBtn"
                            aria-label="Matn formatlash" aria-expanded="false" title="Matn formatlash">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.2 9.6 6.4a1.5 1.5 0 0 1 2.8 0L18 19.2"/><path d="M6.1 14.4h7.8"/><path d="M20.4 20.4v-5.6h1.5a2.8 2.8 0 0 1 0 5.6z"/></svg>
                    </button>
                    <button type="button" class="reels-c-tool" id="cAttachBtn"
                            aria-label="Stiker, emoji, GIF, rasm va belgilash" aria-expanded="false" title="Stiker, emoji, GIF, rasm">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.6"/><path d="M8.6 14.2c.9 1.2 2.1 1.8 3.4 1.8s2.5-.6 3.4-1.8"/><path d="M9.2 10h.01M14.8 10h.01"/></svg>
                    </button>
                    <textarea class="reels-comments-input" id="commentInput" rows="1"
                              maxlength="1000" placeholder="Izoh yozing…" aria-label="Izoh"></textarea>
                    <a class="reels-c-tool reels-c-tool-tg" id="cOpenTg" href="#" target="_blank" rel="noopener" title="Suhbatni ochish" aria-label="Suhbatni ochish" hidden>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 3 3 10.5l6 2.2L11.2 20 21 3z"/><path d="m9 12.7 12-9.7"/></svg>
                    </a>
                    <button class="reels-comments-send" id="commentSend" type="submit" data-mode="mic"
                            aria-label="Ovozli xabar" title="Ovozli xabar">
                        <span class="tv-send-mic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2.6" width="6" height="11" rx="3"/><path d="M5.6 11.3a6.4 6.4 0 0 0 12.8 0"/><path d="M12 17.8v3.4M8.8 21.2h6.4"/></svg></span>
                        <span class="tv-send-clip" hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.4 11.1 12 19.5a5 5 0 0 1-7.1-7.1l8.4-8.4a3.4 3.4 0 0 1 4.8 4.8l-8.3 8.3a1.8 1.8 0 0 1-2.5-2.5l7.6-7.6"/></svg></span>
                        <span class="tv-send-ico" hidden><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3.5 11.15 19.9 4.3a.55.55 0 0 1 .72.7l-7 15.6a.55.55 0 0 1-1 .05l-2-5.6-5.55-1.95a.55.55 0 0 1-.07-.99z"/></svg></span>
                    </button>
                    <input type="file" id="cPhoto" accept="image/*" hidden>
                </form>
                </div>

                <?php /* Telegram vositalari paneli: stiker / emoji / GIF / rasm /
                         @ belgilash. reels.php bilan BIR XIL tuzilma -
                         tg-comments.js shu id'larni kutadi. */ ?>
                <div class="reels-c-picker" id="cPicker" hidden>
                    <div class="reels-c-picker-tabs" id="cPickerTabs">
                        <!-- Telegram tartibi: Emoji | Stiker | GIF. data-mode o'zgarmaydi,
                             shuning uchun tg-comments.js switchTab() ishlashda davom etadi. -->
                        <button type="button" class="reels-c-picker-tab" data-mode="emoji" title="Emoji">Emoji</button>
                        <button type="button" class="reels-c-picker-tab on" data-mode="sticker" title="Stiker">Stiker</button>
                        <button type="button" class="reels-c-picker-tab" data-mode="gif" title="GIF">GIF</button>
                        <button type="button" class="reels-c-picker-tab" data-mode="photo" title="Rasm">Rasm</button>
                        <button type="button" class="reels-c-picker-tab" data-mode="mention" title="Belgilash">@</button>
                        <button type="button" class="reels-c-picker-x" id="cPickerX" aria-label="Yopish">&times;</button>
                    </div>
                    <div class="reels-c-picker-panel" id="cPickerPanel"></div>
                </div>

                <div class="reels-c-replybar" id="cReplyBar" hidden>
                    <span class="reels-c-replybar-av" id="cReplyAv"></span>
                    <span class="reels-c-replybar-txt" id="cReplyTxt"></span>
                    <button type="button" class="reels-c-replybar-x" id="cReplyCancel" aria-label="Bekor qilish"><?php echo ig_svg('close'); ?></button>
                </div>

                <div class="reels-comments-list watch-comments-list" id="commentsList"></div>

                <?php /* Telefon rejimi: izohlar qisqartirilgan holda faqat
                         boshidagi 2 TA XABAR ko'rinadi (watch.css). Shu
                         tugma (yoki blokning o'zi) ustidan bosilsa - to'liq
                         oyna ochiladi: barcha izohlar + yozish maydoni
                         (watch.js `wc-full`). Kompyuterda yashirin. */ ?>
                <button type="button" class="watch-c-more" id="watchCMore">Barcha izohlarni ko‘rish</button>
                </div>
            </section>

            <!-- Tavsiyalar endi chap ustunda emas - ular O'NG PANELDA
                 (`.watch-side-rec`), YouTube kanal sahifasi kabi. -->
        </div>

        <!-- ============================ O'NG PANEL ============================
             YouTube'dekidek ikki blokli yon panel (~27%):

               1) `#watchSideEpBlock` — QISMLAR kassetasi (anime/serial).
                  `hidden` = faqat kino/multfilmda; shunda panel butunlay
                  tavsiyalarga qoladi. Ro'yxat VERTIKAL skroll qilinadi
                  (`max-height` bilan cheklangan - panel ekrandan oshmasin).
                  Tepasida QISM RAQAMI kiritish maydoni: raqam yozilib
                  Enter bosilsa, shu qism darhol ochiladi (YouTube playlist
                  "jump to episode" odati).

               2) `#watchSideRecBlock` — aralash tavsiyalar (kino + anime +
                  multfilm). SARLAVHASI YO'Q (YouTube'dagi kabi ro'yxat
                  sarlavhasiz) va ICHKI SKROLLI YO'Q: u izohlar bilan birga
                  sahifa bo'ylab pastga ketadi. Pastga tushgan sayin
                  `IntersectionObserver` orqali keyingi sahifa yuklanadi
                  (`api/related.php`) - shuning uchun ro'yxat uzayib boradi.

             Ikkala blok ham `watch.css` da: qismlar vertikal skroll bilan,
             tavsiyalar esa oqimda (o'z ichida aylantirilmaydi). -->
        <aside class="watch-side" id="watchSide">

            <section class="watch-side-block watch-side-eps"
                     id="watchSideEpBlock"<?php echo $hasPlaylist ? '' : ' hidden'; ?>>
                <header class="watch-side-head">
                    <div class="watch-side-title" id="watchSideTitle">Qismlar</div>
                    <div class="watch-side-count" id="watchSideCount"></div>
                    <form class="watch-ep-find" id="watchEpFind" autocomplete="off">
                        <span class="watch-ep-find-ic" aria-hidden="true">🔎</span>
                        <input class="watch-ep-find-in" id="watchEpFindInput" type="text"
                               inputmode="numeric" placeholder="Qism raqami…"
                               aria-label="Qism raqamini yozing va Enter bosing"
                               maxlength="6">
                        <button class="watch-ep-find-go" type="submit" aria-label="Shu qismga o'tish">↵</button>
                    </form>
                </header>
                <div class="watch-side-list" id="watchSideList"></div>
            </section>

            <section class="watch-side-block watch-side-rec" id="watchSideRecBlock">
                <?php /* YouTube chiplari: Hammasi / Yangi / Tomosha qilingan (watch.js filtrlaydi). */ ?>
                <div class="watch-chips" id="watchChips" role="tablist">
                    <button type="button" class="watch-chip-f on" data-f="all" role="tab" aria-selected="true">Hammasi</button>
                    <button type="button" class="watch-chip-f" data-f="new" role="tab" aria-selected="false">Yangi</button>
                    <button type="button" class="watch-chip-f" data-f="seen" role="tab" aria-selected="false">Tomosha qilingan</button>
                </div>
                <div class="watch-side-list" id="watchSideRecList"></div>
                <!-- Lazy load "ruxsat beruvchi": ko'rinishga kirganda
                     `api/related.php` dan keyingi sahifa so'raladi. -->
                <div class="watch-rec-more" id="watchRecMore" hidden>
                    <span class="watch-rec-spin" aria-hidden="true"></span>
                </div>
            </section>

        </aside>
    </div>
</main>
<?php endif; ?>

<!-- ============================ @username tanlash ============================ -->
<div class="reels-modal reels-username-modal" id="usernameModal" hidden>
    <div class="reels-modal-backdrop" data-close-uname></div>
    <div class="reels-uname-box" role="dialog" aria-label="@username">
        <h3 class="reels-uname-title">@username tanlang</h3>
        <p class="reels-uname-desc">Izohlarda boshqalar sizni shu nom bilan ko‘radi va sizni belgilashi mumkin.</p>
        <div class="reels-uname-row">
            <span class="reels-uname-at">@</span>
            <input class="reels-uname-input" id="unameInput" type="text" placeholder="username"
                   maxlength="32" autocapitalize="off" autocomplete="off" spellcheck="false">
        </div>
        <div class="reels-uname-err" id="unameErr" hidden></div>
        <button type="button" class="reels-uname-save" id="unameSave">Saqlash</button>
    </div>
</div>

<div class="reels-toast" id="reelToast" hidden></div>
<?php /* watch.js'ning o'z xabarlari (kutubxona / ulashish / xato) uchun
         alohida toast - `#reelToast` ni tg-comments.js ham ishlatadi.
         `#chatToast` ham olib tashlandi: bu sahifada chat yo'q. */ ?>
<div class="reels-toast" id="watchToast" hidden></div>

<script>
    window.APP = {
        base: <?php echo json_encode($WATCH['base']); ?>,
        mediaflowEnabled: <?php echo $mediaflowEnabled ? 'true' : 'false'; ?>,
        tg: {
            apiId:   <?php echo (int) TG_API_ID; ?>,
            apiHash: <?php echo json_encode((string) TG_API_HASH); ?>
        },
        tgCommentsChat: <?php echo json_encode((string) TG_COMMENTS_CHAT); ?>,
        tgCommentsUrl:  <?php echo json_encode((string) TG_COMMENTS_URL); ?>,
        <?php /* Izohlar reels moduli bilan bir xil ishlaydi, faqat mavzu
                 endpointi boshqa: reels.id emas, episodes.id. */ ?>
        tgCommentsTopicApi: 'api/video-topic.php',
        tgCommentsScope: 'video',
        botUsername: <?php echo json_encode($WATCH['botName']); ?>,
        botUrl: <?php echo json_encode('https://t.me/' . $WATCH['botName']); ?>,
        miniApp: <?php echo json_encode($WATCH['miniApp']); ?>
    };
    window.WATCH = <?php echo json_encode($WATCH, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); ?>;
    // Foydalanuvchi (gram) havolalari tayyor holda HTML bilan keladi —
    // `tg-stream.js` ularni lokal keshga uradi va `api/tg-doc.php` so'rovini
    // umuman qilmaydi. Faqat `source='gram'` yozuvlari (xavfsiz).
    window.__WCDOCMETA = <?php echo json_encode($__inlineDocMeta, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); ?>;
    // Tayyor qisqa preview'lar (agar bor): avval ular o'ynatiladi, keyin
    // asl video. Baytlar yana to'g'ridan-to'g'ri Telegram'dan keladi.
    window.__WCPREVIEW = <?php echo json_encode($__inlinePreview, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); ?>;
    // SQL keshidan olingan umumiy ma'lumotlar + faqat shu sessiyaga tegishli chipta.
    // Brauzer endi qo'shimcha API so'rovi yubormaydi - faqat video oqimi ishlaydi.
    // `?boot=0` — faqat A/B o'lchash uchun: kesh chiqarilmaydi va eski
    // ketma-ketlik (tg-embed / r2-sign / MTProto) ishlayveradi.
    <?php if (!isset($_GET['boot']) || (string) $_GET['boot'] !== '0'): ?>
    window.__WCBOOT = <?php echo json_encode(array_merge(
        is_array($__boot) ? $__boot : [],
        ['sessionDoc' => $__inlineDocMeta]
    ), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); ?>;
    <?php endif; ?>
    <?php /* Server-side MTProto gateway (ixtiyoriy zaxira yo'l). Faqat
             `TG_GATEWAY_ENABLED=1` + `TG_GATEWAY_MODE=primary` bo'lsa
             yoqiladi. O'chiq bo'lsa sahifaga umuman qo'shilmaydi. */ ?>
    <?php if (defined('TG_GATEWAY_ENABLED') && TG_GATEWAY_ENABLED && defined('TG_GATEWAY_MODE') && TG_GATEWAY_MODE === 'primary'): ?>
    window.__WCGW = { enabled: true, mode: 'primary', url: 'api/tg-gateway.php' };
    <?php endif; ?>
</script>
<script src="assets/js/stream-bootstrap.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/stream-bootstrap.js') ?: 1; ?>"></script>
<script src="assets/js/tg-probe.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/tg-probe.js') ?: 1; ?>"></script>
<?php /* Minimal MTProto klient (25 KB) — 5.4 MB GramJS bundle'ini video oqimi
         uchun umuman kerak qilmaydi. `tg-stream.js` dan OLDIN yuklanadi:
         u `window.TgFast` ni ishlatadi va sahifa yuklanayotgan paytda
         Telegram DC'ga ulanishni (TLS handshake) oldindan boshlaydi. */ ?>
<script src="assets/js/tg-mtproto.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/tg-mtproto.js') ?: 1; ?>"></script>
<script src="assets/js/tg-stream.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/tg-stream.js') ?: 1; ?>"></script>
<script>
(function(){
  function send(msg, stack){
    try { fetch('assets/logerr.php', {method:'POST',body:msg+'\n'+(stack||'')}); } catch(e){}
  }
  window.addEventListener('error', function(e){ send('ERROR: ' + (e.message||'') + ' @ ' + (e.filename||'') + ':' + (e.lineno||'') + ':' + (e.colno||''), e.error && e.error.stack); });
  window.addEventListener('unhandledrejection', function(e){ var r=e.reason; send('REJECT: ' + (r && (r.message||r.errorMessage||String(r))), r && r.stack); });
})();
</script>
<script>
    // Telegram quvurini SHU YERDA — qolgan skriptlardan OLDIN — qizdiramiz.
    //
    // Nima uchun aynan bu joy: videoni ochadigan `watch.js` `DOMContentLoaded`
    // ni kutadi, u esa ostidagi 6 ta skript (~210 KB) yuklanib bo'lgachgina
    // yonadi. Quyidagi uch ish esa ularga bog'liq emas va eng og'ir qismi
    // (GramJS bundle 735 KB + Telegram DC'ga ulanish) aynan shu kutish
    // oynasida bemalol ulguradi:
    //
    //   init()   — Service Worker'ni ro'yxatdan o'tkazadi (reload QILMAYDI).
    //   warm()   — SW'ni sahifaga "homiylash" qiladi. Bu muhim: aks holda
    //              birinchi marta video ochilganda `ensureWorker()` sahifani
    //              QAYTA YUKLAYDI (brauzer qoidasi: yangi o'rnatilgan SW o'z
    //              sahifasini keyingi yuklanishdagina boshqaradi).
    //   prefetch() — joriy post metama'lumotini topadi va odatiy tarmoqda
    //                MP4 boshidagi 128 KB ni brauzer RAM'ida qizdiradi.
    //
    // `index.php`, `reels.php` va `chat.php` da bu allaqachon bor edi; videolar
    // alohida `watch.php` sahifasiga ko'chirilgach bu sahifa e'tibordan
    // chiqib qolgan. Uchala chaqiruv ham ichki holatni (`S.reg`,
    // `S.connecting`) bir marta ishlatadi, shuning uchun keyinroq `mount()`
    // ularni takrorlamaydi — tayyor natijani oladi.
    if (!window.APP.mediaflowEnabled && window.TgStream) {
        try { window.TgStream.init(); } catch (e) {}
        if (window.TgStream.warm) { try { window.TgStream.warm(); } catch (e) {} }
        if (window.TgStream.hasSession && window.TgStream.hasSession()) {
            var currentPlayback = (window.WATCH && window.WATCH.playback) || {};
            if (currentPlayback.type === 'telegram' && currentPlayback.channel
                && currentPlayback.post && typeof window.TgStream.prefetch === 'function') {
                // Pleerning BIRINCHI bo'lagi (512 KB = Service Worker'dagi
                // `CHUNK`) oldindan olinadi: klik paytida u disk keshidan
                // 0 ms da keladi. 256 KB yetmasdi — kesh kaliti butun
                // bo'lakni talab qiladi (`doc/0/524288`), yarim bo'lak esa
                // hech qachon "urilmasdi".
                var warmCurrentHead = 512 * 1024;
                try {
                    var netInfo = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
                    if (netInfo && (netInfo.saveData || /(^|-)2g$/.test(String(netInfo.effectiveType || '')))) {
                        warmCurrentHead = 0;
                    }
                } catch (e) { warmCurrentHead = 0; }
                try {
                    window.TgStream.prefetch({
                        channel: currentPlayback.channel,
                        post: currentPlayback.post,
                        metadataOnly: true,
                        warmBytes: warmCurrentHead,
                        // Fayl oxiridagi MP4 indeksini (moov) HOZIR yuklashni
                        // boshlaymiz — player mount bo'lishidan oldin. Brauzer
                        // indeksni so'raganda javob keshdan, bir zumda keladi.
                        warmTail: warmCurrentHead > 0,
                        // Olingan baytlarni Service Worker keshiga (diskka) ham
                        // yozamiz. Cache API sahifa almashganda ham qoladi, shuning
                        // uchun birinchi bo'lak keyingi ochilishda 0 ms da keladi.
                        cacheSeed: warmCurrentHead > 0
                    }).catch(function () {
                        if (!window.TgStream.hasSession()) {
                            location.replace((window.APP && window.APP.base ? window.APP.base : '') + '/1stlogin.php');
                        }
                    });
                } catch (e) {}
            } else {
                // Telegram manbasi bo'lmagan sahifalarda avvalgi sessiya
                // tekshiruvini saqlaymiz.
                try {
                    window.TgStream.verify().catch(function () {
                        if (!window.TgStream.hasSession()) {
                            location.replace((window.APP && window.APP.base ? window.APP.base : '') + '/1stlogin.php');
                        }
                    });
                } catch (e) {}
            }

            // --- JORIY + KEYINGI + OLDINGI qismni oldindan tayyorlash -------------
            //
            // Nima uchun: ketma-ket tomosha qilganda keyingi qism darhol,
            // zaxira sifatida oldingi qism ham tayyor turadi. Butun serialning
            // 120 qismigacha so'ramaymiz; video baytlari bosilmaguncha kelmaydi.
            //
            // Har bir kanal uchun postlar guruhlanadi; bu fon ishi, video
            // baytlarini esa foydalanuvchi qismni tanlagandagina olamiz.
            try {
                var eps = (window.WATCH && window.WATCH.episodes) || [];
                var batch = [];
                var currentId = Number((window.WATCH && window.WATCH.selectedId) || 0);
                var currentIndex = -1;
                for (var bi = 0; bi < eps.length; bi++) {
                    if (Number((eps[bi] || {}).id) === currentId) { currentIndex = bi; break; }
                }
                if (currentIndex < 0 && eps.length) currentIndex = 0;
                // Keyingi qism ustuvor; oldingi qism esa zaxira sifatida.
                var order = [currentIndex, currentIndex + 1, currentIndex - 1];
                for (var oi = 0; oi < order.length; oi++) {
                    var be = eps[order[oi]] || {};
                    if (be.tg_channel && be.tg_post) {
                        batch.push({ channel: be.tg_channel, post: be.tg_post });
                    }
                }
                if (batch.length && typeof window.TgStream.prefetchMany === 'function') {
                    window.TgStream.prefetchMany(batch);
                }
                // Asosiy yo'l: foydalanuvchining O'Z sessiyasi (GramJS).
                // `file_reference` shunda to'g'ri akkauntga tegishli bo'ladi
                // (serverdagi bot havola boshqa akkauntda ishlamaydi).
                if (batch.length && typeof window.TgStream.prefetchManyGram === 'function') {
                    window.TgStream.prefetchManyGram(batch);
                }
            } catch (e) {}
        }
    }
</script>
<?php /* OLIB TASHLANGAN: tv-mode.js va notifications.js (defer)

   Ikkalasi allaqachon `includes/nav.php` da yuklanadi (bu sahifa uni
   208-qatorda majburiy `require` qiladi). Ikki marta yuklash faqat ~30 KB
   va parse vaqtini yo'qotish emas edi — ikkala modul ham himoyasiz IIFE,
   ya'ni `boot()` / `init()` IKKI MARTA ishlar va D-Pad tugmalari ikki
   marta ulanib, bitta bosishda fokus ikki qadam surilardi.

   Yo'qotish yo'q: ikkala modul ham `document.readyState === 'loading'`
   bo'lsa `DOMContentLoaded` ni kutadi, shuning uchun nav.php nusxasi ham
   aynan shu vaqtda ishga tushadi — faqat yuklab olish va parse biroz
   oldinroq sodir bo'ladi. */ ?>
<script src="assets/js/tg-voice.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/tg-voice.js') ?: 1; ?>"></script>
<script src="assets/js/tg-format.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/tg-format.js') ?: 1; ?>"></script>
<script src="assets/js/tg-emoji.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/tg-emoji.js') ?: 1; ?>"></script>
<script src="assets/js/tg-comments.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/tg-comments.js') ?: 1; ?>"></script>
<?php /* `tg-chat.js` bu sahifada KERAK EMAS - chat bloki olib tashlandi
         (chat alohida `chat.php` sahifasida). Skriptni yuklamaslik tezlik
         uchun ham foyda: yana bir katta fayl (telegram ulanishlari yo'q). */ ?>
<script src="assets/player/player.js?v=<?php echo @filemtime(__DIR__ . '/assets/player/player.js') ?: 1; ?>"></script>
<script src="assets/js/wc-lib.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/wc-lib.js') ?: 1; ?>"></script>
<?php /* Ixtiyoriy server gateway mijozi — faqat `TG_GATEWAY_MODE=primary`. */ ?>
<?php if (defined('TG_GATEWAY_ENABLED') && TG_GATEWAY_ENABLED && defined('TG_GATEWAY_MODE') && TG_GATEWAY_MODE === 'primary'): ?>
<script src="assets/js/tg-gateway.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/tg-gateway.js') ?: 1; ?>"></script>
<?php endif; ?>
<script src="assets/js/watch.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/watch.js') ?: 1; ?>"></script>
<script src="assets/js/tv-watch.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/tv-watch.js') ?: 1; ?>"></script>
<?php /* Ambient light (YouTube kengaytmasi kabi). Standart holati o'chiq. */ ?>
<script src="assets/js/watch-ambient.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/watch-ambient.js') ?: 1; ?>"></script>
