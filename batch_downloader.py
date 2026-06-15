#!/usr/bin/env python3
"""
VibeEnglish 批量下载器

用法:
    python batch_downloader.py urls.txt          # 从文件批量下载
    python batch_downloader.py --watch urls.txt  # 后台监控文件变化自动下载
    python batch_downloader.py <单个URL>         # 下载单个视频

urls.txt 格式（每行一个URL，#开头为注释）:
    # 这是注释
    https://www.youtube.com/watch?v=xxxxx
    https://www.youtube.com/watch?v=yyyyy
"""

import os
import sys
import json
import re
import time
import platform
import urllib.request
import zipfile
import argparse
import logging
from datetime import datetime
import yt_dlp

LOGS_DIR = os.path.join(os.getcwd(), 'logs')
os.makedirs(LOGS_DIR, exist_ok=True)
log_file = os.path.join(LOGS_DIR, f"batch_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log")

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler(log_file, encoding='utf-8'),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)

MAX_RETRIES = 3
RETRY_DELAY = 5

PROXY_CONFIG_PATH = os.path.join(os.getcwd(), 'proxy_config.json')
ENV_LOCAL_PATH = os.path.join(os.getcwd(), '.env.local')


def get_cdn_base():
    """读取 .env.local 里的 NEXT_PUBLIC_VIDEO_CDN_BASE；缺失返回 None。"""
    env = os.environ.get('NEXT_PUBLIC_VIDEO_CDN_BASE', '').strip()
    if env:
        return env.rstrip('/')
    if os.path.exists(ENV_LOCAL_PATH):
        try:
            with open(ENV_LOCAL_PATH, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith('#'):
                        continue
                    if '=' not in line:
                        continue
                    k, v = line.split('=', 1)
                    if k.strip() == 'NEXT_PUBLIC_VIDEO_CDN_BASE':
                        return v.strip().rstrip('/')
        except Exception:
            pass
    return None


def cdn_has_mp4(video_id, cdn_base):
    """HEAD 探测 CDN 上 mp4 是否存在。网络异常时保守返回 True（避免假阴性触发重下）。"""
    if not cdn_base:
        return False
    url = f"{cdn_base}/{video_id}/video.mp4"
    try:
        req = urllib.request.Request(url, method='HEAD')
        req.add_header('User-Agent', 'Mozilla/5.0')
        with urllib.request.urlopen(req, timeout=8) as resp:
            return 200 <= resp.status < 400
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return False
        # 其他 HTTP 错误：保守视为存在，不主动覆盖
        logger.warning(f"CDN HEAD {video_id} HTTP {e.code}，保守跳过")
        return True
    except Exception as e:
        logger.warning(f"CDN HEAD {video_id} 失败 ({e})，保守跳过")
        return True


def get_proxy_url():
    """获取代理地址，优先级：配置文件 > 环境变量 > 系统代理"""
    if os.path.exists(PROXY_CONFIG_PATH):
        try:
            with open(PROXY_CONFIG_PATH, 'r', encoding='utf-8') as f:
                cfg = json.load(f)
            proxy = cfg.get('proxy', '').strip()
            if proxy:
                logger.info(f"使用配置文件代理: {proxy}")
                return proxy
        except Exception as e:
            logger.warning(f"读取代理配置失败: {e}")

    for env_key in ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy', 'ALL_PROXY', 'all_proxy']:
        val = os.environ.get(env_key, '').strip()
        if val:
            logger.info(f"使用环境变量 {env_key}: {val}")
            return val

    try:
        import winreg
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER,
            r'Software\Microsoft\Windows\CurrentVersion\Internet Settings')
        proxy_enable, _ = winreg.QueryValueEx(key, 'ProxyEnable')
        if proxy_enable:
            proxy_server, _ = winreg.QueryValueEx(key, 'ProxyServer')
            if proxy_server:
                proxy_url = f"http://{proxy_server}"
                logger.info(f"检测到系统代理: {proxy_url}")
                return proxy_url
        winreg.CloseKey(key)
    except Exception:
        pass

    for port in [7890, 7891, 10808, 10809, 2080, 8080]:
        test_proxies = [
            f'http://127.0.0.1:{port}',
            f'socks5://127.0.0.1:{port}',
        ]
        for tp in test_proxies:
            try:
                proxy_handler = urllib.request.ProxyHandler({'https': tp, 'http': tp})
                opener = urllib.request.build_opener(proxy_handler)
                req = urllib.request.Request('https://www.youtube.com', method='HEAD')
                req.add_header('User-Agent', 'Mozilla/5.0')
                opener.open(req, timeout=5)
                logger.info(f"自动检测到本地代理: {tp}")
                return tp
            except Exception:
                continue

    logger.warning("未检测到可用代理，将尝试直连（国内可能无法访问YouTube）")
    return None


def save_proxy_config(proxy_url):
    """保存代理配置到文件"""
    try:
        with open(PROXY_CONFIG_PATH, 'w', encoding='utf-8') as f:
            json.dump({'proxy': proxy_url}, f, indent=2)
        logger.info(f"代理已保存到 {PROXY_CONFIG_PATH}")
        return True
    except Exception as e:
        logger.error(f"保存代理配置失败: {e}")
        return False


def ensure_ffmpeg():
    """确保 ffmpeg 可用，如果没有则下载"""
    ffmpeg_dir = os.path.join(os.getcwd(), 'bin')
    if platform.system() == 'Windows':
        ffmpeg_path = os.path.join(ffmpeg_dir, 'ffmpeg.exe')
    else:
        ffmpeg_path = os.path.join(ffmpeg_dir, 'ffmpeg')

    if os.path.exists(ffmpeg_path):
        return ffmpeg_path

    logger.info("正在下载 FFmpeg...")
    os.makedirs(ffmpeg_dir, exist_ok=True)

    if platform.system() == 'Windows':
        url = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip'
        zip_path = os.path.join(ffmpeg_dir, 'ffmpeg.zip')
        try:
            urllib.request.urlretrieve(url, zip_path)
            with zipfile.ZipFile(zip_path, 'r') as z:
                for member in z.namelist():
                    if member.endswith('ffmpeg.exe'):
                        z.extract(member, ffmpeg_dir)
                        extracted = os.path.join(ffmpeg_dir, member)
                        os.rename(extracted, ffmpeg_path)
                        break
            os.remove(zip_path)
            for root, dirs, _ in os.walk(ffmpeg_dir, topdown=False):
                for d in dirs:
                    dpath = os.path.join(root, d)
                    try:
                        os.rmdir(dpath)
                    except OSError:
                        pass
            logger.info("FFmpeg 下载完成")
            return ffmpeg_path
        except Exception as e:
            logger.warning(f"FFmpeg 下载失败: {e}")
            return None
    else:
        logger.warning("非 Windows 系统，请手动安装 FFmpeg")
        return None


def classify_accent(title, description=""):
    """使用关键词规则判断口音"""
    text = (title + " " + description).lower()

    british_keywords = [
        'british', 'uk', 'united kingdom', 'england', 'scottish', 'irish',
        'bbc', 'received pronunciation', 'rp ', 'cockney', 'queen\'s english',
        '牛津', '剑桥', '伦敦', '英式', '英音', '英国'
    ]
    american_keywords = [
        'american', 'usa', 'us ', 'united states', 'california', 'new york',
        'texas', 'midwest', 'southern accent', 'valley girl', 'general american',
        '托福', '美式', '美音', '美国', '纽约', '加州'
    ]

    british_score = sum(1 for k in british_keywords if k in text)
    american_score = sum(1 for k in american_keywords if k in text)

    if british_score > american_score:
        return 'british'
    elif american_score > british_score:
        return 'american'
    return 'other'


def download_video(youtube_url, proxy_url=None):
    video_id_match = re.search(r'(?:v=|/)([a-zA-Z0-9_-]{11})', youtube_url)
    if not video_id_match:
        logger.error(f"无效的 YouTube 链接: {youtube_url}")
        return None

    video_id = video_id_match.group(1)
    output_dir = os.path.join('public', 'content', video_id)
    print(f"[VPROG] {video_id} started {youtube_url}", flush=True)

    # 跳过条件：meta.json 在 + (本地 mp4 在 OR CDN 上有 mp4)
    # 防御 batch_downloader 早期版本的 bug：只有 meta 没 mp4 也跳过，
    # 导致"meta 在 + 本地无 mp4 + R2 也无"的假阳性视频前端 404 看不了。
    meta_path = os.path.join(output_dir, 'meta.json')
    mp4_path = os.path.join(output_dir, 'video.mp4')
    if os.path.exists(meta_path):
        if os.path.exists(mp4_path):
            logger.info(f"已存在完整下载，跳过: {video_id}")
            print(f"[VPROG] {video_id} skipped", flush=True)
            return {'id': video_id, 'status': 'skipped'}
        cdn_base = get_cdn_base()
        if cdn_base and cdn_has_mp4(video_id, cdn_base):
            logger.info(f"已有 meta.json，CDN 上 mp4 存在，跳过: {video_id}")
            print(f"[VPROG] {video_id} skipped", flush=True)
            return {'id': video_id, 'status': 'skipped'}
        # 本地+CDN 都没 mp4，删除残留 meta 让 yt-dlp 重新走完整流程
        logger.warning(f"{video_id}: meta 在但本地+CDN 都无 mp4，强制重下")
        try:
            os.remove(meta_path)
        except Exception as e:
            logger.warning(f"删除残留 meta.json 失败: {e}")

    os.makedirs(output_dir, exist_ok=True)

    for f in os.listdir(output_dir):
        fp = os.path.join(output_dir, f)
        if (f.startswith('video.') or f.startswith('tmp_')) and not f.endswith('.vtt'):
            try:
                os.remove(fp)
                logger.info(f"清理残留文件: {f}")
            except Exception:
                pass

    ffmpeg_path = ensure_ffmpeg()
    if ffmpeg_path:
        os.environ['PATH'] = os.path.dirname(ffmpeg_path) + os.pathsep + os.environ.get('PATH', '')

    if proxy_url is None:
        proxy_url = get_proxy_url()

    if proxy_url:
        logger.info(f"使用代理: {proxy_url}")
    else:
        logger.warning("未配置代理，将尝试直连（如果在国内可能失败）")

    def _progress_hook(d):
        # 结构化输出，供 batch-download API 解析单视频进度
        # 格式：[VPROG] <video_id> downloading <percent>
        status = d.get('status')
        if status == 'downloading':
            try:
                total = d.get('total_bytes') or d.get('total_bytes_estimate') or 0
                downloaded = d.get('downloaded_bytes') or 0
                pct = round(downloaded * 100 / total, 1) if total else 0
                print(f"[VPROG] {video_id} downloading {pct}", flush=True)
            except Exception:
                pass
        elif status == 'finished':
            print(f"[VPROG] {video_id} downloading 100", flush=True)

    ydl_opts = {
        'format': 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080][ext=mp4]/best[height<=1080]/best',
        'outtmpl': os.path.join(output_dir, 'video.%(ext)s'),
        'writesubtitles': True,
        'writeautomaticsub': True,
        'subtitleslangs': ['en', 'zh-Hans', 'zh-Hant', 'zh'],
        'subtitlesformat': 'vtt',
        'writethumbnail': True,
        'ignoreerrors': True,
        'merge_output_format': 'mp4',
        'overwrites': True,
        'socket_timeout': 60,
        'retries': MAX_RETRIES,
        'fragment_retries': MAX_RETRIES,
        'extractor_retries': MAX_RETRIES,
        'progress_hooks': [_progress_hook],
    }

    if proxy_url:
        ydl_opts['proxy'] = proxy_url

    last_error = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            logger.info(f"尝试下载 (第{attempt}/{MAX_RETRIES}次): {youtube_url}")
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(youtube_url, download=True)
                if info is None:
                    last_error = "yt-dlp 返回空信息（视频可能不可用、地区限制或网络不通）"
                    logger.warning(f"第{attempt}次失败: {last_error}")
                    if attempt < MAX_RETRIES:
                        time.sleep(RETRY_DELAY * attempt)
                        continue
                    logger.error(f"无法获取视频信息: {youtube_url} - {last_error}")
                    logger.error("提示：请检查代理设置，或运行 python batch_downloader.py --setup-proxy 配置代理")
                    return None

                title = info.get('title', video_id)
                description = info.get('description', '')
                duration = info.get('duration', 0)
                thumbnail_url = info.get('thumbnail', '')

                video_files = [f for f in os.listdir(output_dir) if f.startswith('video.') and f.endswith(('.mp4', '.webm', '.mkv', '.m4a'))]
                mp4_files = [f for f in video_files if f.endswith('.mp4')]
                if mp4_files:
                    if 'video.mp4' not in mp4_files:
                        os.rename(os.path.join(output_dir, mp4_files[0]), os.path.join(output_dir, 'video.mp4'))
                elif video_files:
                    largest = max(video_files, key=lambda f: os.path.getsize(os.path.join(output_dir, f)))
                    os.rename(os.path.join(output_dir, largest), os.path.join(output_dir, 'video.mp4'))

                for f in os.listdir(output_dir):
                    if f.startswith('video.f') and (f.endswith('.mp4') or f.endswith('.m4a') or f.endswith('.webm')):
                        os.remove(os.path.join(output_dir, f))

                thumb_files = [f for f in os.listdir(output_dir) if f.endswith(('.jpg', '.png', '.webp'))]
                if thumb_files:
                    old_path = os.path.join(output_dir, thumb_files[0])
                    new_path = os.path.join(output_dir, 'thumbnail.jpg')
                    if old_path != new_path:
                        os.rename(old_path, new_path)

                accent = classify_accent(title, description)

                meta = {
                    'id': video_id,
                    'title': title,
                    'description': description[:500] if description else '',
                    'duration': duration,
                    'thumbnail': f'/content/{video_id}/thumbnail.jpg' if thumb_files else thumbnail_url,
                    'downloadedAt': datetime.now().isoformat(),
                    'accent': accent,
                }
                meta_path = os.path.join(output_dir, 'meta.json')
                with open(meta_path, 'w', encoding='utf-8') as f:
                    json.dump(meta, f, ensure_ascii=False, indent=2)

                logger.info(f"下载完成: {title} ({video_id}), 口音: {accent}")
                # 给 batch-download API 解析的结构化日志（紧凑 JSON 一行，title 可能含特殊字符）
                title_safe = title.replace('\n', ' ').replace('\r', ' ')[:200]
                print(f"[VPROG] {video_id} done {title_safe}", flush=True)
                return meta

        except yt_dlp.utils.DownloadError as e:
            last_error = str(e)
            error_lower = last_error.lower()
            if any(kw in error_lower for kw in ['429', 'too many requests', 'rate limit']):
                logger.warning(f"第{attempt}次被限流，等待{RETRY_DELAY * attempt}秒后重试...")
                time.sleep(RETRY_DELAY * attempt)
            elif any(kw in error_lower for kw in ['network', 'connection', 'timeout', 'socket', 'ssl']):
                logger.warning(f"第{attempt}次网络错误: {e}")
                if attempt < MAX_RETRIES:
                    time.sleep(RETRY_DELAY)
            elif 'private video' in error_lower or 'video unavailable' in error_lower or 'copyright' in error_lower:
                logger.error(f"视频不可用: {youtube_url} - {e}")
                return None
            else:
                logger.warning(f"第{attempt}次下载错误: {e}")
                if attempt < MAX_RETRIES:
                    time.sleep(RETRY_DELAY)
        except Exception as e:
            last_error = str(e)
            logger.warning(f"第{attempt}次未知异常: {e}", exc_info=True)
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_DELAY)

    logger.error(f"下载失败（已重试{MAX_RETRIES}次）: {youtube_url} - 最后错误: {last_error}")
    err_safe = (last_error or 'unknown').replace('\n', ' ')[:200]
    print(f"[VPROG] {video_id} failed {err_safe}", flush=True)
    return None


def batch_download(url_file):
    if not os.path.exists(url_file):
        logger.error(f"文件不存在: {url_file}")
        return

    with open(url_file, 'r', encoding='utf-8') as f:
        raw_urls = [line.strip() for line in f if line.strip() and not line.startswith('#')]

    def extract_vid(u):
        m = re.search(r'(?:v=|/)([a-zA-Z0-9_-]{11})', u)
        return m.group(1) if m else None

    deduped = []
    seen_ids = {}
    for u in raw_urls:
        vid = extract_vid(u)
        if vid in seen_ids:
            logger.info(f"⏭ 跳过重复视频: {vid} (之前: {seen_ids[vid]})")
            continue
        seen_ids[vid] = u
        deduped.append((u, vid))

    urls = [u for u, _ in deduped]
    skipped_count = len(raw_urls) - len(urls)

    if skipped_count > 0:
        logger.warning(f"列表中有 {skipped_count} 个重复链接已跳过，实际待下载 {len(urls)} 个")

    proxy_url = get_proxy_url()
    logger.info(f"共 {len(urls)} 个视频待下载")
    # 提前广播队列，让前端立刻显示完整列表
    for u, vid in deduped:
        print(f"[VPROG] {vid} queued {u}", flush=True)
    success = 0
    skipped = 0
    failed_list = []
    for i, (url, vid) in enumerate(deduped, 1):
        logger.info(f"[{i}/{len(urls)}] 正在处理: {url}")
        result = download_video(url, proxy_url=proxy_url)
        if result is None:
            failed_list.append(url)
        elif isinstance(result, dict) and result.get('status') == 'skipped':
            skipped += 1
        else:
            success += 1
        time.sleep(2)

    logger.info(f"下载完成: {success} 成功, {skipped} 已存在跳过, {len(failed_list)} 失败")
    if skipped > 0:
        logger.info("已存在的视频无需重新下载（如需重新下载请删除对应 content 目录）")
    if failed_list:
        logger.warning(f"失败的视频 ({len(failed_list)}个):")
        for f in failed_list:
            logger.warning(f"  - {f}")
    return success


def watch_file(url_file):
    """后台监控文件变化，自动下载新添加的URL"""
    logger.info(f"开始监控文件: {url_file}")
    logger.info("按 Ctrl+C 停止")

    processed = set()
    processed_vids = set()
    proxy_url = get_proxy_url()

    if os.path.exists(url_file):
        with open(url_file, 'r', encoding='utf-8') as f:
            for line in f:
                url = line.strip()
                if url and not url.startswith('#'):
                    processed.add(url)
                    vm = re.search(r'(?:v=|/)([a-zA-Z0-9_-]{11})', url)
                    if vm:
                        processed_vids.add(vm.group(1))

    try:
        while True:
            if os.path.exists(url_file):
                with open(url_file, 'r', encoding='utf-8') as f:
                    urls = [line.strip() for line in f if line.strip() and not line.startswith('#')]

                new_urls = []
                for u in urls:
                    if u in processed:
                        continue
                    vm = re.search(r'(?:v=|/)([a-zA-Z0-9_-]{11})', u)
                    if vm and vm.group(1) in processed_vids:
                        logger.info(f"⏭ 跳过重复视频: {vm.group(1)}")
                        processed.add(u)
                        continue
                    new_urls.append(u)

                if new_urls:
                    logger.info(f"发现 {len(new_urls)} 个新链接")
                    for url in new_urls:
                        logger.info(f"开始下载: {url}")
                        download_video(url, proxy_url=proxy_url)
                        processed.add(url)
                        vm = re.search(r'(?:v=|/)([a-zA-Z0-9_-]{11})', url)
                        if vm:
                            processed_vids.add(vm.group(1))
                        time.sleep(2)

            time.sleep(5)
    except KeyboardInterrupt:
        logger.info("监控已停止")


def setup_proxy():
    """交互式配置代理"""
    print("\n" + "=" * 50)
    print("  VibeEnglish 代理配置")
    print("=" * 50)
    print()

    current = None
    if os.path.exists(PROXY_CONFIG_PATH):
        try:
            with open(PROXY_CONFIG_PATH, 'r', encoding='utf-8') as f:
                cfg = json.load(f)
            current = cfg.get('proxy', '')
        except Exception:
            pass

    if current:
        print(f"当前代理: {current}")
    else:
        print("当前: 未配置")

    print()
    print("常见代理格式:")
    print("  http://127.0.0.1:7890      (Clash 默认)")
    print("  socks5://127.0.0.1:7891    (Clash SOCKS5)")
    print("  http://127.0.0.1:10808     (V2Ray默认)")
    print("  socks5://127.0.0.1:10809   (V2Ray SOCKS5)")
    print()

    auto_detected = get_proxy_url()
    if auto_detected and auto_detected != current:
        print(f"✓ 自动检测到可用代理: {auto_detected}")
        use_auto = input("是否使用自动检测的代理？(y/n): ").strip().lower()
        if use_auto == 'y':
            save_proxy_config(auto_detected)
            print(f"\n✓ 代理已设置为: {auto_detected}")
            return

    proxy_input = input("请输入代理地址（留空取消）: ").strip()
    if proxy_input:
        if not proxy_input.startswith(('http://', 'https://', 'socks4://', 'socks5://')):
            proxy_input = f'http://{proxy_input}'
        save_proxy_config(proxy_input)
        print(f"\n✓ 代理已保存为: {proxy_input}")

        print("\n正在测试连接 YouTube...")
        try:
            proxy_handler = urllib.request.ProxyHandler({'https': proxy_input, 'http': proxy_input})
            opener = urllib.request.build_opener(proxy_handler)
            req = urllib.request.Request('https://www.youtube.com', method='HEAD')
            req.add_header('User-Agent', 'Mozilla/5.0')
            opener.open(req, timeout=10)
            print("✓ 代理连接成功！可以正常访问 YouTube")
        except Exception as e:
            print(f"✗ 代理连接失败: {e}")
            print("  请检查代理地址是否正确，或确认代理软件已启动")
    else:
        print("已取消")


def main():
    parser = argparse.ArgumentParser(description='VibeEnglish 批量视频下载器')
    parser.add_argument('input', nargs='?', help='YouTube URL 或包含 URL 列表的文本文件')
    parser.add_argument('--watch', '-w', action='store_true', help='后台监控文件变化自动下载')
    parser.add_argument('--setup-proxy', '-p', action='store_true', help='配置代理设置')
    args = parser.parse_args()

    if args.setup_proxy:
        setup_proxy()
        return

    if not args.input:
        print("=" * 50)
        print("  VibeEnglish 批量下载器")
        print("=" * 50)
        print()
        print("使用方式:")
        print("  1. 下载单个视频: python batch_downloader.py <YouTube链接>")
        print("  2. 批量下载:      python batch_downloader.py urls.txt")
        print("  3. 后台监控:      python batch_downloader.py --watch urls.txt")
        print("  4. 配置代理:      python batch_downloader.py --setup-proxy")
        print()
        print("urls.txt 格式:")
        print("  # 注释行")
        print("  https://www.youtube.com/watch?v=xxxxx")
        print("  https://www.youtube.com/watch?v=yyyyy")
        print()
        return

    if args.watch:
        watch_file(args.input)
    elif os.path.isfile(args.input):
        batch_download(args.input)
    else:
        download_video(args.input)


if __name__ == "__main__":
    main()
