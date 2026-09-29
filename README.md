# Confluence HTML Exporter v1.0.0

Chrome / Edge Manifest V3 extension.

## Features

- Export the currently rendered page to standalone HTML.
- Export a ZIP containing `index.html`, downloaded images and a `manifest.json`.
- Preserve already-rendered Mermaid / diagram SVGs by keeping them in the HTML.
- Optional stylesheet download.
- Optional removal of common Confluence navigation/UI elements.
- Uses the current browser session when fetching protected Confluence assets.
- No npm build is required.

## Install

1. Extract the ZIP.
2. Open `chrome://extensions/` in Chrome or `edge://extensions/` in Edge.
3. Enable Developer mode.
4. Click `Load unpacked`.
5. Select the extracted `confluence-exporter` directory.
6. Open the desired Confluence page.
7. Click the extension icon.

## Important

For production use, narrow both `host_permissions` and `content_scripts.matches` in `manifest.json` to the real Confluence hostname.

The extension exports the rendered DOM. It does not call Confluence REST API, so anything not rendered into the page is not automatically exported.

Large pages/assets can hit browser extension message/download limits. For very large Space exports, a background service/backend exporter is a better architecture.

## Resilience

Version 1.0.1 hardens filename handling for Chrome/Windows reserved names, trailing dots/spaces, control characters, empty names and unexpected titles. Download is retried with a timestamped fallback name if Chrome rejects the primary filename. Individual asset failures are recorded in `manifest.json` and do not stop the export. If ZIP assembly itself fails, the extension falls back to downloading HTML so the export operation still produces a usable result.
