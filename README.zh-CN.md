# Pi 天气组件（weather-widget）

中文 | **[English](README.md)**

一个零配置的 [pi](https://github.com/earendil-works/pi-coding-agent) 全局扩展，在输入框上方用一行彩色文字显示当前天气。

它通过公网 IP 定位大致位置（使用 [IPWhois](https://ipwho.is/)），再从 [Open-Meteo](https://open-meteo.com/) 获取当前天气。**无需任何 API key。**

```
☀ 東京都 27°C 体感 31°C 大部晴朗 · 湿度 77% · 风速 5 km/h
```

## 功能特性

- **零配置** —— 无需 API key、无需设置，装好重载即可使用。
- **不阻塞** —— 缓存与网络请求全部在后台进行，绝不拖慢 pi 启动和对话。
- **自动刷新** —— 每 30 分钟完整刷新一次「IP → 位置 → 天气」链路。
- **本地缓存** —— 结果写入磁盘缓存，3 小时以内直接复用。
- **优雅降级** —— 刷新失败时继续显示有效期内的天气并标注 `⚠ 数据已过期`；没有有效数据时整个组件静默隐藏。
- **自适应宽度** —— 终端变窄时按「风速 → 湿度 → 体感温度 → 天气描述」顺序依次省略字段。
- **彩色显示** —— 图标与颜色随天气类型（晴/云/雾/雨/雪/雷暴）和温度档位（严寒→酷热）变化，并跟随 pi 当前主题。
- **安全渲染** —— 远端或缓存文本中的终端控制字符会被拒绝渲染。

仅支持 pi 的 TUI 模式；`print` 与 JSON 模式不会启动任何天气任务。

## 环境要求

- 支持扩展的 pi（coding agent）
- Node.js ≥ 24

## 安装

把仓库克隆到 pi 的全局扩展目录：

```bash
git clone https://github.com/wangjianming/pi-weather-widget.git ~/.pi/agent/extensions/pi-weather-widget
```

然后重启 pi，或在会话中执行 `/reload`。

卸载时删除该目录并再次 `/reload` 即可。

## 工作原理

| 文件 | 职责 |
| --- | --- |
| `index.ts` | 扩展入口；把生命周期接到 `session_start` / `session_shutdown`，并渲染组件 |
| `api.ts` | IPWhois + Open-Meteo 客户端，严格校验响应，单请求 10 秒超时 |
| `runtime.ts` | 刷新/过期调度、中止处理、过期兜底显示逻辑 |
| `cache.ts` | 原子化（临时文件 + rename）JSON 缓存，严格 3 小时有效期 |
| `formatter.ts` | 自适应宽度的单行彩色渲染 |
| `weather-codes.ts` | WMO 天气代码 → 图标 / 描述 / 类型 的映射 |
| `types.ts` | 共享类型与终端安全文本规范化 |

启动时的数据流：

1. 读取缓存；若未过期（< 3 小时）立即显示。
2. 后台刷新；成功后更新显示并重写缓存。
3. 失败时继续显示缓存天气并标注过期，直到超出有效期；随后隐藏组件并删除缓存。
4. 每 30 分钟重复刷新。

## 测试

测试套件零外部依赖（仅 Node 内置模块）：

```bash
npm test
```

## 隐私与缓存

- 缓存路径：`${PI_CODING_AGENT_DIR:-~/.pi/agent}/cache/weather-widget.json`
- 缓存只保存大致位置、坐标、当前天气、观测时间和抓取时间。
- 绝不保存公网 IP、API key、pi 消息或遥测数据。
- IPWhois 会看到你的公网 IP；Open-Meteo 收到的是解析后的坐标及正常 HTTP 元数据。
- 基于 IP 的定位是近似的，可能反映 VPN、代理或运营商出口位置。

## 许可证

[MIT](LICENSE) © 2026 wangjianming
