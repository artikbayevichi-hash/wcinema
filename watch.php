<?php
// ============================================================================
// watch.php - YouTube uslubidagi ko'rish sahifasi
// ============================================================================
// Video chapda, yon panelda qismlar (yoki tavsiyalar), tagida izohlar va
// chat, eng pastida aralash tavsiyalar qatori.
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
// ---------------------------------------------------------------------------
$cId = (int) ($_GET['c'] ?? 0);
$eId = (int) ($_GET['e'] ?? 0);

if ($cId <= 0 && $eId > 0) {
    $ep = $catalog->getEpisode($eId);
    if ($ep) {
        $cId = (int) $ep['content_id'];
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
$progress = null;
$hasPlaylist = false;

if ($item) {
    // DIQQAT: maydon nomlari `api/content.php` bilan BIR XIL bo'lishi shart
    // (`number`, `has_video`, ...). Sababi: `watch.js` dagi qism almashtirish
    // shu endpoint javobini oladi va `S.episodes` ni to'liq almashtiradi.
    // Nomlar farq qilsa, birinchi ochilishda raqamlar chiqib, keyin
    // barcha qismlar "undefined" bo'lib ko'rinardi.
    $episodes = array_map(static fn($e) => [
        'id'         => (int) $e['id'],
        'season'     => (int) $e['season'],
        'number'     => (int) $e['episode_number'],
        'title'      => $e['title'],
        'thumbnail'  => $e['thumbnail'],
        'duration'   => $e['duration'],
        'is_premium' => (int) $e['is_premium'] === 1,
        'has_video'  => !empty($e['video_url']),
    ], $catalog->getEpisodes($item['id']));

    $genres   = $catalog->getContentGenres($item['id']);

    // Tanlangan qism: ?e=..., yoki birinchi mavjud qism, yoki butun film
    // (kontentning o'zida video_url bo'lishi mumkin).
    foreach ($episodes as $e) {
        if ((int) $e['id'] === $eId) {
            $selected = $e;
            break;
        }
    }
    if (!$selected) {
        $eId      = 0;
        $selected = $episodes[0] ?? null;
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

    // "Boshqa kinolar, animelar va multfilmlar" - pastki qator va (qismlar
    // bo'lmasa) yon panel uchun bir xil ro'yxat.
    foreach ($catalog->getRelated($item, 14) as $r) {
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
$roomHint = 'general';
if ($item && !empty($item['category_slug'])) {
    // `tg-chat.js` xonalari aynan shu kalitlar bilan nomlangan.
    $sl = (string) $item['category_slug'];
    if (in_array($sl, ['general', 'kino', 'anime', 'multfilm'], true)) {
        $roomHint = $sl;
    }
}

$WATCH = [
    'base'      => rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/\\'),
    'botName'   => TELEGRAM_BOT_USERNAME,
    'miniApp'   => MINI_APP_URL,
    'loggedIn'  => (bool) $user,
    'content'   => $item ? $catalog->toPublicArray($item, $userId) : null,
    'genres'    => $genres,
    'episodes'  => $episodes,
    'selectedId' => $selected ? (int) $selected['id'] : 0,
    'playback'  => $playback,
    'progress'  => $progress,
    'hasPlaylist' => $hasPlaylist,
    'related'   => $related,
    'roomHint'  => $roomHint,
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
    <link rel="stylesheet" href="assets/css/chat.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/chat.css') ?: 1; ?>">
    <link rel="stylesheet" href="assets/css/player.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/player.css') ?: 1; ?>">
    <?php /* tg-stream.css - Telegram CDN playeri uchun; tg-format.css - matn
             formatlash (bold/italic/kod/havola/...) va formatlash menyusi;
             voice.css - mikrofon zanjiri (tez bosish / skripka / uzoq ushlanish). */ ?>
    <link rel="stylesheet" href="assets/css/tg-stream.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/tg-stream.css') ?: 1; ?>">
    <link rel="stylesheet" href="assets/css/tg-format.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/tg-format.css') ?: 1; ?>">
    <link rel="stylesheet" href="assets/css/voice.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/voice.css') ?: 1; ?>">
    <link rel="stylesheet" href="assets/css/watch.css?v=<?php echo @filemtime(__DIR__ . '/assets/css/watch.css') ?: 1; ?>">
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

    <div class="watch-grid">

        <!-- ============================ CHAP USTUN ============================ -->
        <div class="watch-main">

            <!-- Video -->
            <div class="watch-player" id="watchPlayer"></div>

            <!-- Sarlavha + harakatlar -->
            <div class="watch-head">
                <h1 class="watch-title" id="watchTitle"></h1>
                <div class="watch-sub" id="watchSub"></div>
                <div class="watch-actions" id="watchActions"></div>
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
                </div>
            </section>

            <!-- ============================== CHAT ============================== -->
            <section class="watch-block">
                <h2 class="watch-block-h">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 12a8.4 8.4 0 0 1-11.9 7.6L3.5 20.5l1-4.9A8.4 8.4 0 1 1 20.5 12z"/></svg>
                    Chat
                </h2>

                <?php /* Xonalar (💬 Kino ✨ Anime 🧸 Multfilm) bitta qatorda.
                         chat.php dagi `.chat-rooms`; pastdagi `.chat-thread`
                         OLDINDAN ko'rinadi (watch.js xonani avtomatik ochadi),
                         shuning uchun "orqaga" tugmasi kerak emas. */ ?>
                <div class="chat-rooms watch-chat-rooms" id="chatRooms">
                    <div class="chat-room-skel"></div>
                    <div class="chat-room-skel"></div>
                    <div class="chat-room-skel"></div>
                    <div class="chat-room-skel"></div>
                </div>

                <section class="chat-thread watch-chat-thread" id="chatThread">
                    <header class="chat-thead">
                        <div class="chat-ttl" id="chatTitle">Chat</div>
                        <a class="chat-tg" id="chatOpenTg" href="#" target="_blank" rel="noopener" hidden aria-label="Telegram'da ochish">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 5h5v5"/><path d="M19 5l-8 8"/><path d="M19 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4"/></svg>
                        </a>
                    </header>

                    <div class="chat-feed" id="chatFeed"></div>

                    <div class="chat-picker" id="chatPicker" hidden></div>

                    <form class="chat-composer" id="chatComposer" autocomplete="off">
                        <button type="button" class="chat-tool tg-fmt-btn" id="chatFmtBtn"
                                aria-label="Matn formatlash" aria-expanded="false" title="Matn formatlash">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.2 9.6 6.4a1.5 1.5 0 0 1 2.8 0L18 19.2"/><path d="M6.1 14.4h7.8"/><path d="M20.4 20.4v-5.6h1.5a2.8 2.8 0 0 1 0 5.6z"/></svg>
                        </button>
                        <button type="button" class="chat-tool" id="chatAttachBtn"
                                aria-label="Emoji, stiker, GIF va rasm" aria-expanded="false">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.6"/><path d="M8.6 14.2c.9 1.2 2.1 1.8 3.4 1.8s2.5-.6 3.4-1.8"/><path d="M9.2 10h.01M14.8 10h.01"/></svg>
                        </button>
                        <textarea id="chatInput" rows="1" placeholder="Xabar yozing…" maxlength="4000"></textarea>
                        <button type="submit" class="chat-send" id="chatSend" data-mode="mic"
                                aria-label="Ovozli xabar" title="Ovozli xabar">
                            <span class="tv-send-mic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2.6" width="6" height="11" rx="3"/><path d="M5.6 11.3a6.4 6.4 0 0 0 12.8 0"/><path d="M12 17.8v3.4M8.8 21.2h6.4"/></svg></span>
                            <span class="tv-send-clip" hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.4 11.1 12 19.5a5 5 0 0 1-7.1-7.1l8.4-8.4a3.4 3.4 0 0 1 4.8 4.8l-8.3 8.3a1.8 1.8 0 0 1-2.5-2.5l7.6-7.6"/></svg></span>
                            <span class="tv-send-ico" hidden><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3.5 11.15 19.9 4.3a.55.55 0 0 1 .72.7l-7 15.6a.55.55 0 0 1-1 .05l-2-5.6-5.55-1.95a.55.55 0 0 1-.07-.99z"/></svg></span>
                        </button>
                        <input type="file" id="chatPhoto" accept="image/*" hidden>
                    </form>
                </section>
            </section>
        </div>

        <!-- ============================ O'NG PANEL ============================ -->
        <aside class="watch-side" id="watchSide">
            <header class="watch-side-head">
                <div class="watch-side-title" id="watchSideTitle">Qismlar</div>
                <div class="watch-side-count" id="watchSideCount"></div>
            </header>
            <div class="watch-side-list" id="watchSideList"></div>
        </aside>
    </div>

    <!-- ============ Boshqa kinolar, animelar va multfilmlar ============ -->
    <section class="watch-related" id="watchRelated" hidden>
        <h2 class="watch-related-h">Boshqa kinolar, animelar va multfilmlar</h2>
        <div class="watch-related-row" id="watchRelatedRow"></div>
    </section>
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
<div class="chat-toast" id="chatToast" hidden></div>
<?php /* watch.js'ning o'z xabarlari (kutubxona / ulashish / xato) uchun
         alohida toast - `#reelToast` ni tg-comments.js ham ishlatadi. */ ?>
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
<script src="assets/js/tv-mode.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/tv-mode.js') ?: 1; ?>" defer></script>
<script src="assets/js/notifications.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/notifications.js') ?: 1; ?>" defer></script>
<script src="assets/js/tg-voice.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/tg-voice.js') ?: 1; ?>"></script>
<script src="assets/js/tg-format.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/tg-format.js') ?: 1; ?>"></script>
<script src="assets/js/tg-emoji.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/tg-emoji.js') ?: 1; ?>"></script>
<script src="assets/js/tg-comments.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/tg-comments.js') ?: 1; ?>"></script>
<script src="assets/js/tg-chat.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/tg-chat.js') ?: 1; ?>"></script>
<script src="assets/js/player.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/player.js') ?: 1; ?>"></script>
<script src="assets/js/watch.js?v=<?php echo @filemtime(__DIR__ . '/assets/js/watch.js') ?: 1; ?>"></script>
