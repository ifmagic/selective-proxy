// Listen for messages from popup
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === 'updateProxy') {
    updateProxySettings(sendResponse);
    return true; // Indicate we will send a response asynchronously
  }
});

// Initialize proxy settings on extension load
updateProxySettings();

function updateProxySettings(callback) {
  chrome.storage.sync.get(['proxyServer', 'whitelistDomains'], function(result) {
    const proxyServer = result.proxyServer || '';
    const whitelistDomains = result.whitelistDomains || '';
    
    if (!proxyServer) {
      // No proxy server configured, use direct mode
      chrome.proxy.settings.set(
        {
          value: {
            mode: 'direct'
          },
          scope: 'regular'
        },
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
  return `
    function FindProxyForURL(url, host) {
      // List of domains to route through proxy
      const whitelist = ${JSON.stringify(domains)};
      
      // Check if host matches any domain in whitelist
      for (let i = 0; i < whitelist.length; i++) {
        const domain = whitelist[i];
        if (host === domain || host.endsWith('.' + domain)) {
          return 'PROXY ${proxyServer}';
        }
      }
      
      // All other traffic goes direct
      return 'DIRECT';
    }
  `;
}