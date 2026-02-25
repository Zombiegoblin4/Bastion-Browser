"use strict";

const HOME_URL = "https://duckduckgo.com/";
const NEW_TAB_URL = "about:newtab";
const SEARCH_PREFIX = "https://duckduckgo.com/?q=";
const SETTINGS_KEY = "bastion.settings.v2";
const BOOKMARKS_KEY = "bastion.bookmarks.v1";
const SESSION_KEY = "bastion.session.v1";
const NEW_TAB_KEY = "bastion.newtab.v1";
const MAX_TABS = 20;
const MAX_BOOKMARKS = 80;
const MAX_CLOSED_TABS = 30;
const MAX_NEW_TAB_LINKS = 8;

const DEFAULT_FAVICON = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";

const DEFAULT_SETTINGS = {
  animations: true,
  showBookmarksBar: true,
  restoreSession: true,
  compactMode: false
};

const DEFAULT_UPDATE_CONFIG = {
  autoCheck: true,
  autoDownload: true,
  allowPrerelease: false,
  feedURL: "",
  useGithubReleaseZip: true,
  autoApplyGithubZip: true,
  autoUpdateUblockOrigin: true
};

const DEFAULT_PRIVACY_CONFIG = {
  blockTrackers: true,
  upgradeHttps: true,
  sendDoNotTrack: true,
  sendGlobalPrivacyControl: true,
  blockThirdPartyCookies: true,
  stripThirdPartyReferer: true,
  blockFingerprintingPermissions: true,
  clearDataOnExit: false
};

const NEW_TAB_BACKGROUND_OPTIONS = {
  steel: {
    label: "Steel",
    css: "linear-gradient(135deg, #0a1018 0%, #102038 52%, #0b1422 100%)"
  },
  dawn: {
    label: "Dawn",
    css: "linear-gradient(135deg, #20120f 0%, #532018 52%, #162233 100%)"
  },
  forest: {
    label: "Forest",
    css: "linear-gradient(135deg, #08120f 0%, #12342a 52%, #0a1820 100%)"
  },
  cobalt: {
    label: "Cobalt",
    css: "linear-gradient(135deg, #0a1022 0%, #1a2464 52%, #0f1a32 100%)"
  }
};

const DEFAULT_NEW_TAB_CONFIG = {
  title: "Bastion New Tab",
  subtitle: "DuckDuckGo search, quick links, and a clean launch point.",
  showClock: true,
  backgroundStyle: "steel",
  links: [
    { label: "DuckDuckGo", url: "https://duckduckgo.com/" },
    { label: "YouTube", url: "https://www.youtube.com/" },
    { label: "GitHub", url: "https://github.com/" },
    { label: "Bastion Settings", url: "about:settings" }
  ]
};

const LOCAL_PAGE_TITLES = {
  bastion: "Bastion Home",
  newtab: "New Tab",
  settings: "Settings",
  downloads: "Downloads",
  history: "History",
  game: "Offline Game",
  error: "Page Error"
};

const state = {
  tabs: [],
  activeTabId: null,
  closedTabs: [],
  settings: {
    ...DEFAULT_SETTINGS,
    ...loadJson(SETTINGS_KEY, {})
  },
  newTab: sanitizeNewTabConfig(loadJson(NEW_TAB_KEY, {})),
  bookmarks: loadJson(BOOKMARKS_KEY, []),
  downloads: [],
  history: [],
  extensions: [],
  updateStatus: null,
  updateConfig: { ...DEFAULT_UPDATE_CONFIG },
  privacyConfig: { ...DEFAULT_PRIVACY_CONFIG },
  privacyStats: null,
  appMeta: null,
  progressValue: 0,
  progressTimer: null
};

const dom = {
  tabStrip: document.getElementById("tabStrip"),
  newTabBtn: document.getElementById("newTabBtn"),
  webviewDeck: document.getElementById("webviewDeck"),
  addressForm: document.getElementById("addressForm"),
  addressInput: document.getElementById("addressInput"),
  backBtn: document.getElementById("backBtn"),
  forwardBtn: document.getElementById("forwardBtn"),
  refreshBtn: document.getElementById("refreshBtn"),
  homeBtn: document.getElementById("homeBtn"),
  bookmarkBtn: document.getElementById("bookmarkBtn"),
  fullscreenBtn: document.getElementById("fullscreenBtn"),
  settingsBtn: document.getElementById("settingsBtn"),
  menuBtn: document.getElementById("menuBtn"),
  browserMenu: document.getElementById("browserMenu"),
  pageProgressBar: document.getElementById("pageProgressBar"),
  bookmarksBar: document.getElementById("bookmarksBar"),
  statusBadge: document.getElementById("statusBadge"),
  logoButton: document.getElementById("logoButton"),
  minimizeBtn: document.getElementById("minimizeBtn"),
  maximizeBtn: document.getElementById("maximizeBtn"),
  closeBtn: document.getElementById("closeBtn"),
  toastContainer: document.getElementById("toastContainer")
};

if (!window.bastionAPI) {
  throw new Error("Bastion API bridge is unavailable. Check preload configuration.");
}

init();

function init() {
  bindGlobalEvents();
  bindToolbarEvents();
  bindWindowControls();

  applySettings();
  renderBookmarks();
  restoreTabsOrCreateFresh();

  refreshExtensionList();
  refreshDownloads();
  refreshHistory();
  refreshUpdateStatus();
  refreshUpdateConfig();
  refreshPrivacyConfig();
  refreshPrivacyStats();
  refreshMetaInfo();
  syncWindowState();

  window.bastionAPI.navigation.onNewTab((url) => {
    createTab(url || NEW_TAB_URL, true);
  });

  window.bastionAPI.extensions.onUpdated((extensions) => {
    state.extensions = Array.isArray(extensions) ? extensions : [];
    refreshOpenLocalPages();
  });

  window.bastionAPI.downloads.onUpdated((downloads) => {
    state.downloads = Array.isArray(downloads) ? downloads : [];
    refreshOpenLocalPages();
  });

  window.bastionAPI.downloads.onDone((download) => {
    if (download && download.state === "completed") {
      showToast(`Download complete: ${download.filename}`);
    }
  });

  window.bastionAPI.history.onUpdated((history) => {
    state.history = Array.isArray(history) ? history : [];
    refreshOpenLocalPages();
  });

  window.bastionAPI.updates.onStatus((status) => {
    state.updateStatus = status && typeof status === "object" ? status : null;
    refreshOpenLocalPages();
  });

  window.bastionAPI.updates.onConfig((config) => {
    state.updateConfig = {
      ...DEFAULT_UPDATE_CONFIG,
      ...(config && typeof config === "object" ? config : {})
    };
    refreshOpenLocalPages();
  });

  window.bastionAPI.privacy.onConfig((config) => {
    state.privacyConfig = {
      ...DEFAULT_PRIVACY_CONFIG,
      ...(config && typeof config === "object" ? config : {})
    };
    refreshOpenLocalPages();
  });

  window.bastionAPI.privacy.onStats((stats) => {
    state.privacyStats = stats && typeof stats === "object" ? stats : null;
    refreshOpenLocalPages();
  });

  window.bastionAPI.window.onState((windowState) => {
    applyWindowState(windowState);
  });
}

function bindGlobalEvents() {
  window.addEventListener("keydown", (event) => {
    const isInput =
      event.target instanceof HTMLElement &&
      (event.target.tagName === "INPUT" ||
        event.target.tagName === "TEXTAREA" ||
        event.target.isContentEditable);

    if (event.key === "F11") {
      event.preventDefault();
      toggleFullscreen();
      return;
    }

    if (event.key === "Escape") {
      hideBrowserMenu();
    }

    if (event.altKey && !isInput && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      if (event.key === "ArrowLeft") {
        goBackActiveTab();
      } else {
        goForwardActiveTab();
      }
      return;
    }

    if (event.ctrlKey || event.metaKey) {
      const key = event.key.toLowerCase();

      if (key === "l" || key === "k") {
        event.preventDefault();
        dom.addressInput.focus();
        dom.addressInput.select();
        return;
      }

      if (key === "t" && event.shiftKey) {
        event.preventDefault();
        reopenLastClosedTab();
        return;
      }

      if (key === "t") {
        event.preventDefault();
        createTab(NEW_TAB_URL, true);
        return;
      }

      if (key === "w") {
        event.preventDefault();
        closeTab(state.activeTabId);
        return;
      }

      if (key === "d") {
        event.preventDefault();
        toggleBookmarkForActiveTab();
        return;
      }

      if (key === "r") {
        event.preventDefault();
        reloadActiveTab(event.shiftKey);
        return;
      }

      if (event.key === ",") {
        event.preventDefault();
        openSettingsPage();
        return;
      }

      if (event.key >= "1" && event.key <= "9") {
        event.preventDefault();
        const index = event.key === "9" ? state.tabs.length - 1 : Number(event.key) - 1;
        activateTabByIndex(index);
      }
    }
  });
}

function bindToolbarEvents() {
  dom.newTabBtn.addEventListener("click", () => createTab(NEW_TAB_URL, true));

  dom.addressForm.addEventListener("submit", (event) => {
    event.preventDefault();
    navigateActiveTab(dom.addressInput.value);
  });

  dom.backBtn.addEventListener("click", goBackActiveTab);
  dom.forwardBtn.addEventListener("click", goForwardActiveTab);

  dom.refreshBtn.addEventListener("click", () => {
    const tab = getActiveTab();
    if (!tab) {
      return;
    }

    if (tab.isLoading) {
      tab.webview.stop();
      return;
    }

    reloadActiveTab(false);
  });

  dom.homeBtn.addEventListener("click", () => navigateActiveTab(HOME_URL));
  dom.bookmarkBtn.addEventListener("click", toggleBookmarkForActiveTab);
  dom.fullscreenBtn.addEventListener("click", toggleFullscreen);
  dom.settingsBtn.addEventListener("click", openSettingsPage);
  dom.menuBtn.addEventListener("click", toggleBrowserMenu);
  dom.logoButton.addEventListener("click", () => navigateActiveTab(HOME_URL));

  if (dom.browserMenu) {
    dom.browserMenu.addEventListener("click", handleBrowserMenuAction);
  }

  document.addEventListener("click", (event) => {
    if (!dom.browserMenu || !dom.menuBtn) {
      return;
    }

    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!target) {
      return;
    }

    if (target.closest("#browserMenu") || target.closest("#menuBtn")) {
      return;
    }

    hideBrowserMenu();
  });
}

function bindWindowControls() {
  dom.minimizeBtn.addEventListener("click", () => window.bastionAPI.window.minimize());
  dom.maximizeBtn.addEventListener("click", () => window.bastionAPI.window.maximizeToggle());
  dom.closeBtn.addEventListener("click", () => window.bastionAPI.window.close());

  const titleRow = document.querySelector(".title-row");
  if (titleRow) {
    titleRow.addEventListener("dblclick", (event) => {
      if (event.target instanceof HTMLElement && event.target.closest(".no-drag")) {
        return;
      }
      window.bastionAPI.window.maximizeToggle();
    });
  }
}

function toggleBrowserMenu() {
  if (!dom.browserMenu) {
    return;
  }

  const willShow = dom.browserMenu.classList.contains("hidden");
  dom.browserMenu.classList.toggle("hidden", !willShow);
}

function hideBrowserMenu() {
  if (!dom.browserMenu) {
    return;
  }
  dom.browserMenu.classList.add("hidden");
}

async function handleBrowserMenuAction(event) {
  const button = event.target instanceof HTMLElement
    ? event.target.closest("[data-menu-action]")
    : null;

  if (!button) {
    return;
  }

  const action = String(button.getAttribute("data-menu-action") || "");
  hideBrowserMenu();

  const tab = getActiveTab();
  if (!tab) {
    return;
  }

  if (action === "print") {
    if (tab.localPage) {
      showToast("Print is only available for website tabs.", true);
      return;
    }
    tab.webview.executeJavaScript("window.print();").catch(() => {
      showToast("Unable to print this page.", true);
    });
    return;
  }

  if (action === "inspect") {
    if (tab.webview && typeof tab.webview.openDevTools === "function") {
      tab.webview.openDevTools({ mode: "detach" });
    }
    return;
  }

  if (action === "source") {
    const currentUrl = tab.localPage ? "" : (safeUrl(tab.webview) || tab.address || "");
    if (!/^https?:\/\//i.test(currentUrl)) {
      showToast("Page source works on HTTP/HTTPS pages.", true);
      return;
    }
    createTab(`view-source:${currentUrl}`, true);
    return;
  }

  if (action === "copy-url") {
    const value = getTabDisplayAddress(tab);
    try {
      await navigator.clipboard.writeText(value);
      showToast("URL copied.");
    } catch (_) {
      showToast("Unable to copy URL.", true);
    }
    return;
  }

  if (action === "downloads") {
    navigateActiveTab("about:downloads");
    return;
  }

  if (action === "history") {
    navigateActiveTab("about:history");
    return;
  }

  if (action === "settings") {
    openSettingsPage();
    return;
  }

  if (action === "newtab") {
    createTab(NEW_TAB_URL, true);
    return;
  }

  if (action === "clear-history") {
    await window.bastionAPI.history.clear();
    await refreshHistory();
    showToast("History cleared.");
    refreshOpenLocalPages();
  }
}

function createTab(rawAddress = NEW_TAB_URL, makeActive = true) {
  if (state.tabs.length >= MAX_TABS) {
    showToast(`Tab limit reached (${MAX_TABS}). Close a tab first.`, true);
    return null;
  }

  const id = `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const resolved = resolveAddress(rawAddress);

  const tabButton = document.createElement("button");
  tabButton.type = "button";
  tabButton.className = "tab-btn";
  tabButton.dataset.tabId = id;

  const favicon = document.createElement("img");
  favicon.className = "tab-favicon";
  favicon.alt = "";
  favicon.src = resolved.localPage ? DEFAULT_FAVICON : inferFavicon(resolved.url);
  favicon.onerror = () => {
    favicon.src = DEFAULT_FAVICON;
  };

  const tabTitle = document.createElement("span");
  tabTitle.className = "tab-title";
  tabTitle.textContent = "New Tab";

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "tab-close";
  closeButton.textContent = "x";

  tabButton.appendChild(favicon);
  tabButton.appendChild(tabTitle);
  tabButton.appendChild(closeButton);
  dom.tabStrip.appendChild(tabButton);

  const webview = document.createElement("webview");
  webview.className = "browser-view";
  webview.dataset.tabId = id;
  webview.setAttribute("partition", "persist:bastion");
  webview.setAttribute("allowpopups", "");
  webview.setAttribute("allowfullscreen", "");
  webview.setAttribute("src", resolved.url);
  dom.webviewDeck.appendChild(webview);

  const tab = {
    id,
    title: resolved.localPage ? getLocalPageTitle(resolved.localPage) : "New Tab",
    address: resolved.url,
    displayAddress: resolved.display,
    localPage: resolved.localPage,
    tabButton,
    tabTitle,
    closeButton,
    favicon,
    webview,
    isLoading: false
  };

  tab.tabTitle.textContent = trimTabTitle(tab.title);

  state.tabs.push(tab);

  tabButton.addEventListener("click", () => activateTab(id));
  closeButton.addEventListener("click", (event) => {
    event.stopPropagation();
    closeTab(id);
  });

  wireWebviewEvents(tab);

  if (makeActive || !state.activeTabId) {
    activateTab(id);
  }

  persistSession();
  return tab;
}
function wireWebviewEvents(tab) {
  tab.webview.addEventListener("will-navigate", (event) => {
    if (handleSpecialNavigation(event.url, tab, event)) {
      return;
    }
  });

  tab.webview.addEventListener("did-start-loading", () => {
    tab.isLoading = true;
    tab.tabButton.classList.add("loading");

    if (tab.id === state.activeTabId) {
      setLoadingState(true);
      startPageProgress();
      updateNavigationButtons();
    }
  });

  tab.webview.addEventListener("did-stop-loading", () => {
    tab.isLoading = false;
    tab.tabButton.classList.remove("loading");

    if (tab.id === state.activeTabId) {
      setLoadingState(false);
      finishPageProgress();
      updateNavigationButtons();
      updateBookmarkButtonState();
    }

    const url = safeUrl(tab.webview);
    if (url && !tab.localPage && url !== "about:blank") {
      addHistoryEntry(url, tab.title || url);
    }

    persistSession();
  });

  tab.webview.addEventListener("did-navigate", (event) => {
    if (!tab.localPage) {
      tab.displayAddress = event.url;
    }

    tab.address = event.url;

    if (tab.id === state.activeTabId) {
      dom.addressInput.value = getTabDisplayAddress(tab);
      updateNavigationButtons();
      updateBookmarkButtonState();
    }

    if (!tab.localPage) {
      updateTabFavicon(tab, inferFavicon(event.url));
    }

    persistSession();
  });

  tab.webview.addEventListener("did-redirect-navigation", (event) => {
    if (!event || !event.url) {
      return;
    }

    tab.address = event.url;
    if (!tab.localPage) {
      tab.displayAddress = event.url;
      updateTabFavicon(tab, inferFavicon(event.url));
    }

    if (tab.id === state.activeTabId) {
      dom.addressInput.value = getTabDisplayAddress(tab);
    }
  });

  tab.webview.addEventListener("did-navigate-in-page", (event) => {
    tab.address = event.url;
    if (tab.id === state.activeTabId) {
      dom.addressInput.value = getTabDisplayAddress(tab);
      updateBookmarkButtonState();
    }
    persistSession();
  });

  tab.webview.addEventListener("page-title-updated", (event) => {
    tab.title = event.title || "New Tab";
    tab.tabTitle.textContent = trimTabTitle(tab.title);

    if (tab.id === state.activeTabId) {
      document.title = `${tab.title} - Bastion Browser`;
    }
  });

  tab.webview.addEventListener("page-favicon-updated", (event) => {
    if (!tab.localPage && event.favicons && event.favicons.length > 0) {
      const candidate = pickBestFavicon(event.favicons);
      updateTabFavicon(tab, candidate || inferFavicon(tab.address));
    }
  });

  tab.webview.addEventListener("did-finish-load", () => {
    const currentUrl = safeUrl(tab.webview);
    if (!currentUrl || tab.localPage) {
      return;
    }

    tab.address = currentUrl;
    tab.displayAddress = currentUrl;
    updateTabFavicon(tab, inferFavicon(currentUrl));

    if (tab.id === state.activeTabId) {
      dom.addressInput.value = currentUrl;
    }
  });

  tab.webview.addEventListener("new-window", (event) => {
    if (!event.url) {
      return;
    }

    if (handleSpecialNavigation(event.url, tab, event)) {
      return;
    }

    createTab(event.url, true);
  });

  tab.webview.addEventListener("enter-html-full-screen", () => {
    window.bastionAPI.window.setFullscreen(true);
  });

  tab.webview.addEventListener("leave-html-full-screen", () => {
    window.bastionAPI.window.setFullscreen(false);
  });

  tab.webview.addEventListener("did-fail-load", (event) => {
    tab.isLoading = false;
    tab.tabButton.classList.remove("loading");

    if (event.errorCode === -3 || !event.validatedURL) {
      if (tab.id === state.activeTabId) {
        setLoadingState(false);
        finishPageProgress();
      }
      return;
    }

    const errorPage = buildErrorPage(event.validatedURL, event.errorDescription || "Unknown error");
    tab.localPage = "error";
    tab.address = errorPage;
    tab.displayAddress = "about:error";
    tab.webview.loadURL(errorPage);

    if (tab.id === state.activeTabId) {
      dom.addressInput.value = tab.displayAddress;
      setLoadingState(false);
      finishPageProgress();
    }
  });
}

function activateTab(tabId) {
  const target = state.tabs.find((tab) => tab.id === tabId);
  if (!target) {
    return;
  }

  state.activeTabId = tabId;

  for (const tab of state.tabs) {
    const isActive = tab.id === tabId;
    tab.tabButton.classList.toggle("active", isActive);
    tab.webview.classList.toggle("active", isActive);
  }

  dom.addressInput.value = getTabDisplayAddress(target);
  document.title = `${target.title} - Bastion Browser`;
  updateNavigationButtons();
  updateBookmarkButtonState();

  if (target.isLoading) {
    setLoadingState(true);
    startPageProgress();
  } else {
    setLoadingState(false);
    resetPageProgress();
  }

  persistSession();
}

function activateTabByIndex(index) {
  if (!Number.isInteger(index) || index < 0 || index >= state.tabs.length) {
    return;
  }
  activateTab(state.tabs[index].id);
}

function closeTab(tabId) {
  if (!tabId) {
    return;
  }

  const index = state.tabs.findIndex((tab) => tab.id === tabId);
  if (index < 0) {
    return;
  }

  const [tab] = state.tabs.splice(index, 1);
  state.closedTabs.unshift({
    url: tab.localPage ? getTabDisplayAddress(tab) : safeUrl(tab.webview) || tab.address || NEW_TAB_URL,
    title: tab.title || "Closed Tab"
  });
  state.closedTabs = state.closedTabs.slice(0, MAX_CLOSED_TABS);

  tab.tabButton.remove();
  tab.webview.remove();

  if (state.tabs.length === 0) {
    state.activeTabId = null;
    createTab(NEW_TAB_URL, true);
    return;
  }

  if (state.activeTabId === tabId) {
    const fallback = state.tabs[index] || state.tabs[index - 1] || state.tabs[0];
    activateTab(fallback.id);
  }

  persistSession();
}

function reopenLastClosedTab() {
  const entry = state.closedTabs.shift();
  if (!entry) {
    showToast("No recently closed tabs.");
    return;
  }

  createTab(entry.url || NEW_TAB_URL, true);
}

function getActiveTab() {
  return state.tabs.find((tab) => tab.id === state.activeTabId) || null;
}

function getTabDisplayAddress(tab) {
  if (tab.localPage) {
    return `about:${tab.localPage}`;
  }
  return tab.displayAddress || tab.address || NEW_TAB_URL;
}

function navigateActiveTab(rawAddress) {
  const tab = getActiveTab();
  if (!tab) {
    return;
  }

  const resolved = resolveAddress(rawAddress);
  if (!resolved || !resolved.url) {
    return;
  }

  tab.localPage = resolved.localPage;
  tab.address = resolved.url;
  tab.displayAddress = resolved.display;
  if (resolved.localPage) {
    tab.title = getLocalPageTitle(resolved.localPage);
    tab.tabTitle.textContent = trimTabTitle(tab.title);
  }

  tab.webview.loadURL(resolved.url);
  dom.addressInput.value = resolved.display;

  if (!resolved.localPage) {
    updateTabFavicon(tab, inferFavicon(resolved.url));
  } else {
    updateTabFavicon(tab, DEFAULT_FAVICON);
  }
}

function toTitleCase(value) {
  return String(value || "")
    .replaceAll("-", " ")
    .split(" ")
    .filter((part) => part.length > 0)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function getLocalPageTitle(localPage) {
  const key = String(localPage || "").toLowerCase();
  if (Object.prototype.hasOwnProperty.call(LOCAL_PAGE_TITLES, key)) {
    return LOCAL_PAGE_TITLES[key];
  }

  if (key.startsWith("about-")) {
    return `About ${toTitleCase(key.replace(/^about-/, ""))}`;
  }

  return "Bastion Page";
}

function buildGenericAboutPage(slug) {
  const title = `About ${toTitleCase(slug)}`;
  const body = `
    <h1>${escapeHtml(title)}</h1>
    <p>This local page is reserved for <code>about:${escapeHtml(slug)}</code>.</p>
    <div class="row">
      <a href="about:newtab">Open New Tab</a>
      <a href="about:settings">Open Settings</a>
    </div>
  `;

  return buildLocalPage(title, body);
}

function resolveAddress(raw) {
  const input = (raw || "").trim();
  if (!input) {
    return { url: buildNewTabPage(), display: NEW_TAB_URL, localPage: "newtab" };
  }

  const lowered = input.toLowerCase();

  if (lowered === "about:bastion" || lowered === "about:home" || lowered === "bastion://welcome") {
    return { url: buildWelcomePage(), display: "about:bastion", localPage: "bastion" };
  }

  if (lowered === "about:newtab" || lowered === "bastion://newtab") {
    return { url: buildNewTabPage(), display: NEW_TAB_URL, localPage: "newtab" };
  }

  if (lowered === "about:settings" || lowered === "bastion://settings") {
    return { url: buildSettingsPage(), display: "about:settings", localPage: "settings" };
  }

  if (lowered === "about:downloads") {
    return { url: buildDownloadsPage(), display: "about:downloads", localPage: "downloads" };
  }

  if (lowered === "about:history") {
    return { url: buildHistoryPage(), display: "about:history", localPage: "history" };
  }

  if (lowered === "about:game" || lowered === "bastion://game") {
    return { url: buildGamePage(), display: "about:game", localPage: "game" };
  }

  const aboutMatch = lowered.match(/^about:([a-z0-9-]+)$/i);
  if (aboutMatch && aboutMatch[1] !== "blank") {
    const slug = aboutMatch[1].toLowerCase();
    return {
      url: buildGenericAboutPage(slug),
      display: `about:${slug}`,
      localPage: `about-${slug}`
    };
  }

  if (/^https?:\/\//i.test(input) || /^file:\/\//i.test(input) || /^data:/i.test(input)) {
    return { url: input, display: input, localPage: null };
  }

  if (/^localhost(?::\d+)?(\/.*)?$/i.test(input)) {
    return { url: `http://${input}`, display: `http://${input}`, localPage: null };
  }

  if (input.includes(" ") || !input.includes(".")) {
    const searchUrl = `${SEARCH_PREFIX}${encodeURIComponent(input)}`;
    return { url: searchUrl, display: searchUrl, localPage: null };
  }

  const webUrl = `https://${input}`;
  return { url: webUrl, display: webUrl, localPage: null };
}

function openSettingsPage() {
  navigateActiveTab("about:settings");
}

function goBackActiveTab() {
  const tab = getActiveTab();
  if (tab && safeMethod(tab.webview, "canGoBack")) {
    tab.webview.goBack();
  }
}

function goForwardActiveTab() {
  const tab = getActiveTab();
  if (tab && safeMethod(tab.webview, "canGoForward")) {
    tab.webview.goForward();
  }
}

function reloadActiveTab(ignoreCache = false) {
  const tab = getActiveTab();
  if (!tab) {
    return;
  }

  if (tab.localPage) {
    refreshLocalPage(tab);
    return;
  }

  try {
    if (ignoreCache && typeof tab.webview.reloadIgnoringCache === "function") {
      tab.webview.reloadIgnoringCache();
    } else {
      tab.webview.reload();
    }
  } catch (_) {
    showToast("Unable to reload this tab.", true);
  }
}

function updateNavigationButtons() {
  const tab = getActiveTab();
  if (!tab) {
    dom.backBtn.disabled = true;
    dom.forwardBtn.disabled = true;
    dom.refreshBtn.disabled = true;
    return;
  }

  dom.backBtn.disabled = !safeMethod(tab.webview, "canGoBack");
  dom.forwardBtn.disabled = !safeMethod(tab.webview, "canGoForward");
  dom.refreshBtn.disabled = false;
}

function setLoadingState(isLoading) {
  dom.addressInput.classList.toggle("loading", isLoading);
  dom.refreshBtn.textContent = isLoading ? "Stop" : "Reload";
  dom.statusBadge.textContent = isLoading ? "Loading..." : "Ready";
}

function startPageProgress() {
  clearPageProgressTimer();
  state.progressValue = Math.max(state.progressValue, 6);
  applyPageProgress(true);

  state.progressTimer = window.setInterval(() => {
    if (state.progressValue >= 90) {
      return;
    }

    state.progressValue += Math.random() * 5 + 1;
    if (state.progressValue > 90) {
      state.progressValue = 90;
    }

    applyPageProgress(true);
  }, 120);
}

function finishPageProgress() {
  clearPageProgressTimer();
  state.progressValue = 100;
  applyPageProgress(true);
  window.setTimeout(resetPageProgress, 180);
}

function resetPageProgress() {
  clearPageProgressTimer();
  state.progressValue = 0;
  applyPageProgress(false);
}

function clearPageProgressTimer() {
  if (state.progressTimer) {
    window.clearInterval(state.progressTimer);
    state.progressTimer = null;
  }
}

function applyPageProgress(active) {
  dom.pageProgressBar.style.width = `${state.progressValue}%`;
  dom.pageProgressBar.classList.toggle("active", active && state.progressValue > 0);
}
function toggleFullscreen() {
  window.bastionAPI.window.toggleFullscreen();
}

function applyWindowState(windowState) {
  const isMaximized = Boolean(windowState && windowState.isMaximized);
  const isFullscreen = Boolean(windowState && windowState.isFullscreen);

  dom.maximizeBtn.textContent = isMaximized ? "Restore" : "[]";
  dom.fullscreenBtn.classList.toggle("is-active", isFullscreen);
}

async function syncWindowState() {
  const windowState = await window.bastionAPI.window.getState();
  applyWindowState(windowState);
}

function applySettings() {
  document.body.classList.toggle("no-motion", !state.settings.animations);
  document.body.classList.toggle("compact", Boolean(state.settings.compactMode));
  dom.bookmarksBar.style.display = state.settings.showBookmarksBar ? "flex" : "none";
}

function saveSettings() {
  saveJson(SETTINGS_KEY, state.settings);
}

function getDefaultNewTabConfig() {
  return {
    ...DEFAULT_NEW_TAB_CONFIG,
    links: DEFAULT_NEW_TAB_CONFIG.links.map((item) => ({
      label: item.label,
      url: item.url
    }))
  };
}

function normalizeNewTabLinkUrl(rawUrl) {
  const value = String(rawUrl || "").trim();
  if (!value) {
    return "";
  }

  if (/^javascript:/i.test(value)) {
    return "";
  }

  if (
    /^https?:\/\//i.test(value) ||
    /^about:/i.test(value) ||
    /^bastion:\/\//i.test(value) ||
    /^file:\/\//i.test(value)
  ) {
    return value;
  }

  if (/^localhost(?::\d+)?(\/.*)?$/i.test(value)) {
    return `http://${value}`;
  }

  if (value.includes(" ")) {
    return "";
  }

  if (value.includes(".")) {
    return `https://${value}`;
  }

  return "";
}

function deriveNewTabLinkLabel(urlValue) {
  try {
    const parsed = new URL(urlValue);
    if (parsed.hostname) {
      return parsed.hostname.replace(/^www\./i, "");
    }
  } catch (_) {
    // Use fallback label below.
  }

  if (/^about:/i.test(urlValue)) {
    return urlValue;
  }

  return "Quick Link";
}

function sanitizeNewTabLink(entry) {
  const raw = entry && typeof entry === "object" ? entry : {};
  const normalizedUrl = normalizeNewTabLinkUrl(raw.url);
  if (!normalizedUrl) {
    return null;
  }

  let label = String(raw.label || "").trim();
  if (!label) {
    label = deriveNewTabLinkLabel(normalizedUrl);
  }
  if (label.length > 32) {
    label = `${label.slice(0, 31)}...`;
  }

  return {
    label,
    url: normalizedUrl
  };
}

function sanitizeNewTabConfig(payload) {
  const defaults = getDefaultNewTabConfig();
  const raw = payload && typeof payload === "object" ? payload : {};
  const style = String(raw.backgroundStyle || defaults.backgroundStyle);
  const selectedStyle = Object.prototype.hasOwnProperty.call(NEW_TAB_BACKGROUND_OPTIONS, style)
    ? style
    : defaults.backgroundStyle;
  const rawLinks = Array.isArray(raw.links) ? raw.links : defaults.links;
  const links = [];

  for (const item of rawLinks) {
    const sanitized = sanitizeNewTabLink(item);
    if (sanitized) {
      links.push(sanitized);
    }
    if (links.length >= MAX_NEW_TAB_LINKS) {
      break;
    }
  }

  return {
    title: String(raw.title || defaults.title).trim() || defaults.title,
    subtitle: String(raw.subtitle || defaults.subtitle).trim() || defaults.subtitle,
    showClock: typeof raw.showClock === "boolean" ? raw.showClock : defaults.showClock,
    backgroundStyle: selectedStyle,
    links: links.length > 0 ? links : defaults.links
  };
}

function saveNewTabConfig() {
  state.newTab = sanitizeNewTabConfig(state.newTab);
  saveJson(NEW_TAB_KEY, state.newTab);
}

function parseNewTabLinksText(rawText) {
  const source = String(rawText || "");
  const lines = source.split(/\r?\n/);
  const links = [];

  for (const line of lines) {
    const cleaned = line.trim();
    if (!cleaned) {
      continue;
    }

    let label = "";
    let url = cleaned;
    if (cleaned.includes("|")) {
      const [left, ...rest] = cleaned.split("|");
      label = left.trim();
      url = rest.join("|").trim();
    }

    const sanitized = sanitizeNewTabLink({ label, url });
    if (sanitized) {
      links.push(sanitized);
    }
    if (links.length >= MAX_NEW_TAB_LINKS) {
      break;
    }
  }

  return links;
}

function renderBookmarks() {
  dom.bookmarksBar.innerHTML = "";

  if (!Array.isArray(state.bookmarks) || state.bookmarks.length === 0) {
    return;
  }

  for (const bookmark of state.bookmarks) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "bookmark-chip";
    chip.title = `${bookmark.title}\nRight-click to remove`;
    chip.textContent = trimTabTitle(bookmark.title || bookmark.url || "Saved");

    chip.addEventListener("click", () => navigateActiveTab(bookmark.url));
    chip.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      removeBookmark(bookmark.url);
    });

    dom.bookmarksBar.appendChild(chip);
  }
}

function toggleBookmarkForActiveTab() {
  const tab = getActiveTab();
  if (!tab || tab.localPage) {
    return;
  }

  const url = safeUrl(tab.webview) || tab.address;
  if (!url || url === "about:blank") {
    return;
  }

  const existingIndex = state.bookmarks.findIndex((bookmark) => bookmark.url === url);
  if (existingIndex >= 0) {
    state.bookmarks.splice(existingIndex, 1);
    showToast("Removed bookmark.");
  } else {
    state.bookmarks.unshift({
      title: tab.title || url,
      url
    });
    state.bookmarks = state.bookmarks.slice(0, MAX_BOOKMARKS);
    showToast("Saved bookmark.");
  }

  saveJson(BOOKMARKS_KEY, state.bookmarks);
  renderBookmarks();
  updateBookmarkButtonState();
}

function removeBookmark(url) {
  const index = state.bookmarks.findIndex((bookmark) => bookmark.url === url);
  if (index >= 0) {
    state.bookmarks.splice(index, 1);
    saveJson(BOOKMARKS_KEY, state.bookmarks);
    renderBookmarks();
    updateBookmarkButtonState();
    showToast("Bookmark removed.");
  }
}

function updateBookmarkButtonState() {
  const tab = getActiveTab();
  if (!tab || tab.localPage) {
    dom.bookmarkBtn.classList.remove("is-active");
    dom.bookmarkBtn.title = "Bookmark";
    return;
  }

  const url = safeUrl(tab.webview) || tab.address;
  const isSaved = state.bookmarks.some((bookmark) => bookmark.url === url);
  dom.bookmarkBtn.classList.toggle("is-active", isSaved);
  dom.bookmarkBtn.title = isSaved ? "Remove Bookmark" : "Bookmark";
}

async function refreshMetaInfo() {
  state.appMeta = await window.bastionAPI.app.getMeta();
}

async function refreshExtensionList() {
  const list = await window.bastionAPI.extensions.list();
  state.extensions = Array.isArray(list) ? list : [];
}

async function refreshDownloads() {
  const list = await window.bastionAPI.downloads.list();
  state.downloads = Array.isArray(list) ? list : [];
}

async function refreshHistory() {
  const list = await window.bastionAPI.history.list();
  state.history = Array.isArray(list) ? list : [];
}

async function refreshUpdateStatus() {
  const status = await window.bastionAPI.updates.getStatus();
  state.updateStatus = status && typeof status === "object" ? status : null;
}

async function refreshUpdateConfig() {
  const config = await window.bastionAPI.updates.getConfig();
  state.updateConfig = {
    ...DEFAULT_UPDATE_CONFIG,
    ...(config && typeof config === "object" ? config : {})
  };
}

async function refreshPrivacyConfig() {
  const config = await window.bastionAPI.privacy.getConfig();
  state.privacyConfig = {
    ...DEFAULT_PRIVACY_CONFIG,
    ...(config && typeof config === "object" ? config : {})
  };
}

async function refreshPrivacyStats() {
  const stats = await window.bastionAPI.privacy.getStats();
  state.privacyStats = stats && typeof stats === "object" ? stats : null;
}

function addHistoryEntry(url, title) {
  const safeEntry = {
    url,
    title: title || url,
    visitedAt: Date.now()
  };

  window.bastionAPI.history.append(safeEntry).catch(() => {
    // Best effort.
  });
}

function restoreTabsOrCreateFresh() {
  const restored = restoreSession();
  if (!restored) {
    createTab(NEW_TAB_URL, true);
  }
}

function restoreSession() {
  if (!state.settings.restoreSession) {
    return false;
  }

  const payload = loadJson(SESSION_KEY, null);
  if (!payload || !Array.isArray(payload.tabs) || payload.tabs.length === 0) {
    return false;
  }

  const tabs = payload.tabs.slice(0, MAX_TABS);
  for (const entry of tabs) {
    if (typeof entry === "string") {
      createTab(entry, false);
    } else if (entry && typeof entry.url === "string") {
      createTab(entry.url, false);
    }
  }

  const activeIndex = Number.isInteger(payload.activeIndex) ? payload.activeIndex : 0;
  const activeTab = state.tabs[activeIndex] || state.tabs[0];
  if (activeTab) {
    activateTab(activeTab.id);
  }

  return state.tabs.length > 0;
}

function persistSession() {
  if (!state.settings.restoreSession) {
    return;
  }

  const tabs = state.tabs.map((tab) => ({
    url: tab.localPage ? getTabDisplayAddress(tab) : safeUrl(tab.webview) || tab.address || NEW_TAB_URL
  })).slice(0, MAX_TABS);

  const activeIndex = state.tabs.findIndex((tab) => tab.id === state.activeTabId);
  saveJson(SESSION_KEY, {
    tabs,
    activeIndex: activeIndex >= 0 ? activeIndex : 0
  });
}

function handleSpecialNavigation(url, tab, event) {
  if (!url) {
    return false;
  }

  if (isActionUrl(url)) {
    if (event && typeof event.preventDefault === "function") {
      event.preventDefault();
    }
    handleLocalAction(url, tab);
    return true;
  }

  if (isInternalAlias(url)) {
    if (event && typeof event.preventDefault === "function") {
      event.preventDefault();
    }

    const resolved = resolveAddress(url);
    tab.localPage = resolved.localPage;
    tab.address = resolved.url;
    tab.displayAddress = resolved.display;
    if (resolved.localPage) {
      tab.title = getLocalPageTitle(resolved.localPage);
      tab.tabTitle.textContent = trimTabTitle(tab.title);
    }
    tab.webview.loadURL(resolved.url);

    if (tab.id === state.activeTabId) {
      dom.addressInput.value = resolved.display;
    }

    return true;
  }

  return false;
}

function isInternalAlias(url) {
  const value = String(url || "").toLowerCase();
  if (/^about:[a-z0-9-]+$/i.test(value) && value !== "about:blank") {
    return true;
  }

  if (/^bastion:\/\/[a-z0-9-]+$/i.test(value)) {
    return true;
  }

  return (
    value === "about:bastion" ||
    value === "about:home" ||
    value === "bastion://welcome" ||
    value === "about:newtab" ||
    value === "bastion://newtab" ||
    value === "about:settings" ||
    value === "bastion://settings" ||
    value === "about:downloads" ||
    value === "about:history" ||
    value === "about:game" ||
    value === "bastion://game"
  );
}

function isActionUrl(url) {
  return String(url || "").toLowerCase().startsWith("bastion-action://");
}

async function handleLocalAction(url, tab) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (_) {
    return;
  }

  const key = `${parsed.hostname}${parsed.pathname}`.replace(/\/+$/, "");

  if (key === "settings/save") {
    state.settings.animations = parsed.searchParams.get("animations") === "1";
    state.settings.showBookmarksBar = parsed.searchParams.get("showBookmarksBar") === "1";
    state.settings.restoreSession = parsed.searchParams.get("restoreSession") === "1";
    state.settings.compactMode = parsed.searchParams.get("compactMode") === "1";

    if (!state.settings.restoreSession) {
      localStorage.removeItem(SESSION_KEY);
    } else {
      persistSession();
    }

    saveSettings();
    applySettings();
    showToast("Settings saved.");
    refreshLocalPage(tab);
    return;
  }

  if (key === "settings/load-extension") {
    const result = await window.bastionAPI.extensions.loadFromDialog();
    if (result && result.ok && result.detail) {
      showToast(`Extension loaded: ${result.detail.name}`);
      await refreshExtensionList();
    } else if (!result || !result.canceled) {
      showToast(result && result.error ? result.error : "Failed to load extension.", true);
    }
    refreshLocalPage(tab);
    return;
  }

  if (key === "newtab/save") {
    const nextLinks = parseNewTabLinksText(parsed.searchParams.get("links") || "");
    state.newTab = sanitizeNewTabConfig({
      ...state.newTab,
      title: parsed.searchParams.get("title") || "",
      subtitle: parsed.searchParams.get("subtitle") || "",
      showClock: parsed.searchParams.get("showClock") === "1",
      backgroundStyle: parsed.searchParams.get("backgroundStyle") || "",
      links: nextLinks.length > 0 ? nextLinks : state.newTab.links
    });
    saveNewTabConfig();
    showToast("New tab updated.");
    refreshOpenNewTabPages();
    return;
  }

  if (key === "newtab/reset") {
    state.newTab = getDefaultNewTabConfig();
    saveNewTabConfig();
    showToast("New tab reset to defaults.");
    refreshOpenNewTabPages();
    return;
  }

  if (key === "updates/save") {
    const patch = {
      autoCheck: parsed.searchParams.get("autoCheck") === "1",
      autoDownload: parsed.searchParams.get("autoDownload") === "1",
      allowPrerelease: parsed.searchParams.get("allowPrerelease") === "1",
      feedURL: (parsed.searchParams.get("feedURL") || "").trim(),
      useGithubReleaseZip: parsed.searchParams.get("useGithubReleaseZip") === "1",
      autoApplyGithubZip: parsed.searchParams.get("autoApplyGithubZip") === "1",
      autoUpdateUblockOrigin: parsed.searchParams.get("autoUpdateUblockOrigin") === "1"
    };

    await window.bastionAPI.updates.updateConfig(patch);
    await refreshUpdateConfig();
    await refreshUpdateStatus();
    showToast("Update settings saved.");
    refreshLocalPage(tab);
    return;
  }

  if (key === "updates/check") {
    const result = await window.bastionAPI.updates.check();
    await refreshUpdateStatus();

    if (result && result.ok) {
      showToast("Update check started.");
    } else {
      showToast(result && result.error ? result.error : "Unable to check for updates.", true);
    }

    refreshLocalPage(tab);
    return;
  }

  if (key === "updates/download") {
    const result = await window.bastionAPI.updates.download();
    await refreshUpdateStatus();

    if (result && result.ok) {
      showToast("Update download started.");
    } else {
      showToast(result && result.error ? result.error : "Unable to download update.", true);
    }

    refreshLocalPage(tab);
    return;
  }

  if (key === "updates/install") {
    const result = await window.bastionAPI.updates.install();
    if (result && result.ok) {
      showToast("Installing update and restarting...");
    } else {
      showToast(result && result.error ? result.error : "No installable update yet.", true);
    }
    return;
  }

  if (key === "privacy/save") {
    const patch = {
      blockTrackers: parsed.searchParams.get("blockTrackers") === "1",
      upgradeHttps: parsed.searchParams.get("upgradeHttps") === "1",
      sendDoNotTrack: parsed.searchParams.get("sendDoNotTrack") === "1",
      sendGlobalPrivacyControl: parsed.searchParams.get("sendGlobalPrivacyControl") === "1",
      blockThirdPartyCookies: parsed.searchParams.get("blockThirdPartyCookies") === "1",
      stripThirdPartyReferer: parsed.searchParams.get("stripThirdPartyReferer") === "1",
      blockFingerprintingPermissions: parsed.searchParams.get("blockFingerprintingPermissions") === "1",
      clearDataOnExit: parsed.searchParams.get("clearDataOnExit") === "1"
    };

    await window.bastionAPI.privacy.updateConfig(patch);
    await refreshPrivacyConfig();
    await refreshPrivacyStats();
    showToast("Privacy settings saved.");
    refreshLocalPage(tab);
    return;
  }

  if (key === "privacy/clear-data") {
    const scope = (parsed.searchParams.get("scope") || "all").toLowerCase();
    const result = await window.bastionAPI.privacy.clearData(scope);
    if (result && result.ok) {
      if (scope === "downloads" || scope === "all") {
        await refreshDownloads();
      }
      if (scope === "history" || scope === "all") {
        await refreshHistory();
      }
      await refreshPrivacyStats();
      showToast("Data cleared.");
      refreshOpenLocalPages();
    } else {
      showToast(result && result.error ? result.error : "Unable to clear data.", true);
    }
    return;
  }

  if (key === "downloads/clear") {
    await window.bastionAPI.downloads.clearCompleted();
    await refreshDownloads();
    showToast("Cleared completed downloads.");
    refreshLocalPage(tab);
    return;
  }

  if (key === "downloads/open") {
    const id = parsed.searchParams.get("id") || "";
    const result = await window.bastionAPI.downloads.openFile(id);
    if (!result.ok) {
      showToast(result.error || "Unable to open file.", true);
    }
    return;
  }

  if (key === "downloads/folder") {
    const id = parsed.searchParams.get("id") || "";
    const result = await window.bastionAPI.downloads.showInFolder(id);
    if (!result.ok) {
      showToast(result.error || "Unable to show file in folder.", true);
    }
    return;
  }

  if (key === "history/clear") {
    await window.bastionAPI.history.clear();
    await refreshHistory();
    showToast("History cleared.");
    refreshLocalPage(tab);
    return;
  }

  if (key === "tabs/reopen") {
    reopenLastClosedTab();
    refreshLocalPage(tab);
  }
}

function refreshLocalPage(tab) {
  if (!tab || !tab.localPage) {
    return;
  }

  const resolved = resolveAddress(`about:${tab.localPage}`);
  if (!resolved || !resolved.url) {
    return;
  }

  tab.address = resolved.url;
  tab.displayAddress = resolved.display;
  tab.title = getLocalPageTitle(tab.localPage);
  tab.tabTitle.textContent = trimTabTitle(tab.title);
  tab.webview.loadURL(resolved.url);

  if (tab.id === state.activeTabId) {
    dom.addressInput.value = resolved.display;
  }
}

function refreshOpenLocalPages() {
  for (const tab of state.tabs) {
    if (tab.localPage === "settings" || tab.localPage === "downloads" || tab.localPage === "history") {
      refreshLocalPage(tab);
    }
  }
}

function refreshOpenNewTabPages() {
  for (const tab of state.tabs) {
    if (tab.localPage === "newtab") {
      refreshLocalPage(tab);
    }
  }
}
function buildLocalPage(title, bodyHtml, script = "") {
  const html = `
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: dark; }
    body {
      margin: 0;
      font-family: "Segoe UI", sans-serif;
      background: #0a1018;
      color: #e6edf6;
      line-height: 1.5;
    }
    main { max-width: 980px; margin: 0 auto; padding: 24px; }
    h1 { margin: 0 0 8px; font-size: 30px; }
    h2 { margin: 22px 0 8px; font-size: 20px; }
    p { margin: 0 0 10px; color: #a5bbcf; }
    .grid { display: grid; gap: 10px; }
    .card {
      border: 1px solid #2a3e56;
      background: #111a27;
      padding: 12px;
      border-radius: 0;
    }
    .card h3 { margin: 0 0 8px; font-size: 15px; }
    .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .row label { display: flex; align-items: center; gap: 8px; }
    .muted { color: #9cb2c8; font-size: 13px; }
    a, button {
      border: 1px solid #3d5d7f;
      background: #1b2a3c;
      color: #e6edf6;
      border-radius: 0;
      text-decoration: none;
      cursor: pointer;
      min-height: 34px;
      padding: 7px 12px;
      font-size: 14px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    a:hover, button:hover { background: #23364e; }
    input[type='checkbox'] { width: 18px; height: 18px; accent-color: #4ca6ff; }
    input[type='url'] {
      border: 1px solid #3d5d7f;
      background: #111a27;
      color: #e6edf6;
      border-radius: 0;
      padding: 8px 10px;
      min-width: 280px;
    }
    .link-list { display: grid; gap: 6px; }
    .table { display: grid; gap: 8px; }
    .bar {
      height: 6px;
      background: #1d2a3b;
      border-radius: 0;
      overflow: hidden;
    }
    .bar > span { display: block; height: 100%; background: #4ca6ff; }
    canvas {
      width: 100%;
      max-width: 720px;
      height: auto;
      border: 1px solid #365173;
      background: #111a27;
      display: block;
    }
  </style>
</head>
<body>
  <main>
    ${bodyHtml}
  </main>
  <script>
    ${script}
  </script>
</body>
</html>
  `;

  return `data:text/html;charset=UTF-8,${encodeURIComponent(html)}`;
}

function buildWelcomePage() {
  const body = `
    <h1>Bastion Browser</h1>
    <p>DuckDuckGo is your default search engine. This browser includes local pages for settings, downloads, history and an offline game.</p>
    <div class="row">
      <a href="about:newtab">Open New Tab</a>
      <a href="about:settings">Open Settings</a>
      <a href="about:downloads">View Downloads</a>
      <a href="about:history">View History</a>
      <a href="about:game">Play Offline Game</a>
    </div>
    <h2>Shortcuts</h2>
    <div class="card">
      <div class="link-list">
        <div>Ctrl+L or Ctrl+K: Focus address bar</div>
        <div>Ctrl+T: New tab</div>
        <div>Ctrl+Shift+T: Reopen closed tab</div>
        <div>Ctrl+W: Close tab</div>
        <div>Ctrl+, : Open local settings page</div>
        <div>F11: Fullscreen</div>
      </div>
    </div>
  `;

  return buildLocalPage("Bastion Home", body);
}

function buildNewTabPage() {
  const config = sanitizeNewTabConfig(state.newTab);
  const backgroundOption = NEW_TAB_BACKGROUND_OPTIONS[config.backgroundStyle] || NEW_TAB_BACKGROUND_OPTIONS.steel;
  const optionRows = Object.entries(NEW_TAB_BACKGROUND_OPTIONS).map(([value, detail]) => {
    const selected = value === config.backgroundStyle ? "selected" : "";
    return `<option value="${escapeHtml(value)}" ${selected}>${escapeHtml(detail.label)}</option>`;
  }).join("");

  const quickLinks = config.links.length > 0
    ? config.links.map((link) => {
        const compactUrl = escapeHtml(link.url.replace(/^https?:\/\//i, "").replace(/\/$/, ""));
        return `<a class="quick-link" href="${escapeHtml(link.url)}"><strong>${escapeHtml(link.label)}</strong><span>${compactUrl}</span></a>`;
      }).join("")
    : '<div class="card"><div class="muted">No quick links yet. Add some below.</div></div>';

  const linksText = config.links.map((link) => `${link.label} | ${link.url}`).join("\n");
  const clockStyle = config.showClock ? "" : 'style="display:none;"';

  const body = `
    <style>
      .newtab-hero {
        border: 1px solid #35506f;
        padding: 18px;
        margin-bottom: 16px;
        background: ${escapeHtml(backgroundOption.css)};
      }
      .newtab-hero h1 { margin: 0 0 8px; font-size: 34px; }
      .newtab-hero p { margin: 0; color: #c2d7ec; }
      .clock { margin-top: 12px; color: #d7ebff; font-size: 24px; font-weight: 700; letter-spacing: 0.04em; }
      .search-row { display: grid; grid-template-columns: minmax(160px, 1fr) auto; gap: 8px; margin-top: 14px; }
      .search-row input, textarea, select {
        border: 1px solid #3d5d7f;
        background: #111a27;
        color: #e6edf6;
        border-radius: 0;
        padding: 8px 10px;
        font-family: inherit;
        font-size: 14px;
      }
      textarea { min-height: 120px; resize: vertical; }
      .quick-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 10px;
      }
      .quick-link {
        display: grid;
        gap: 4px;
        border: 1px solid #35506f;
        background: #132235;
        padding: 10px;
        text-decoration: none;
        color: #e6edf6;
      }
      .quick-link span {
        color: #9bb7d3;
        font-size: 12px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    </style>

    <div class="newtab-hero">
      <h1>${escapeHtml(config.title)}</h1>
      <p>${escapeHtml(config.subtitle)}</p>
      <div id="newtabClock" class="clock" ${clockStyle}>--:--:--</div>
      <form id="newTabSearchForm" class="search-row">
        <input id="newTabSearchInput" type="text" placeholder="Search DuckDuckGo" autocomplete="off" />
        <button type="submit">Search</button>
      </form>
    </div>

    <h2>Quick Links</h2>
    <div class="quick-grid">${quickLinks}</div>

    <h2>Customize New Tab</h2>
    <div class="card">
      <form id="newTabCustomizeForm" class="grid">
        <label class="grid">
          <span>Title</span>
          <input id="newTabTitle" type="text" value="${escapeHtml(config.title)}" maxlength="60" />
        </label>
        <label class="grid">
          <span>Subtitle</span>
          <input id="newTabSubtitle" type="text" value="${escapeHtml(config.subtitle)}" maxlength="120" />
        </label>
        <label><input id="newTabShowClock" type="checkbox" ${config.showClock ? "checked" : ""} /> Show clock</label>
        <label class="grid">
          <span>Background style</span>
          <select id="newTabBackgroundStyle">${optionRows}</select>
        </label>
        <label class="grid">
          <span>Quick links (one per line: <code>Label | URL</code>)</span>
          <textarea id="newTabLinks">${escapeHtml(linksText)}</textarea>
        </label>
        <div class="row">
          <button type="submit">Save New Tab</button>
          <a href="bastion-action://newtab/reset">Reset Defaults</a>
          <a href="about:settings">Open Settings</a>
        </div>
      </form>
    </div>
  `;

  const script = `
    const searchPrefix = ${JSON.stringify(SEARCH_PREFIX)};
    const showClock = ${config.showClock ? "true" : "false"};
    const clockEl = document.getElementById('newtabClock');
    const searchForm = document.getElementById('newTabSearchForm');
    const searchInput = document.getElementById('newTabSearchInput');
    const customizeForm = document.getElementById('newTabCustomizeForm');

    function tickClock() {
      if (!showClock || !clockEl) return;
      clockEl.textContent = new Date().toLocaleTimeString();
    }

    if (showClock && clockEl) {
      tickClock();
      setInterval(tickClock, 1000);
    }

    searchInput.focus();
    searchForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const query = searchInput.value.trim();
      if (!query) return;
      location.href = searchPrefix + encodeURIComponent(query);
    });

    customizeForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const q = new URLSearchParams();
      q.set('title', document.getElementById('newTabTitle').value.trim());
      q.set('subtitle', document.getElementById('newTabSubtitle').value.trim());
      q.set('showClock', document.getElementById('newTabShowClock').checked ? '1' : '0');
      q.set('backgroundStyle', document.getElementById('newTabBackgroundStyle').value);
      q.set('links', document.getElementById('newTabLinks').value);
      location.href = 'bastion-action://newtab/save?' + q.toString();
    });
  `;

  return buildLocalPage("Bastion New Tab", body, script);
}

function buildSettingsPage() {
  const checked = (value) => (value ? "checked" : "");
  const update = {
    ...DEFAULT_UPDATE_CONFIG,
    ...(state.updateConfig || {})
  };
  const privacy = {
    ...DEFAULT_PRIVACY_CONFIG,
    ...(state.privacyConfig || {})
  };
  const updateStatus = state.updateStatus || {};
  const privacyStats = state.privacyStats || {};
  const metaText = state.appMeta
    ? `${escapeHtml(state.appMeta.name)} ${escapeHtml(state.appMeta.version)} on ${escapeHtml(state.appMeta.platform)}`
    : "Loading app info...";

  const extensionItems = state.extensions.length
    ? state.extensions.map((ext) => `<div class="card"><h3>${escapeHtml(ext.name || "Unnamed")}</h3><div class="muted">v${escapeHtml(ext.version || "unknown")} ${escapeHtml(ext.source || "")}</div></div>`).join("")
    : '<div class="card"><div class="muted">No extensions loaded.</div></div>';

  const updateStatusText = humanUpdateStatus(updateStatus.status);
  const updateMessage = updateStatus.message ? escapeHtml(updateStatus.message) : "Idle";
  const currentVersion = updateStatus.currentVersion
    ? escapeHtml(updateStatus.currentVersion)
    : (state.appMeta ? escapeHtml(state.appMeta.version) : "unknown");
  const availableVersion = updateStatus.availableVersion
    ? escapeHtml(updateStatus.availableVersion)
    : "None";
  const checkedAtText = updateStatus.checkedAt ? escapeHtml(formatDateTime(updateStatus.checkedAt)) : "Never";
  const updateSource = updateStatus.source ? escapeHtml(updateStatus.source) : "none";
  const updateFilePath = updateStatus.updateFilePath
    ? `<div class="muted">Downloaded file: ${escapeHtml(updateStatus.updateFilePath)}</div>`
    : "";
  const updateReleasePage = updateStatus.releasePage
    ? `<div class="muted"><a href="${escapeHtml(updateStatus.releasePage)}">Open release page</a></div>`
    : "";
  const updaterError = updateStatus.error
    ? `<div class="muted">Error: ${escapeHtml(updateStatus.error)}</div>`
    : "";

  const statsStartedAt = privacyStats.startedAt
    ? escapeHtml(formatDateTime(privacyStats.startedAt))
    : "Current session";

  const body = `
    <h1>Settings</h1>
    <p>Local settings are saved to disk in your profile automatically.</p>

    <div class="card">
      <h3>Experience</h3>
      <form id="settingsForm" class="grid">
        <label><input id="animations" type="checkbox" ${checked(state.settings.animations)} /> Smooth animations</label>
        <label><input id="bookmarks" type="checkbox" ${checked(state.settings.showBookmarksBar)} /> Show bookmarks bar</label>
        <label><input id="restore" type="checkbox" ${checked(state.settings.restoreSession)} /> Restore session on launch</label>
        <label><input id="compact" type="checkbox" ${checked(state.settings.compactMode)} /> Compact navigation mode</label>
        <div class="row">
          <button type="submit">Save Settings</button>
          <a href="about:bastion">Back Home</a>
        </div>
      </form>
    </div>

    <h2>Updates</h2>
    <div class="card">
      <h3>Chromium/Electron Auto Update</h3>
      <form id="updatesForm" class="grid">
        <label><input id="useGithubReleaseZip" type="checkbox" ${checked(update.useGithubReleaseZip)} /> Use GitHub release ZIP updater at launch (downloads latest update.zip)</label>
        <label><input id="autoApplyGithubZip" type="checkbox" ${checked(update.autoApplyGithubZip)} /> Auto-apply downloaded update.zip on launch (Windows packaged app)</label>
        <label><input id="autoUpdateUblockOrigin" type="checkbox" ${checked(update.autoUpdateUblockOrigin)} /> Auto-check and update managed uBlock Origin on launch</label>
        <label><input id="autoCheck" type="checkbox" ${checked(update.autoCheck)} /> Auto check for updates</label>
        <label><input id="autoDownload" type="checkbox" ${checked(update.autoDownload)} /> Auto download updates</label>
        <label><input id="allowPrerelease" type="checkbox" ${checked(update.allowPrerelease)} /> Allow prerelease builds</label>
        <label class="grid">
          <span>Update feed URL (optional)</span>
          <input id="feedURL" type="url" value="${escapeHtml(update.feedURL || "")}" placeholder="https://updates.example.com/bastion/win/" />
        </label>
        <div class="row">
          <button type="submit">Save Update Settings</button>
          <a href="bastion-action://updates/check">Check Now</a>
          <a href="bastion-action://updates/download">Download Update</a>
          <a href="bastion-action://updates/install">Install Downloaded Update</a>
        </div>
      </form>
      <div class="muted">Status: ${escapeHtml(updateStatusText)} (${updateMessage})</div>
      <div class="muted">Updater source: ${updateSource}</div>
      <div class="muted">Current version: ${currentVersion}</div>
      <div class="muted">Available version: ${availableVersion}</div>
      <div class="muted">Last checked: ${checkedAtText}</div>
      ${updateFilePath}
      ${updateReleasePage}
      ${updaterError}
    </div>

    <h2>Privacy</h2>
    <div class="card">
      <h3>Privacy Controls</h3>
      <form id="privacyForm" class="grid">
        <label><input id="blockTrackers" type="checkbox" ${checked(privacy.blockTrackers)} /> Block known third-party trackers</label>
        <label><input id="upgradeHttps" type="checkbox" ${checked(privacy.upgradeHttps)} /> Upgrade HTTP requests to HTTPS</label>
        <label><input id="sendDoNotTrack" type="checkbox" ${checked(privacy.sendDoNotTrack)} /> Send Do Not Track header</label>
        <label><input id="sendGlobalPrivacyControl" type="checkbox" ${checked(privacy.sendGlobalPrivacyControl)} /> Send Global Privacy Control header</label>
        <label><input id="blockThirdPartyCookies" type="checkbox" ${checked(privacy.blockThirdPartyCookies)} /> Strip third-party cookie headers</label>
        <label><input id="stripThirdPartyReferer" type="checkbox" ${checked(privacy.stripThirdPartyReferer)} /> Strip third-party Referer headers</label>
        <label><input id="blockFingerprintingPermissions" type="checkbox" ${checked(privacy.blockFingerprintingPermissions)} /> Block fingerprinting-related permissions</label>
        <label><input id="clearDataOnExit" type="checkbox" ${checked(privacy.clearDataOnExit)} /> Clear cache/history/downloads on app exit</label>
        <div class="row">
          <button type="submit">Save Privacy Settings</button>
        </div>
      </form>
      <div class="row">
        <a href="bastion-action://privacy/clear-data?scope=cache">Clear Cache</a>
        <a href="bastion-action://privacy/clear-data?scope=cookies">Clear Cookies</a>
        <a href="bastion-action://privacy/clear-data?scope=history">Clear History</a>
        <a href="bastion-action://privacy/clear-data?scope=downloads">Clear Download Records</a>
        <a href="bastion-action://privacy/clear-data?scope=all">Clear All Browser Data</a>
      </div>
    </div>

    <div class="card">
      <h3>Privacy Stats</h3>
      <div class="muted">Blocked tracker requests: ${escapeHtml(String(privacyStats.blockedRequests || 0))}</div>
      <div class="muted">HTTP upgrades to HTTPS: ${escapeHtml(String(privacyStats.upgradedToHttps || 0))}</div>
      <div class="muted">Stripped cookie headers: ${escapeHtml(String(privacyStats.strippedCookieHeaders || 0))}</div>
      <div class="muted">Stripped Referer headers: ${escapeHtml(String(privacyStats.strippedRefererHeaders || 0))}</div>
      <div class="muted">Blocked permission prompts: ${escapeHtml(String(privacyStats.blockedPermissions || 0))}</div>
      <div class="muted">Tracking since: ${statsStartedAt}</div>
    </div>

    <h2>Extensions</h2>
    <p class="muted">Load unpacked Chrome extensions from a folder.</p>
    <div class="row">
      <a href="bastion-action://settings/load-extension">Load Extension Folder</a>
    </div>
    <div class="grid">${extensionItems}</div>

    <h2>Tools</h2>
    <div class="row">
      <a href="about:newtab">Open New Tab Page</a>
      <a href="about:downloads">Open Downloads Page</a>
      <a href="about:history">Open History Page</a>
      <a href="about:game">Open Offline Game</a>
      <a href="bastion-action://tabs/reopen">Reopen Closed Tab</a>
    </div>

    <h2>Build</h2>
    <div class="card"><div class="muted">${metaText}</div></div>
  `;

  const script = `
    const settingsForm = document.getElementById('settingsForm');
    settingsForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const q = new URLSearchParams();
      q.set('animations', document.getElementById('animations').checked ? '1' : '0');
      q.set('showBookmarksBar', document.getElementById('bookmarks').checked ? '1' : '0');
      q.set('restoreSession', document.getElementById('restore').checked ? '1' : '0');
      q.set('compactMode', document.getElementById('compact').checked ? '1' : '0');
      location.href = 'bastion-action://settings/save?' + q.toString();
    });

    const updatesForm = document.getElementById('updatesForm');
    updatesForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const q = new URLSearchParams();
      q.set('useGithubReleaseZip', document.getElementById('useGithubReleaseZip').checked ? '1' : '0');
      q.set('autoApplyGithubZip', document.getElementById('autoApplyGithubZip').checked ? '1' : '0');
      q.set('autoUpdateUblockOrigin', document.getElementById('autoUpdateUblockOrigin').checked ? '1' : '0');
      q.set('autoCheck', document.getElementById('autoCheck').checked ? '1' : '0');
      q.set('autoDownload', document.getElementById('autoDownload').checked ? '1' : '0');
      q.set('allowPrerelease', document.getElementById('allowPrerelease').checked ? '1' : '0');
      q.set('feedURL', document.getElementById('feedURL').value.trim());
      location.href = 'bastion-action://updates/save?' + q.toString();
    });

    const privacyForm = document.getElementById('privacyForm');
    privacyForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const q = new URLSearchParams();
      q.set('blockTrackers', document.getElementById('blockTrackers').checked ? '1' : '0');
      q.set('upgradeHttps', document.getElementById('upgradeHttps').checked ? '1' : '0');
      q.set('sendDoNotTrack', document.getElementById('sendDoNotTrack').checked ? '1' : '0');
      q.set('sendGlobalPrivacyControl', document.getElementById('sendGlobalPrivacyControl').checked ? '1' : '0');
      q.set('blockThirdPartyCookies', document.getElementById('blockThirdPartyCookies').checked ? '1' : '0');
      q.set('stripThirdPartyReferer', document.getElementById('stripThirdPartyReferer').checked ? '1' : '0');
      q.set('blockFingerprintingPermissions', document.getElementById('blockFingerprintingPermissions').checked ? '1' : '0');
      q.set('clearDataOnExit', document.getElementById('clearDataOnExit').checked ? '1' : '0');
      location.href = 'bastion-action://privacy/save?' + q.toString();
    });
  `;

  return buildLocalPage("Bastion Settings", body, script);
}

function buildDownloadsPage() {
  const items = state.downloads.length
    ? state.downloads.map((item) => {
        const progress = getDownloadProgress(item);
        const actions = item.savePath
          ? `<div class="row"><a href="bastion-action://downloads/open?id=${encodeURIComponent(item.id)}">Open</a><a href="bastion-action://downloads/folder?id=${encodeURIComponent(item.id)}">Show Folder</a></div>`
          : "";

        return `<div class="card"><h3>${escapeHtml(item.filename || 'Unknown file')}</h3><div class="muted">${escapeHtml(humanDownloadState(item.state))}</div><div class="bar"><span style="width:${progress}%"></span></div><div class="muted">${escapeHtml(formatBytes(item.receivedBytes))} / ${escapeHtml(formatBytes(item.totalBytes))}</div>${actions}</div>`;
      }).join("")
    : '<div class="card"><div class="muted">No downloads yet.</div></div>';

  const body = `
    <h1>Downloads</h1>
    <p>These download entries are saved to disk and restored on app launch.</p>
    <div class="row">
      <a href="bastion-action://downloads/clear">Clear Completed</a>
      <a href="about:settings">Back to Settings</a>
    </div>
    <div class="table">${items}</div>
  `;

  return buildLocalPage("Bastion Downloads", body);
}

function buildHistoryPage() {
  const rows = state.history.length
    ? state.history.slice(0, 500).map((entry) => `<div class="card"><h3>${escapeHtml(entry.title || entry.url)}</h3><div class="muted">${escapeHtml(formatDateTime(entry.visitedAt))}</div><div class="row"><a href="${escapeHtml(entry.url)}">Open</a></div></div>`).join("")
    : '<div class="card"><div class="muted">History is empty.</div></div>';

  const body = `
    <h1>History</h1>
    <p>Browsing history is persisted to disk.</p>
    <div class="row">
      <a href="bastion-action://history/clear">Clear History</a>
      <a href="about:settings">Back to Settings</a>
    </div>
    <div class="table">${rows}</div>
  `;

  return buildLocalPage("Bastion History", body);
}

function buildGamePage() {
  const body = `
    <h1>Offline Game: Bastion Defender</h1>
    <p>Move with Left/Right arrows. Block incoming red squares. Works fully offline.</p>
    <canvas id="game" width="720" height="420"></canvas>
    <div class="row"><a href="about:bastion">Back Home</a></div>
  `;

  const script = `
    const canvas = document.getElementById('game');
    const ctx = canvas.getContext('2d');

    const player = { x: 340, y: 390, w: 80, h: 16, speed: 7 };
    const keys = { left: false, right: false };
    const blocks = [];
    let score = 0;
    let lives = 3;
    let frame = 0;

    window.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') keys.left = true;
      if (e.key === 'ArrowRight') keys.right = true;
    });

    window.addEventListener('keyup', (e) => {
      if (e.key === 'ArrowLeft') keys.left = false;
      if (e.key === 'ArrowRight') keys.right = false;
    });

    function spawnBlock() {
      const size = 16 + Math.random() * 18;
      blocks.push({
        x: Math.random() * (canvas.width - size),
        y: -size,
        s: size,
        v: 2 + Math.random() * 2.8
      });
    }

    function update() {
      if (keys.left) player.x -= player.speed;
      if (keys.right) player.x += player.speed;
      player.x = Math.max(0, Math.min(canvas.width - player.w, player.x));

      frame += 1;
      if (frame % 24 === 0) spawnBlock();

      for (let i = blocks.length - 1; i >= 0; i -= 1) {
        const b = blocks[i];
        b.y += b.v;

        const hit = b.x < player.x + player.w &&
                    b.x + b.s > player.x &&
                    b.y < player.y + player.h &&
                    b.y + b.s > player.y;

        if (hit) {
          score += 1;
          blocks.splice(i, 1);
          continue;
        }

        if (b.y > canvas.height) {
          lives -= 1;
          blocks.splice(i, 1);
          if (lives <= 0) {
            blocks.length = 0;
            lives = 3;
            score = 0;
          }
        }
      }
    }

    function draw() {
      ctx.fillStyle = '#0e1724';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = '#4ca6ff';
      ctx.fillRect(player.x, player.y, player.w, player.h);

      ctx.fillStyle = '#f87171';
      for (const b of blocks) {
        ctx.fillRect(b.x, b.y, b.s, b.s);
      }

      ctx.fillStyle = '#e6edf6';
      ctx.font = '16px Segoe UI';
      ctx.fillText('Score: ' + score, 14, 24);
      ctx.fillText('Lives: ' + lives, 14, 46);
    }

    function loop() {
      update();
      draw();
      requestAnimationFrame(loop);
    }

    loop();
  `;

  return buildLocalPage("Bastion Offline Game", body, script);
}

function getDownloadProgress(download) {
  const received = Number((download && download.receivedBytes) || 0);
  const total = Number((download && download.totalBytes) || 0);
  if (total <= 0) {
    return download && download.state === "completed" ? 100 : 0;
  }
  return Math.max(0, Math.min(100, Math.round((received / total) * 100)));
}

function humanDownloadState(stateValue) {
  const value = String(stateValue || "progressing");
  if (value === "progressing") {
    return "Downloading";
  }
  if (value === "completed") {
    return "Completed";
  }
  if (value === "cancelled") {
    return "Cancelled";
  }
  if (value === "interrupted") {
    return "Interrupted";
  }
  return value;
}

function humanUpdateStatus(statusValue) {
  const value = String(statusValue || "idle").toLowerCase();
  if (value === "checking") {
    return "Checking";
  }
  if (value === "available") {
    return "Available";
  }
  if (value === "downloading") {
    return "Downloading";
  }
  if (value === "downloaded") {
    return "Downloaded";
  }
  if (value === "installing") {
    return "Installing";
  }
  if (value === "disabled") {
    return "Disabled";
  }
  if (value === "error") {
    return "Error";
  }
  return "Idle";
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let current = value;
  let index = 0;

  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index += 1;
  }

  const digits = current >= 100 || index === 0 ? 0 : 1;
  return `${current.toFixed(digits)} ${units[index]}`;
}

function formatDateTime(value) {
  const date = new Date(Number(value || Date.now()));
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }
  return date.toLocaleString();
}

function updateTabFavicon(tab, faviconUrl) {
  if (!tab || !tab.favicon) {
    return;
  }
  tab.favicon.src = faviconUrl || DEFAULT_FAVICON;
}

function pickBestFavicon(favicons) {
  if (!Array.isArray(favicons) || favicons.length === 0) {
    return "";
  }

  const cleaned = favicons
    .map((item) => String(item || "").trim())
    .filter((item) => item.length > 0);

  if (cleaned.length === 0) {
    return "";
  }

  const preferred = cleaned.find((item) => /^https:\/\//i.test(item)) ||
    cleaned.find((item) => /^http:\/\//i.test(item)) ||
    cleaned.find((item) => /^data:image\//i.test(item));

  return preferred || cleaned[0];
}

function inferFavicon(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return `${parsed.origin}/favicon.ico`;
    }
  } catch (_) {
    // Ignore parse errors and fall back.
  }
  return DEFAULT_FAVICON;
}

function showToast(message, isError = false) {
  const toast = document.createElement("div");
  toast.className = `toast${isError ? " error" : ""}`;
  toast.textContent = message;
  dom.toastContainer.appendChild(toast);

  window.setTimeout(() => {
    toast.remove();
  }, 2600);
}

function trimTabTitle(title) {
  const text = String(title || "New Tab");
  return text.length > 30 ? `${text.slice(0, 29)}...` : text;
}

function safeMethod(object, methodName) {
  try {
    if (!object || typeof object[methodName] !== "function") {
      return false;
    }
    return Boolean(object[methodName]());
  } catch (_) {
    return false;
  }
}

function safeUrl(webview) {
  try {
    return webview.getURL();
  } catch (_) {
    return "";
  }
}

function loadJson(key, fallbackValue) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallbackValue;
  } catch (_) {
    return fallbackValue;
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
