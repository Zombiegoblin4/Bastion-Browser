# Bastion Browser v0.4.0

Bastion Browser is a custom desktop web browser built with Electron and Chromium.

It includes:

- DuckDuckGo as the default search engine
- Fullscreen support (including site-driven fullscreen on pages like YouTube)
- A clean browser UI with tabs, bookmarks, and custom window controls
- Customizable built-in new tab page (`about:newtab`) with quick links
- Tab favicons, loading progress bar, and reopen closed tab support
- Local pages: `about:settings`, `about:downloads`, `about:history`, `about:game`
- Offline built-in game at `about:game`
- Disk persistence for downloads and browsing history
- Chrome extension loading support for unpacked extensions
- Local auto-update controls (Electron/Chromium runtime updates + GitHub ZIP updater)
- Startup update-check mini window (app/chromium/extensions status)
- Managed uBlock Origin install + auto-check/update on startup
- Privacy controls (tracker blocking, HTTPS upgrades, DNT/GPC, third-party cookie/referer stripping)
- Windows `.bat` launcher and `.exe` packaging setup

## Requirements

- Windows 10/11
- Node.js LTS (https://nodejs.org/)

## Run From Source

1. Open `launch-bastion.bat`
2. The script installs dependencies automatically on first run
3. Bastion Browser launches

Or use commands:

```powershell
npm.cmd install
npm.cmd start
```

## Build EXE

1. Open `build-bastion-exe.bat`
2. Setup + portable builds are generated in `dist/`
3. `dist/update.zip` is generated automatically for GitHub release publishing

Or use commands:

```powershell
npm.cmd install
npm.cmd run dist
```

Build output names:

- `dist/Bastion-Browser-<version>-x64-Setup.exe`
- `dist/Bastion-Browser-<version>-x64-Portable.exe`
- `dist/update.zip`

## Extension Support

Bastion Browser can load unpacked Chrome extensions:

- Put extension folders under `extensions/` before launch, or
- Open `about:settings` and click `Load Extension Folder`

Each extension folder must include `manifest.json`.

Note: Electron does not guarantee support for every Chrome extension API. Many extensions work, but some may be partially supported.

## Auto Update

Bastion can run two updater modes from `about:settings`:

- GitHub release ZIP updater (default): checks the latest tag from `https://github.com/Zombiegoblin4/Bastion-Browser/releases/tags` and downloads `update.zip` on launch when auto-check is enabled.
- GitHub release ZIP auto-apply: after download, Bastion can automatically extract `update.zip`, launch the included updater executable, and exit.
- Electron updater feed: checks a generic update feed URL.
- Managed extension updater: checks uBlock Origin releases and installs the latest Chromium extension package at launch.

Set a generic feed URL with:

```powershell
$env:BASTION_UPDATE_URL="https://updates.example.com/bastion/win/"
```

Optional environment overrides for GitHub mode:

```powershell
$env:BASTION_GITHUB_RELEASES_API_URL="https://api.github.com/repos/Zombiegoblin4/Bastion-Browser/releases"
$env:BASTION_GITHUB_RELEASES_TAGS_URL="https://github.com/Zombiegoblin4/Bastion-Browser/releases/tags"
$env:BASTION_GITHUB_UPDATE_ASSET_NAME="update.zip"
```

Optional environment overrides for managed uBlock Origin updates:

```powershell
$env:BASTION_UBLOCK_RELEASES_API_URL="https://api.github.com/repos/gorhill/uBlock/releases"
$env:BASTION_UBLOCK_RELEASES_PAGE_URL="https://github.com/gorhill/uBlock/releases"
```

## Project Structure

- `main.js`: Electron main process (windowing, extension loading, IPC)
- `preload.js`: Safe API bridge from main process to renderer
- `src/index.html`: Browser UI shell
- `src/styles.css`: UI design and animation system
- `src/renderer.js`: Tabs, navigation, local pages, history, downloads, bookmarks
- `launch-bastion.bat`: One-click run script
- `build-bastion-exe.bat`: One-click build script

## Screenshots
- newtab
<img width="2221" height="1368" alt="Schermafbeelding 2026-02-25 130024" src="https://github.com/user-attachments/assets/0a02310e-0224-4d9b-9c99-78880a3b7dcf" />
- settings
<img width="2222" height="1357" alt="Schermafbeelding 2026-02-25 130311" src="https://github.com/user-attachments/assets/ad659554-251d-46fe-8629-85f9cf72fc2c" />
- downloads
<img width="2251" height="1360" alt="Schermafbeelding 2026-02-25 130405" src="https://github.com/user-attachments/assets/77da0906-ced9-4462-bff6-1791d66cd431" />
more screenshots comming soon
  
