// Listen for messages from popup
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === 'updateProxy') {
    updateProxySettings(sendResponse);
    return true; // Indicate we will send a response asynchronously
  }
});

// Only apply proxy settings on first install or extension update,
// NOT on every service worker startup. chrome.proxy.settings are
// persistent — re-applying them on every SW wake causes Chrome to
// invalidate its proxy-resolution cache and re-compile the PAC script,
// adding latency to every in-flight and subsequent request.
chrome.runtime.onInstalled.addListener(function() {
  updateProxySettings();
});

function updateProxySettings(callback) {
  chrome.storage.sync.get(['proxyServer', 'whitelistDomains'], function(result) {
    const proxyServer = result.proxyServer || '';
    const whitelistDomains = result.whitelistDomains || '';
    
    if (!proxyServer) {
      // No proxy server configured — clear any extension-level proxy
      // so Chrome falls back to system/default proxy settings instead
      // of forcing DIRECT (which would override the user's system proxy).
      chrome.proxy.settings.clear(
        { scope: 'regular' },
        function() {
          if (callback) {
            callback({success: true});
          }
        }
      );
    } else {
      // Generate PAC script
      const domains = whitelistDomains.split('\n')
        .map(domain => domain.trim())
        .filter(domain => domain.length > 0);
      
      if (domains.length === 0) {
        // No domains to proxy — clear settings to avoid unnecessary PAC overhead
        chrome.proxy.settings.clear(
          { scope: 'regular' },
          function() {
            if (callback) {
              callback({success: true});
            }
          }
        );
        return;
      }

      const pacScript = generatePacScript(proxyServer, domains);
      
      // Set proxy settings with PAC script
      chrome.proxy.settings.set(
        {
          value: {
            mode: 'pac_script',
            pacScript: {
              data: pacScript
            }
          },
          scope: 'regular'
        },
        function() {
          if (callback) {
            callback({success: true});
          }
        }
      );
    }
  });
}

function generatePacScript(proxyServer, domains) {
  // Build a domain lookup object for O(1) matching instead of O(n) loop.
  // Use standard PAC-compatible JS (var, no const/let/arrow/endsWith)
  // to avoid potential issues with Chrome's PAC sandbox.
  const domainObj = {};
  domains.forEach(function(d) { domainObj[d] = true; });

  return `
    var PROXY_RESULT = "PROXY ${proxyServer}";
    var domainMap = ${JSON.stringify(domainObj)};
    function FindProxyForURL(url, host) {
      var parts = host.split(".");
      for (var i = 0; i < parts.length - 1; i++) {
        if (domainMap[parts.slice(i).join(".")]) {
          return PROXY_RESULT;
        }
      }
      return "DIRECT";
    }
  `;
}