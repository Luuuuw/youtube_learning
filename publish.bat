@echo off
cd /d "%~dp0"

echo.
echo [Step 1/4] Working directory: %CD%
echo.

echo [Step 2/4] Checking git...
git --version
if errorlevel 1 (
    echo ERROR: git not found in PATH
    pause
    exit /b 1
)
echo.

echo [Step 3/4] Checking rclone...
where rclone
if errorlevel 1 (
    echo ERROR: rclone not found in PATH
    pause
    exit /b 1
)
echo.

echo [Step 4/4] Ready to publish:
echo   - rclone copy public/content to R2
echo   - git add public/content
echo   - git commit + push
echo.

set /p CONFIRM=Press Y then Enter to proceed:
if /i not "%CONFIRM%"=="Y" (
    echo Cancelled.
    pause
    exit /b 0
)

echo.
echo --- Running rclone copy ---
rclone copy public/content r2:vibe-english --progress --transfers 4
if errorlevel 1 (
    echo ERROR: rclone failed
    pause
    exit /b 1
)

echo.
echo --- git add ---
git add public/content
git diff --staged --quiet
if not errorlevel 1 (
    echo No metadata changes to commit, skipping git push
    goto :done
)

echo.
echo --- git commit ---
git commit -m "add new videos"
if errorlevel 1 (
    echo ERROR: git commit failed
    pause
    exit /b 1
)

echo.
echo --- git push ---
git push origin main
if errorlevel 1 (
    echo ERROR: git push failed (try manually: git push origin main)
    pause
    exit /b 1
)

echo OK: pushed to GitHub. Render will redeploy in 5-10 min.

:done
echo.
echo === Publish complete ===
echo Verify at: https://vibe-english.onrender.com
pause
