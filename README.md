# Selective Proxy

A Chrome extension that routes specific domains through a custom proxy while keeping all other traffic direct.

## Features

- **Per-domain proxy routing** — only the domains you specify go through the proxy
- **PAC script under the hood** — efficient O(1) domain matching via auto-generated PAC
- **Persistent settings** — configuration synced across Chrome profiles via `chrome.storage.sync`
- **Clean popup UI** — add / remove domains and set the proxy server in one click

## Quick Install

1. Download the latest `.zip` from the [Releases](../../releases) page.
2. Unzip the file locally.
3. Go to `chrome://extensions/`, enable **Developer mode**, and click **Load unpacked**.
4. Select the unzipped folder.

## Development

```bash
git clone https://github.com/<owner>/selective-proxy.git
cd selective-proxy
```

Load the project folder as an unpacked extension in Chrome (`chrome://extensions/` → Developer mode → Load unpacked).

## License

MIT
