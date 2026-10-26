# Privacy

Quota Float is designed to be local-first and minimal.

## What It Reads

- The app reads the local Codex Desktop login file from `CODEX_HOME/auth.json` or the user's `.codex/auth.json`.
- The app sends the existing Codex access token only to the ChatGPT quota endpoints needed to read Codex usage.
- The app may read the account identifier from the login file or token payload only to set the request header expected by the quota service.
- These Codex login reads occur only in official Codex mode. In Sub2API mode, the app reads the API key configured for the selected service from the OS credential store.

## What It Stores

Quota Float stores non-secret settings in its own application config directory:

- locked state
- always-on-top state
- pinned provider
- auto-rotate interval
- language, quota source, Sub2API service address, and selected quota period

Sub2API API keys are stored in Windows Credential Manager or macOS Keychain, with separate entries for each normalized service address. They are not written to settings JSON, browser storage, or logs, and the settings page never reads the stored key back into its input. Replacing the service address requires entering its key again. Closing the settings window clears its input state. Credential entries for previously configured services remain in the OS store until removed there.

It does not copy or persist Codex tokens, account IDs, raw quota responses, user prompts, chat history, or local file paths.

## What It Sends

The app calls the selected source's quota-related endpoints from the local desktop process:

- `https://chatgpt.com/backend-api/wham/usage`
- `https://chatgpt.com/backend-api/wham/rate-limit-reset-credits`
- The configured Sub2API service's `/v1/usage`, using its API key. HTTPS is required except for loopback services; redirects are not followed. “Test query” performs the same read without saving a new configuration.

No telemetry, analytics, crash reporting, or third-party tracking is included.

## Logging

Logs are intentionally generic. They must not include tokens, account IDs, raw backend responses, request headers, local auth paths, or personal file paths.

## Accuracy Boundary

Quota Float displays quota windows returned by the selected service. Sub2API mode uses only explicit Key limits, not shared wallet or subscription balances. Auto mode selects the lowest remaining percentage among the Key's returned limits. It does not estimate quota from local token usage or fabricate values when the response shape is unknown. Browser preview uses mock data without saving or transmitting a Key.
