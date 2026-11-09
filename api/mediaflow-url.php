<?php
// Create a short-lived MediaFlow URL for a published Telegram video.
require_once __DIR__ . '/../includes/bootstrap.php';
require_once __DIR__ . '/../includes/MediaFlow.php';

header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('Referrer-Policy: no-referrer');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    fail('POST so‘rovi kerak', 405);
}

$origin = trim((string) ($_SERVER['HTTP_ORIGIN'] ?? ''));
if ($origin === '') {
    fail('Origin sarlavhasi talab qilinadi', 403);
}
if ($origin !== '') {
    $originParts = parse_url($origin);
    $siteParts = parse_url((string) SITE_URL);
    $originHost = is_array($originParts) ? strtolower((string) ($originParts['host'] ?? '')) : '';
    $siteHost = is_array($siteParts) ? strtolower((string) ($siteParts['host'] ?? '')) : '';
    $originScheme = is_array($originParts) ? strtolower((string) ($originParts['scheme'] ?? '')) : '';
    $siteScheme = is_array($siteParts) ? strtolower((string) ($siteParts['scheme'] ?? '')) : '';
    $originPort = is_array($originParts) ? (int) ($originParts['port'] ?? ($originScheme === 'https' ? 443 : 80)) : 0;
    $sitePort = is_array($siteParts) ? (int) ($siteParts['port'] ?? ($siteScheme === 'https' ? 443 : 80)) : 0;
    if ($originHost === '' || $originHost !== $siteHost
        || $originScheme !== $siteScheme || $originPort !== $sitePort) {
        fail('Manba domeni mos emas', 403);
    }
}

if (!MediaFlow::isEnabled()) {
    fail('MediaFlow oqimi hozircha yoqilmagan', 503);
}

$body = json_decode((string) file_get_contents('php://input'), true);
if (!is_array($body)) {
    fail('So‘rov ma’lumoti noto‘g‘ri', 400);
}
$contentId = (int) ($body['content_id'] ?? 0);
$episodeId = (int) ($body['episode_id'] ?? 0);
if ($contentId <= 0 || $episodeId < 0) {
    fail('Kontent identifikatori noto‘g‘ri', 400);
}

$item = $catalog->getContent($contentId);
if (!$item) {
    fail('Kontent topilmadi', 404);
}
if (($item['status'] ?? 'published') !== 'published' && !$auth->isAdmin()) {
    fail('Kontent topilmadi', 404);
}

$source = $item;
if ($episodeId > 0) {
    $episode = $catalog->getEpisode($episodeId);
    if (!$episode || (int) ($episode['content_id'] ?? 0) !== $contentId) {
        fail('Qism topilmadi', 404);
    }
    $source = $episode;
}

if ((!empty($item['is_premium']) || !empty($source['is_premium']))
    && empty($user['is_premium'])) {
    fail('Bu kontent premium hisoblanadi', 403);
}

$telegramUrl = trim((string) ($source['video_url'] ?? ''));
$parts = parse_url($telegramUrl);
$host = is_array($parts) ? strtolower((string) ($parts['host'] ?? '')) : '';
$path = is_array($parts) ? (string) ($parts['path'] ?? '') : '';
if (!is_array($parts)
    || strtolower((string) ($parts['scheme'] ?? '')) !== 'https'
    || !in_array($host, ['t.me', 'www.t.me', 'telegram.me', 'www.telegram.me'], true)
    || !preg_match('#^/(?:c/\d+|[A-Za-z0-9_]+)/\d+/?$#', $path)) {
    fail('Bu kontentda qo‘llab-quvvatlanadigan Telegram posti yo‘q', 422);
}

if (session_status() === PHP_SESSION_ACTIVE) {
    $now = time();
    $recent = $_SESSION['mediaflow_url_issues'] ?? [];
    if (!is_array($recent)) {
        $recent = [];
    }
    $recent = array_values(array_filter($recent, static function ($issuedAt) use ($now) {
        return is_numeric($issuedAt) && (int) $issuedAt > $now - 60;
    }));
    if (count($recent) >= 24) {
        fail('Juda ko‘p oqim so‘rovi yuborildi', 429);
    }
    $recent[] = $now;
    $_SESSION['mediaflow_url_issues'] = $recent;
}

// Session lockni tashqi proxy so‘rovidan oldin bo‘shatamiz.
if (session_status() === PHP_SESSION_ACTIVE) {
    session_write_close();
}

try {
    $url = MediaFlow::createSignedTelegramUrl($telegramUrl);
    ok([
        'url' => $url,
        'expires_in' => MediaFlow::urlTtl(),
    ]);
} catch (Throwable $e) {
    error_log('[MediaFlow] Signed URL unavailable: ' . get_class($e));
    fail('MediaFlow vaqtincha javob bermadi', 502);
}
