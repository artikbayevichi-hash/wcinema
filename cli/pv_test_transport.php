<?php
// Vaqtinchalik test: turli MTProto transport bilan video boshini yuklash.
if (PHP_SAPI !== 'cli') exit('CLI only');
require dirname(__DIR__) . '/includes/bootstrap.php';

if (!class_exists(\danog\MadelineProto\API::class)) {
    require dirname(__DIR__) . '/vendor/autoload.php';
}

$transport = $argv[1] ?? 'intermediate';
$post = (int) ($argv[2] ?? 12);
$classes = [
    'abridged'    => \danog\MadelineProto\Stream\MTProtoTransport\AbridgedStream::class,
    'intermediate'=> \danog\MadelineProto\Stream\MTProtoTransport\IntermediateStream::class,
    'full'        => \danog\MadelineProto\Stream\MTProtoTransport\FullStream::class,
    'obfuscated'  => \danog\MadelineProto\Stream\MTProtoTransport\ObfuscatedStream::class,
    'http'        => \danog\MadelineProto\Stream\MTProtoTransport\HttpStream::class,
    'https'       => \danog\MadelineProto\Stream\MTProtoTransport\HttpsStream::class,
];
if (!isset($classes[$transport])) { echo "Noto'g'ri transport: {$transport}\n"; exit(1); }

$dir = dirname(__DIR__) . '/storage/mtproto/t_' . preg_replace('/[^a-z0-9]/', '', $transport);
if (!is_dir($dir)) @mkdir($dir, 0777, true);
$settings = new \danog\MadelineProto\Settings;
$settings->getAppInfo()->setApiId(TG_API_ID)->setApiHash(TG_API_HASH);
$settings->getPeer()->setFullFetch(false)->setCacheAllPeersOnStartup(false);
$settings->getConnection()->setTimeout(60)->setProtocol($classes[$transport]);
$settings->getFiles()->setDownloadParallelChunks(1);

echo "=== transport={$transport} post={$post} ===\n";
$t0 = microtime(true);
try {
    $api = new \danog\MadelineProto\API($dir . '/bot_pull', $settings);
    if ($api->getAuthorization() === 0) $api->botLogin(TELEGRAM_BOT_TOKEN);
    else $api->start();
    echo "session: " . round(microtime(true)-$t0, 1) . "s\n";

    $info = TgPull::fetchDocInfo($api, 'https://t.me/wcinemauz/' . $post);
    $doc = $info['doc'];
    echo "doc dc=" . ($doc['dc_id'] ?? '?') . " size=" . $doc['size'] . "\n";

    $dest = dirname(__DIR__) . '/storage/cache/preview/test_' . $transport . '_' . $post . '.bin';
    $fp = fopen($dest, 'wb');
    $written = 0;
    $want = min((int)$doc['size'], 4 * 1024 * 1024);
    $tries = 0;
    while ($written < $want && $tries < 5) {
        $tries++;
        $base = $written;
        try {
            $api->downloadToCallable($doc,
                function ($payload, $off) use ($fp, $base, $want, &$written) {
                    $payload = (string)$payload;
                    $off = (int)$off;
                    if ($off < $base) {
                        $skip = $base - $off;
                        if ($skip >= strlen($payload)) return;
                        $payload = substr($payload, $skip);
                        $off = $base;
                    }
                    if ($off >= $want) return;
                    if ($off + strlen($payload) > $want) $payload = substr($payload, 0, $want - $off);
                    fseek($fp, $off);
                    fwrite($fp, $payload);
                    $written = max($written, $off + strlen($payload));
                },
                null, false, $base, $want, 256 * 1024
            );
        } catch (\Throwable $e) {
            echo "  urinish {$tries} xato: " . mb_substr($e->getMessage(), 0, 100) . "\n";
            sleep(2);
        }
    }
    fclose($fp);
    echo "NATIJA {$transport}: written={$written}/{$want} time=" . round(microtime(true)-$t0, 1) . "s\n";
    @unlink($dest);
} catch (\Throwable $e) {
    echo "FATAL: " . get_class($e) . ': ' . mb_substr($e->getMessage(), 0, 300) . "\n";
}
