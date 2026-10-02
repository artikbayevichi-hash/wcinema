@echo off
rem ============================================================
rem  start-all.bat - W CINEMA tizimini qo'lda ishga tushirish
rem  (Apache + MySQL + Cloudflare tunnel + bot)
rem ============================================================
%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0start-all.ps1"