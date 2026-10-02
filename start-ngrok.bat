@echo off
REM ==============================================================
REM  tele_uzdub - HTTPS tunnel (ngrok)
REM
REM  Telegram Mini App faqat HTTPS orqali ishlaydi. Bu skript
REM  localhost:80 ni bepul https manzilga bog'laydi va shu
REM  manzilni chiqaradi. Oynani yopmang - tunnel shu yerda
REM  ishlab turadi. To'xtatish uchun Ctrl+C.
REM ==============================================================
REM
REM DIQQAT: ngrok Free rejasida har bir so'rovda ogohlantirish sahifasi
REM chiqadi, bu Mini App uchun muammo bo'lishi mumkin. Cloudflare
REM quick tunnel (start-tunnel.bat) ogohlantirishsiz ishlaydi.
REM ==============================================================

setlocal

set NGROK=%USERPROFILE%\ngrok\ngrok.exe
if not exist "%NGROK%" (
    echo.
    echo [XATO] ngrok topilmadi: %NGROK%
    echo.
    echo NGROK ni quyidagicha o'rnating:
    echo.
    echo 1. https://ngrok.com/download saytiga boring
    echo 2. Windows versiyasini yuklab oling
    echo 3. Zip faylni oching
    echo 4. ngrok.exe faylini C:\Users\user\ngrok\ papkasiga ko'chiring
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
echo  ngrok tunnel yoqilmoqda...
echo ==============================================================
echo.

"%NGROK%" http 80

pause
