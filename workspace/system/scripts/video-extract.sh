#!/bin/bash
# video-extract.sh — Unified video content extractor (Instagram + YouTube + TikTok)
# Downloads video, extracts caption/description, transcribes audio via Whisper.
# Works with PUBLIC links — no login/cookies needed.
#
# Usage: video-extract.sh <url> [whisper_model]
# Models: tiny (fast, default), base (better), small (best balance)
#
# Dependencies: yt-dlp, ffmpeg, whisper (openai-whisper)
# Install: brew install yt-dlp ffmpeg && pip install openai-whisper

set -euo pipefail

URL="${1:-}"
WHISPER_MODEL="${2:-tiny}"
WORK_DIR="/tmp/video-extract-$$"
WORKSPACE="${NATIVECLAW_WORKSPACE:-$HOME/.claude/workspace}"
OUTPUT_DIR="$WORKSPACE/downloads"

if [ -z "$URL" ]; then
    echo '{"error": "Usage: video-extract.sh <url> [whisper_model]", "supported": ["instagram.com/reel/", "youtube.com", "youtu.be", "tiktok.com"]}'
    exit 1
fi

cleanup() { rm -rf "$WORK_DIR" 2>/dev/null; }
trap cleanup EXIT

mkdir -p "$WORK_DIR" "$OUTPUT_DIR"

# ── Detect platform ────────────────────────────────────────────────────────
PLATFORM="unknown"
if echo "$URL" | grep -qiE 'instagram\.com'; then
    PLATFORM="instagram"
elif echo "$URL" | grep -qiE 'youtube\.com|youtu\.be'; then
    PLATFORM="youtube"
elif echo "$URL" | grep -qiE 'tiktok\.com'; then
    PLATFORM="tiktok"
fi

echo "{\"status\": \"downloading\", \"platform\": \"$PLATFORM\"}" >&2

# ── Step 1: Get metadata (no download yet) ─────────────────────────────────
META_JSON=$(yt-dlp --dump-json --no-download --no-playlist "$URL" 2>/dev/null) || {
    # Try extracting cookies from local Chrome (user may be logged in)
    echo '{"status": "retrying_with_browser_cookies"}' >&2
    META_JSON=$(yt-dlp --cookies-from-browser chrome --dump-json --no-download --no-playlist "$URL" 2>/dev/null) || {
        # Try with explicit cookies file if available
        COOKIES="$WORKSPACE/credentials/instagram-cookies.txt"
        if [ -f "$COOKIES" ]; then
            META_JSON=$(yt-dlp --cookies "$COOKIES" --dump-json --no-download --no-playlist "$URL" 2>/dev/null) || {
                echo '{"error": "Failed to fetch video metadata. URL may be private or require login.", "url": "'"$URL"'", "hint": "Try opening in browser first to ensure cookies exist"}'
                exit 1
            }
        else
            echo '{"error": "Failed to fetch video metadata. URL may be private or require login.", "url": "'"$URL"'", "hint": "Try opening in browser first to ensure cookies exist"}'
            exit 1
        fi
    }
}

# Parse metadata
CREATOR=$(echo "$META_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('uploader','') or d.get('channel','') or 'unknown')" 2>/dev/null || echo "unknown")
DURATION=$(echo "$META_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('duration','') or '0')" 2>/dev/null || echo "0")
TITLE=$(echo "$META_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print((d.get('title','') or 'unknown')[:100])" 2>/dev/null || echo "unknown")
VIEWS=$(echo "$META_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('view_count','') or '0')" 2>/dev/null || echo "0")
LIKES=$(echo "$META_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('like_count','') or '0')" 2>/dev/null || echo "0")
VIDEO_ID=$(echo "$META_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id','') or d.get('display_id','') or 'video')" 2>/dev/null || echo "video")

CAPTION=$(echo "$META_JSON" | python3 -c "
import sys, json
d = json.load(sys.stdin)
# Instagram uses 'description', YouTube uses 'description' too
desc = d.get('description','') or d.get('title','') or ''
print(desc)
" 2>/dev/null || echo "")

echo "{\"status\": \"metadata_fetched\", \"creator\": \"$CREATOR\", \"duration\": \"$DURATION\"}" >&2

# ── Step 2: Try to get subtitles/captions (YouTube often has them) ──────────
SUBTITLE_TRANSCRIPT=""
if [ "$PLATFORM" = "youtube" ]; then
    yt-dlp \
        --write-auto-sub --write-sub \
        --sub-lang en \
        --skip-download \
        --no-playlist \
        --output "$WORK_DIR/subs" \
        "$URL" 2>/dev/null || true

    # Find subtitle file
    SUB_FILE=""
    for ext in vtt srt; do
        for lang in en en-orig; do
            candidate="$WORK_DIR/subs.${lang}.${ext}"
            if [ -f "$candidate" ]; then
                SUB_FILE="$candidate"
                break 2
            fi
        done
    done

    if [ -n "$SUB_FILE" ] && [ -f "$SUB_FILE" ]; then
        SUBTITLE_TRANSCRIPT=$(sed \
            -e 's/<[^>]*>//g' \
            -e '/^WEBVTT/d' \
            -e '/^Kind:/d' \
            -e '/^Language:/d' \
            -e '/^NOTE/d' \
            -e '/^[0-9][0-9]:[0-9][0-9]:[0-9][0-9]/d' \
            -e '/^[0-9][0-9]:[0-9][0-9]\./d' \
            -e '/^[0-9]*$/d' \
            -e '/^$/d' \
            -e 's/^[[:space:]]*//' \
            "$SUB_FILE" | awk '!seen[$0]++')
        echo "{\"status\": \"subtitles_found\"}" >&2
    fi
fi

# ── Step 3: Download video for Whisper transcription ────────────────────────
WHISPER_TRANSCRIPT=""
HAS_WHISPER=false
command -v whisper &>/dev/null && HAS_WHISPER=true
command -v ffmpeg &>/dev/null || { echo '{"error": "ffmpeg not installed. Run: brew install ffmpeg"}'; exit 1; }

# Only download+transcribe if we don't already have subtitles
if [ -z "$SUBTITLE_TRANSCRIPT" ] && [ "$HAS_WHISPER" = true ]; then
    echo "{\"status\": \"downloading_video\"}" >&2
    VIDEO_FILE="$WORK_DIR/video.mp4"

    yt-dlp \
        --output "$VIDEO_FILE" \
        --format "worst[ext=mp4]/worst" \
        --no-playlist \
        "$URL" 2>/dev/null || {
        # Try with Chrome cookies
        yt-dlp --cookies-from-browser chrome \
            --output "$VIDEO_FILE" \
            --format "worst[ext=mp4]/worst" \
            --no-playlist \
            "$URL" 2>/dev/null || {
            # Try with explicit cookies file
            COOKIES="$WORKSPACE/credentials/instagram-cookies.txt"
            if [ -f "$COOKIES" ]; then
                yt-dlp --cookies "$COOKIES" \
                    --output "$VIDEO_FILE" \
                    --format "worst[ext=mp4]/worst" \
                    --no-playlist \
                    "$URL" 2>/dev/null
            fi
        }
    }

    if [ -f "$VIDEO_FILE" ]; then
        # Extract audio
        AUDIO_FILE="$WORK_DIR/audio.wav"
        ffmpeg -y -i "$VIDEO_FILE" -vn -acodec pcm_s16le -ar 16000 -ac 1 "$AUDIO_FILE" 2>/dev/null

        if [ -f "$AUDIO_FILE" ]; then
            # Check audio level (skip if near-silent)
            MEAN_VOL=$(ffmpeg -i "$AUDIO_FILE" -af "volumedetect" -f null /dev/null 2>&1 | grep "mean_volume" | awk -F': ' '{print $2}' | tr -d ' dB' || echo "-99")

            if [ -n "$MEAN_VOL" ] && python3 -c "exit(0 if float('$MEAN_VOL') > -45 else 1)" 2>/dev/null; then
                echo "{\"status\": \"transcribing\", \"model\": \"$WHISPER_MODEL\"}" >&2
                whisper "$AUDIO_FILE" --model "$WHISPER_MODEL" --output_format txt --output_dir "$WORK_DIR" 2>/dev/null || true

                if [ -f "$WORK_DIR/audio.txt" ]; then
                    WHISPER_TRANSCRIPT=$(cat "$WORK_DIR/audio.txt")
                fi
            else
                echo "{\"status\": \"audio_too_quiet\"}" >&2
            fi
        fi
    fi
elif [ -z "$SUBTITLE_TRANSCRIPT" ] && [ "$HAS_WHISPER" = false ]; then
    echo "{\"status\": \"whisper_not_installed\", \"note\": \"Install with: pip install openai-whisper\"}" >&2
fi

# ── Step 4: Decide best transcript ──────────────────────────────────────────
TRANSCRIPT=""
TRANSCRIPT_SOURCE=""
if [ -n "$SUBTITLE_TRANSCRIPT" ]; then
    TRANSCRIPT="$SUBTITLE_TRANSCRIPT"
    TRANSCRIPT_SOURCE="subtitles"
elif [ -n "$WHISPER_TRANSCRIPT" ]; then
    TRANSCRIPT="$WHISPER_TRANSCRIPT"
    TRANSCRIPT_SOURCE="whisper"
fi

# ── Step 5: Output structured JSON ─────────────────────────────────────────
python3 -c "
import json, sys

result = {
    'success': True,
    'platform': '$PLATFORM',
    'url': sys.argv[1],
    'creator': sys.argv[2],
    'duration_seconds': sys.argv[3],
    'views': sys.argv[4],
    'likes': sys.argv[5],
    'caption': sys.argv[6],
    'transcript': sys.argv[7],
    'transcript_source': sys.argv[8]
}

print(json.dumps(result, indent=2, ensure_ascii=False))
" "$URL" "$CREATOR" "$DURATION" "$VIEWS" "$LIKES" "$CAPTION" "$TRANSCRIPT" "$TRANSCRIPT_SOURCE"
