@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ============================================
echo  VibeEnglish 一键发布新视频到 R2 + Render
echo ============================================
echo.

REM ---- 0. 检查 git 工作区 ----
git rev-parse --show-toplevel >nul 2>&1
if errorlevel 1 (
    echo [ERR] 当前目录不是 git 仓库
    pause
    exit /b 1
)

REM ---- 1. 检查 public/content 有没有新增或修改 ----
git status --short public/content > "%TEMP%\vibe-status.txt"
for /f %%i in ('type "%TEMP%\vibe-status.txt" ^| find /c /v ""') do set CHANGES=%%i
del "%TEMP%\vibe-status.txt" >nul 2>&1

echo [步骤 1/4] git status: !CHANGES! 个文件有改动
if "!CHANGES!"=="0" (
    echo [WARN] public/content 没有新增或修改的文件
    echo 是否继续？（可能只想重推 R2 同步）
    set /p "GO=Y/n: "
    if /i not "!GO!"=="Y" (
        if /i not "!GO!"=="" exit /b 0
    )
)
echo.

REM ---- 2. 提示翻译检查（不自动跑，避免误操作 MiniMax 配额） ----
echo [步骤 2/4] 翻译检查
echo 如果有新视频还没翻译，请先：
echo   1) 另开窗口跑 npm run dev
echo   2) 浏览器打开 http://localhost:3000，admin 登录
echo   3) 点 "一键处理" 翻译新视频
echo   4) 等翻译完成后回来按 Enter 继续
echo.
echo 已翻译过的视频会被自动跳过，无需重翻
pause
echo.

REM ---- 3. rclone 推 R2 ----
where rclone >nul 2>&1
if errorlevel 1 (
    echo [ERR] 找不到 rclone 命令，请先把 C:\Users\18933\bin 加进 PATH
    pause
    exit /b 1
)

echo [步骤 3/4] 推送到 R2 (vibe-english bucket)
rclone copy public/content r2:vibe-english --progress --transfers 4 --checkers 8
if errorlevel 1 (
    echo [ERR] rclone 失败
    pause
    exit /b 1
)
echo [OK] R2 同步完成
echo.

REM ---- 4. git add + commit + push ----
echo [步骤 4/4] 提交 git 元数据
set /p "MSG=请输入 commit message (默认 add new videos): "
if "!MSG!"=="" set "MSG=add new videos"

git add public/content
git diff --staged --quiet
if not errorlevel 1 (
    echo [INFO] 没有需要提交的元数据改动，跳过 git commit
    goto :done
)

git commit -m "!MSG!"
if errorlevel 1 (
    echo [ERR] git commit 失败
    pause
    exit /b 1
)

git push origin main
if errorlevel 1 (
    echo [ERR] git push 失败（可能网络不稳，等会儿手动重试 git push origin main）
    pause
    exit /b 1
)

echo [OK] 已 push 到 GitHub，Render 将在几分钟内自动 redeploy

:done
echo.
echo ============================================
echo  发布完成！
echo  访问 https://vibe-english.onrender.com 验证
echo ============================================
pause
