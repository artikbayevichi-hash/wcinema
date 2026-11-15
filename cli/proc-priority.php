<?php
// ============================================================================
// cli/proc-priority.php — og'ir jarayonlarni (ffmpeg) PAST ustuvorlikda ishga
// tushirish.
// ============================================================================
// Muammo: ffmpeg konvertatsiyasi Apache/PHP/MySQL bilan bitta kompyuterning
// protsessorini bo'lishadi. Sessiya paytida bu saytning javob vaqtini
// sezilarli oshiradi (sayt "sekinlashdi" degan shikoyat).
//
// Yechim: ffmpeg'ga eng past ustuvorlik beriladi — OS avval Apache/MySQL
// so'rovlarini bajaradi, ffmpeg bo'sh vaqtda ishlaydi. Konvertatsiya biroz
// cho'ziladi, lekin foydalanuvchi hech narsa sezmaydi (HLS fon jarayoni).
//
//   .env: HLS_FFMPEG_NICE=1   (0 = o'chirish)
// ============================================================================

if (!function_exists('wc_low_priority_enabled')) {

    /** Sozlama yoqilganmi (config.php: HLS_FFMPEG_NICE). */
    function wc_low_priority_enabled(): bool
    {
        return defined('HLS_FFMPEG_NICE') ? (bool) HLS_FFMPEG_NICE : true;
    }

    function wc_is_windows(): bool
    {
        return stripos(PHP_OS_FAMILY, 'win') === 0;
    }

    /**
     * Berilgan PID'ga past ustuvorlik qo'llaydi.
     *
     * Windows: PowerShell orqali PriorityClass = Idle.
     * Linux/macOS: renice 19 (faqat pasaytirish — ruxsat talab qilmaydi).
     *
     * @return bool muvaffaqiyatli bo'lsa true
     */
    function wc_apply_low_priority(int $pid): bool
    {
        $pid = (int) $pid;
        if ($pid <= 0 || !wc_low_priority_enabled()) {
            return false;
        }
        if (wc_is_windows()) {
            $cmd = 'powershell -NoProfile -NonInteractive -Command "(Get-Process -Id '
                . $pid . ' -ErrorAction SilentlyContinue).PriorityClass=\'Idle\'" 2>NUL';
            @exec($cmd, $o, $code);
            return $code === 0;
        }
        @exec('renice -n 19 -p ' . $pid . ' >/dev/null 2>&1', $o, $code);
        return $code === 0;
    }

    /**
     * Shell buyrug'i oldiga qo'yiladigan "nice" prefiksi (proc_open massiv
     * ishlatmaydigan eski yo'l uchun). Windows'da bo'sh satr.
     */
    function wc_nice_prefix(): string
    {
        if (!wc_low_priority_enabled() || wc_is_windows()) {
            return '';
        }
        return 'nice -n 19 ';
    }
}
