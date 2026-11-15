<?php
// ============================================================================
// HttpCache — javob (response) darajasidagi fayl keshi
// ============================================================================
// Nima uchun kerak: minglab tashrif bir xil ro'yxatni so'raydi. Har safar
// MySQL'ga borish o'rniga tayyor JSON massivni diskdan qaytaramiz.
//
// Xususiyatlari:
//   * TTL — necha soniya "yangi" hisoblanadi;
//   * s-maxage — Cloudflare/edge uchun kesh muddati (brauzer uchun max-age);
//   * stale-while-revalidate — muddati o'tgan nusxa qayta hisoblash paytida
//     ham beriladi (foydalanuvchi kutmaydi);
//   * stampede himoyasi — bir vaqtda kelgan 100 so'rovdan faqat bittasi
//     MySQL'ga boradi, qolganlari eski nusxani oladi (flock).
//
// Foydalanish:
//   $data = HttpCache::json('hot-30', 300, 60, function () use ($db) { ... });
//   ok($data);
//
// MUHIM: kesh kaliti foydalanuvchiga bog'liq bo'lmasligi kerak. Login qilgan
// foydalanuvchi uchun kesh ishlatilmaydi (endpointlar o'zi tekshiradi).
// ============================================================================

class HttpCache
{
    /** Nechta so'rovda bir marta eski fayllar tozalanadi. */
    private const PRUNE_EVERY = 50;

    public static function dir(): string
    {
        $d = dirname(__DIR__) . '/storage/cache/http';
        if (!is_dir($d)) {
            @mkdir($d, 0777, true);
        }
        return $d;
    }

    /** Kalitni xavfsiz fayl nomiga aylantiradi. */
    public static function key(string $name, array $parts = []): string
    {
        $safe = preg_replace('/[^A-Za-z0-9_-]/', '_', $name);
        $safe = substr($safe, 0, 40);
        $raw  = $name . '|' . json_encode($parts, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        return ($safe !== '' ? $safe : 'c') . '_' . sha1($raw);
    }

    /**
     * Keshdan massiv qaytaradi yoki $cb natijasini hisoblab, keshlab beradi.
     *
     * @param string   $key      HttpCache::key(...) natijasi
     * @param int      $ttl      Yangi hisoblash oralig'i (soniya)
     * @param int      $sMaxAge  Edge/CDN kesh muddati (soniya, 0 = keshlanmasin)
     * @param callable $cb       Ma'lumotni hisoblovchi funksiya (massiv qaytaradi)
     * @param int      $stale    TTL'dan keyin ham "eskirgan" nusxa beriladigan qo'shimcha soniya
     */
    public static function json(string $key, int $ttl, int $sMaxAge, callable $cb, int $stale = 60): array
    {
        $ttl     = max(1, $ttl);
        $sMaxAge = max(0, $sMaxAge);
        $stale   = max(0, $stale);
        $path    = self::dir() . '/' . $key . '.json';

        $hit = self::read($path, $stale > 0 ? $ttl + $stale : $ttl);
        if ($hit !== null && (time() - $hit['t']) < $ttl) {
            self::headers('HIT', $ttl, $sMaxAge, $stale);
            return $hit['v'];
        }

        // Eski nusxa bormi? (qayta hisoblash paytida berish uchun)
        $staleHit = ($hit !== null && (time() - $hit['t']) < $ttl + $stale) ? $hit : null;

        $lockPath = $path . '.lock';
        $lock     = @fopen($lockPath, 'c');
        $locked   = $lock && @flock($lock, LOCK_EX | LOCK_NB);

        if (!$locked) {
            // Boshqa jarayon hisoblayapti — kutish shart emas.
            if ($staleHit !== null) {
                self::headers('STALE', $ttl, $sMaxAge, $stale);
                if ($lock) {
                    fclose($lock);
                }
                return $staleHit['v'];
            }
            // Eski nusxa yo'q: qisqa kutamiz (stampede yumshatish), keyin baribir hisoblaymiz.
            for ($i = 0; $i < 10; $i++) {
                usleep(50000);
                $again = self::read($path, $ttl);
                if ($again !== null && (time() - $again['t']) < $ttl) {
                    self::headers('HIT', $ttl, $sMaxAge, $stale);
                    if ($lock) {
                        fclose($lock);
                    }
                    return $again['v'];
                }
            }
        }

        $value = null;
        $error = null;
        try {
            $value = $cb();
        } catch (Throwable $e) {
            $error = $e;
        } finally {
            if ($locked && $lock) {
                @flock($lock, LOCK_UN);
            }
            if ($lock) {
                fclose($lock);
            }
        }

        if ($error !== null) {
            // Hisoblash yiqildi: eski nusxa bo'lsa — uni beramiz (xato ko'rsatmaymiz).
            if ($staleHit !== null) {
                self::headers('STALE', $ttl, $sMaxAge, $stale);
                return $staleHit['v'];
            }
            throw $error;
        }

        if (is_array($value)) {
            self::write($path, ['t' => time(), 'v' => $value]);
        }
        self::headers('MISS', $ttl, $sMaxAge, $stale);
        self::prune();
        return is_array($value) ? $value : [];
    }

    /** Javob keshga yozilmaydi: foydalanuvchiga xos endpointlar uchun. */
    public static function privateNoStore(): void
    {
        if (!headers_sent()) {
            header('Cache-Control: private, no-store, max-age=0');
            header('X-WC-Cache: BYPASS');
        }
    }

    /** Keshdagi yozuvlarni o'chirish (masalan, kontent o'zgarganda). */
    public static function purge(string $prefix = ''): void
    {
        foreach (glob(self::dir() . '/*.json') ?: [] as $f) {
            if ($prefix === '' || strpos(basename($f), $prefix) === 0) {
                @unlink($f);
            }
        }
    }

    // ------------------------------------------------------------------ ichki

    private static function headers(string $state, int $ttl, int $sMaxAge, int $stale): void
    {
        if (headers_sent()) {
            return;
        }
        // Sessiya limiteri (session_start) "Expires: 1981" va "Pragma: no-cache"
        // qo'ygan bo'lishi mumkin — keshlanadigan javobda ular qarama-qarshi
        // ma'no beradi. O'chirib tashlaymiz.
        header_remove('Expires');
        header_remove('Pragma');
        $maxAge = $ttl >= 30 ? 15 : 0;
        if ($sMaxAge > 0) {
            header('Cache-Control: public, max-age=' . $maxAge . ', s-maxage=' . $sMaxAge
                . ($stale > 0 ? ', stale-while-revalidate=' . $stale : ''));
        } else {
            header('Cache-Control: public, max-age=' . $maxAge);
        }
        header('X-WC-Cache: ' . $state);
        header('X-WC-TTL: ' . $ttl);
    }

    /** @return array{t:int,v:array}|null */
    private static function read(string $path, int $maxAge = 0): ?array
    {
        if (!is_file($path)) {
            return null;
        }
        $raw = @file_get_contents($path);
        if ($raw === false || $raw === '') {
            return null;
        }
        $data = json_decode($raw, true);
        if (!is_array($data) || !isset($data['t']) || !isset($data['v']) || !is_array($data['v'])) {
            return null;
        }
        if ($maxAge > 0 && (time() - (int) $data['t']) > $maxAge) {
            return null;
        }
        return ['t' => (int) $data['t'], 'v' => $data['v']];
    }

    /** Atomik yozish: vaqtinchalik fayl + rename (chala JSON o'qilmasin). */
    private static function write(string $path, array $payload): void
    {
        $tmp = $path . '.' . getmypid() . '.tmp';
        $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_PARTIAL_OUTPUT_ON_ERROR);
        if ($json === false) {
            return;
        }
        if (@file_put_contents($tmp, $json, LOCK_EX) === false) {
            @unlink($tmp);
            return;
        }
        if (!@rename($tmp, $path)) {
            @unlink($tmp);
        }
    }

    /** Eskirgan kesh fayllarini seyrek tozalash (disk to'lib ketmasin). */
    private static function prune(): void
    {
        if (random_int(1, self::PRUNE_EVERY) !== 1) {
            return;
        }
        $cut = time() - 2 * 86400;
        foreach (glob(self::dir() . '/*.json') ?: [] as $f) {
            if ((int) @filemtime($f) < $cut) {
                @unlink($f);
                @unlink($f . '.lock');
            }
        }
    }
}
