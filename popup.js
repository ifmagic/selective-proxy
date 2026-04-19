document.addEventListener('DOMContentLoaded', function() {
  // Load saved settings
  chrome.storage.sync.get(['proxyServer', 'whitelistDomains'], function(result) {
    if (result.proxyServer) {
      document.getElementById('proxyServer').value = result.proxyServer;
    }
    if (result.whitelistDomains) {
      const domains = result.whitelistDomains.split('\n')
        .map(domain => domain.trim())
        .filter(domain => domain.length > 0);
      renderDomainList(domains);
    }
  });

  // Add domain button click handler
  document.getElementById('addDomainBtn').addEventListener('click', function() {
    addDomain();
  });

  // Enter key press handler for new domain input
  document.getElementById('newDomain').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
      addDomain();
    }
  });

  // Save button click handler
  document.getElementById('saveButton').addEventListener('click', function() {
    const proxyServer = document.getElementById('proxyServer').value.trim();
    const domains = getDomainList();
    const whitelistDomains = domains.join('\n');

    // Save to storage
    chrome.storage.sync.set({
      proxyServer: proxyServer,
      whitelistDomains: whitelistDomains
    }, function() {
      // Send message to background script to update proxy settings
      chrome.runtime.sendMessage({action: 'updateProxy'}, function(response) {
        const status = document.getElementById('status');
        if (response.success) {
          status.textContent = 'Settings saved and applied!';
          status.className = 'success';
        } else {
          status.textContent = 'Error applying settings';
          status.className = 'error';
        }
        // Clear status after 3 seconds
        setTimeout(function() {
          status.textContent = '';
          status.className = '';
        }, 3000);
      });
    });
  });

  function addDomain() {
    const newDomainInput = document.getElementById('newDomain');
    const domain = newDomainInput.value.trim();
    
    if (domain) {
      const domains = getDomainList();
      if (!domains.includes(domain)) {
        domains.push(domain);
        renderDomainList(domains);
        newDomainInput.value = '';
      }
    }
  }

  function getDomainList() {
    const domainItems = document.querySelectorAll('.domain-item');
    const domains = [];
    
    domainItems.forEach(item => {
      domains.push(item.dataset.domain);
    });
    
    return domains;
  }

  function renderDomainList(domains) {
    const domainList = document.getElementById('domainList');
    domainList.innerHTML = '';
    
    domains.forEach(domain => {
      const domainItem = document.createElement('div');
      domainItem.className = 'domain-item';
      domainItem.dataset.domain = domain;
      
      const domainText = document.createElement('span');
      domainText.textContent = domain;
      
      const removeButton = document.createElement('button');
      removeButton.className = 'remove-domain-btn';
      removeButton.title = 'Remove domain';
      removeButton.addEventListener('click', function() {
        const domains = getDomainList();
        const index = domains.indexOf(domain);
        if (index > -1) {
          domains.splice(index, 1);
          renderDomainList(domains);
        }
      });
      
      domainItem.appendChild(domainText);
      domainItem.appendChild(removeButton);
      domainList.appendChild(domainItem);
    });
  }
});