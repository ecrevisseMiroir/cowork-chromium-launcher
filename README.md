<div align="center">
  <img src="Chromium_Logo.svg.png" alt="Chromium Launcher" width="120" />

  # Chromium Launcher MCP
</div>

A minimal MCP server that lets Claude open Chromium on your machine.

## Why

The [Claude in Chrome](https://github.com/anthropics/anthropic-quickstarts/tree/main/computer-use-demo) extension lets you remotely control an agent through the browser. If Chrome isn't already open when the agent tries to use it, the agent stops dead — it has no way to launch it.

This MCP fixes that. It gives the agent a single tool to launch Chromium, so a closed browser is no longer a blocker.

## Installation

Drag `chromium-mcp.mcpb` into the Claude Desktop window. That's it.

## Configuration

After installing, open the **Chromium Launcher** settings panel in Claude Desktop.

| Setting | Description |
|---------|-------------|
| **URL Filter Mode** | `blocklist` — open anything except matched URLs. `allowlist` — open only matched URLs. |
| **URL Patterns** | Comma-separated glob patterns, e.g. `https://evil.com/*,https://*.tracker.io/*`. Leave empty to allow everything. |

## Tools

| Tool | Description |
|------|-------------|
| `launch_chromium` | Launch Chromium, optionally with a URL, `--incognito`, `--new-window`, or extra CLI flags. |
| `open_url` | Open a URL in Chromium (launches it if not already running). |
| `detect_chromium` | Check whether Chromium is installed and return the binary path. |

Supports native installs and Flatpak (`org.chromium.Chromium`).

## Building from source

```bash
npm install
npm run pack   # produces chromium-mcp.mcpb
```
