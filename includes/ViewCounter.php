<?php
// ============================================================================
// ViewCounter — ko'rishlar hisoblagichi (write-behind / batching)
// ============================================================================
// Muammo: har bir ko'rishda `content.views` ni UPDATE qilish katta yuklamada
// bir xil qatorga yozuvlar navbatini hosil qiladi (row lock). Minglab
// tomoshabin bir vaqtda ko'rsa, MySQL shu bitta ustunga tiqilib qoladi.
//
// Yechim (YouTube uslubi bilan bir xil mantiq):
//   1) unikal ko'rish `content_views` ga DARHOL yoziladi (INSERT IGNORE);
//   2) `content.views` esa daqiqada bir marta, yig'ib (batch) yangilanadi;
//   3) javobda ko'rsatiladigan son `COUNT(*)` dan olinadi — ya'ni foydalanuvchi
//      kechikishni sezmaydi.
//
// Bu klass `api/views.php` dan chaqiriladi. Qo'shimcha ravishda
// `cli/flush-views.php` cron/systemd timer orqali ham ishga tushirilishi
// mumkin (masalan, saytda so'rov bo'lmasa ham kesh yangilanib turadi).
// ============================================================================

class ViewCounter
{
    /** Yozishlar shu oraliqda yig'iladi (soniya). */
    private const FLUSH_EVERY = 60;

    /** Kutilayotgan kontentlar soni shundan oshsa — darhol yozamiz. */
    private const FLUSH_MAX_IDS = 200;

    /**
     * Unikal ko'rishni qayd etadi va joriy (aniq) sonni qaytaradi.
     *
     * @return array{success:bool,views:int,counted:bool,message?:string}
     */
    public static function record(int $contentId, string $viewerKey): array
    {
        $contentId = (int) $contentId;
        $viewerKey = trim((string) $viewerKey);
        if ($contentId <= 0 || $viewerKey === '') {
            return ['success' => false, 'views' => 0, 'counted' => false, 'message' => 'viewer aniqlanmadi'];
        }

        $db = Database::getInstance();
        $stmt = $db->query(
            "INSERT IGNORE INTO content_views (content_id, viewer_key) VALUES (?, ?)",
            [$contentId, $viewerKey]
        );
        $isNew = $stmt !== false && $stmt->rowCount() > 0;

        if ($isNew) {
            self::markPending($contentId);
        }

        // Aniq son — `content_views(content_id, viewer_key)` unikal indeksi
        // orqali COUNT(*) tez ishlaydi (jadval skaneri emas).
        $row = $db->fetchOne(
            "SELECT COUNT(*) AS n FROM content_views WHERE content_id = ?",
            [$contentId]
        );
        $count = (int) ($row['n'] ?? 0);

        self::flushIfDue();

        return ['success' => true, 'views' => $count, 'counted' => true, 'new' => $isNew];
    }

    /**
     * Vaqti kelgan bo'lsa, yig'ilgan kontentlar uchun `content.views` ni
     * bitta so'rovda yangilaydi.
     *
     * @return int Yangilangan kontentlar soni
     */
    public static function flushIfDue(bool $force = false): int
    {
        $dir  = dirname(__DIR__) . '/storage/cache';
        $file = $dir . '/views_pending.json';
        if (!is_file($file)) {
            return 0;
        }

        $lock = @fopen($dir . '/views_pending.lock', 'c');
        if (!$lock) {
            return 0;
        }
        // Boshqa jarayon yozayotgan bo'lsa — kutmaymiz.
        if (!@flock($lock, LOCK_EX | LOCK_NB)) {
            fclose($lock);
            return 0;
        }

        try {
            $raw = @file_get_contents($file);
            $st  = $raw ? json_decode($raw, true) : null;
            if (!is_array($st)) {
                $st = ['t' => time(), 'ids' => []];
            }
            $ids = isset($st['ids']) && is_array($st['ids']) ? array_keys($st['ids']) : [];
            $ids = array_values(array_filter(array_map('intval', $ids), static fn($v) => $v > 0));
            if (!$ids) {
                @unlink($file);
                return 0;
            }

            $due = $force
                || (time() - (int) ($st['t'] ?? 0)) >= self::FLUSH_EVERY
                || count($ids) >= self::FLUSH_MAX_IDS;
            if (!$due) {
                return 0;
            }

            $db = Database::getInstance();
            $done = 0;
            foreach ($ids as $cid) {
                // Korrelyatsiyalangan subso'rov: har bir kontent uchun aniq son.
                $ok = $db->query(
                    "UPDATE content
                        SET views = (SELECT COUNT(*) FROM content_views v WHERE v.content_id = content.id)
                      WHERE id = ?",
                    [$cid]
                );
                if ($ok !== false) {
                    $done++;
                }
            }

            @file_put_contents(
                $file,
                json_encode(['t' => time(), 'ids' => new stdClass()], JSON_UNESCAPED_UNICODE),
                LOCK_EX
            );
            return $done;
        } finally {
            @flock($lock, LOCK_UN);
            fclose($lock);
        }
    }

    /** Kutilayotganlar ro'yxatiga kontentni qo'shadi (flock bilan). */
    private static function markPending(int $contentId): void
    {
        $dir  = dirname(__DIR__) . '/storage/cache';
        if (!is_dir($dir)) {
            @mkdir($dir, 0777, true);
        }
        $file = $dir . '/views_pending.json';
        $lock = @fopen($dir . '/views_pending.lock', 'c');
        if (!$lock) {
            return;
        }
        if (@flock($lock, LOCK_EX)) {
            $raw = @file_get_contents($file);
            $st  = $raw ? json_decode($raw, true) : null;
            if (!is_array($st)) {
                $st = ['t' => time(), 'ids' => []];
            }
            if (!isset($st['ids']) || !is_array($st['ids'])) {
                $st['ids'] = [];
            }
            $st['ids'][(string) $contentId] = 1;
            @file_put_contents($file, json_encode($st, JSON_UNESCAPED_UNICODE), LOCK_EX);
            @flock($lock, LOCK_UN);
        }
        fclose($lock);
    }

    /** Nechta kontent yozuvni kutmoqda (diagnostika uchun). */
    public static function pendingCount(): int
    {
        $file = dirname(__DIR__) . '/storage/cache/views_pending.json';
        if (!is_file($file)) {
            return 0;
        }
        $st = json_decode((string) @file_get_contents($file), true);
        return is_array($st) && isset($st['ids']) && is_array($st['ids']) ? count($st['ids']) : 0;
    }
}
