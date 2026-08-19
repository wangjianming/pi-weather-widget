# Pi Weather Widget

**[中文文档](README.zh-CN.md)** | English

A zero-config global extension for [pi](https://github.com/earendil-works/pi-coding-agent) that shows the current weather as a single colored line above the input editor.

It resolves your approximate location from your public IP (via [IPWhois](https://ipwho.is/)) and fetches current conditions from [Open-Meteo](https://open-meteo.com/). **No API key required.**

```
☀ 東京都 27°C 体感 31°C 大部晴朗 · 湿度 77% · 风速 5 km/h
```

## Features

- **Zero config** — no API keys, no settings; install and reload.
- **Non-blocking** — all cache and network work runs in the background; Pi startup and conversations are never delayed.
- **Self-updating** — refreshes the full IP → location → weather chain every 30 minutes.
- **Cached** — results are cached on disk and reused while less than 3 hours old.
- **Graceful degradation** — on refresh failure, valid weather stays visible with a `⚠ 数据已过期` (stale) label; with no valid data the widget hides completely.
- **Responsive** — on narrow terminals it drops fields in order: wind → humidity → apparent temperature → description.
- **Colored** — icons and colors adapt to the weather family (clear / cloud / fog / rain / snow / thunder) and temperature band (ice → extreme), using your active Pi theme.
- **Safe** — terminal control characters in remote or cached text are rejected before rendering.

Only Pi TUI mode is supported; `print` and JSON modes start no weather work.

## Requirements

- pi (coding agent) with extension support
- Node.js ≥ 24

## Installation

Clone the repo into Pi's global extensions directory:

```bash
git clone https://github.com/wangjianming/pi-weather-widget.git ~/.pi/agent/extensions/pi-weather-widget
```

Then restart pi, or run `/reload` inside a session.

To remove, delete the directory and `/reload` again.

## How it works

| File | Responsibility |
| --- | --- |
| `index.ts` | Extension entry; wires lifecycle to `session_start` / `session_shutdown` and renders the widget |
| `api.ts` | IPWhois + Open-Meteo client with strict response validation and per-request timeouts (10 s) |
| `runtime.ts` | Refresh/expiry scheduling, abort handling, stale-or-hide fallback |
| `cache.ts` | Atomic (temp-file + rename) JSON cache with a strict 3-hour max age |
| `formatter.ts` | Responsive colored single-line rendering |
| `weather-codes.ts` | WMO weather code → symbol / description / family mapping |
| `types.ts` | Shared types and terminal-safe text normalization |

Data flow on startup:

1. Read the cache; if it is fresh (< 3 h), show it immediately.
2. Refresh in the background; on success, update the display and rewrite the cache.
3. On failure, keep showing cached weather with a stale label until it expires; then hide and delete the cache.
4. Repeat the refresh every 30 minutes.

## Tests

The test suite has no external dependencies (Node built-ins only):

```bash
npm test
```

## Privacy & cache

- Cache location: `${PI_CODING_AGENT_DIR:-~/.pi/agent}/cache/weather-widget.json`
- The cache stores only the approximate location, coordinates, current weather, observation time, and fetch time.
- It never stores your public IP, API keys, pi messages, or telemetry.
- IPWhois sees your public IP; Open-Meteo receives the resolved coordinates plus normal HTTP metadata.
- IP-based location is approximate and may reflect a VPN, proxy, or ISP exit point.

## License

[MIT](LICENSE) © 2026 wangjianming
