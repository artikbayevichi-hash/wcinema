<?php
// Zero-cost million-scale: file-based metadata cache. Reduces DB hits and
// origin CPU. Cache files live under storage/cache with TTL (seconds).
class Cache {
    private static function dir() {
        $d = __DIR__ . '/../storage/cache';
        if (!is_dir($d)) {
            @mkdir($d, 0777, true);
        }
        return $d;
    }

    private static function path($key) {
        return self::dir() . '/' . preg_replace('/[^A-Za-z0-9_-]/', '_', (string)$key) . '.json';
    }

    public static function get($key, $ttl, callable $cb) {
        $TTL = (int) $ttl;
        if ($TTL <= 0) {
            return $cb();
        }
        $path = self::path($key);
        if (is_file($path)) {
            $raw = @file_get_contents($path);
            $cached = $raw ? json_decode($raw, true) : null;
            if (is_array($cached) && isset($cached['_cached_at']) && (time() - (int)$cached['_cached_at']) < $TTL) {
                return $cached['_value'];
            }
        }
        $value = $cb();
        @file_put_contents(
            $path,
            json_encode(['_cached_at' => time(), '_value' => $value], JSON_UNESCAPED_UNICODE | JSON_PARTIAL_OUTPUT_ON_ERROR),
            LOCK_EX
        );
        return $value;
    }

    public static function clear($prefix = '') {
        foreach (glob(self::dir() . '/*') as $f) {
            if ($prefix === '' || strpos(basename($f), (string)$prefix) === 0) {
                @unlink($f);
            }
        }
    }
}
