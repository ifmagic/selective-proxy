document.addEventListener('DOMContentLoaded', function() {
  const proxyToggle = document.getElementById('proxyToggle');
  const toggleStatus = document.getElementById('toggleStatus');
  const currentMode = document.getElementById('currentMode');
  const currentHostname = document.getElementById('currentHostname');
  const currentReason = document.getElementById('currentReason');
  const lastError = document.getElementById('lastError');
  const newDomainInput = document.getElementById('newDomain');
  const domainError = document.getElementById('domainError');

  function readSettings(callback) {
    chrome.storage.sync.get(['proxyServer', 'whitelistDomains', 'proxyEnabled'], function(syncResult) {
      chrome.storage.local.get(['proxyServer', 'whitelistDomains', 'proxyEnabled'], function(localResult) {
        callback({
          proxyServer: syncResult.proxyServer ?? localResult.proxyServer ?? '',
          whitelistDomains: syncResult.whitelistDomains ?? localResult.whitelistDomains ?? '',
          proxyEnabled: syncResult.proxyEnabled ?? localResult.proxyEnabled ?? true
        });
      });
    });
  }

  function writeSettings(data, callback) {
    chrome.storage.sync.set(data, function() {
      chrome.storage.local.set(data, function() {
        if (callback) {
          callback();
        }
      });
    });
  }

  function renderRuntimeStatus(status) {
    const mode = status && status.mode ? status.mode.toLowerCase() : 'unknown';
    currentMode.textContent = mode.toUpperCase();
    currentMode.className = 'status-badge ' + (mode === 'pac' || mode === 'clear' ? mode : 'unknown');
    currentHostname.textContent = status && status.hostname ? status.hostname : '-';
    currentReason.textContent = status && status.reason ? status.reason : 'No runtime status';
    lastError.textContent = status && status.lastError ? status.lastError : '-';
  }

  function refreshRuntimeStatus() {
    chrome.runtime.sendMessage({ action: 'getStatus' }, function(response) {
      if (chrome.runtime.lastError || !response) {
        renderRuntimeStatus({ mode: 'unknown', hostname: '', reason: 'Background unavailable', lastError: chrome.runtime.lastError ? chrome.runtime.lastError.message : '' });
        return;
      }
      renderRuntimeStatus(response.status);
    });
  }

  function clearStatusMessage() {
    const status = document.getElementById('status');
    status.textContent = '';
    status.className = '';
  }

  function setDomainError(message) {
    domainError.textContent = message || '';
    newDomainInput.classList.toggle('invalid', Boolean(message));
  }

  function normalizeDomainInput(value) {
    let normalized = value.trim().toLowerCase();

    normalized = normalized.replace(/^[a-z]+:\/\//, '');
    normalized = normalized.replace(/\/.*$/, '');
    normalized = normalized.replace(/\?.*$/, '');
    normalized = normalized.replace(/#.*$/, '');
    normalized = normalized.replace(/:\d+$/, '');
    normalized = normalized.replace(/^\.+|\.+$/g, '');

    return normalized;
  }

  function isValidDomain(domain) {
    if (!domain || domain.length > 253 || domain.includes('..')) {
      return false;
    }

    const labels = domain.split('.');
    if (labels.length < 2) {
      return false;
    }

    return labels.every(function(label) {
      return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label);
    });
  }

  function showStatusMessage(message, type) {
    const status = document.getElementById('status');
    status.textContent = message;
    status.className = type;
    setTimeout(clearStatusMessage, 3000);
  }

  // Load saved settings
  readSettings(function(result) {
    if (result.proxyServer) {
      document.getElementById('proxyServer').value = result.proxyServer;
    }
    if (result.whitelistDomains) {
      const domains = result.whitelistDomains.split('\n')
        .map(domain => domain.trim())
        .filter(domain => domain.length > 0);
      renderDomainList(domains);
    }
    // Default to enabled for backward compat
    const enabled = result.proxyEnabled !== false;
    proxyToggle.checked = enabled;
    toggleStatus.textContent = enabled ? 'Enabled' : 'Disabled';
    refreshRuntimeStatus();
  });

  // Toggle handler — instant on/off, no save needed
  proxyToggle.addEventListener('change', function() {
    const enabled = proxyToggle.checked;
    toggleStatus.textContent = enabled ? 'Enabling...' : 'Disabling...';
    writeSettings({ proxyEnabled: enabled }, function() {
      chrome.runtime.sendMessage({ action: 'toggleProxy' }, function(response) {
        if (chrome.runtime.lastError || !response || !response.success) {
          proxyToggle.checked = !enabled;
          toggleStatus.textContent = 'Failed to update';
          refreshRuntimeStatus();
          showStatusMessage('Failed to update proxy state', 'error');
          return;
        }
        toggleStatus.textContent = enabled ? 'Enabled' : 'Disabled';
        refreshRuntimeStatus();
        showStatusMessage(enabled ? 'Proxy enabled' : 'Proxy disabled', 'success');
      });
    });
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

  newDomainInput.addEventListener('input', function() {
    if (domainError.textContent) {
      setDomainError('');
    }
  });

  // Save button click handler
  document.getElementById('saveButton').addEventListener('click', function() {
    const proxyServer = document.getElementById('proxyServer').value.trim();
    const domains = getDomainList();
    const whitelistDomains = domains.join('\n');

    // Save to storage
    writeSettings({
      proxyServer: proxyServer,
      whitelistDomains: whitelistDomains
    }, function() {
      // Send message to background script to update proxy settings
      chrome.runtime.sendMessage({action: 'updateProxy'}, function(response) {
        if (chrome.runtime.lastError || !response || !response.success) {
          showStatusMessage('Failed to apply settings', 'error');
        } else {
          showStatusMessage('Settings saved and applied!', 'success');
        }
        refreshRuntimeStatus();
      });
    });
  });

  function addDomain() {
    const normalizedDomain = normalizeDomainInput(newDomainInput.value);
    
    if (!normalizedDomain) {
      setDomainError('Enter a hostname such as chatgpt.com.');
      return;
    }

    if (!isValidDomain(normalizedDomain)) {
      setDomainError('Invalid domain format. Use hostname only, without protocol or path.');
      return;
    }

    const domains = getDomainList();
    if (domains.includes(normalizedDomain)) {
      setDomainError('This domain is already in the whitelist.');
      return;
    }

    setDomainError('');
    domains.push(normalizedDomain);
    renderDomainList(domains);
    newDomainInput.value = '';
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
      domainText.className = 'domain-chip-text';
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