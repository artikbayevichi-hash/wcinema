<?php
// Vaqtinchalik test: upload.getFile ni to'g'ridan-to'g'ri chaqirish.
if (PHP_SAPI !== 'cli') exit('CLI only');
require dirname(__DIR__) . '/includes/bootstrap.php';
require dirname(__DIR__) . '/vendor/autoload.php';

$post = (int) ($argv[1] ?? 12);
$dir = dirname(__DIR__) . '/storage/mtproto/getfile';
if (!is_dir($dir)) @mkdir($dir, 0777, true);

$settings = new \danog\MadelineProto\Settings;
$settings->getAppInfo()->setApiId(TG_API_ID)->setApiHash(TG_API_HASH);
$settings->getPeer()->setFullFetch(false)->setCacheAllPeersOnStartup(false);
$settings->getConnection()->setTimeout(60);
$settings->getFiles()->setDownloadParallelChunks(1);

$t0 = microtime(true);
try {
    $api = new \danog\MadelineProto\API($dir . '/bot_pull', $settings);
    if ($api->getAuthorization() === 0) $api->botLogin(TELEGRAM_BOT_TOKEN);
    else $api->start();
    echo "session: " . round(microtime(true)-$t0, 1) . "s\n";

    $info = TgPull::fetchDocInfo($api, 'https://t.me/wcinemauz/' . $post);
    $doc = $info['doc'];
    $dl = $api->getDownloadInfo($doc);
    $loc = $dl['InputFileLocation'];
    echo "doc dc=" . ($doc['dc_id'] ?? '?') . " loc=" . json_encode($loc) . "\n";

    foreach ([0, 65536, 524288] as $off) {
        foreach ([65536, 262144] as $limit) {
            $t1 = microtime(true);
            try {
                $res = $api->upload->getFile([
                    'location' => $loc,
                    'offset' => $off,
                    'limit' => $limit,
                    'cdn_supported' => false,
                ]);
                $bytes = isset($res['bytes']) ? strlen($res['bytes']) : -1;
                echo "off={$off} lim={$limit}: OK bytes={$bytes} " . round(microtime(true)-$t1, 2) . "s type=" . ($res['type']['_'] ?? '?') . "\n";
            } catch (\Throwable $e) {
                echo "off={$off} lim={$limit}: XATO " . get_class($e) . ': ' . mb_substr($e->getMessage(), 0, 120) . " " . round(microtime(true)-$t1, 2) . "s\n";
            }
        }
    }
} catch (\Throwable $e) {
    echo "FATAL: " . get_class($e) . ': ' . mb_substr($e->getMessage(), 0, 300) . "\n";
}
