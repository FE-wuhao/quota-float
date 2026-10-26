# Security

## Supported Use

Quota Float is a local desktop utility that reads Sub2API Key quotas or official Codex quotas using the user's existing Codex Desktop login state.

## Reporting Issues

Please do not open public issues containing tokens, account IDs, raw backend responses, screenshots with personal data, or local file paths. Redact sensitive information before sharing logs or bug reports.

## Security Boundaries

- The app does not persist Codex credentials.
- Sub2API keys are stored in the OS credential store, isolated by service address, and are never returned by the settings-read command.
- Only the selected service receives its key. Changing the service address requires entering its corresponding key; HTTPS is required except for loopback endpoints.
- The app does not log request headers or raw quota responses.
- The app caps auth file reads at 256 KB and quota responses at 1 MB.
- The app does not follow redirects for quota HTTP requests.
- Switching configuration invalidates cached quota and separates stale snapshots so previous keys' balances are not reused.
- The app does not redeem reset credits or change account settings.

## Release Notes For Maintainers

Before publishing a release, verify:

- Source archives do not include local installers, build outputs, `.codex`, QA screenshots, or environment files.
- Windows/macOS bundles are built by CI or a clean machine.
- Unsigned builds are clearly labeled as unsigned.
- Signed releases are produced only with maintainer-controlled certificates and secrets.
