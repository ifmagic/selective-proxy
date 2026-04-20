let currentState = "unknown";
let currentPacScript = "";
let cachedConfig = null;

function loadConfig(callback) {
  chrome.storage.sync.get(
    ["proxyServer", "whitelistDomains", "proxyEnabled"],
    (result) => {
      const enabled = result.proxyEnabled !== false;
      const proxyServer = (result.proxyServer || "").trim();
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
    }
  );
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
    if (callback) callback(true);
    return;
  }

  chrome.proxy.settings.clear({ scope: "regular" }, () => {
    const success = !chrome.runtime.lastError;

    if (success) {
      currentState = "cleared";
      currentPacScript = "";
      console.log("[Selective Proxy] cleared for non-whitelisted hostname");
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
        currentState = "pac";
        currentPacScript = pacScript;
        console.log("[Selective Proxy] applied PAC for", hostname);
      }

      if (callback) callback(success);
    }
  );
}

function applyStateForHostname(hostname, callback) {
  const config = cachedConfig;

  if (!config || !config.enabled || !config.proxyServer || config.domains.length === 0) {
    clearProxySettings(callback);
    return;
  }

  if (!config.parsedProxy) {
    console.log("[Selective Proxy] invalid proxy config:", config.proxyServer);
    clearProxySettings(callback);
    return;
  }

  if (!hostname || !hostnameMatchesWhitelist(hostname, config.domains)) {
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