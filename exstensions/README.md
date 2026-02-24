# Extensions Folder

Place unpacked Chrome extensions in this folder to load them on startup.

Each extension must be in its own subfolder and include `manifest.json`.

Example:

```
extensions/
  my-extension/
    manifest.json
    background.js
    ...
```

You can also load extension folders while the app is running from:

`Settings -> Extensions -> Load Extension Folder`
