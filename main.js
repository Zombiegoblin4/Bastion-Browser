"use strict";

const { app, BrowserWindow, dialog, ipcMain, session, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");
const { execFile, spawn } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

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
const GITHUB_RELEASES_API_URL = "https://api.github.com/repos/Zombiegoblin4/Bastion-Browser/releases";
const GITHUB_RELEASES_TAGS_PAGE_URL = "https://github.com/Zombiegoblin4/Bastion-Browser/releases/tags";
const GITHUB_UPDATE_ASSET_NAME = "update.zip";

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
  feedURL: "",
  useGithubReleaseZip: true,
  autoApplyGithubZip: true
};

let privacyConfig = { ...DEFAULT_PRIVACY_CONFIG };
let updateConfig = { ...DEFAULT_UPDATE_CONFIG };
let privacyStats = createEmptyPrivacyStats();
let updateStatus = createInitialUpdateStatus();
let githubUpdateMetadata = createInitialGitHubUpdateMetadata();

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
    source: "none",
    availableVersion: null,
    downloadedVersion: null,
    updateFilePath: null,
    releasePage: null,
    progressPercent: 0,
    checkedAt: null,
    isPackaged: app.isPackaged,
    error: null,
    updatedAt: Date.now()
  };
}

function createInitialGitHubUpdateMetadata() {
  return {
    lastTag: "",
    filePath: "",
    downloadedAt: 0,
    sizeBytes: 0,
    assetName: GITHUB_UPDATE_ASSET_NAME,
    releasePage: "",
    lastAppliedTag: "",
    appliedAt: 0
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

function getGitHubUpdateMetaStorePath() {
  return path.join(app.getPath("userData"), "github-release-update.json");
}

function getGitHubUpdateDownloadDir() {
  return path.join(app.getPath("userData"), "updates");
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
    feedURL: sanitizeString(raw.feedURL, DEFAULT_UPDATE_CONFIG.feedURL).trim(),
    useGithubReleaseZip: sanitizeBoolean(
      raw.useGithubReleaseZip,
      DEFAULT_UPDATE_CONFIG.useGithubReleaseZip
    ),
    autoApplyGithubZip: sanitizeBoolean(
      raw.autoApplyGithubZip,
      DEFAULT_UPDATE_CONFIG.autoApplyGithubZip
    )
  };
}

function sanitizeGitHubUpdateMetadata(payload) {
  const raw = payload && typeof payload === "object" ? payload : {};
  return {
    lastTag: sanitizeString(raw.lastTag, ""),
    filePath: sanitizeString(raw.filePath, ""),
    downloadedAt: Number(raw.downloadedAt || 0),
    sizeBytes: Number(raw.sizeBytes || 0),
    assetName: sanitizeString(raw.assetName, GITHUB_UPDATE_ASSET_NAME),
    releasePage: sanitizeString(raw.releasePage, ""),
    lastAppliedTag: sanitizeString(raw.lastAppliedTag, ""),
    appliedAt: Number(raw.appliedAt || 0)
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

function persistGitHubUpdateMetadata() {
  writeJsonFile(getGitHubUpdateMetaStorePath(), githubUpdateMetadata);
}

function loadPersistedState() {
  const downloadsPayload = readJsonFile(getDownloadsStorePath(), { items: [] });
  const historyPayload = readJsonFile(getHistoryStorePath(), { items: [] });
  const privacyPayload = readJsonFile(getPrivacyStorePath(), DEFAULT_PRIVACY_CONFIG);
  const updatePayload = readJsonFile(getUpdateStorePath(), DEFAULT_UPDATE_CONFIG);
  const githubUpdatePayload = readJsonFile(
    getGitHubUpdateMetaStorePath(),
    createInitialGitHubUpdateMetadata()
  );

  downloadItems = Array.isArray(downloadsPayload.items)
    ? downloadsPayload.items.map(sanitizeDownloadRecord).slice(0, 300)
    : [];

  browsingHistory = Array.isArray(historyPayload.items)
    ? historyPayload.items.map(sanitizeHistoryEntry).slice(0, 2000)
    : [];

  privacyConfig = sanitizePrivacyConfig(privacyPayload);
  updateConfig = sanitizeUpdateConfig(updatePayload);
  githubUpdateMetadata = sanitizeGitHubUpdateMetadata(githubUpdatePayload);
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

function shouldUseGitHubReleaseZipUpdater() {
  return Boolean(updateConfig.useGithubReleaseZip);
}

function resolveGitHubReleasesApiURL() {
  const fromEnv = sanitizeString(process.env.BASTION_GITHUB_RELEASES_API_URL, "").trim();
  return fromEnv || GITHUB_RELEASES_API_URL;
}

function resolveGitHubTagsPageURL() {
  const fromEnv = sanitizeString(process.env.BASTION_GITHUB_RELEASES_TAGS_URL, "").trim();
  return fromEnv || GITHUB_RELEASES_TAGS_PAGE_URL;
}

function resolveGitHubUpdateAssetName() {
  const fromEnv = sanitizeString(process.env.BASTION_GITHUB_UPDATE_ASSET_NAME, "").trim();
  return fromEnv || GITHUB_UPDATE_ASSET_NAME;
}

function buildGitHubRequestHeaders() {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": `BastionBrowser/${app.getVersion()}`
  };

  const token = sanitizeString(process.env.BASTION_GITHUB_TOKEN, "").trim() ||
    sanitizeString(process.env.GITHUB_TOKEN, "").trim();

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

function normalizeVersionFromTag(tagValue) {
  const tag = String(tagValue || "").trim();
  if (!tag) {
    return "";
  }
  return tag.replace(/^v/i, "");
}

function parseVersionParts(versionValue) {
  const source = String(versionValue || "").trim();
  if (!source) {
    return [];
  }

  return source
    .split(/[^0-9]+/)
    .filter((part) => part.length > 0)
    .map((part) => Number(part))
    .filter((part) => Number.isFinite(part));
}

function compareVersions(leftVersion, rightVersion) {
  const left = parseVersionParts(leftVersion);
  const right = parseVersionParts(rightVersion);

  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const maxLength = Math.max(left.length, right.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = left[index] || 0;
    const rightValue = right[index] || 0;
    if (leftValue > rightValue) {
      return 1;
    }
    if (leftValue < rightValue) {
      return -1;
    }
  }

  return 0;
}

function sanitizeTagForPath(tagValue) {
  const normalized = String(tagValue || "").trim().replace(/[^a-z0-9._-]+/gi, "_");
  return normalized || "latest";
}

function resolveGitHubUpdateTargetPath(tagValue) {
  const safeTag = sanitizeTagForPath(tagValue);
  const fileName = resolveGitHubUpdateAssetName();
  return path.join(getGitHubUpdateDownloadDir(), safeTag, fileName);
}

function resolveGitHubUpdateStagingDir(tagValue) {
  const safeTag = sanitizeTagForPath(tagValue);
  return path.join(getGitHubUpdateDownloadDir(), "staged", safeTag);
}

function findReleaseAsset(release, assetName) {
  const assets = Array.isArray(release && release.assets) ? release.assets : [];
  const wantedName = String(assetName || "").toLowerCase();
  return assets.find((asset) => String((asset && asset.name) || "").toLowerCase() === wantedName) || null;
}

function ensureFetchAvailable() {
  if (typeof fetch !== "function") {
    throw new Error("This runtime does not provide fetch() support.");
  }
}

async function fetchLatestGitHubRelease() {
  ensureFetchAvailable();
  const apiURL = resolveGitHubReleasesApiURL();
  const response = await fetch(apiURL, {
    method: "GET",
    headers: buildGitHubRequestHeaders(),
    redirect: "follow"
  });

  if (!response.ok) {
    throw new Error(`GitHub releases request failed (${response.status}).`);
  }

  const payload = await response.json();
  const releases = Array.isArray(payload) ? payload : [];
  const nonDraftReleases = releases.filter((release) => release && !release.draft);
  const preferred = nonDraftReleases.filter((release) =>
    updateConfig.allowPrerelease ? true : !release.prerelease
  );
  const selectionPool = preferred.length > 0 ? preferred : nonDraftReleases;
  const sorted = selectionPool.sort((left, right) => {
    const leftTime = Date.parse(
      String((left && (left.published_at || left.created_at || left.createdAt)) || "")
    ) || 0;
    const rightTime = Date.parse(
      String((right && (right.published_at || right.created_at || right.createdAt)) || "")
    ) || 0;
    return rightTime - leftTime;
  });

  return sorted[0] || null;
}

async function downloadGitHubAssetToPath(assetURL, targetPath) {
  ensureFetchAvailable();
  const response = await fetch(assetURL, {
    method: "GET",
    headers: buildGitHubRequestHeaders(),
    redirect: "follow"
  });

  if (!response.ok) {
    throw new Error(`GitHub asset download failed (${response.status}).`);
  }

  if (!response.body) {
    throw new Error("GitHub asset download returned an empty response body.");
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });

  const tempPath = `${targetPath}.download`;
  try {
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(tempPath));
    fs.renameSync(tempPath, targetPath);
  } catch (error) {
    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch (_) {
        // Best-effort cleanup.
      }
    }
    throw error;
  }

  const stats = fs.statSync(targetPath);
  return {
    filePath: targetPath,
    sizeBytes: Number(stats.size || 0)
  };
}

function escapePowerShellLiteral(value) {
  return String(value || "").replaceAll("'", "''");
}

async function expandArchiveOnWindows(zipPath, destinationPath) {
  const command = [
    "$ErrorActionPreference='Stop';",
    `Expand-Archive -LiteralPath '${escapePowerShellLiteral(zipPath)}'`,
    `-DestinationPath '${escapePowerShellLiteral(destinationPath)}' -Force`
  ].join(" ");

  await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
    { windowsHide: true }
  );
}

function collectFilesRecursive(rootDir) {
  const files = [];
  const queue = [rootDir];

  while (queue.length > 0) {
    const current = queue.shift();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (_) {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      files.push(fullPath);
    }
  }

  return files;
}

function scoreLauncherCandidate(filePath) {
  const name = path.basename(filePath).toLowerCase();
  if (name.includes("uninstall")) {
    return -100;
  }

  let score = 0;
  if (name.includes("setup")) {
    score += 60;
  }
  if (name.includes("installer")) {
    score += 50;
  }
  if (name.includes("update")) {
    score += 40;
  }
  if (name.includes("portable")) {
    score += 30;
  }
  if (name.includes("bastion")) {
    score += 20;
  }

  const ext = path.extname(name);
  if (ext === ".exe") {
    score += 25;
  } else if (ext === ".cmd" || ext === ".bat") {
    score += 10;
  } else {
    score -= 10;
  }

  return score;
}

function pickUpdateLauncherFromExtractedFiles(files) {
  const candidates = files.filter((filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    return ext === ".exe" || ext === ".cmd" || ext === ".bat";
  });

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => {
    const scoreDiff = scoreLauncherCandidate(right) - scoreLauncherCandidate(left);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }
    return left.length - right.length;
  });

  return candidates[0];
}

function launchDetachedFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  let command = filePath;
  let args = [];

  if (ext === ".cmd" || ext === ".bat") {
    command = "cmd.exe";
    args = ["/c", filePath];
  }

  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
}

async function applyGitHubReleaseZipUpdate(options = {}) {
  const opts = {
    manual: false,
    tag: githubUpdateMetadata.lastTag,
    zipPath: githubUpdateMetadata.filePath,
    releasePage: githubUpdateMetadata.releasePage,
    ...options
  };

  const tag = String(opts.tag || "").trim();
  const zipPath = String(opts.zipPath || "").trim();
  const releasePage = String(opts.releasePage || "").trim();

  if (process.platform !== "win32") {
    return { ok: false, error: "Automatic ZIP apply is currently implemented for Windows only." };
  }

  if (!zipPath || !fs.existsSync(zipPath)) {
    return { ok: false, error: "No downloaded update.zip was found to apply." };
  }

  if (!opts.manual && tag && githubUpdateMetadata.lastAppliedTag === tag) {
    return {
      ok: true,
      skipped: true,
      reason: "already-applied",
      tag
    };
  }

  const stageDir = resolveGitHubUpdateStagingDir(tag || "latest");
  setUpdateStatus({
    source: "github-release-zip",
    status: "installing",
    message: `Applying ${path.basename(zipPath)}...`,
    availableVersion: tag ? normalizeVersionFromTag(tag) || tag : updateStatus.availableVersion,
    updateFilePath: zipPath,
    releasePage: releasePage || updateStatus.releasePage,
    progressPercent: 100,
    checkedAt: Date.now(),
    error: null
  });

  try {
    fs.rmSync(stageDir, { recursive: true, force: true });
    fs.mkdirSync(stageDir, { recursive: true });
  } catch (_) {
    // Continue even if cleanup is partial.
  }

  try {
    await expandArchiveOnWindows(zipPath, stageDir);
    const extractedFiles = collectFilesRecursive(stageDir);
    const launcherPath = pickUpdateLauncherFromExtractedFiles(extractedFiles);

    if (!launcherPath) {
      throw new Error("No launcher executable (.exe/.cmd/.bat) found in update.zip.");
    }

    launchDetachedFile(launcherPath);

    githubUpdateMetadata = {
      ...githubUpdateMetadata,
      lastAppliedTag: tag,
      appliedAt: Date.now(),
      releasePage: releasePage || githubUpdateMetadata.releasePage
    };
    persistGitHubUpdateMetadata();

    setUpdateStatus({
      source: "github-release-zip",
      status: "installing",
      message: `Launching updater: ${path.basename(launcherPath)}`,
      updateFilePath: zipPath,
      releasePage: releasePage || updateStatus.releasePage,
      error: null
    });

    setTimeout(() => {
      app.quit();
    }, 420);

    return {
      ok: true,
      tag,
      launcherPath,
      stagedPath: stageDir
    };
  } catch (error) {
    const message = getErrorMessage(error);
    setUpdateStatus({
      source: "github-release-zip",
      status: "error",
      message: "Failed to apply downloaded update.zip.",
      updateFilePath: zipPath,
      releasePage: releasePage || updateStatus.releasePage,
      checkedAt: Date.now(),
      error: message
    });
    return { ok: false, error: message };
  }
}

async function checkGitHubReleaseZipUpdate(options = {}) {
  const opts = {
    manual: false,
    download: false,
    forceDownload: false,
    ...options
  };

  const assetName = resolveGitHubUpdateAssetName();
  const tagsPageURL = resolveGitHubTagsPageURL();

  setUpdateStatus({
    source: "github-release-zip",
    status: "checking",
    message: `Checking GitHub release tags for ${assetName}...`,
    availableVersion: null,
    downloadedVersion: null,
    updateFilePath: null,
    releasePage: tagsPageURL,
    progressPercent: 0,
    checkedAt: Date.now(),
    error: null
  });

  let release;
  try {
    release = await fetchLatestGitHubRelease();
  } catch (error) {
    const message = getErrorMessage(error);
    setUpdateStatus({
      source: "github-release-zip",
      status: "error",
      message: "Failed to fetch GitHub release tags.",
      checkedAt: Date.now(),
      error: message
    });
    return { ok: false, error: message };
  }

  if (!release || !release.tag_name) {
    const message = "No GitHub release tags found.";
    setUpdateStatus({
      source: "github-release-zip",
      status: "idle",
      message,
      checkedAt: Date.now(),
      error: null
    });
    return { ok: false, error: message };
  }

  const tag = String(release.tag_name || "").trim();
  const normalizedVersion = normalizeVersionFromTag(tag);
  const normalizedCurrentVersion = normalizeVersionFromTag(app.getVersion());
  const releasePage = sanitizeString(release.html_url, "") || tagsPageURL;
  const asset = findReleaseAsset(release, assetName);

  const latestParts = parseVersionParts(normalizedVersion);
  const currentParts = parseVersionParts(normalizedCurrentVersion);
  if (
    latestParts.length > 0 &&
    currentParts.length > 0 &&
    compareVersions(normalizedVersion, normalizedCurrentVersion) <= 0
  ) {
    setUpdateStatus({
      source: "github-release-zip",
      status: "idle",
      message: `You are already on version ${app.getVersion()}.`,
      availableVersion: normalizedVersion || tag,
      downloadedVersion: normalizedVersion || tag,
      updateFilePath: githubUpdateMetadata.filePath || null,
      releasePage,
      progressPercent: 100,
      checkedAt: Date.now(),
      error: null
    });
    return {
      ok: true,
      upToDate: true,
      tag,
      filePath: githubUpdateMetadata.filePath || ""
    };
  }

  if (!asset || !asset.browser_download_url) {
    const message = `Latest tag ${tag} has no ${assetName} asset.`;
    setUpdateStatus({
      source: "github-release-zip",
      status: "error",
      message,
      availableVersion: normalizedVersion || tag,
      checkedAt: Date.now(),
      releasePage,
      error: message
    });
    return { ok: false, error: message };
  }

  const hasDownloadedFile = Boolean(
    githubUpdateMetadata.lastTag === tag &&
    githubUpdateMetadata.filePath &&
    fs.existsSync(githubUpdateMetadata.filePath)
  );

  if (hasDownloadedFile && !opts.forceDownload) {
    const alreadyApplied = Boolean(tag && githubUpdateMetadata.lastAppliedTag === tag);
    setUpdateStatus({
      source: "github-release-zip",
      status: alreadyApplied ? "idle" : "downloaded",
      message: alreadyApplied
        ? `Latest tag ${tag} is already applied.`
        : `Latest tag ${tag} is already downloaded.`,
      availableVersion: normalizedVersion || tag,
      downloadedVersion: normalizedVersion || tag,
      updateFilePath: githubUpdateMetadata.filePath,
      releasePage,
      progressPercent: 100,
      checkedAt: Date.now(),
      error: null
    });
    return {
      ok: true,
      alreadyDownloaded: true,
      alreadyApplied,
      tag,
      filePath: githubUpdateMetadata.filePath,
      releasePage
    };
  }

  if (!opts.download) {
    setUpdateStatus({
      source: "github-release-zip",
      status: "available",
      message: `GitHub update ${tag} is available.`,
      availableVersion: normalizedVersion || tag,
      downloadedVersion: null,
      updateFilePath: null,
      releasePage,
      progressPercent: 0,
      checkedAt: Date.now(),
      error: null
    });
    return {
      ok: true,
      available: true,
      tag,
      downloadURL: asset.browser_download_url,
      releasePage
    };
  }

  setUpdateStatus({
    source: "github-release-zip",
    status: "downloading",
    message: `Downloading ${assetName} from ${tag}...`,
    availableVersion: normalizedVersion || tag,
    downloadedVersion: null,
    updateFilePath: null,
    releasePage,
    progressPercent: 0,
    checkedAt: Date.now(),
    error: null
  });

  try {
    const destinationPath = resolveGitHubUpdateTargetPath(tag);
    const result = await downloadGitHubAssetToPath(asset.browser_download_url, destinationPath);

    githubUpdateMetadata = {
      ...githubUpdateMetadata,
      lastTag: tag,
      filePath: result.filePath,
      downloadedAt: Date.now(),
      sizeBytes: result.sizeBytes,
      assetName,
      releasePage
    };
    persistGitHubUpdateMetadata();

    setUpdateStatus({
      source: "github-release-zip",
      status: "downloaded",
      message: `Downloaded ${assetName} from ${tag}.`,
      availableVersion: normalizedVersion || tag,
      downloadedVersion: normalizedVersion || tag,
      updateFilePath: result.filePath,
      releasePage,
      progressPercent: 100,
      checkedAt: Date.now(),
      error: null
    });

    return {
      ok: true,
      downloaded: true,
      tag,
      filePath: result.filePath,
      sizeBytes: result.sizeBytes,
      releasePage
    };
  } catch (error) {
    const message = getErrorMessage(error);
    setUpdateStatus({
      source: "github-release-zip",
      status: "error",
      message: "Failed to download update.zip from GitHub.",
      availableVersion: normalizedVersion || tag,
      checkedAt: Date.now(),
      releasePage,
      error: message
    });
    return { ok: false, error: message };
  }
}

function bindUpdaterEvents() {
  if (!autoUpdater || updaterEventsBound) {
    return;
  }

  autoUpdater.on("checking-for-update", () => {
    setUpdateStatus({
      source: "electron-updater",
      status: "checking",
      message: "Checking for updates...",
      updateFilePath: null,
      error: null,
      checkedAt: Date.now(),
      progressPercent: 0
    });
  });

  autoUpdater.on("update-available", (info) => {
    const availableVersion = getUpdateVersion(info);
    setUpdateStatus({
      source: "electron-updater",
      status: updateConfig.autoDownload ? "downloading" : "available",
      message: updateConfig.autoDownload
        ? "Update available. Downloading now..."
        : "Update available. Download is waiting.",
      availableVersion,
      downloadedVersion: null,
      updateFilePath: null,
      checkedAt: Date.now(),
      error: null,
      progressPercent: 0
    });
  });

  autoUpdater.on("update-not-available", () => {
    setUpdateStatus({
      source: "electron-updater",
      status: "idle",
      message: "You are running the latest version.",
      availableVersion: null,
      downloadedVersion: null,
      updateFilePath: null,
      checkedAt: Date.now(),
      error: null,
      progressPercent: 0
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    const percent = Math.max(0, Math.min(100, Math.round(Number((progress && progress.percent) || 0))));
    setUpdateStatus({
      source: "electron-updater",
      status: "downloading",
      message: `Downloading update (${percent}%)...`,
      updateFilePath: null,
      progressPercent: percent,
      error: null
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    const downloadedVersion = getUpdateVersion(info);
    setUpdateStatus({
      source: "electron-updater",
      status: "downloaded",
      message: "Update downloaded. Restart Bastion to install.",
      availableVersion: downloadedVersion || updateStatus.availableVersion,
      downloadedVersion,
      updateFilePath: null,
      progressPercent: 100,
      error: null
    });
  });

  autoUpdater.on("error", (error) => {
    setUpdateStatus({
      source: "electron-updater",
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

  if (shouldUseGitHubReleaseZipUpdater()) {
    return;
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
    if (shouldUseGitHubReleaseZipUpdater()) {
      updaterConfigured = true;
      return;
    }

    setUpdateStatus({
      status: "disabled",
      message: "Auto updater is unavailable. Install electron-updater dependency."
    });
    updaterConfigured = true;
    return;
  }

  bindUpdaterEvents();
  applyUpdaterConfig();

  if (!app.isPackaged && !shouldUseGitHubReleaseZipUpdater()) {
    setUpdateStatus({
      source: "electron-updater",
      status: "idle",
      message: "Update checks run from packaged builds.",
      updateFilePath: null,
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
        source: "electron-updater",
        status: "idle",
        message: error,
        updateFilePath: null,
        checkedAt: Date.now(),
        error: null
      });
    }
    return { ok: false, error };
  }

  try {
    if (manual) {
      setUpdateStatus({
        source: "electron-updater",
        status: "checking",
        message: "Checking for updates...",
        updateFilePath: null,
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
      source: "electron-updater",
      status: "error",
      message: "Failed to check for updates.",
      updateFilePath: null,
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
      source: "electron-updater",
      status: "error",
      message: "Failed to download update.",
      updateFilePath: null,
      error: message
    });
    return { ok: false, error: message };
  }
}

function installDownloadedUpdate() {
  if (updateStatus.source === "github-release-zip") {
    return applyGitHubReleaseZipUpdate({
      manual: true,
      tag: githubUpdateMetadata.lastTag || updateStatus.availableVersion,
      zipPath: updateStatus.updateFilePath || githubUpdateMetadata.filePath,
      releasePage: updateStatus.releasePage || githubUpdateMetadata.releasePage
    });
  }

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
    source: "electron-updater",
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

  if (!autoUpdater && !shouldUseGitHubReleaseZipUpdater()) {
    setUpdateStatus({
      source: "none",
      status: "disabled",
      message: "No updater backend is enabled.",
      updateFilePath: null,
      error: "Enable GitHub release ZIP updater or install electron-updater backend."
    });
  }

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
    if (shouldUseGitHubReleaseZipUpdater()) {
      return checkGitHubReleaseZipUpdate({ manual: true, download: false });
    }
    return checkForUpdates(true);
  });

  ipcMain.handle("updates:download", () => {
    if (shouldUseGitHubReleaseZipUpdater()) {
      return checkGitHubReleaseZipUpdate({ manual: true, download: true });
    }
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
    if (shouldUseGitHubReleaseZipUpdater()) {
      checkGitHubReleaseZipUpdate({
        manual: false,
        download: true
      })
        .then((result) => {
          if (!updateConfig.autoApplyGithubZip || !app.isPackaged) {
            return;
          }

          if (!result || !result.ok || result.alreadyApplied || result.upToDate) {
            return;
          }

          const zipPath = String(result.filePath || "").trim();
          const tag = String(result.tag || "").trim();
          if (!zipPath) {
            return;
          }

          applyGitHubReleaseZipUpdate({
            manual: false,
            tag,
            zipPath,
            releasePage: result.releasePage || updateStatus.releasePage
          }).catch(() => {
            // Status update already handled by apply path.
          });
        })
        .catch(() => {
          // Status update already handled by updater state.
        });
    } else {
      checkForUpdates(false).catch(() => {
        // Status update already handled by updater events.
      });
    }
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
