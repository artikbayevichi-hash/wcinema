@echo off
REM ==============================================================
REM  tele_uzdub - Telegram bot (long-poll) ishga tushirish
REM
REM  bot.php doimiy ishlaydigan polling-sikli: W CINEMA SUPPORT
REM  qo'llab-quvvatlash boti. Foydalanuvchi savollariga FAQ bilan
REM  javob beradi, savollarni adminlarga uzatadi, sayt-login
REM  tasdiqlaydi (/start auth_*) va reels videolarini qabul qiladi
REM  (/start reel_*).
REM  Bu skript bot'ni ishga tushiradi va shu oynada ushlab turadi.
REM  To'xtatish uchun Ctrl+C; qayta boshlash uchun yana ishga
REM  tushiring.
REM ==============================================================

setlocal

set PHP=C:\xampp\php\php.exe
if not exist "%PHP%" (
    echo.
    echo [XATO] PHP topilmadi: %PHP%
    echo.
    echo XAMPP'da PHP o'rnatilganiga ishonch hosil qiling.
    echo.
    pause
    exit /b 1
)

echo Telegram bot ishga tushirilmoqda ...
"%PHP%" "%~dp0bot.php"
endlocal