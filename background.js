// --- Selective Proxy — PAC-based per-request routing ---
//
// When enabled: injects a minimal PAC script so whitelisted domains go
// through the configured proxy while everything else returns DIRECT.
// When disabled: remove the extension-level proxy settings entirely so
// Chrome falls back to the user's original/system proxy configuration.

// --- Apply or clear proxy based on enabled state ---

function applyProxySettings(callback) {
  chrome.storage.sync.get(
    ["proxyServer", "whitelistDomains", "proxyEnabled"],
    (result) => {
      const enabled = result.proxyEnabled !== false; // default true for backward compat
      const proxyServer = (result.proxyServer || "").trim();
      const rawDomains = result.whitelistDomains || "";

      const domains = rawDomains
        .split("\n")
        .map((d) => d.trim().toLowerCase())
        .filter((d) => d.length > 0);

      // If disabled, or no proxy, or no domains → remove extension proxy settings
      if (!enabled || !proxyServer || domains.length === 0) {
        chrome.proxy.settings.clear(
          { scope: "regular" },
          () => {
            const success = !chrome.runtime.lastError;
            console.log(
              "[Selective Proxy] cleared —",
              !enabled ? "disabled by user" : "no proxy or no domains configured"
            );
            if (callback) callback(success);
          }
        );
        return;
      }

      const parsed = parseProxyServer(proxyServer);
      if (!parsed) {
        console.log("[Selective Proxy] invalid proxy config:", proxyServer);
        chrome.proxy.settings.clear(
          { scope: "regular" },
          () => {
            if (callback) callback(!chrome.runtime.lastError);
          }
        );
        return;
      }

      const pacScript = generatePacScript(parsed, domains);

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
          console.log(
            "[Selective Proxy] config applied:",
            domains.length,
            "proxied domains →",
            parsed.scheme + "://" + parsed.host + ":" + parsed.port
          );
          if (callback) callback(success);
        }
      );
    }
  );
}

// --- Parse "host:port" or "scheme://host:port" ---

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
  const proxyType = typeMap[scheme] || "PROXY";
  return { scheme, host, port, proxyType };
}

// --- Generate PAC script ---
// Hash-map O(1) lookup per domain segment. "chatgpt.com" matches
// chatgpt.com, www.chatgpt.com, x.y.chatgpt.com.
// Returns "PROXY host:port; DIRECT" so if proxy is down, requests
// fall back to direct instead of hanging forever.

function generatePacScript(parsed, domains) {
  const domainObj = {};
  domains.forEach((d) => {
    domainObj[d] = 1;
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

// --- Event listeners ---

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "updateProxy" || request.action === "toggleProxy") {
    try {
      applyProxySettings((success) => {
        sendResponse({ success: Boolean(success) });
      });
    } catch (error) {
      console.log("[Selective Proxy] message handling failed", error);
      sendResponse({ success: false });
    }
    return true;
  }
});

chrome.runtime.onInstalled.addListener(() => {
  applyProxySettings();
});

applyProxySettings();