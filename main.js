"use strict";

const { app, BrowserWindow, dialog, ipcMain, session, shell } = require("electron");
const fs = require("fs");
const path = require("path");

let autoUpdater = null;
try {
  ({ autoUpdater } = require("electron-updater"));
} catch (_) {
  autoUpdater = null;
}

let mainWindow = null;
let loadedExtensions = [];
let downloadItems = [];
let browsingHistory = [];

const EXTENSIONS_DIR = path.join(__dirname, "extensions");
const START_URL = path.join(__dirname, "src", "index.html");

const TRACKER_HOST_RULES = [
  "doubleclick.net",
  "google-analytics.com",
  "googletagmanager.com",
  "googlesyndication.com",
  "adservice.google.com",
  "ads.yahoo.com",
  "facebook.net",
  "connect.facebook.net",
  "scorecardresearch.com",
  "hotjar.com",
  "segment.io",
  "mixpanel.com",
  "taboola.com",
  "outbrain.com",
  "adnxs.com",
  "criteo.com",
  "quantserve.com"
];

const TRACKER_RESOURCE_TYPES = new Set([
  "script",
  "image",
  "xhr",
  "fetch",
  "subFrame",
  "ping",
  "media",
  "font",
  "stylesheet",
  "object",
  "webSocket"
]);

const LOOPBACK_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]"
]);

const FINGERPRINTING_PERMISSIONS = new Set([
  "idle-detection",
  "window-management",
  "display-capture",
  "midi",
  "midiSysex",
  "midi-sysex",
  "pointerLock",
  "background-sync",
  "payment-handler",
  "speaker-selection"
]);

const ALLOWED_PERMISSIONS = new Set([
  "fullscreen",
  "notifications",
  "clipboard-read",
  "media"
]);

const DEFAULT_PRIVACY_CONFIG = {
  blockTrackers: true,
  upgradeHttps: true,
  sendDoNotTrack: true,
  sendGlobalPrivacyControl: true,
  blockThirdPartyCookies: true,
  blockFingerprintingPermissions: true,
  clearDataOnExit: false
};

const DEFAULT_UPDATE_CONFIG = {
  autoCheck: true,
  autoDownload: true,
  allowPrerelease: false,
  feedURL: ""
};

let privacyConfig = { ...DEFAULT_PRIVACY_CONFIG };
let updateConfig = { ...DEFAULT_UPDATE_CONFIG };
let privacyStats = createEmptyPrivacyStats();
let updateStatus = createInitialUpdateStatus();

let privacyNetworkConfigured = false;
let updaterConfigured = false;
let updaterEventsBound = false;
let updateCheckTimer = null;
let privacyStatsBroadcastTimer = null;

function createEmptyPrivacyStats() {
  return {
    blockedRequests: 0,
    upgradedToHttps: 0,
    strippedCookieHeaders: 0,
    blockedPermissions: 0,
    startedAt: Date.now()
  };
}

function createInitialUpdateStatus() {
  return {
    status: "idle",
    message: "Updater idle.",
    currentVersion: app.getVersion(),
    availableVersion: null,
    downloadedVersion: null,
    progressPercent: 0,
    checkedAt: null,
    isPackaged: app.isPackaged,
    error: null,
    updatedAt: Date.now()
  };
}

function readJsonFile(filePath, fallbackValue) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallbackValue;
    }

    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch (_) {
    return fallbackValue;
  }
}

function writeJsonFile(filePath, value) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
  } catch (_) {
    // Best-effort persistence.
  }
}

function sanitizeBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function sanitizeString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function getUserExtensionStorePath() {
  return path.join(app.getPath("userData"), "extension-paths.json");
}

function getDownloadsStorePath() {
  return path.join(app.getPath("userData"), "downloads.json");
}

function getHistoryStorePath() {
  return path.join(app.getPath("userData"), "history.json");
}

function getPrivacyStorePath() {
  return path.join(app.getPath("userData"), "privacy.json");
}

function getUpdateStorePath() {
  return path.join(app.getPath("userData"), "updates.json");
}

function sanitizePrivacyConfig(payload) {
  const raw = payload && typeof payload === "object" ? payload : {};
  return {
    blockTrackers: sanitizeBoolean(raw.blockTrackers, DEFAULT_PRIVACY_CONFIG.blockTrackers),
    upgradeHttps: sanitizeBoolean(raw.upgradeHttps, DEFAULT_PRIVACY_CONFIG.upgradeHttps),
    sendDoNotTrack: sanitizeBoolean(raw.sendDoNotTrack, DEFAULT_PRIVACY_CONFIG.sendDoNotTrack),
    sendGlobalPrivacyControl: sanitizeBoolean(
      raw.sendGlobalPrivacyControl,
      DEFAULT_PRIVACY_CONFIG.sendGlobalPrivacyControl
    ),
    blockThirdPartyCookies: sanitizeBoolean(
      raw.blockThirdPartyCookies,
      DEFAULT_PRIVACY_CONFIG.blockThirdPartyCookies
    ),
    blockFingerprintingPermissions: sanitizeBoolean(
      raw.blockFingerprintingPermissions,
      DEFAULT_PRIVACY_CONFIG.blockFingerprintingPermissions
    ),
    clearDataOnExit: sanitizeBoolean(raw.clearDataOnExit, DEFAULT_PRIVACY_CONFIG.clearDataOnExit)
  };
}

function sanitizeUpdateConfig(payload) {
  const raw = payload && typeof payload === "object" ? payload : {};
  return {
    autoCheck: sanitizeBoolean(raw.autoCheck, DEFAULT_UPDATE_CONFIG.autoCheck),
    autoDownload: sanitizeBoolean(raw.autoDownload, DEFAULT_UPDATE_CONFIG.autoDownload),
    allowPrerelease: sanitizeBoolean(raw.allowPrerelease, DEFAULT_UPDATE_CONFIG.allowPrerelease),
    feedURL: sanitizeString(raw.feedURL, DEFAULT_UPDATE_CONFIG.feedURL).trim()
  };
}

function getSavedUserExtensionPaths() {
  const storePath = getUserExtensionStorePath();
  const payload = readJsonFile(storePath, { paths: [] });
  if (!payload || !Array.isArray(payload.paths)) {
    return [];
  }

  return [...new Set(payload.paths)]
    .filter((item) => typeof item === "string")
    .filter((item) => item.trim().length > 0)
    .filter((item) => fs.existsSync(path.join(item, "manifest.json")));
}

function saveUserExtensionPath(extensionPath) {
  const normalized = path.resolve(extensionPath);
  const existing = getSavedUserExtensionPaths();
  if (existing.includes(normalized)) {
    return;
  }

  existing.push(normalized);
  writeJsonFile(getUserExtensionStorePath(), { paths: existing });
}

function removeUserExtensionPath(extensionPath) {
  const normalized = path.resolve(extensionPath);
  const existing = getSavedUserExtensionPaths();
  const filtered = existing.filter((item) => path.resolve(item) !== normalized);
  writeJsonFile(getUserExtensionStorePath(), { paths: filtered });
}

function sanitizeDownloadRecord(record) {
  return {
    id: String(record.id || ""),
    filename: String(record.filename || "unknown"),
    url: String(record.url || ""),
    state: String(record.state || "progressing"),
    receivedBytes: Number(record.receivedBytes || 0),
    totalBytes: Number(record.totalBytes || 0),
    savePath: String(record.savePath || ""),
    startedAt: Number(record.startedAt || Date.now()),
    endedAt: Number(record.endedAt || 0) || null
  };
}

function sanitizeHistoryEntry(entry) {
  return {
    url: String(entry.url || ""),
    title: String(entry.title || ""),
    visitedAt: Number(entry.visitedAt || Date.now())
  };
}

function persistDownloads() {
  writeJsonFile(getDownloadsStorePath(), { items: downloadItems.map(sanitizeDownloadRecord) });
}

function persistHistory() {
  writeJsonFile(getHistoryStorePath(), { items: browsingHistory.map(sanitizeHistoryEntry) });
}

function persistPrivacyConfig() {
  writeJsonFile(getPrivacyStorePath(), privacyConfig);
}

function persistUpdateConfig() {
  writeJsonFile(getUpdateStorePath(), updateConfig);
}

function loadPersistedState() {
  const downloadsPayload = readJsonFile(getDownloadsStorePath(), { items: [] });
  const historyPayload = readJsonFile(getHistoryStorePath(), { items: [] });
  const privacyPayload = readJsonFile(getPrivacyStorePath(), DEFAULT_PRIVACY_CONFIG);
  const updatePayload = readJsonFile(getUpdateStorePath(), DEFAULT_UPDATE_CONFIG);

  downloadItems = Array.isArray(downloadsPayload.items)
    ? downloadsPayload.items.map(sanitizeDownloadRecord).slice(0, 300)
    : [];

  browsingHistory = Array.isArray(historyPayload.items)
    ? historyPayload.items.map(sanitizeHistoryEntry).slice(0, 2000)
    : [];

  privacyConfig = sanitizePrivacyConfig(privacyPayload);
  updateConfig = sanitizeUpdateConfig(updatePayload);
}

function getWindow() {
  const focused = BrowserWindow.getFocusedWindow();
  return focused || mainWindow;
}

function sendWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("window:state", {
    isMaximized: mainWindow.isMaximized(),
    isFullscreen: mainWindow.isFullScreen()
  });
}

function sendDownloadUpdates() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send("downloads:updated", downloadItems);
}

function sendHistoryUpdates() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send("history:updated", browsingHistory);
}

function sendUpdateStatus() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send("updates:status", updateStatus);
}

function sendUpdateConfig() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send("updates:config", updateConfig);
}

function sendPrivacyConfig() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send("privacy:config", privacyConfig);
}

function sendPrivacyStats() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send("privacy:stats", privacyStats);
}

function queuePrivacyStatsBroadcast() {
  if (privacyStatsBroadcastTimer) {
    return;
  }

  privacyStatsBroadcastTimer = setTimeout(() => {
    privacyStatsBroadcastTimer = null;
    sendPrivacyStats();
  }, 220);
}

function incrementPrivacyStat(key) {
  if (!Object.prototype.hasOwnProperty.call(privacyStats, key) || typeof privacyStats[key] !== "number") {
    return;
  }
  privacyStats[key] += 1;
  queuePrivacyStatsBroadcast();
}

function setUpdateStatus(patch) {
  const next = patch && typeof patch === "object" ? patch : {};
  updateStatus = {
    ...updateStatus,
    ...next,
    currentVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    updatedAt: Date.now()
  };
  sendUpdateStatus();
}

function pushRuntimeStateToRenderer() {
  sendWindowState();
  sendDownloadUpdates();
  sendHistoryUpdates();
  sendUpdateStatus();
  sendUpdateConfig();
  sendPrivacyConfig();
  sendPrivacyStats();
}

function getExtensionByPath(extensionPath) {
  const normalized = path.resolve(extensionPath);
  return loadedExtensions.find((item) => path.resolve(item.path) === normalized) || null;
}

async function loadExtension(extensionPath, source = "User") {
  const existing = getExtensionByPath(extensionPath);
  if (existing) {
    return { ok: true, detail: existing };
  }

  try {
    const extension = await session.defaultSession.loadExtension(extensionPath, {
      allowFileAccess: true
    });

    const detail = {
      id: extension.id,
      name: extension.name || path.basename(extensionPath),
      version: extension.version || "unknown",
      source,
      path: extensionPath
    };

    const existingIndex = loadedExtensions.findIndex(
      (item) => item.id === detail.id || item.path === detail.path
    );

    if (existingIndex >= 0) {
      loadedExtensions[existingIndex] = detail;
    } else {
      loadedExtensions.push(detail);
    }

    return { ok: true, detail };
  } catch (error) {
    if (String((error && error.message) || "").includes("already loaded")) {
      return { ok: true, detail: getExtensionByPath(extensionPath) };
    }
    return { ok: false, error: error && error.message ? error.message : "Unknown extension load error" };
  }
}

async function loadBundledExtensions() {
  loadedExtensions = [];

  const candidates = [];

  if (fs.existsSync(EXTENSIONS_DIR)) {
    const bundled = fs
      .readdirSync(EXTENSIONS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(EXTENSIONS_DIR, entry.name))
      .filter((dirPath) => fs.existsSync(path.join(dirPath, "manifest.json")))
      .map((item) => ({ path: item, source: "Bundled" }));
    candidates.push(...bundled);
  }

  const userPaths = getSavedUserExtensionPaths().map((item) => ({
    path: item,
    source: "User"
  }));
  candidates.push(...userPaths);

  for (const candidate of candidates) {
    const result = await loadExtension(candidate.path, candidate.source);
    if (!result.ok && candidate.source === "User") {
      removeUserExtensionPath(candidate.path);
    }
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 980,
    minHeight: 640,
    show: false,
    backgroundColor: "#050a11",
    autoHideMenuBar: true,
    frame: false,
    title: "Bastion Browser",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
      spellcheck: true
    }
  });

  mainWindow.loadFile(START_URL);

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    pushRuntimeStateToRenderer();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("navigation:new-tab", url);
    }
    return { action: "deny" };
  });

  mainWindow.webContents.on("enter-html-full-screen", () => {
    if (mainWindow && !mainWindow.isFullScreen()) {
      mainWindow.setFullScreen(true);
    }
    sendWindowState();
  });

  mainWindow.webContents.on("leave-html-full-screen", () => {
    if (mainWindow && mainWindow.isFullScreen()) {
      mainWindow.setFullScreen(false);
    }
    sendWindowState();
  });

  mainWindow.on("maximize", sendWindowState);
  mainWindow.on("unmaximize", sendWindowState);
  mainWindow.on("enter-full-screen", sendWindowState);
  mainWindow.on("leave-full-screen", sendWindowState);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function createDownloadRecord(item) {
  return {
    id: `dl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    filename: item.getFilename(),
    url: item.getURL(),
    state: "progressing",
    receivedBytes: item.getReceivedBytes(),
    totalBytes: item.getTotalBytes(),
    savePath: item.getSavePath() || "",
    startedAt: Date.now(),
    endedAt: null
  };
}

function getDownloadById(id) {
  return downloadItems.find((item) => item.id === id) || null;
}

function wireDownloads() {
  session.defaultSession.on("will-download", (_event, item) => {
    const record = createDownloadRecord(item);
    downloadItems.unshift(record);
    downloadItems = downloadItems.slice(0, 300);
    persistDownloads();
    sendDownloadUpdates();

    item.on("updated", (_innerEvent, state) => {
      record.state = state === "interrupted" ? "interrupted" : "progressing";
      record.receivedBytes = item.getReceivedBytes();
      record.totalBytes = item.getTotalBytes();
      if (item.getSavePath()) {
        record.savePath = item.getSavePath();
      }
      persistDownloads();
      sendDownloadUpdates();
    });

    item.once("done", (_innerEvent, state) => {
      record.state = state;
      record.receivedBytes = item.getReceivedBytes();
      record.totalBytes = item.getTotalBytes();
      record.endedAt = Date.now();
      if (item.getSavePath()) {
        record.savePath = item.getSavePath();
      }

      persistDownloads();
      sendDownloadUpdates();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("downloads:done", record);
      }
    });
  });
}

function toUrlObject(input) {
  try {
    return new URL(String(input || ""));
  } catch (_) {
    return null;
  }
}

function getHostnameFromUrl(input) {
  const parsed = toUrlObject(input);
  return parsed ? parsed.hostname.toLowerCase() : "";
}

function getSiteKey(hostname) {
  const value = String(hostname || "").toLowerCase();
  if (!value) {
    return "";
  }

  if (LOOPBACK_HOSTS.has(value) || value.endsWith(".localhost")) {
    return value;
  }

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) {
    return value;
  }

  const parts = value.split(".").filter(Boolean);
  if (parts.length <= 2) {
    return value;
  }

  return parts.slice(-2).join(".");
}

function isThirdPartyRequest(requestUrl, initiatorUrl) {
  const requestHost = getHostnameFromUrl(requestUrl);
  const initiatorHost = getHostnameFromUrl(initiatorUrl);

  if (!requestHost || !initiatorHost) {
    return false;
  }

  return getSiteKey(requestHost) !== getSiteKey(initiatorHost);
}

function matchesTrackerHost(hostname) {
  const value = String(hostname || "").toLowerCase();
  if (!value) {
    return false;
  }

  return TRACKER_HOST_RULES.some((rule) => value === rule || value.endsWith(`.${rule}`));
}

function shouldBlockTrackerRequest(details) {
  if (!privacyConfig.blockTrackers) {
    return false;
  }

  const resourceType = String(details.resourceType || "");
  if (!TRACKER_RESOURCE_TYPES.has(resourceType)) {
    return false;
  }

  const host = getHostnameFromUrl(details.url);
  if (!host || !matchesTrackerHost(host)) {
    return false;
  }

  const initiator = typeof details.initiator === "string" ? details.initiator : "";
  if (!initiator) {
    return resourceType !== "mainFrame";
  }

  return isThirdPartyRequest(details.url, initiator);
}

function shouldUpgradeToHttps(rawUrl) {
  const parsed = toUrlObject(rawUrl);
  if (!parsed || parsed.protocol !== "http:") {
    return false;
  }

  const host = parsed.hostname.toLowerCase();
  if (!host || LOOPBACK_HOSTS.has(host) || host.endsWith(".localhost")) {
    return false;
  }

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return false;
  }

  return true;
}

function findHeaderKey(headers, name) {
  const target = String(name || "").toLowerCase();
  for (const key of Object.keys(headers || {})) {
    if (key.toLowerCase() === target) {
      return key;
    }
  }
  return null;
}

function setHeader(headers, name, value) {
  const key = findHeaderKey(headers, name) || name;
  headers[key] = value;
}

function removeHeader(headers, name) {
  const key = findHeaderKey(headers, name);
  if (key) {
    delete headers[key];
  }
}

function hasHeader(headers, name) {
  return Boolean(findHeaderKey(headers, name));
}

function configurePrivacyNetworkLayer() {
  if (privacyNetworkConfigured) {
    return;
  }

  const ses = session.defaultSession;

  ses.webRequest.onBeforeRequest((details, callback) => {
    try {
      if (shouldBlockTrackerRequest(details)) {
        incrementPrivacyStat("blockedRequests");
        callback({ cancel: true });
        return;
      }

      if (privacyConfig.upgradeHttps && shouldUpgradeToHttps(details.url)) {
        const redirectURL = String(details.url).replace(/^http:\/\//i, "https://");
        if (redirectURL !== details.url) {
          incrementPrivacyStat("upgradedToHttps");
          callback({ redirectURL });
          return;
        }
      }
    } catch (_) {
      // Fail open if privacy middleware cannot decide.
    }

    callback({});
  });

  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const requestHeaders = { ...(details.requestHeaders || {}) };

    if (privacyConfig.sendDoNotTrack) {
      setHeader(requestHeaders, "DNT", "1");
    } else {
      removeHeader(requestHeaders, "DNT");
    }

    if (privacyConfig.sendGlobalPrivacyControl) {
      setHeader(requestHeaders, "Sec-GPC", "1");
    } else {
      removeHeader(requestHeaders, "Sec-GPC");
    }

    if (
      privacyConfig.blockThirdPartyCookies &&
      hasHeader(requestHeaders, "Cookie") &&
      isThirdPartyRequest(details.url, details.initiator || "")
    ) {
      removeHeader(requestHeaders, "Cookie");
      incrementPrivacyStat("strippedCookieHeaders");
    }

    callback({ requestHeaders });
  });

  privacyNetworkConfigured = true;
}

function configurePermissions() {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    const requested = String(permission || "");

    if (privacyConfig.blockFingerprintingPermissions && FINGERPRINTING_PERMISSIONS.has(requested)) {
      incrementPrivacyStat("blockedPermissions");
      callback(false);
      return;
    }

    const allowed = ALLOWED_PERMISSIONS.has(requested);
    if (!allowed) {
      incrementPrivacyStat("blockedPermissions");
    }
    callback(allowed);
  });

  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    const requested = String(permission || "");
    if (privacyConfig.blockFingerprintingPermissions && FINGERPRINTING_PERMISSIONS.has(requested)) {
      return false;
    }
    return ALLOWED_PERMISSIONS.has(requested);
  });
}

function getUpdateVersion(updateInfo) {
  if (!updateInfo || typeof updateInfo !== "object") {
    return null;
  }

  if (typeof updateInfo.version === "string") {
    return updateInfo.version;
  }

  return null;
}

function getErrorMessage(error) {
  if (!error) {
    return "Unknown error";
  }

  if (typeof error === "string") {
    return error;
  }

  if (error && typeof error.message === "string" && error.message.trim()) {
    return error.message;
  }

  try {
    return JSON.stringify(error);
  } catch (_) {
    return "Unknown error";
  }
}

function resolveUpdateFeedURL() {
  const fromEnv = sanitizeString(process.env.BASTION_UPDATE_URL, "").trim();
  if (fromEnv) {
    return fromEnv;
  }
  return updateConfig.feedURL;
}

function bindUpdaterEvents() {
  if (!autoUpdater || updaterEventsBound) {
    return;
  }

  autoUpdater.on("checking-for-update", () => {
    setUpdateStatus({
      status: "checking",
      message: "Checking for updates...",
      error: null,
      checkedAt: Date.now(),
      progressPercent: 0
    });
  });

  autoUpdater.on("update-available", (info) => {
    const availableVersion = getUpdateVersion(info);
    setUpdateStatus({
      status: updateConfig.autoDownload ? "downloading" : "available",
      message: updateConfig.autoDownload
        ? "Update available. Downloading now..."
        : "Update available. Download is waiting.",
      availableVersion,
      downloadedVersion: null,
      checkedAt: Date.now(),
      error: null,
      progressPercent: 0
    });
  });

  autoUpdater.on("update-not-available", () => {
    setUpdateStatus({
      status: "idle",
      message: "You are running the latest version.",
      availableVersion: null,
      downloadedVersion: null,
      checkedAt: Date.now(),
      error: null,
      progressPercent: 0
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    const percent = Math.max(0, Math.min(100, Math.round(Number((progress && progress.percent) || 0))));
    setUpdateStatus({
      status: "downloading",
      message: `Downloading update (${percent}%)...`,
      progressPercent: percent,
      error: null
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    const downloadedVersion = getUpdateVersion(info);
    setUpdateStatus({
      status: "downloaded",
      message: "Update downloaded. Restart Bastion to install.",
      availableVersion: downloadedVersion || updateStatus.availableVersion,
      downloadedVersion,
      progressPercent: 100,
      error: null
    });
  });

  autoUpdater.on("error", (error) => {
    setUpdateStatus({
      status: "error",
      message: "Update check failed.",
      checkedAt: Date.now(),
      error: getErrorMessage(error)
    });
  });

  updaterEventsBound = true;
}

function configureUpdateSchedule() {
  if (updateCheckTimer) {
    clearInterval(updateCheckTimer);
    updateCheckTimer = null;
  }

  if (!autoUpdater || !updateConfig.autoCheck || !app.isPackaged) {
    return;
  }

  updateCheckTimer = setInterval(() => {
    checkForUpdates(false).catch(() => {
      // Already tracked in update status.
    });
  }, 6 * 60 * 60 * 1000);
}

function applyUpdaterConfig() {
  if (!autoUpdater) {
    return;
  }

  autoUpdater.autoDownload = updateConfig.autoDownload;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = updateConfig.allowPrerelease;

  const feedURL = resolveUpdateFeedURL();
  if (feedURL) {
    try {
      autoUpdater.setFeedURL({
        provider: "generic",
        url: feedURL
      });
    } catch (error) {
      setUpdateStatus({
        status: "error",
        message: "Invalid update feed URL.",
        error: getErrorMessage(error)
      });
    }
  }

  configureUpdateSchedule();
}

function configureAutoUpdater() {
  if (updaterConfigured) {
    applyUpdaterConfig();
    sendUpdateConfig();
    return;
  }

  if (!autoUpdater) {
    setUpdateStatus({
      status: "disabled",
      message: "Auto updater is unavailable. Install electron-updater dependency."
    });
    updaterConfigured = true;
    return;
  }

  bindUpdaterEvents();
  applyUpdaterConfig();

  if (!app.isPackaged) {
    setUpdateStatus({
      status: "idle",
      message: "Update checks run from packaged builds.",
      error: null
    });
  }

  updaterConfigured = true;
}

async function checkForUpdates(manual = false) {
  if (!autoUpdater) {
    return { ok: false, error: "Auto updater module unavailable." };
  }

  if (!app.isPackaged) {
    const error = "Updates can only be checked from packaged builds.";
    if (manual) {
      setUpdateStatus({
        status: "idle",
        message: error,
        checkedAt: Date.now(),
        error: null
      });
    }
    return { ok: false, error };
  }

  try {
    if (manual) {
      setUpdateStatus({
        status: "checking",
        message: "Checking for updates...",
        checkedAt: Date.now(),
        error: null
      });
    }

    const result = await autoUpdater.checkForUpdates();
    return {
      ok: true,
      updateInfo: result && result.updateInfo ? result.updateInfo : null
    };
  } catch (error) {
    const message = getErrorMessage(error);
    setUpdateStatus({
      status: "error",
      message: "Failed to check for updates.",
      checkedAt: Date.now(),
      error: message
    });
    return { ok: false, error: message };
  }
}

async function downloadAvailableUpdate() {
  if (!autoUpdater) {
    return { ok: false, error: "Auto updater module unavailable." };
  }

  if (!app.isPackaged) {
    return { ok: false, error: "Updates can only be downloaded from packaged builds." };
  }

  try {
    await autoUpdater.downloadUpdate();
    return { ok: true };
  } catch (error) {
    const message = getErrorMessage(error);
    setUpdateStatus({
      status: "error",
      message: "Failed to download update.",
      error: message
    });
    return { ok: false, error: message };
  }
}

function installDownloadedUpdate() {
  if (!autoUpdater) {
    return { ok: false, error: "Auto updater module unavailable." };
  }

  if (!app.isPackaged) {
    return { ok: false, error: "Updates can only be installed from packaged builds." };
  }

  if (updateStatus.status !== "downloaded") {
    return { ok: false, error: "No downloaded update is ready to install." };
  }

  setUpdateStatus({
    status: "installing",
    message: "Installing update and restarting..."
  });

  setImmediate(() => {
    try {
      autoUpdater.quitAndInstall(false, true);
    } catch (_) {
      // If install cannot start, next check can recover.
    }
  });

  return { ok: true };
}

function patchUpdateConfig(patch) {
  const raw = patch && typeof patch === "object" ? patch : {};
  updateConfig = sanitizeUpdateConfig({
    ...updateConfig,
    ...raw
  });
  persistUpdateConfig();
  applyUpdaterConfig();
  sendUpdateConfig();
  return updateConfig;
}

function patchPrivacyConfig(patch) {
  const raw = patch && typeof patch === "object" ? patch : {};
  privacyConfig = sanitizePrivacyConfig({
    ...privacyConfig,
    ...raw
  });
  persistPrivacyConfig();
  sendPrivacyConfig();
  return privacyConfig;
}

async function clearDataByScope(scope) {
  const value = String(scope || "all").toLowerCase();
  const allowedScopes = new Set(["all", "cache", "cookies", "storage", "history", "downloads"]);

  if (!allowedScopes.has(value)) {
    return { ok: false, error: "Unknown clear-data scope." };
  }

  const ses = session.defaultSession;
  const tasks = [];

  if (value === "all" || value === "cache") {
    tasks.push(ses.clearCache());
  }

  if (value === "all" || value === "cookies") {
    tasks.push(ses.clearStorageData({ storages: ["cookies"] }));
    tasks.push(ses.clearAuthCache());
  }

  if (value === "all" || value === "storage") {
    tasks.push(
      ses.clearStorageData({
        storages: [
          "appcache",
          "cachestorage",
          "filesystem",
          "indexdb",
          "localstorage",
          "serviceworkers",
          "shadercache",
          "websql"
        ]
      })
    );
  }

  await Promise.allSettled(tasks);

  if (value === "all" || value === "history") {
    browsingHistory = [];
    persistHistory();
    sendHistoryUpdates();
  }

  if (value === "all" || value === "downloads") {
    downloadItems = [];
    persistDownloads();
    sendDownloadUpdates();
  }

  return { ok: true, scope: value };
}

function clearDataOnExitBestEffort() {
  browsingHistory = [];
  persistHistory();
  downloadItems = [];
  persistDownloads();

  if (session.defaultSession) {
    session.defaultSession.clearCache().catch(() => {});
    session.defaultSession.clearStorageData().catch(() => {});
    session.defaultSession.clearAuthCache().catch(() => {});
  }
}

function wireIpc() {
  ipcMain.handle("window:minimize", () => {
    const win = getWindow();
    if (win) {
      win.minimize();
    }
  });

  ipcMain.handle("window:maximize-toggle", () => {
    const win = getWindow();
    if (!win) {
      return { isMaximized: false };
    }

    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
    sendWindowState();

    return { isMaximized: win.isMaximized() };
  });

  ipcMain.handle("window:close", () => {
    const win = getWindow();
    if (win) {
      win.close();
    }
  });

  ipcMain.handle("window:toggle-fullscreen", () => {
    const win = getWindow();
    if (!win) {
      return { isFullscreen: false };
    }

    win.setFullScreen(!win.isFullScreen());
    sendWindowState();

    return { isFullscreen: win.isFullScreen() };
  });

  ipcMain.handle("window:set-fullscreen", (_, value) => {
    const win = getWindow();
    if (!win) {
      return { isFullscreen: false };
    }

    win.setFullScreen(Boolean(value));
    sendWindowState();

    return { isFullscreen: win.isFullScreen() };
  });

  ipcMain.handle("window:state", () => {
    const win = getWindow();
    if (!win) {
      return { isMaximized: false, isFullscreen: false };
    }
    return {
      isMaximized: win.isMaximized(),
      isFullscreen: win.isFullScreen()
    };
  });

  ipcMain.handle("app:meta", () => {
    return {
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform
    };
  });

  ipcMain.handle("extensions:list", () => {
    return loadedExtensions;
  });

  ipcMain.handle("extensions:load-from-dialog", async () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { ok: false, error: "No active window." };
    }

    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Select Extension Folder",
      properties: ["openDirectory", "dontAddToRecent"]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, canceled: true };
    }

    const extensionPath = result.filePaths[0];
    const manifestPath = path.join(extensionPath, "manifest.json");
    if (!fs.existsSync(manifestPath)) {
      return {
        ok: false,
        error: "The selected folder is not a valid unpacked extension (manifest.json missing)."
      };
    }

    const loadResult = await loadExtension(extensionPath, "User");
    if (loadResult.ok) {
      saveUserExtensionPath(extensionPath);
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("extensions:updated", loadedExtensions);
    }

    return loadResult;
  });

  ipcMain.handle("downloads:list", () => {
    return downloadItems;
  });

  ipcMain.handle("downloads:show-in-folder", (_, id) => {
    const item = getDownloadById(id);
    if (!item || !item.savePath) {
      return { ok: false, error: "Download file path not available yet." };
    }

    shell.showItemInFolder(item.savePath);
    return { ok: true };
  });

  ipcMain.handle("downloads:open-file", async (_, id) => {
    const item = getDownloadById(id);
    if (!item || !item.savePath) {
      return { ok: false, error: "Download file path not available yet." };
    }

    const openResult = await shell.openPath(item.savePath);
    if (openResult) {
      return { ok: false, error: openResult };
    }

    return { ok: true };
  });

  ipcMain.handle("downloads:clear-completed", () => {
    const terminalStates = new Set(["completed", "cancelled", "interrupted"]);
    downloadItems = downloadItems.filter((item) => !terminalStates.has(item.state));
    persistDownloads();
    sendDownloadUpdates();
    return { ok: true, remaining: downloadItems.length };
  });

  ipcMain.handle("history:list", () => {
    return browsingHistory;
  });

  ipcMain.handle("history:append", (_, entry) => {
    if (!entry || typeof entry.url !== "string") {
      return { ok: false, error: "Invalid history entry." };
    }

    const sanitized = sanitizeHistoryEntry(entry);
    if (!sanitized.url || sanitized.url === "about:blank") {
      return { ok: false, error: "Ignored empty history URL." };
    }

    const last = browsingHistory[0];
    if (!last || last.url !== sanitized.url) {
      browsingHistory.unshift(sanitized);
      browsingHistory = browsingHistory.slice(0, 2000);
      persistHistory();
      sendHistoryUpdates();
    }

    return { ok: true };
  });

  ipcMain.handle("history:clear", () => {
    browsingHistory = [];
    persistHistory();
    sendHistoryUpdates();
    return { ok: true };
  });

  ipcMain.handle("updates:get-status", () => {
    return updateStatus;
  });

  ipcMain.handle("updates:get-config", () => {
    return updateConfig;
  });

  ipcMain.handle("updates:check", () => {
    return checkForUpdates(true);
  });

  ipcMain.handle("updates:download", () => {
    return downloadAvailableUpdate();
  });

  ipcMain.handle("updates:install", () => {
    return installDownloadedUpdate();
  });

  ipcMain.handle("updates:update-config", (_, patch) => {
    const config = patchUpdateConfig(patch);
    return { ok: true, config, status: updateStatus };
  });

  ipcMain.handle("privacy:get-config", () => {
    return privacyConfig;
  });

  ipcMain.handle("privacy:get-stats", () => {
    return privacyStats;
  });

  ipcMain.handle("privacy:update-config", (_, patch) => {
    const config = patchPrivacyConfig(patch);
    return { ok: true, config };
  });

  ipcMain.handle("privacy:clear-data", (_, scope) => {
    return clearDataByScope(scope);
  });
}

app.whenReady().then(async () => {
  loadPersistedState();
  wireIpc();
  configurePrivacyNetworkLayer();
  configurePermissions();
  wireDownloads();
  configureAutoUpdater();
  await loadBundledExtensions();
  createWindow();

  if (updateConfig.autoCheck) {
    checkForUpdates(false).catch(() => {
      // Status update already handled by updater events.
    });
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("before-quit", () => {
  if (updateCheckTimer) {
    clearInterval(updateCheckTimer);
    updateCheckTimer = null;
  }

  if (privacyConfig.clearDataOnExit) {
    clearDataOnExitBestEffort();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
