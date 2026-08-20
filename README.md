# Pi Weather Widget

**[中文文档](README.zh-CN.md)** | English

A zero-config global extension for [pi](https://github.com/earendil-works/pi-coding-agent) that shows the current weather as a single colored line above the input editor.

It resolves your approximate location from your public IP (via [IPWhois](https://ipwho.is/)) and fetches current conditions from [Open-Meteo](https://open-meteo.com/). **No API key required.** If the IP-based location is wrong (VPN, proxy), pin a fixed location with the `/weather` command.

```
☀ 東京都 27°C 体感 31°C 大部晴朗 · 湿度 77% · 风速 5 km/h
```

## Features

- **Zero config** — no API keys, no settings; install and reload.
- **VPN-proof `/weather` command** — pin a city or coordinates, or fall back to automatic IP geolocation.
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

## Pinning a location (VPN / proxy)

When your public IP points at a VPN exit, automatic geolocation shows the wrong city. Fix it with the `/weather` slash command (takes effect immediately, no restart):

```
/weather set 上海        # pin a city (resolved via Open-Meteo's free geocoding API)
/weather set 8.8.8.8        # ...or resolve any public IP to a location and pin it
/weather set 31.23,121.47  # ...or pin raw coordinates
/weather auto           # clear the pin and restore IP-based geolocation
/weather                 # show the current mode and fixed position
```

- The pin is stored in `${PI_CODING_AGENT_DIR:-~/.pi/agent}/weather-widget.json` (personal config directory, outside this repo).
- While pinned, IPWhois is never contacted; only Open-Meteo is queried.
- Switching between pinned/automatic modes or changing the pin immediately invalidates the on-disk cache and refetches.

## Choosing a weather model

Open-Meteo's default `best_match` blend can pick a model that misrepresents your local weather (e.g. reporting drizzle on a sunny afternoon — observed with MET Nordic over Xi'an). `/weather model` lets you pin the underlying numerical model instead:

```
/weather model                # show the current model and list all available models
/weather model cma_grapes_global  # switch (e.g. China Meteorological Administration GRAPES)
/weather model best_match     # or: /weather model auto — restore the default blend
```

- The choice is stored alongside the pin in the same config file and applies to both pinned and IP-geolocated mode.
- Model ids are validated against a curated allowlist of global models that actually output WMO weather codes (AI models like `ecmwf_aifs025`/`gfs_graphcast025` are excluded because they don't).
- Changing the model invalidates the cache and refetches immediately.

### Available models

| Model | Notes |
| --- | --- |
| `best_match` | Open-Meteo default (auto-selects per region) |
| `cma_grapes_global` | China Meteorological Administration GRAPES — recommended in China |
| `ecmwf_ifs025` | ECMWF IFS 0.25° |
| `gfs_seamless` | US NCEP GFS |
| `icon_seamless` | German ICON |
| `meteofrance_seamless` | Météo-France ARPEGE/AROME |
| `jma_seamless` | Japan Meteorological Agency GSM/MSM |
| `metno_seamless` | Norwegian MET Nordic |
| `ukmo_seamless` | UK Met Office UM |

## How it works

| File | Responsibility |
| --- | --- |
| `index.ts` | Extension entry; wires lifecycle, renders the widget, and registers the `/weather` command |
| `api.ts` | IPWhois + Open-Meteo + geocoding clients with strict response validation and per-request timeouts (10 s) |
| `config.ts` | Atomic persistence of the pinned location/model and cache/mode matching |
| `models.ts` | Curated allowlist of Open-Meteo weather models |
| `runtime.ts` | Refresh/expiry scheduling, abort handling, stale-or-hide fallback, forced refresh |
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
