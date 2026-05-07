<div align="center">
  <img src="Chromium_Logo.svg.png" alt="Chromium MCP Logo" width="120" />
</div>

# Chromium MCP

A lightweight MCP server that gives AI agents the ability to launch and control Chromium on **your** machine — even when the agent has no direct access to your desktop.

## Why this exists

When you work with an AI agent through Claude Desktop or a Cowork session, the agent runs in a sandboxed process with no GUI access. It cannot open a browser, navigate to a URL, or show you something on screen. Chromium MCP bridges that gap: the agent calls a tool, and Chromium opens on your machine as if you had clicked a link yourself.

Typical dispatch scenarios:

- "Open that dashboard in Chromium so I can walk you through it."
- "Launch the staging environment in a new window."
- "Open this URL in incognito mode for a clean session."

---

## Installation

The easiest way to install is via the pre-built `.mcpb` bundle:

1. Download `chromium-mcp.mcpb` (or find it in the project root).
2. Drag the `.mcpb` file into the **Claude Desktop** window.
3. Claude Desktop will unpack it, register the server, and show the configuration panel automatically.

No `npm install`, no PATH changes, no manual `claude_desktop_config.json` editing.

---

## Building from source

```bash
# 1. Install dependencies
npm install

# 2. Compile TypeScript to dist/
npm run build

# 3. Bundle + pack into chromium-mcp.mcpb
npm run pack
```

The `pack` step uses `@anthropic-ai/mcpb` to produce a self-contained bundle ready to drag into Claude Desktop.

---

## Configuration

After installing, open the **Chromium Launcher** settings panel in Claude Desktop. Two options are available:

### URL Filter Mode

Controls whether the pattern list is treated as an allowlist or a blocklist.

| Value | Behaviour |
|-------|-----------|
| `blocklist` (default) | Open any URL **except** those matching the patterns. |
| `allowlist` | Open **only** URLs that match at least one pattern. |

### URL Patterns

A comma-separated list of glob patterns applied to the full URL. `*` matches any sequence of characters.

```
https://example.com/*,https://*.google.com/*
```

Leave this field empty to disable filtering entirely (all URLs pass through).

These settings are passed to the server as environment variables (`URL_FILTER_MODE` and `URL_PATTERNS`) at startup.

---

## Tools

| Tool | Description |
|------|-------------|
| `launch_chromium` | Launch Chromium, optionally with a URL, `--incognito`, `--new-window`, or extra CLI flags. |
| `open_url` | Open a URL in an already-running Chromium instance (launches one if needed). |
| `detect_chromium` | Check whether Chromium or Chrome is installed and return the resolved binary path. |

### Chromium detection

The server searches the following locations in order:

- System PATH: `chromium`, `chromium-browser`, `google-chrome`, `google-chrome-stable`
- Absolute paths: `/usr/bin/chromium`, `/usr/bin/google-chrome`, etc.
- macOS app bundles: `/Applications/Google Chrome.app/...`, `/Applications/Chromium.app/...`
- Flatpak: `org.chromium.Chromium`, `com.google.Chrome`

---

## Manual testing via stdin JSON-RPC

The server speaks MCP over stdio. You can drive it manually with `node` and piped JSON:

```bash
# Start the server
node dist/index.js

# In a second terminal — send an initialize request then call a tool
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}}}' | node dist/index.js
```

Or pipe a sequence of requests:

```bash
(
  echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}}}'
  echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"detect_chromium","arguments":{}}}'
) | node dist/index.js
```

Example `open_url` call:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "open_url",
    "arguments": { "url": "https://example.com" }
  }
}
```

Responses are written to stdout; server log lines go to stderr so they do not pollute the MCP stream.

---

## Environment variables

If you run the server outside of Claude Desktop you can set the filter variables directly:

```bash
URL_FILTER_MODE=allowlist \
URL_PATTERNS="https://example.com/*,https://*.internal.company.com/*" \
node dist/index.js
```
