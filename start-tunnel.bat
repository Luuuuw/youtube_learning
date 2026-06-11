@echo off
chcp 65001 >nul
title VibeEnglish - Phase -1 Tunnel Launcher

echo ========================================
echo   VibeEnglish - Phase -1 Tunnel
echo ========================================
echo.
echo This will start TWO windows:
echo   [1] Next.js production server (port 3000)
echo   [2] Cloudflare quick tunnel (public URL)
echo.
echo Both windows must stay open while you want
echo the site to be accessible from the internet.
echo.
echo Close either window to take the site offline.
echo.
pause

REM Start Next.js server in new window
start "VibeEnglish Server (Next.js)" cmd /k "cd /d %~dp0 && npm start"

REM Wait for server to bind to port 3000
echo Waiting for Next.js to start...
timeout /t 6 /nobreak >nul

REM Start tunnel in new window
start "VibeEnglish Tunnel (Cloudflare)" cmd /k "C:\Users\18933\bin\cloudflared.exe tunnel --url http://localhost:3000"

echo.
echo Both processes started in separate windows.
echo The tunnel URL will appear in the Cloudflare window after a few seconds.
echo It looks like: https://xxxx-xxxx-xxxx.trycloudflare.com
echo.
echo Copy that URL and send it to your testers.
echo.
echo NOTE: The URL changes every time you restart the tunnel.
echo       To get a permanent URL, you need a free Cloudflare account
echo       and a named tunnel (see notes in 上线.md).
echo.
pause
