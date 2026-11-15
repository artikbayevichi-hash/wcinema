<?php
// ============================================================================
// RateLimit — IP bo'yicha so'rovlar cheklovi (fayl + flock)
// ============================================================================
// Nima uchun kerak: ochiq API'larni bot/abuse oqimidan himoya qilish. Kesh
// tufayli oddiy tashrif deyarli hech narsa qilmaydi, lekin cheklovsiz
// endpoint'ni kimdir sekundiga yuzlab marta chaqirsa PHP/MySQL baribir
// yuklanadi.
//
// Model: qat'iy oyna (fixed window). Har (bucket, IP, oyna) uchun alohida
// kichik JSON fayl. Har so'rovda faqat O'SHA fayl ochiladi — MySQL'ga
// murojaat yo'q.
//
// Ishlatish:
//   RateLimit::enforce('read', 240);       // 240 so'rov / 60 s
//   RateLimit::enforce('views', 60, 60);
//
// .env:
//   RL_ENABLED=1
//   RL_READ_PER_MIN=240
//   RL_WRITE_PER_MIN=60
//
// DIQQAT: IP `REMOTE_ADDR` dan olinadi, `CF-Connecting-IP` dan EMAS — uni
// so'rovchi o'zi yozishi mumkin. Cloudflare ortida turgan bo'lsangiz,
// haqiqiy cheklovni Cloudflare WAF qoidasi bilan ham qo'ying
// (docs/production-deploy.md).
// ============================================================================

class RateLimit
{
    private const PRUNE_EVERY = 100;

    public static function enabled(): bool
    {
        $v = strtolower(trim((string) env_value('RL_ENABLED', '1')));
        return in_array($v, ['1', 'true', 'yes', 'on'], true);
    }

    /** Tur bo'yicha standart limit (bir daqiqada). */
    public static function defaultLimit(string $type): int
    {
        if ($type === 'write') {
            return max(1, (int) env_value('RL_WRITE_PER_MIN', '60'));
        }
        return max(1, (int) env_value('RL_READ_PER_MIN', '240'));
    }

    public static function clientIp(): string
    {
        $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
        // IPv6 prefiksini guruhlaymiz (bir /64 = bitta mijoz).
        if (strpos($ip, ':') !== false) {
            $parts = explode(':', $ip);
            $ip = implode(':', array_slice($parts, 0, 4));
        }
        return $ip !== '' ? $ip : '0.0.0.0';
    }

    /**
     * @return array{ok:bool,limit:int,left:int,retry:int}
     */
    public static function check(string $bucket, ?int $limit = null, int $window = 60): array
    {
        $limit  = $limit === null ? self::defaultLimit($bucket) : max(1, $limit);
        $window = max(1, $window);
        $now    = time();
        $start  = $now - ($now % $window);
        $ipHash = substr(sha1(self::clientIp()), 0, 20);
        $bucket = preg_replace('/[^A-Za-z0-9_-]/', '', $bucket);
        $dir    = dirname(__DIR__) . '/storage/cache/rl';
        if (!is_dir($dir)) {
            @mkdir($dir, 0777, true);
        }
        $path = $dir . '/' . $bucket . '-' . $ipHash . '-' . $start . '.json';

        $fp = @fopen($path, 'c+');
        if (!$fp) {
            return ['ok' => true, 'limit' => $limit, 'left' => $limit, 'retry' => 0];
        }
        $ok    = true;
        $count = 0;
        if (@flock($fp, LOCK_EX)) {
            $raw = stream_get_contents($fp);
            $st  = json_decode((string) $raw, true);
            $count = is_array($st) ? (int) ($st['n'] ?? 0) : 0;
            if ($count >= $limit) {
                $ok = false;
            } else {
                $count++;
                ftruncate($fp, 0);
                rewind($fp);
                fwrite($fp, json_encode(['n' => $count, 't' => $now]));
                fflush($fp);
            }
            @flock($fp, LOCK_UN);
        }
        fclose($fp);

        if (random_int(1, self::PRUNE_EVERY) === 1) {
            self::prune($dir, $window);
        }

        return [
            'ok'    => $ok,
            'limit' => $limit,
            'left'  => max(0, $limit - $count),
            'retry' => $ok ? 0 : max(1, $window - ($now - $start)),
        ];
    }

    /** Limitdan oshsa 429 bilan javobni tugatadi. */
    public static function enforce(string $bucket, ?int $limit = null, int $window = 60): void
    {
        if (!self::enabled()) {
            return;
        }
        $r = self::check($bucket, $limit, $window);
        if (!$r['ok']) {
            if (!headers_sent()) {
                header('Retry-After: ' . $r['retry']);
                header('X-RateLimit-Limit: ' . $r['limit']);
                header('X-RateLimit-Remaining: 0');
            }
            fail('Juda ko\'p so\'rov. ' . $r['retry'] . ' soniyadan keyin qayta urinib ko\'ring.', 429);
        }
    }

    private static function prune(string $dir, int $window): void
    {
        $cut = time() - max(3600, $window * 10);
        foreach (glob($dir . '/*.json') ?: [] as $f) {
            if ((int) @filemtime($f) < $cut) {
                @unlink($f);
            }
        }
    }
}
