// --- In-memory state ---
let currentMode = "direct";
let domainSet = [];
let proxyConfig = null; // { scheme, host, port }
let restoreDirectTimer = null;

const RESTORE_DIRECT_DELAY = 500; // ms delay before switching back to direct

// --- Proxy mode switching ---

function setProxyDirect() {
  if (currentMode === "direct") return;
  currentMode = "direct";
  chrome.proxy.settings.set(
    { value: { mode: "direct" }, scope: "regular" },
    () => console.log("[Selective Proxy] switch to direct")
  );
}

function setProxyFixed(hostname) {
  if (!proxyConfig) return;
  if (currentMode === "proxy") return;
  currentMode = "proxy";
  chrome.proxy.settings.set(
    {
      value: {
        mode: "fixed_servers",
        rules: {
          singleProxy: {
            scheme: proxyConfig.scheme,
            host: proxyConfig.host,
            port: proxyConfig.port
          }
        }
      },
      scope: "regular"
    },
    () => console.log("[Selective Proxy] switch to proxy for", hostname)
  );
}

// --- Domain matching ---
// "chatgpt.com" matches chatgpt.com, www.chatgpt.com, anything.chatgpt.com

function hostnameMatchesWhitelist(hostname) {
  for (const domain of domainSet) {
    if (hostname === domain || hostname.endsWith("." + domain)) {
      return true;
    }
  }
  return false;
}

// --- Navigation handler ---

function handleNavigation(hostname) {
  // Cancel any pending restore-to-direct
  if (restoreDirectTimer !== null) {
    clearTimeout(restoreDirectTimer);
    restoreDirectTimer = null;
  }

  if (hostnameMatchesWhitelist(hostname)) {
    setProxyFixed(hostname);
  } else {
    // Delay switching back to direct to avoid rapid toggling on subpage loads
    restoreDirectTimer = setTimeout(() => {
      restoreDirectTimer = null;
      setProxyDirect();
    }, RESTORE_DIRECT_DELAY);
  }
}

// --- Parse proxy server string "host:port" or "scheme://host:port" ---

function parseProxyServer(serverStr) {
  if (!serverStr) return null;
  let scheme = "http";
  let rest = serverStr;
  const schemeMatch = serverStr.match(/^(https?|socks[45]?):\/\//);
  if (schemeMatch) {
    scheme = schemeMatch[1];
    rest = serverStr.slice(schemeMatch[0].length);
  }
  const parts = rest.split(":");
  const host = parts[0];
  const port = parseInt(parts[1], 10) || 7890;
  return { scheme, host, port };
}

// --- Load config from storage ---

function loadConfig(callback) {
  chrome.storage.sync.get(["proxyServer", "whitelistDomains"], (result) => {
    proxyConfig = parseProxyServer(result.proxyServer || "");
    const raw = result.whitelistDomains || "";
    domainSet = raw
      .split("\n")
      .map((d) => d.trim().toLowerCase())
      .filter((d) => d.length > 0);

    if (!proxyConfig || domainSet.length === 0) {
      // No proxy configured or no domains — ensure direct mode
      currentMode = "proxy"; // force state so setProxyDirect actually fires
      setProxyDirect();
    }

    if (callback) callback();
  });
}

// --- Event listeners ---

// Top-level navigations only (frameId === 0)
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return;
  try {
    const url = new URL(details.url);
    if (url.protocol === "http:" || url.protocol === "https:") {
      handleNavigation(url.hostname.toLowerCase());
    }
  } catch (e) {
    // ignore invalid URLs (chrome://, about:, etc.)
  }
});

// Also catch tab switches so proxy mode matches the active tab
chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (chrome.runtime.lastError || !tab || !tab.url) return;
    try {
      const url = new URL(tab.url);
      if (url.protocol === "http:" || url.protocol === "https:") {
        handleNavigation(url.hostname.toLowerCase());
      } else {
        // Non-http tab (new tab, settings, etc.) — go direct
        if (restoreDirectTimer !== null) {
          clearTimeout(restoreDirectTimer);
          restoreDirectTimer = null;
        }
        setProxyDirect();
      }
    } catch (e) {
      // ignore
    }
  });
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "updateProxy") {
    loadConfig(() => {
      // Re-evaluate the current active tab after config reload
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs[0] && tabs[0].url) {
          try {
            const url = new URL(tabs[0].url);
            if (url.protocol === "http:" || url.protocol === "https:") {
              // Reset mode to force re-evaluation
              const wasMode = currentMode;
              currentMode = currentMode === "proxy" ? "direct" : "proxy";
              handleNavigation(url.hostname.toLowerCase());
            }
          } catch (e) {
            // ignore
          }
        }
        sendResponse({ success: true });
      });
    });
    return true; // async response
  }
});

// On install/update: load config and set direct as default
chrome.runtime.onInstalled.addListener(() => {
  loadConfig();
});

// On service worker startup: reload config from storage
loadConfig();