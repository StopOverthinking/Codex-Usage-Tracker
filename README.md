[한국어 README 보기](README.ko.md)

# Codex Usage Tracker

A Stream Deck plugin that shows your local Codex usage limits on a key. It displays both the 5-hour and weekly usage windows, plus plan and reset details.

## Features

- Shows remaining Codex usage for the 5-hour and weekly windows.
- Short press switches between the usage view and the details view.
- Long press refreshes the usage data immediately.
- Supports custom Codex binary paths.
- Includes fallbacks for Windows Store installs and stale local session snapshots.

## Requirements

- Elgato Stream Deck 7.1 or newer.
- Windows 10 or newer, or macOS 12 or newer.
- A local `codex` installation that supports `codex app-server`.
- An active Codex login on the same machine.

## Installation

Download `com.codexusage.tracker.streamDeckPlugin` from the latest GitHub release and open it. Stream Deck will import the plugin automatically.

After installation, add the **Codex Overview** action to a key. If Codex is not found automatically, open the action settings and set the full path to your `codex` executable.

## Data Source

The plugin starts Codex locally with:

```powershell
codex app-server --listen stdio://
```

It then calls:

```text
account/rateLimits/read
```

The plugin does not read or log token values from `~/.codex/auth.json`.

If the local Codex app-server is unavailable, the optional session-file fallback reads the latest recorded rate-limit snapshot from `~/.codex/sessions`. Values from this fallback are marked as stale.

On Windows Store installs, direct execution from `C:\Program Files\WindowsApps` can be blocked by the operating system. When enabled, the WindowsApps fallback copies the Codex binary into `~/.codex-streamdeck-usage/codex-bin/` and runs that copy.

## Settings

- **Codex path**: optional custom path to the `codex` executable.
- **Refresh**: automatic refresh interval, or manual-only mode.
- **Limit bucket**: rate-limit bucket id. The default is `codex`.
- **Screen**: usage view or details view.
- **Allow WindowsApps copy fallback**: helps with Microsoft Store Codex installs.
- **Use session-file fallback**: shows the most recent local snapshot if the app-server call fails.

## Development

Install dependencies:

```powershell
npm install
```

Build, validate, and package the plugin:

```powershell
npm run clean
npm run validate
npm run pack
```

Run a direct Codex API smoke test:

```powershell
npm run smoke -- "C:\path\to\codex.exe"
```

The packaged plugin is written to:

```text
dist/com.codexusage.tracker.streamDeckPlugin
```

## Release

Release assets should include the packaged `.streamDeckPlugin` file from `dist/`. Source files, `node_modules`, and build intermediates are not required for end users.
