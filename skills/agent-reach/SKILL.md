---
name: agent-reach
description: >
  Search and read Twitter/X, Reddit, and YouTube.
  Triggers: search twitter, read tweet, youtube transcript, search reddit,
  read this link, x.com, reddit.com, youtube.com, youtu.be
---

# Agent Reach — X.com + Reddit + YouTube

Call these CLI tools directly from OpenClaw.

## Twitter/X (xreach CLI)

Requires: `npm install -g xreach-cli`
Auth: Twitter cookies (auth_token + ct0) — see setup below.

```bash
# Search tweets
xreach search "query" -n 10 --json

# Read a single tweet (supports long tweets + X Articles)
xreach tweet URL_OR_ID --json

# User timeline
xreach tweets @username -n 20 --json

# Full thread
xreach thread URL_OR_ID --json
```

### Twitter Setup

1. Install: `npm install -g xreach-cli`
2. Get cookies from browser (DevTools > Application > Cookies > x.com):
   - `auth_token` value
   - `ct0` value
3. Configure: `xreach auth set --auth-token=VALUE --ct0=VALUE`

> WARNING: Use a secondary X account. Cookie-based access risks suspension.

> Comparison with OpenClaw's built-in xurl skill: xreach is better for
> X.com because it supports search, timelines, threads, long-form tweets,
> and X Articles. xurl is a generic URL fetcher that only reads page content.

## Reddit (curl JSON API)

No install needed. Uses Reddit public JSON API.

```bash
# Browse subreddit (hot posts)
curl -s "https://www.reddit.com/r/SUBREDDIT/hot.json?limit=10" -H "User-Agent: agent-reach/1.0"

# Search Reddit
curl -s "https://www.reddit.com/search.json?q=QUERY&limit=10" -H "User-Agent: agent-reach/1.0"

# Read a specific post + comments
curl -s "https://www.reddit.com/r/SUBREDDIT/comments/POST_ID.json" -H "User-Agent: agent-reach/1.0"
```

### Reddit Notes

- Server IPs may get 403 from Reddit. If blocked, configure a proxy:
  `export REDDIT_PROXY=http://user:pass@ip:port`
  Then use: `curl -x "$REDDIT_PROXY" ...`
- For search, Exa is a better alternative if available.
- No API keys needed for basic read access.

## YouTube Video to Text (yt-dlp)

Requires: `yt-dlp` (already installed) + Node.js as JS runtime.

```bash
# Get video metadata (title, description, duration, etc.)
yt-dlp --dump-json "URL"

# Download subtitles/captions as text (auto-generated or manual)
yt-dlp --write-sub --write-auto-sub --sub-lang "en,zh-Hans,zh" --skip-download -o "/tmp/%(id)s" "URL"
# Then read the .vtt file:
# cat /tmp/VIDEO_ID.en.vtt

# Search YouTube
yt-dlp --dump-json "ytsearch5:query"

# Extract audio for transcription (if no subtitles available)
yt-dlp -x --audio-format mp3 -o "/tmp/%(id)s.%(ext)s" "URL"
```

### YouTube Setup

yt-dlp needs a JS runtime for YouTube. Since Node.js is available:
```bash
mkdir -p ~/.config/yt-dlp
echo "--js-runtimes node" >> ~/.config/yt-dlp/config
```

### Subtitle to Plain Text

VTT files contain timestamps. To extract just the text:
```bash
sed -n "/^[a-zA-Z]/p" /tmp/VIDEO_ID.en.vtt
```

## Troubleshooting

- **Twitter fetch failed?** Check cookies are current. Install undici: `npm install -g undici`
- **YouTube 403?** Update yt-dlp: `pip install -U yt-dlp`
- **Reddit 403?** Server IP blocked. Use proxy or Exa search instead.

## Workspace Rules

Never create files in the agent workspace. Use `/tmp/` for temporary output.
