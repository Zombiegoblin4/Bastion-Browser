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

Note: Bastion can also auto-manage uBlock Origin updates at launch. Managed files are stored in your user profile, not in this folder.
