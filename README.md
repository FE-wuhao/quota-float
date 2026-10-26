# Quota Float

适用于 Windows 和 macOS 的额度桌面悬浮卡。支持 Sub2API 的 API Key 独立额度，也可以读取本机 Codex Desktop 登录账号的官方额度。

## 功能

- 按内容自动缩放的极简悬浮条，默认字号下余额示例约 64×24、剩余比例约 45×24；支持仅托盘模式。
- 支持拖动、托盘刷新和右键菜单；不提供展开详情窗口。
- 菜单栏/系统托盘用数字图标显示剩余比例或简写余额，悬停查看完整值。
- 支持中英文、自动刷新、额度状态和重置机会。
- 双击刷新额度，右键可重载或收进系统托盘；托盘单击打开设置。
- 悬浮窗右键或托盘菜单打开设置，可修改服务地址、API Key 和展示周期，支持测试查询。
- “展示与外观”支持字号、背景不透明度、状态圆点、重置倒计时、刷新按钮、置顶和鼠标穿透；保存后重启保留。
- Sub2API 支持总额度、5 小时、每日、每周额度；自动模式显示剩余比例最低的一项。Key 没有独立限额时，显示它对应账户或订阅的剩余金额。
- 不上传令牌、聊天内容或额度原始响应，不包含遥测。

## How It Works

在设置的“展示与外观”页签选择“极简悬浮条 + 数字托盘”或“仅数字托盘”，点击“保存展示设置”应用。默认只显示余额或剩余比例，重置时间和刷新按钮可按需开启。悬停悬浮条查看详细额度，双击刷新；托盘右键可恢复悬浮条或解除鼠标穿透。开机启动仍在托盘右键菜单设置。

窗口宽高随内容和字号调整，显示模式、外观及位置保存在本机。仅托盘模式会继续刷新额度；托盘余额为舍入或简写值（例如 `370`、`1.2k`），币种和完整金额以悬停提示为准。

首次启动会打开设置。选择 Sub2API，填写服务根地址（或 `/v1` 地址）及自己的 API Key，点击“测试查询”或“保存并刷新”。以后可从悬浮窗右键或托盘的“设置 / Settings…”更换 Key。保存后显示“已保存”和遮罩提示；切换到官方来源再切回、关闭设置或重启应用，均保留原服务的 Key，无需重新填写。已保存的 Key 不会回填到输入框，留空保留，输入新 Key 可替换；更换服务地址时必须重新输入对应 Key。

Sub2API 模式通过 `GET /v1/usage` 读取当前 Key 的 `quota` 和 `rate_limits`，按“剩余 / 上限”计算百分比。总额度没有自动重置倒计时，周期额度仅使用接口返回的重置时间。自动模式下，Key 没有独立限额时显示接口返回的对应账户或订阅余额，并标明来源；没有上限时直接显示金额，不编造百分比。多个 Key 若属于同一账户，可能显示同一份余额。不会将官方总剩余量除以三来估算份额。Key 已过期时仍可显示接口允许查询的额度记录，但不代表该 Key 可继续调用。

API Key 保存在系统凭据库（Windows Credential Manager / macOS Keychain），按服务地址隔离。配置文件仅保存来源、服务地址和展示周期。请求不跟随重定向，仅支持 HTTPS（本机地址可用 HTTP）。

Sub2API 默认直接连接服务；需要代理的服务可在设置中切换为“跟随系统代理”。切换连接方式不需要重新输入已保存的 Key。网络错误会区分超时、DNS 和证书校验问题；不会跳过 TLS 证书校验。

官方 Codex 模式读取本机现有登录状态，调用 Codex/ChatGPT 额度接口。两种模式都不估算本地 token、不兑换重置机会、不修改服务端额度。

浏览器预览使用示例数据，不保存或发送输入的 Key。真实额度查询和凭据保存需要 Tauri 桌面程序；官方模式还需要本机已登录 Codex Desktop。

## 下载与安装

- 最新版本：https://github.com/FE-wuhao/quota-float/releases/latest
- Windows：下载 `quota-float-windows-unsigned.zip`，解压后运行其中的安装程序。
- macOS Intel/Apple Silicon：下载 `quota-float-macos-universal-unsigned.zip`，解压后把 `Quota Float.app` 放进“应用程序”。

也可以把下面这句话直接发给 Codex：

```text
请安装 https://github.com/FE-wuhao/quota-float/releases/latest 中适合当前系统的 Quota Float。
```

发布包目前未签名。Windows 可能显示 SmartScreen，macOS 可能提示开发者无法验证；仅在确认下载来源是本仓库后允许运行。

## Feedback

请通过 https://github.com/FE-wuhao/quota-float/issues 提交问题。

## Privacy Boundary

Quota Float is local-first and intentionally narrow:

- In official mode, reads the local Codex Desktop login state and sends that token only to ChatGPT quota endpoints.
- In Sub2API mode, sends the configured API key only to the configured service's `/v1/usage` endpoint.
- Stores non-secret widget and quota settings in its own app config directory; stores API keys in the OS credential store, isolated by service address.
- Does not store Codex tokens, account IDs, prompts, chat history, raw quota responses, or local auth paths.
- Does not include telemetry, analytics, crash reporting, or third-party tracking.
- Does not redeem reset credits or modify account settings.

See [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md) for the full boundary.

## Accuracy Boundary

Codex quota is read from Codex/ChatGPT quota service responses. If the response format changes, the app shows an unavailable or stale state instead of inventing quota values.

## Development

Requirements:

- Node.js 20+
- Rust stable
- Tauri 2 system dependencies for your platform

```bash
npm install
npm run dev
npm run test
npm run build
npm run tauri dev
```

## Build

```bash
npm run package
```

On Windows, Tauri may download WiX to create an MSI installer. If WiX download fails, the release executable may still be produced at:

```text
src-tauri/target/release/quota-float.exe
```

## Release

GitHub Actions are configured for:

- CI on push/PR: frontend tests, Rust tests, web build, Tauri build.
- `v*` tags: unsigned Windows and macOS Universal bundle artifacts and a public GitHub Release.

See [docs/GITHUB-RELEASE-CHECKLIST.md](docs/GITHUB-RELEASE-CHECKLIST.md) before publishing a version for others.

Do not upload local credentials, `.codex`, `.env*`, screenshots with personal data, `node_modules`, `dist`, `src-tauri/target`, or local installers to source control.

## License

MIT
