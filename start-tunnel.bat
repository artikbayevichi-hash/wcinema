@echo off
REM ==============================================================
REM  tele_uzdub - HTTPS tunnel (Cloudflare quick tunnel)
REM
REM  Telegram Mini App faqat HTTPS orqali ishlaydi. Bu skript
REM  localhost:80 ni bepul https manzilga bog'laydi va shu
REM  manzilni chiqaradi. Oynani yopmang - tunnel shu yerda
REM  ishlab turadi. To'xtatish uchun Ctrl+C.
REM ==============================================================
setlocal

set CF=%USERPROFILE%\cloudflared\cloudflared.exe
if not exist "%CF%" (
    echo.
    echo [XATO] cloudflared topilmadi: %CF%
    echo.
    echo Yuklab olish:
    echo   curl -L -o "%CF%" https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe
    echo.
    pause
    exit /b 1
)

REM Apache ishlayotganini tekshiramiz
powershell -NoProfile -Command "if (-not (Test-NetConnection -ComputerName localhost -Port 80 -InformationLevel Quiet -WarningAction SilentlyContinue)) { exit 1 }"
if errorlevel 1 (
    echo.
    echo [XATO] 80-port ochiq emas. Apache'ni ishga tushiring ^(XAMPP Control Panel^).
    echo.
    pause
    exit /b 1
)

echo.
echo ==============================================================
echo  tunnel yoqilmoqda... (bu 10-15 soniya oladi)
echo ==============================================================
echo.

"%CF%" tunnel --url http://localhost:80 --no-autoupdate 2>&1 | findstr /C:"https://"

echo.
echo --------------------------------------------------------------
echo  Yuqoridagi manzilni ^(@w_cinema_uz_bot^) BotFather'da
echo  "Menu Button - Configure Menu Button" orqali bering.
echo.
echo  Eslatma: tunnel to'xtatilsa, manzil ham o'chadi va
echo  yangisini olish uchun bu skriptni qayta ishga tushiring.
echo --------------------------------------------------------------
echo.
pause
