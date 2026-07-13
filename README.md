# Quota Float

适用于 Windows 和 macOS 的 Codex 额度桌面悬浮卡。它读取本机 Codex Desktop 的登录状态，实时显示服务端返回的额度窗口和重置时间。

## 功能

- 112×32 单行指标卡，常驻桌面并保持置顶，显示剩余百分比和紧凑重置倒计时。
- 支持拖动、托盘刷新和右键菜单；不提供展开详情窗口。
- 菜单栏/系统托盘同步显示当前主额度窗口的剩余额度。
- 支持中英文、自动刷新、额度状态和重置机会。
- 右键提供 Reload 与 Close。
- 不上传令牌、聊天内容或额度原始响应，不包含遥测。

## How It Works

Quota Float reads the existing Codex Desktop login state on your machine and queries Codex/ChatGPT quota endpoints with that session. It does not estimate usage from local token counts and does not redeem reset credits or modify account settings.

Browser preview uses mock data. Real quota reading requires the Tauri desktop app and an existing Codex Desktop login on the same machine.

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

- Reads the local Codex Desktop login state only to query Codex quota.
- Sends the existing Codex access token only to ChatGPT quota endpoints.
- Stores only widget preferences in its own app config directory.
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
