@echo off
REM ============================================================================
REM  W CINEMA - video havolalarini kuzatib, OLDINDAN tayyorlab turuvchi jarayon
REM ============================================================================
REM  Bu oynani ochiq qoldiring (yoki shu faylga yorliq yaratib, Win+R ->
REM  shell:startup papkasiga tashlang - kompyuter yoqilganda o'zi ishga tushadi).
REM  PHP boshqa joyda bo'lsa, quyidagi yo'lni o'zgartiring.
REM ============================================================================
title W CINEMA - HLS kuzatuvchi
cd /d "%~dp0"
:loop
"C:\xampp\php\php.exe" cli\hls-watch.php
echo.
echo [%date% %time%] Jarayon to'xtadi, 10 soniyadan keyin qayta ishga tushadi...
timeout /t 10 /nobreak >nul
goto loop
