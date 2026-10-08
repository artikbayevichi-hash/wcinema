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
// (`reels.id`), shu sahifa uchun `api/video-topic.php` (`episodes.id`).
// ============================================================================
require_once __DIR__ . '/includes/bootstrap.php';

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
    // (`number`, `has_video`, ...). Sababi: `watch.js` dagi qism almashtirish
    // shu endpoint javobini oladi va `S.episodes` ni to'liq almashtiradi.
    // Nomlar farq qilsa, birinchi ochilishda raqamlar chiqib, keyin
    // barcha qismlar "undefined" bo'lib ko'rinardi.
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
    'progress'  => $progress,
    'hasPlaylist' => $hasPlaylist,
    'related'   => $related,
    // Lazy load uchun holat: nechta yuklandi, yana bormi.
    'relatedOffset'   => count($related),
    'relatedHasMore'  => $relatedHasMore,
    'relatedPageSize' => RELATED_PAGE_SIZE,
];

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
    <link rel="stylesheet" href="assets/css/watch.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/watch.css') ?: 1; ?>">
    <?php /* GramJS bundle'ni OLDINDAN yuklash (735 KB siqilgan).

        Bu sahifadagi eng katta va eng sekin kutiladigan manba. Odatda u
        `tg-stream.js` dan KEYIN, `<body>` oxiridagi inline qizdirish bloki
        ishga tushgandagina so'raladi — ya'ni 8 ta CSS, 45 KB HTML va
        `tg-probe.js` (29 KB) parser'dan o'tguncha kutadi.

        Preload shu kutishni yo'q qiladi: yuklab olish HTML bilan PARALLEL
        boshlanadi. Manzil `tg-stream.js` dagi `bundleGz()` hosil qiladigan
        manzil bilan AYNAN bir xil bo'lishi shart (`window.APP.base` +
        `/assets/js/tg-client.bundle.js.gz`), aks holda brauzer keshdan
        topa olmaydi va fayl IKKI MARTA yuklanadi — shuning uchun bu yerdagi
        `base` ham `$WATCH['base']` dan olinadi, qo'lda yozilmaydi.

        `crossorigin="anonymous"` shart, chunki `loadBundle()` faylni
        `fetch(url, { credentials: 'same-origin' })` bilan oladi. Preload
        rejimi shunga mos kelmasa brauzer keshni ishlatmaydi.

        CSS'lardan KEYIN qo'yilgan: uslublar render'ni bloklagani uchun
        ular birinchi bo'lib o'tishi kerak, aks holda sahifa ko'rinishi
        kechikadi. Bu sahifaga kirish uchun MTProto kaliti shart
        (`includes/nav.php` dagi guard), ya'ni bundle BEKOR yuklanmaydi. */ ?>
    <link rel="preload" as="fetch" crossorigin="anonymous"
          href="<?php echo htmlspecialchars($WATCH['base'], ENT_QUOTES); ?>/assets/js/tg-client.bundle.js.gz">
</head>
<body class="ig-shell watch-body">

<?php require __DIR__ . '/includes/nav.php'; ?>

<?php if (!$item): ?>
    <main class="ig-page watch-page">
        <div class="watch-404">
            <h1>😕 Video topilmadi</h1>
            <p>Bu havola noto‘g‘ri yoki kontent o‘chirilgan bo‘lishi mumkin.</p>
            <a class="watch-404-btn" href="index.php">🏠 Bosh sahifaga</a>
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
            <div class="watch-player" id="watchPlayer"></div>

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
                        <div class="watch-sub" id="watchSub"></div>
                    </div>

                    <!-- O'NG: kinomanba ma'lumoti + harakat tugmalari -->
                    <div class="watch-meta-r">
                        <div class="watch-badges" id="watchBadges"></div>
                        <div class="watch-actions" id="watchActions"></div>
                    </div>
                </div>
            </div>

            <!-- Qisqa tavsif -->
            <div class="watch-desc" id="watchDesc" hidden></div>

            <!-- ============================ IZOHLAR ============================ -->
            <section class="watch-block">
                <h2 class="watch-block-h">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 12a8.4 8.4 0 0 1-11.9 7.6L3.5 20.5l1-4.9A8.4 8.4 0 1 1 20.5 12z"/></svg>
                    Izohlar <span id="commentsCount"></span>
                </h2>

                <?php /* Bu qatlay `position: relative` - formatlash menyusi
                         (`.tg-fmt`, tg-format.css) shu konteynerga bog'lanadi.
                         reels.php da bu rolni `.reels-comments-box` bajaradi. */ ?>
                <div class="watch-comments-wrap">
                <div class="reels-comments-list watch-comments-list" id="commentsList"></div>

                <?php /* Telegram vositalari paneli: stiker / emoji / GIF / rasm /
                         @ belgilash. reels.php bilan BIR XIL tuzilma -
                         tg-comments.js shu id'larni kutadi. */ ?>
                <div class="reels-c-picker" id="cPicker" hidden>
                    <div class="reels-c-picker-tabs" id="cPickerTabs">
                        <button type="button" class="reels-c-picker-tab on" data-mode="sticker" title="Stiker">Stiker</button>
                        <button type="button" class="reels-c-picker-tab" data-mode="emoji" title="Emoji">😀</button>
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
                    <button type="button" class="reels-c-replybar-x" id="cReplyCancel" aria-label="Bekor qilish">✕</button>
                </div>

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
</script>
<script src="assets/js/tg-probe.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/tg-probe.js') ?: 1; ?>"></script>
<script src="assets/js/tg-stream.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/tg-stream.js') ?: 1; ?>"></script>
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
    //   verify() — GramJS'ni yuklab, saqlangan kalit bilan Telegram'ga jim
    //              ulanadi (`getMe`). Login oqimini BOSHLAMAYDI: kalit yo'q
    //              yoki yaroqsiz bo'lsa shunchaki reject qiladi va uni
    //              pastda ushlaymiz — haqiqiy kirishni `mount()` o'zi haladi.
    //
    // `index.php`, `reels.php` va `chat.php` da bu allaqachon bor edi; videolar
    // alohida `watch.php` sahifasiga ko'chirilgach bu sahifa e'tibordan
    // chiqib qolgan. Uchala chaqiruv ham ichki holatni (`S.reg`,
    // `S.connecting`) bir marta ishlatadi, shuning uchun keyinroq `mount()`
    // ularni takrorlamaydi — tayyor natijani oladi.
    if (window.TgStream) {
        try { window.TgStream.init(); } catch (e) {}
        if (window.TgStream.warm) { try { window.TgStream.warm(); } catch (e) {} }
        if (window.TgStream.hasSession && window.TgStream.hasSession()) {
            // Kalit bekor qilingan bo'lsa — tizimdan chiqilganda avtomatik
            // kirish sahifasiga qaytamiz (index.php bilan bir xil mantiq).
            try {
                window.TgStream.verify().catch(function () {
                    if (!window.TgStream.hasSession()) {
                        location.replace((window.APP && window.APP.base ? window.APP.base : '') + '/tg-login.php');
                    }
                });
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
<script src="assets/js/player.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/player.js') ?: 1; ?>"></script>
<script src="assets/js/wc-lib.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/wc-lib.js') ?: 1; ?>"></script>
<script src="assets/js/watch.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/watch.js') ?: 1; ?>"></script>
