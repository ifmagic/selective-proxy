# Selective Proxy

Selective Proxy is a Chrome extension for applying a dedicated proxy only when the current top-level page matches a whitelist domain. When the active hostname does not match the whitelist, the extension clears its proxy settings so browser traffic falls back to the normal Chrome or system configuration.

This project is built for a very specific behavior model:

- Whitelisted domains activate a PAC script that routes matching hosts through the configured proxy.
- Non-whitelisted domains immediately clear the extension proxy settings.
- The popup shows the current runtime mode, active hostname, reason, and last error.

## Current Behavior

The extension does not keep a PAC script enabled all the time.

Instead, it uses top-level navigation events to switch between two states:

1. `PAC`
	The current active hostname matches a configured whitelist domain, so the extension applies a generated PAC script.

2. `CLEAR`
	The current hostname does not match the whitelist, proxy is disabled, or configuration is incomplete. In this state the extension removes its own proxy settings completely.

This means the extension only influences proxy behavior when the current page matches the whitelist.

## Features

- Proxy toggle in the popup for enabling or disabling extension behavior.
- Whitelist-based hostname matching.
- Domain matching supports both exact hostname and subdomains.
  Example: `chatgpt.com` matches `chatgpt.com`, `www.chatgpt.com`, and `x.y.chatgpt.com`.
- Proxy server parsing supports:
  - `127.0.0.1:7890`
  - `http://127.0.0.1:7890`
  - `socks5://127.0.0.1:7890`
- Popup runtime status panel:
  - current mode
  - current hostname
  - reason for the current state
  - last runtime error
- Persistent settings stored in both `chrome.storage.sync` and `chrome.storage.local`.
- Whitelist domain validation in the popup to prevent malformed hostnames from being added silently.

## How It Works

### Matching flow

When Chrome detects a top-level navigation:

1. The extension reads the target URL hostname.
2. It compares that hostname against the saved whitelist.
3. If the hostname matches the whitelist:
	- a PAC script is generated and applied with `chrome.proxy.settings.set`
4. If the hostname does not match:
	- the extension clears its proxy settings with `chrome.proxy.settings.clear`

### PAC behavior

When PAC mode is active, the generated PAC script returns:

- `PROXY ...; DIRECT` for matched whitelist domains
- `DIRECT` for all other domains

The extension only installs this PAC script when the current top-level page is whitelisted.

## Popup UI

The popup includes:

- Proxy enable/disable switch
- Runtime status card
- Proxy server input
- Whitelisted domain chips
- Add-domain validation with explicit error messages
- Save and apply button

### Domain input rules

The whitelist input accepts hostnames only.

Allowed examples:

- `chatgpt.com`
- `api.example.com`

Input is normalized before saving:

- protocol is removed
- path, query, and fragment are removed
- port is removed
- surrounding dots are removed
- hostname is converted to lowercase

## Persistence

Settings are written to both:

- `chrome.storage.sync`
- `chrome.storage.local`

When loading settings, the extension prefers `sync` and falls back to `local` if needed.

Stored keys:

- `proxyServer`
- `whitelistDomains`
- `proxyEnabled`

## Permissions

The extension currently requires:

- `proxy`
- `storage`
- `tabs`
- `webNavigation`

## Known Limitations

This project intentionally uses browser-wide proxy switching based on the current top-level page.

That has consequences:

- Chrome proxy settings are global, not per-tab.
- Switching between whitelisted and non-whitelisted tabs can affect the entire browser proxy state.
- Multi-tab browsing can still produce race conditions because one navigation can replace proxy state for another tab.

This is a limitation of the Chrome proxy API model, not just this implementation.

If you need true per-request coexistence with an existing system PAC or enterprise auto-discovery proxy, this extension model is not sufficient on its own.

## Installation

1. Download or clone this repository.
2. Open `chrome://extensions/`.
3. Enable Developer mode.
4. Click Load unpacked.
5. Select this project folder.

## Development

Project structure:

- `manifest.json` — extension manifest and permissions
- `background.js` — runtime proxy switching logic and status tracking
- `popup.html` — popup UI
- `popup.js` — popup interactions, validation, and persistence

No build step is required. Edit the files directly and reload the unpacked extension in Chrome.

## Service Worker Note

The extension uses a Manifest V3 service worker background script.

In `chrome://extensions`, Chrome may show the service worker as inactive or invalid when it is idle. That is normally expected for MV3 extensions. It only becomes a real problem if the extension stops responding, fails to save settings, or logs registration/runtime errors.

## License

MIT
