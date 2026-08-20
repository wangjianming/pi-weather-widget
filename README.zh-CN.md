# Pi 天气组件（weather-widget）

中文 | **[English](README.md)**

一个零配置的 [pi](https://github.com/earendil-works/pi-coding-agent) 全局扩展，在输入框上方用一行彩色文字显示当前天气。

它通过公网 IP 定位大致位置（使用 [IPWhois](https://ipwho.is/)），再从 [Open-Meteo](https://open-meteo.com/) 获取当前天气。**无需任何 API key。** 若 IP 定位不准（VPN/代理场景），可用 `/weather` 命令固定位置。

```
☀ 東京都 27°C 体感 31°C 大部晴朗 · 湿度 77% · 风速 5 km/h
```

## 功能特性

- **零配置** —— 无需 API key、无需设置，装好重载即可使用。
- **免疫 VPN 的 `/weather` 命令** —— 可固定城市或坐标，也可随时恢复 IP 自动定位。
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

## 固定位置（VPN / 代理场景）

公网 IP 指向 VPN 出口时，自动定位会显示错误的城市。用 `/weather` 斜杠命令修复（立即生效，无需重启）：

```
/weather set 上海        # 固定城市（经 Open-Meteo 免费地理编码 API 解析）
/weather set 8.8.8.8        # 或按公网 IP 解析并固定（经 IPWhois）
/weather set 31.23,121.47  # 或直接固定坐标
/weather auto           # 清除固定，恢复 IP 自动定位
/weather                 # 查看当前模式与固定位置
```

- 固定位置保存在 `${PI_CODING_AGENT_DIR:-~/.pi/agent}/weather-widget.json`（个人配置目录，不在本仓库内）。
- 固定后不再访问 IPWhois，只查询 Open-Meteo。
- 固定/自动模式切换或修改固定位置时，磁盘缓存立即失效并重新拉取。

## 切换气象模型

Open-Meteo 默认的 `best_match` 组合可能挑到不契合当地实况的模型（例如晴天午后报“大毛毛雨”——西安实测 MET Nordic 就出过这种幽灵毛毛雨）。用 `/weather model` 可以钉住底层数值模型：

```
/weather model                # 查看当前模型并列出全部可选模型
/weather model cma_grapes_global  # 切换（中国气象局 GRAPES，国内推荐）
/weather model best_match     # 或：/weather model auto —— 恢复默认组合
```

- 模型与固定位置存在同一配置文件中，固定定位与 IP 自动定位两种模式下均生效。
- 模型 ID 经过白名单校验，只收录任意坐标都返回数据且输出 WMO 天气代码的模型（`ecmwf_aifs025`/`gfs_graphcast025` 等 AI 模型、`gfs_hrrr` 等域内限定模型不收录）。
- 切换模型后缓存立即失效并重新拉取。

### 可选模型

| 模型 | 说明 |
| --- | --- |
| `best_match` | Open-Meteo 默认（按区域自动选模型） |
| `cma_grapes_global` | 中国气象局 GRAPES —— 国内推荐 |
| `ecmwf_ifs025` | 欧洲中期天气预报中心 IFS 0.25° |
| `gfs_seamless` | 美国 NCEP GFS |
| `icon_seamless` | 德国 ICON |
| `meteofrance_seamless` | 法国 ARPEGE/AROME |
| `jma_seamless` | 日本气象厅 GSM/MSM |
| `metno_seamless` | 挪威 MET 北欧模型 |
| `ukmo_seamless` | 英国气象局 UM |
| `gem_seamless` | 加拿大 GEM —— 全球可用，加拿大推荐 |
| `knmi_seamless` | 荷兰 KNMI HARMONIE（本域高分辨率，域外全球兑底） |
| `dmi_seamless` | 丹麦 DMI HARMONIE（本域高分辨率，域外全球兑底） |
| `meteoswiss_icon_seamless` | 瑞士气象局 ICON（本域高分辨率，域外全球兑底） |
| `geosphere_seamless` | 奥地利 GEORES AROME（本域高分辨率，域外全球兑底） |
| `chmi_aladin_seamless` | 捷克 ALADIN（本域高分辨率，域外全球兑底） |
| `arpae_cosmo_seamless` | 意大利 ARPAE COSMO（本域高分辨率，域外全球兑底） |

刻意不收录：不输出 WMO 天气代码的模型（`ecmwf_aifs025`、`gfs_graphcast025`、`kma_seamless`、`bom_access_global` 等 AI/新模型），以及无全球兑底的域内限定模型（`gfs_hrrr`、`italia_meteo_arpae_icon_2i`）——上述 `_seamless` 系列已把各自域拼好。

## 工作原理

| 文件 | 职责 |
| --- | --- |
| `index.ts` | 扩展入口；生命周期接线、组件渲染，并注册 `/weather` 命令 |
| `api.ts` | IPWhois + Open-Meteo + 地理编码客户端，严格校验响应，单请求 10 秒超时 |
| `config.ts` | 固定位置与模型的原子化持久化，及缓存/模式匹配 |
| `models.ts` | Open-Meteo 气象模型白名单 |
| `runtime.ts` | 刷新/过期调度、中止处理、过期兜底显示逻辑、强制刷新 |
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
