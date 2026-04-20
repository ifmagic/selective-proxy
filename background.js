let currentState = "unknown";
let currentPacScript = "";
let cachedConfig = null;
let lastStatus = {
  mode: "unknown",
  hostname: "",
  reason: "Initializing",
  lastError: ""
};

function readStoredSettings(callback) {
  chrome.storage.sync.get(
    ["proxyServer", "whitelistDomains", "proxyEnabled"],
    (syncResult) => {
      chrome.storage.local.get(
        ["proxyServer", "whitelistDomains", "proxyEnabled"],
        (localResult) => {
          const merged = {
            proxyServer: (syncResult.proxyServer ?? localResult.proxyServer ?? "").trim(),
            whitelistDomains: syncResult.whitelistDomains ?? localResult.whitelistDomains ?? "",
            proxyEnabled: syncResult.proxyEnabled ?? localResult.proxyEnabled ?? true
          };

          callback(merged);
        }
      );
    }
  );
}

function setLastStatus(mode, hostname, reason) {
  lastStatus = {
    mode,
    hostname: hostname || "",
    reason,
    lastError: lastStatus.lastError || ""
  };
}

function setLastError(message) {
  lastStatus = {
    ...lastStatus,
    lastError: message || ""
  };
}

function loadConfig(callback) {
  readStoredSettings((result) => {
      const enabled = result.proxyEnabled !== false;
      const proxyServer = result.proxyServer;
      const domains = (result.whitelistDomains || "")
        .split("\n")
        .map((domain) => domain.trim().toLowerCase())
        .filter((domain) => domain.length > 0);

      cachedConfig = {
        enabled,
        proxyServer,
        domains,
        parsedProxy: parseProxyServer(proxyServer)
      };

      if (callback) callback(cachedConfig);
    });
}

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
  const port = parts[1] ? parseInt(parts[1], 10) : NaN;

  if (!host || isNaN(port) || port < 1 || port > 65535) {
    return null;
  }

  const typeMap = {
    http: "PROXY",
    https: "HTTPS",
    socks4: "SOCKS4",
    socks5: "SOCKS5",
    socks: "SOCKS"
  };

  return {
    scheme,
    host,
    port,
    proxyType: typeMap[scheme] || "PROXY"
  };
}

function hostnameMatchesWhitelist(hostname, domains) {
  for (const domain of domains) {
    if (hostname === domain || hostname.endsWith(`.${domain}`)) {
      return true;
    }
  }

  return false;
}

function generatePacScript(parsed, domains) {
  const domainObj = {};

  domains.forEach((domain) => {
    domainObj[domain] = 1;
  });

  return `
var P = "${parsed.proxyType} ${parsed.host}:${parsed.port}; DIRECT";
var D = ${JSON.stringify(domainObj)};
function FindProxyForURL(url, host) {
  var h = host.toLowerCase();
  var parts = h.split(".");
  for (var i = 0; i < parts.length - 1; i++) {
    if (D[parts.slice(i).join(".")]) return P;
  }
  return "DIRECT";
}`;
}

function clearProxySettings(callback) {
  if (currentState === "cleared") {
    setLastStatus("clear", lastStatus.hostname, lastStatus.reason || "Proxy settings cleared");
    if (callback) callback(true);
    return;
  }

  chrome.proxy.settings.clear({ scope: "regular" }, () => {
    const success = !chrome.runtime.lastError;

    if (success) {
      setLastError("");
      currentState = "cleared";
      currentPacScript = "";
      setLastStatus("clear", lastStatus.hostname, lastStatus.reason || "Proxy settings cleared");
      console.log("[Selective Proxy] cleared for non-whitelisted hostname");
    } else {
      setLastError(chrome.runtime.lastError.message);
    }

    if (callback) callback(success);
  });
}

function applyPacScript(pacScript, hostname, callback) {
  if (currentState === "pac" && currentPacScript === pacScript) {
    if (callback) callback(true);
    return;
  }

  chrome.proxy.settings.set(
    {
      value: {
        mode: "pac_script",
        pacScript: { data: pacScript }
      },
      scope: "regular"
    },
    () => {
      const success = !chrome.runtime.lastError;

      if (success) {
        setLastError("");
        currentState = "pac";
        currentPacScript = pacScript;
        setLastStatus("pac", hostname, "Matched whitelist domain");
        console.log("[Selective Proxy] applied PAC for", hostname);
      } else {
        setLastError(chrome.runtime.lastError.message);
      }

      if (callback) callback(success);
    }
  );
}

function clearAllSettings(callback) {
  const keys = ["proxyServer", "whitelistDomains", "proxyEnabled"];

  chrome.storage.sync.remove(keys, () => {
    chrome.storage.local.remove(keys, () => {
      cachedConfig = {
        enabled: true,
        proxyServer: "",
        domains: [],
        parsedProxy: null
      };
      currentPacScript = "";
      setLastError("");
      setLastStatus("clear", "", "All settings cleared");
      clearProxySettings(callback);
    });
  });
}

function applyStateForHostname(hostname, callback) {
  const config = cachedConfig;

  if (!config || !config.enabled || !config.proxyServer || config.domains.length === 0) {
    setLastStatus("clear", hostname, !config || !config.enabled ? "Proxy disabled" : "Missing proxy server or whitelist domains");
    clearProxySettings(callback);
    return;
  }

  if (!config.parsedProxy) {
    console.log("[Selective Proxy] invalid proxy config:", config.proxyServer);
    setLastStatus("clear", hostname, "Invalid proxy server configuration");
    clearProxySettings(callback);
    return;
  }

  if (!hostname || !hostnameMatchesWhitelist(hostname, config.domains)) {
    setLastStatus("clear", hostname, hostname ? "Hostname not in whitelist" : "No active hostname");
    clearProxySettings(callback);
    return;
  }

  applyPacScript(generatePacScript(config.parsedProxy, config.domains), hostname, callback);
}

function syncWithActiveTab(callback) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (chrome.runtime.lastError || !tabs || !tabs[0] || !tabs[0].url) {
      clearProxySettings(callback);
      return;
    }

    try {
      const url = new URL(tabs[0].url);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        clearProxySettings(callback);
        return;
      }

      applyStateForHostname(url.hostname.toLowerCase(), callback);
    } catch (error) {
      clearProxySettings(callback);
    }
  });
}

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) {
    return;
  }

  try {
    const url = new URL(details.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      clearProxySettings();
      return;
    }

    applyStateForHostname(url.hostname.toLowerCase());
  } catch (error) {
    clearProxySettings();
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "updateProxy" || request.action === "toggleProxy") {
    loadConfig(() => {
      syncWithActiveTab((success) => {
        sendResponse({ success: Boolean(success) });
      });
    });
    return true;
  }

  if (request.action === "getStatus") {
    loadConfig(() => {
      syncWithActiveTab((success) => {
        sendResponse({
          success: Boolean(success),
          status: lastStatus,
          config: {
            enabled: cachedConfig ? cachedConfig.enabled : true,
            proxyServer: cachedConfig ? cachedConfig.proxyServer : "",
            whitelistDomains: cachedConfig ? cachedConfig.domains : []
          }
        });
      });
    });
    return true;
  }

  if (request.action === "clearAllSettings") {
    clearAllSettings((success) => {
      sendResponse({ success: Boolean(success), status: lastStatus });
    });
    return true;
  }
});

chrome.runtime.onInstalled.addListener(() => {
  loadConfig(() => {
    syncWithActiveTab();
  });
});

chrome.runtime.onStartup.addListener(() => {
  loadConfig(() => {
    syncWithActiveTab();
  });
});

loadConfig(() => {
  syncWithActiveTab();
});