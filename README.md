# Bastion Browser

Bastion Browser is a custom desktop web browser built with Electron and Chromium.

It includes:

- DuckDuckGo as the default search engine
- Fullscreen support (including site-driven fullscreen on pages like YouTube)
- A clean browser UI with tabs, bookmarks, and custom window controls
- Tab favicons, loading progress bar, and reopen closed tab support
- Local pages: `about:settings`, `about:downloads`, `about:history`, `about:game`
- Offline built-in game at `about:game`
- Disk persistence for downloads and browsing history
- Chrome extension loading support for unpacked extensions
- Local auto-update controls (Electron/Chromium runtime updates)
- Privacy controls (tracker blocking, HTTPS upgrades, DNT/GPC, third-party cookie stripping)
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

Or use commands:

```powershell
npm.cmd install
npm.cmd run dist
```

Build output names:

- `dist/Bastion-Browser-<version>-x64-Setup.exe`
- `dist/Bastion-Browser-<version>-x64-Portable.exe`

## Extension Support

Bastion Browser can load unpacked Chrome extensions:

- Put extension folders under `extensions/` before launch, or
- Open `about:settings` and click `Load Extension Folder`

Each extension folder must include `manifest.json`.

Note: Electron does not guarantee support for every Chrome extension API. Many extensions work, but some may be partially supported.

## Auto Update Feed

Set an update feed URL in `about:settings` or with:

```powershell
$env:BASTION_UPDATE_URL="https://updates.example.com/bastion/win/"
```

Auto-update checks run in packaged builds (`.exe`), not in dev source mode.

## Project Structure

- `main.js`: Electron main process (windowing, extension loading, IPC)
- `preload.js`: Safe API bridge from main process to renderer
- `src/index.html`: Browser UI shell
- `src/styles.css`: UI design and animation system
- `src/renderer.js`: Tabs, navigation, local pages, history, downloads, bookmarks
- `launch-bastion.bat`: One-click run script
- `build-bastion-exe.bat`: One-click build script
