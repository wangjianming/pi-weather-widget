# Pi IP Weather Widget Design

**Date:** 2026-08-19  
**Status:** Approved design, pending implementation plan

## 1. Purpose

Create a global Pi extension that determines the user's approximate coordinates from the current public IP address, retrieves current weather for those coordinates, and displays it as a compact colored widget immediately above Pi's input editor.

The extension must be automatic, require no API key, never block Pi startup or conversation, and remain silent when no usable weather data exists.

## 2. Scope

### In scope

- Global Pi extension installed at `~/.pi/agent/extensions/weather-widget/`.
- Public-IP geolocation through IPWhois.
- Current weather retrieval through Open-Meteo.
- One-line, colored, label-style widget above the input editor.
- Temperature-dependent colors and weather-dependent icons.
- Startup refresh and automatic refresh every 30 minutes.
- A local weather cache valid for less than three hours.
- Silent background operation and graceful network failure.
- Responsive reduction of displayed fields on narrow terminals.
- Automated tests for parsing, cache lifetime, scheduling, lifecycle, and formatting.

### Out of scope

- Manual location configuration or override.
- GPS or operating-system location services.
- Forecasts, alerts, air quality, sunrise, or historical weather.
- Configuration UI, slash commands, keyboard shortcuts, or custom settings.
- API keys, accounts, telemetry, analytics, or request logging.
- Rendering in Pi print or JSON modes.

## 3. External services

### 3.1 IP geolocation

Request:

```text
GET https://ipwho.is/?lang=zh-CN&fields=success,message,city,region,country,latitude,longitude,timezone
```

Required response data:

- `success`
- `city`
- `region`
- `country`
- `latitude`
- `longitude`
- `timezone.id`, when available

Validation rules:

- `success` must be `true`.
- Latitude and longitude must be finite numbers.
- Latitude must be within `[-90, 90]`.
- Longitude must be within `[-180, 180]`.
- The display location uses the first non-empty value in this order: city, region, country.
- Empty, malformed, unsuccessful, or out-of-range responses fail the refresh.

IP-based location is approximate and may represent a VPN, proxy, or ISP exit point. This limitation is accepted because manual location override is explicitly out of scope.

### 3.2 Current weather

Request:

```text
GET https://api.open-meteo.com/v1/forecast
    ?latitude=<latitude>
    &longitude=<longitude>
    &current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m
    &temperature_unit=celsius
    &wind_speed_unit=kmh
    &timezone=auto
```

Required `current` response data:

- `temperature_2m`
- `apparent_temperature`
- `relative_humidity_2m`
- `weather_code`
- `wind_speed_10m`
- `time`, when available

All numeric values must be finite. A missing or malformed required field fails the refresh rather than displaying a partial or invalid value.

Each external request has an independent 10-second timeout. Session shutdown and `/reload` must abort both requests immediately through an `AbortController`.

The no-key Open-Meteo endpoint is suitable for this personal, non-commercial extension. Commercial redistribution would require a separate licensing review.

## 4. Project structure

```text
~/.pi/agent/extensions/weather-widget/
├── index.ts
├── api.ts
├── cache.ts
├── formatter.ts
├── weather-codes.ts
├── types.ts
├── package.json
├── README.md
├── tests/
│   ├── api.test.ts
│   ├── cache.test.ts
│   ├── formatter.test.ts
│   └── lifecycle.test.ts
└── docs/superpowers/specs/
    └── 2026-08-19-weather-widget-design.md
```

Responsibilities:

- `index.ts`: Pi lifecycle hooks, background refresh orchestration, timers, widget visibility, and cleanup.
- `api.ts`: HTTP requests, timeouts, response validation, and conversion into internal types.
- `cache.ts`: config-directory resolution, cache parsing, validity checks, atomic writes, and deletion of invalid cache data.
- `formatter.ts`: temperature bands, responsive field selection, themed pill composition, numeric display formatting, and ANSI-safe width handling.
- `weather-codes.ts`: WMO weather-code mapping to concise Chinese descriptions and standard Unicode symbols.
- `types.ts`: internal location, weather, cache, and render-segment types.
- `tests/`: deterministic tests using fixtures and fake clocks; normal tests do not call live external APIs.

The implementation will use Node and Pi-provided modules only. It will add no production npm dependency.

## 5. Data model

A successful refresh produces one internal record:

```typescript
interface WeatherSnapshot {
  location: {
    city?: string;
    region?: string;
    country?: string;
    latitude: number;
    longitude: number;
    timezone?: string;
    displayName: string;
  };
  weather: {
    temperatureC: number;
    apparentTemperatureC: number;
    relativeHumidityPercent: number;
    weatherCode: number;
    windSpeedKmh: number;
    observedAt?: string;
  };
  fetchedAt: string;
}
```

`fetchedAt` is an ISO timestamp created only after both API requests succeed and all fields pass validation.

## 6. Lifecycle and non-blocking behavior

### 6.1 Session start

The extension acts only when `ctx.mode === "tui"`.

The `session_start` handler launches initialization without awaiting it. Therefore, Pi startup, editor input, and conversation are not delayed by cache I/O or network I/O.

Background initialization performs these steps:

1. Read the cache asynchronously.
2. If the cache age is strictly less than three hours, render it immediately.
3. If the cache is missing, malformed, or at least three hours old, delete or ignore it and keep the widget hidden.
4. Start a full IP-to-weather refresh in the background.
5. Start the 30-minute refresh schedule.

No loading widget, notification, dialog, status message, or visible error is shown.

### 6.2 Refresh concurrency

Only one complete refresh may run at a time. A refresh request arriving while another refresh is active is skipped. This applies to startup refreshes and scheduled refreshes.

Every successful refresh:

1. Replaces the in-memory snapshot.
2. Clears any stale-warning state.
3. Updates the widget.
4. Attempts to write the cache atomically through a temporary file and rename.
5. Reschedules the exact three-hour expiry timer from the new `fetchedAt` time.

A cache-write failure does not invalidate freshly fetched in-memory weather and does not hide the widget. It is caught silently; the current session continues using the fresh snapshot, while a later process restart simply has no updated cache to restore.

### 6.3 Scheduled refresh

A refresh attempt runs every 30 minutes for the lifetime of the active Pi session. Each attempt repeats the complete chain:

```text
public IP → approximate coordinates → current weather
```

Repeating geolocation allows the displayed location to follow a changed VPN or public network exit.

### 6.4 Session shutdown and reload

On `session_shutdown`, the extension must:

- Mark the extension instance as disposed.
- Abort the active request controller.
- Clear the 30-minute refresh timer.
- Clear the cache-expiry timer.
- Remove the widget.

Background completions must check the disposed state before modifying Pi UI or writing cache. Aborted operations must be caught so they do not create unhandled Promise rejections.

## 7. Cache policy

Cache path:

```text
${PI_CODING_AGENT_DIR:-~/.pi/agent}/cache/weather-widget.json
```

The path respects `PI_CODING_AGENT_DIR`; otherwise it uses Pi's default global configuration directory.

Validity is based only on `fetchedAt`:

- `age < 3 hours`: valid and displayable.
- `age >= 3 hours`: expired and not displayable.
- A `fetchedAt` timestamp more than five minutes in the future, an invalid date, malformed JSON, or invalid snapshot fields: invalid.
- A future timestamp within five minutes is tolerated as minor system clock skew, but its age is treated as zero rather than negative.

When an in-memory or cached snapshot reaches exactly three hours of age, an expiry timer hides the widget immediately and removes the expired cache. It does not wait for the next 30-minute refresh attempt.

The cache contains only the location fields, coordinates, current weather values, observed time, and successful fetch time. It does not store additional IP, device, request, or session data.

## 8. Failure behavior

### No valid snapshot

If there is no valid snapshot and any cache read, geolocation, weather, validation, timeout, or network operation fails:

- Keep the widget completely hidden.
- Do not display loading or error text.
- Do not block or interrupt the conversation.
- Retry silently at the next 30-minute interval.

### Valid snapshot available

If a refresh fails while the current snapshot is still less than three hours old:

- Keep displaying the snapshot.
- Append a low-emphasis warning pill: `⚠ 数据已过期`.
- Keep the original `fetchedAt`; a failed refresh never extends cache life.
- Hide the entire widget when the original snapshot reaches three hours old.

A later successful refresh removes the warning pill and resets the three-hour lifetime.

## 9. Widget visual design

The widget is installed with:

```text
ctx.ui.setWidget("weather-widget", ...)
```

The default placement is above the editor.

Example logical layout:

```text
[☀ 西安] [36°C] [体感 40°C] [炎热 · 湿度 61% · 风速 5 km/h]
```

Terminals cannot draw true web-style rounded corners. The Pi implementation therefore simulates compact labels with themed foreground colors, themed background colors, and one-cell horizontal padding.

The implementation uses Pi theme functions instead of hard-coded RGB values so it remains readable after theme changes. Rendered color strings are rebuilt or rendered fresh after invalidation; old ANSI colors must not be retained in cached component content.

### 9.1 Temperature bands

The temperature pill uses these exact boundaries:

| Temperature | Meaning | Theme treatment |
|---|---|---|
| `<= 0°C` | Ice cold | cool accent foreground and subdued cool background |
| `1–15°C` | Cool | accent/link-like foreground and selected/subdued background |
| `16–25°C` | Comfortable | success foreground and success background |
| `26–32°C` | Warm | warning foreground and pending/warning background |
| `33–37°C` | Hot | bold warning foreground and pending/warning background |
| `>= 38°C` | Extreme heat | bold error foreground and error background |

The apparent-temperature pill has lower visual emphasis than the actual-temperature pill.

### 9.2 Weather symbols and location pill

Use standard Unicode weather symbols that do not require a Nerd Font. The WMO code mapping covers all codes returned by Open-Meteo, including:

- Clear: `☀`
- Partly cloudy: `◒`
- Cloudy: `☁`
- Fog: `≋`
- Drizzle/rain: `☂`
- Snow: `❄`
- Thunderstorm: `⚡`
- Unknown fallback: `○`

The location pill's foreground follows the weather family: warm for clear, muted for cloud/fog, accent for rain, cool accent for snow, and error/warning for thunderstorms.

Descriptions are concise Chinese labels such as `晴`, `多云`, `雾`, `小雨`, `大雨`, `小雪`, and `雷暴`.

### 9.3 Numeric formatting

- Temperature and apparent temperature: rounded to the nearest whole degree and suffixed with `°C`.
- Relative humidity: rounded to a whole percent and clamped to the validated physical range before display.
- Wind speed: rounded to the nearest whole `km/h`.

## 10. Responsive rendering

The widget always renders one line. It composes independent ANSI-aware segments and checks their visible width rather than raw string length.

When width is insufficient, fields are removed in this order:

1. Wind speed.
2. Relative humidity.
3. Apparent temperature.
4. Weather description, only if still required.

The minimum intended display retains:

```text
[weather symbol + location] [actual temperature]
```

If even the minimum layout exceeds the available width, the location is ANSI-safely truncated while preserving the weather symbol and temperature. The implementation uses TUI width utilities such as `visibleWidth` and `truncateToWidth`; it must not slice raw ANSI strings.

## 11. Testing strategy

Tests use Node 24's built-in test runner and deterministic fixtures. Fake fetch functions, fake clocks, and fake timers isolate the tests from live services.

### API and validation tests

- Successful IPWhois response parsing.
- `success: false`, missing fields, non-numeric coordinates, and coordinate range failures.
- Successful Open-Meteo response parsing.
- Missing, non-finite, and malformed current-weather fields.
- Independent request timeout and external abort propagation.

### Weather mapping and formatting tests

- All supported WMO codes map to a Chinese description and symbol.
- Unknown code uses the fallback mapping.
- Every temperature boundary, including `0`, `1`, `15`, `16`, `25`, `26`, `32`, `33`, `37`, and `38`.
- Numeric rounding and units.
- Theme-role selection for cool, comfortable, warm, hot, and extreme heat.
- Responsive removal order at multiple terminal widths.
- ANSI-safe truncation of long location names.

### Cache tests

- Cache younger than three hours is valid.
- Cache at exactly three hours is invalid.
- Cache older than three hours is invalid.
- Malformed JSON, invalid dates, future timestamps, and invalid snapshot data are rejected.
- Cache writes are atomic.
- Expired cache is removed.

### Lifecycle tests

- `session_start` returns without awaiting cache or network work.
- No valid data means `setWidget` is not called with visible content.
- Valid cache is displayed before the network refresh completes.
- Failed refresh retains valid data and adds the stale warning.
- Three-hour expiry hides the widget immediately.
- Thirty-minute scheduling triggers refresh attempts.
- An active slow refresh prevents overlapping refreshes.
- Shutdown aborts network work, clears both timers, and removes the widget.
- Aborts and timeouts do not create unhandled rejections.

## 12. Manual acceptance criteria

The implementation is accepted when all of the following are demonstrated in a real Pi TUI:

1. `/reload` leaves the editor immediately usable and does not wait for either API.
2. With no valid cache, nothing is displayed before a successful weather response.
3. A successful response creates the colored label widget above the input editor.
4. Temperature colors change at the specified boundaries.
5. Narrowing the terminal removes fields in the specified order without broken ANSI output.
6. Changing Pi themes keeps the widget readable and updates its colors.
7. A simulated refresh failure preserves valid data with the stale-warning pill.
8. A snapshot disappears when it reaches three hours of age.
9. With no valid data and simulated network failure, the UI remains completely silent.
10. `/reload` and process exit leave no active request or extension timer.
11. The automated test suite passes.

## 13. Privacy and security

- IPWhois necessarily receives the caller's public IP to perform geolocation.
- Open-Meteo receives only latitude, longitude, requested weather fields, and normal HTTP metadata.
- The extension does not store the public IP.
- The extension sends no API key and performs no telemetry.
- API response structures are validated before use.
- Cache data is restricted to the minimum fields described above.
- Extension code runs with the user's Pi process permissions, consistent with Pi's extension security model.
