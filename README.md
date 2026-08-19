# Pi Weather Widget

A global Pi extension that resolves the current public IP to an approximate city and coordinates, fetches current weather, and displays one responsive colored line above Pi's editor.

## Behavior

- Starts cache and network work in the background without blocking Pi.
- Refreshes the complete IP-to-weather chain every 30 minutes.
- Uses cache only while it is less than three hours old.
- Keeps valid weather with a `⚠ 数据已过期` label after a failed refresh.
- Hides the widget completely when no valid weather exists.
- Drops wind, humidity, apparent temperature, and description in that order on narrow terminals.
- Supports only Pi TUI mode; print and JSON modes do not start weather work.
- Rejects terminal control characters in remote or cached text before rendering.

## Data sources

- IP geolocation: `https://ipwho.is/`
- Weather: `https://open-meteo.com/`

No API key is required. IP location is approximate and can reflect a VPN, proxy, or ISP exit point.

## Cache and privacy

The cache is `${PI_CODING_AGENT_DIR:-~/.pi/agent}/cache/weather-widget.json`. It stores the approximate location, coordinates, current weather, observation time, and successful fetch time. It does not store the public IP, API keys, Pi messages, or telemetry.

IPWhois receives the caller's public IP. Open-Meteo receives the resolved coordinates and normal HTTP metadata.

## Verification

```powershell
npm test
$env:PI_OFFLINE = "1"
pi --no-extensions -e .\index.ts --list-models *> $null
Remove-Item Env:PI_OFFLINE
```

For an intentional live API smoke test:

```powershell
node --input-type=module -e "import('./api.ts').then(async m => console.log(JSON.stringify(await m.fetchWeatherSnapshot(), null, 2)))"
```

After installation, run `/reload` in Pi. With no valid cache, the widget stays hidden until both API requests succeed.
