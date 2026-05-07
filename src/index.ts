#!/usr/bin/env node
/**
 * Chromium MCP Server
 * Exposes tools to launch and control Chromium on the local machine.
 * Transport: stdio
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { spawn, exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// ── Resolve the Chromium/Chrome binary ──────────────────────────────────────
const CHROMIUM_CANDIDATES = [
  "chromium",
  "chromium-browser",
  "google-chrome",
  "google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  // macOS
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];

const FLATPAK_CANDIDATES = [
  "org.chromium.Chromium",
  "com.google.Chrome",
];

type BinaryEntry =
  | { type: "direct"; path: string }
  | { type: "flatpak"; appId: string };

async function findChromium(): Promise<BinaryEntry | null> {
  for (const candidate of CHROMIUM_CANDIDATES) {
    try {
      await execAsync(`which "${candidate}" 2>/dev/null || test -f "${candidate}"`);
      return { type: "direct", path: candidate };
    } catch {
      // try next
    }
  }
  for (const appId of FLATPAK_CANDIDATES) {
    try {
      await execAsync(`flatpak info "${appId}" 2>/dev/null`);
      return { type: "flatpak", appId };
    } catch {
      // try next
    }
  }
  return null;
}

// Build the display/session environment needed to launch a GUI app from a
// stripped context (e.g. when the MCP server is spawned by Claude Desktop).
// systemctl --user itself needs DBUS_SESSION_BUS_ADDRESS, so we resolve the
// socket paths from the UID directly instead of calling it first.
async function getSessionEnv(): Promise<NodeJS.ProcessEnv> {
  const base = { ...process.env };
  const uid = process.getuid?.() ?? 1000;
  const runtimeDir = `/run/user/${uid}`;

  // Always force-set these — Claude Desktop passes DBUS_SESSION_BUS_ADDRESS="disabled:"
  // to MCP servers which breaks Chromium's portal bus. Override unconditionally.
  base.XDG_RUNTIME_DIR = runtimeDir;
  base.DBUS_SESSION_BUS_ADDRESS = `unix:path=${runtimeDir}/bus`;

  // Derive WAYLAND_DISPLAY / DISPLAY via systemctl (now has a working D-Bus path)
  try {
    const { stdout } = await execAsync("systemctl --user show-environment", { env: base });
    for (const line of stdout.split("\n")) {
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq);
      const val = line.slice(eq + 1);
      // Override display vars always; leave other vars intact if already set
      if (["DISPLAY", "WAYLAND_DISPLAY"].includes(key) || !base[key]) {
        base[key] = val;
      }
    }
  } catch {
    // Fall back: scan /run/user/<uid> for a wayland socket
    try {
      const { stdout } = await execAsync(`ls "${runtimeDir}"/wayland-? 2>/dev/null | head -1`);
      const socket = stdout.trim().split("/").pop();
      if (socket) base.WAYLAND_DISPLAY = socket;
    } catch {}
    if (!base.DISPLAY) base.DISPLAY = ":0";
  }

  return base;
}

async function spawnChromium(
  binary: BinaryEntry,
  args: string[]
): Promise<{ pid: number | undefined; output: string }> {
  const env = await getSessionEnv();
  const [cmd, cmdArgs] =
    binary.type === "flatpak"
      ? ["flatpak", ["run", binary.appId, ...args]]
      : [binary.path, args];

  return new Promise((resolve) => {
    const child = spawn(cmd, cmdArgs, { detached: true, stdio: ["ignore", "pipe", "pipe"], env });
    let output = "";
    child.stdout?.on("data", (d) => { output += d.toString(); });
    child.stderr?.on("data", (d) => { output += d.toString(); });

    // Give it 3s to fail fast; if still running, consider it successfully launched
    const timer = setTimeout(() => {
      child.unref();
      resolve({ pid: child.pid, output });
    }, 3000);

    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ pid: child.pid, output: output + `\n[exited code=${code} signal=${signal}]` });
    });
  });
}

function binaryLabel(binary: BinaryEntry): string {
  return binary.type === "flatpak"
    ? `flatpak run ${binary.appId}`
    : binary.path;
}

// ── URL Filter ───────────────────────────────────────────────────────────────

function globMatch(pattern: string, url: string): boolean {
  // Escape regex special chars except * which becomes .*
  const regex = new RegExp("^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
  return regex.test(url);
}

function checkUrl(url: string): { allowed: boolean; reason: string } {
  const mode = (process.env.URL_FILTER_MODE ?? "blocklist").trim().toLowerCase();
  const raw = (process.env.URL_PATTERNS ?? "").trim();
  const patterns = raw ? raw.split(",").map(p => p.trim()).filter(Boolean) : [];

  if (patterns.length === 0) return { allowed: true, reason: "" };

  const matched = patterns.some(p => globMatch(p, url));

  if (mode === "allowlist") {
    return matched
      ? { allowed: true, reason: "" }
      : { allowed: false, reason: `URL is not in the allowlist. Patterns: ${patterns.join(", ")}` };
  } else {
    // blocklist
    return matched
      ? { allowed: false, reason: `URL is blocked. Patterns: ${patterns.join(", ")}` }
      : { allowed: true, reason: "" };
  }
}

// ── MCP Server ───────────────────────────────────────────────────────────────
const server = new McpServer({
  name: "chromium-mcp",
  version: "1.0.0",
});

// ── Tool: launch_chromium ────────────────────────────────────────────────────
server.tool(
  "launch_chromium",
  "Launch Chromium (or Google Chrome) on the local machine, optionally opening a URL.",
  {
    url: z
      .string()
      .url()
      .optional()
      .describe("URL to open. Defaults to the browser's new-tab page."),
    incognito: z
      .boolean()
      .optional()
      .default(false)
      .describe("Open in incognito / guest mode."),
    new_window: z
      .boolean()
      .optional()
      .default(false)
      .describe("Force a new browser window even if one is already open."),
    extra_args: z
      .array(z.string())
      .optional()
      .default([])
      .describe(
        "Additional CLI flags to pass to Chromium, e.g. ['--kiosk', '--disable-gpu']."
      ),
  },
  async ({ url, incognito, new_window, extra_args }) => {
    if (url) {
      const { allowed, reason } = checkUrl(url);
      if (!allowed) return { content: [{ type: "text", text: `❌ Blocked: ${reason}` }], isError: true };
    }
    const binary = await findChromium();
    if (!binary) {
      return {
        content: [
          {
            type: "text",
            text: "❌ Could not find a Chromium or Chrome binary on this machine. " +
              "Install chromium-browser or google-chrome and make sure it is on PATH.",
          },
        ],
        isError: true,
      };
    }

    const args: string[] = [];
    if (incognito) args.push("--incognito");
    if (new_window) args.push("--new-window");
    args.push(...(extra_args ?? []));
    if (url) args.push(url);

    try {
      const { pid, output } = await spawnChromium(binary, args);
      const trimmed = output.trim();

      return {
        content: [
          {
            type: "text",
            text:
              `✅ Launched Chromium (pid ${pid}).\n` +
              `Binary : ${binaryLabel(binary)}\n` +
              `Args   : ${args.join(" ") || "(none)"}` +
              (trimmed ? `\n\n${trimmed}` : ""),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `❌ Failed to launch Chromium: ${(err as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ── Tool: open_url ────────────────────────────────────────────────────────────
server.tool(
  "open_url",
  "Open a URL in an already-running Chromium instance (or launch one if needed).",
  {
    url: z.string().url().describe("The URL to navigate to."),
  },
  async ({ url }) => {
    const { allowed, reason } = checkUrl(url);
    if (!allowed) return { content: [{ type: "text", text: `❌ Blocked: ${reason}` }], isError: true };

    const binary = await findChromium();
    if (!binary) {
      return {
        content: [
          {
            type: "text",
            text: "❌ Could not find Chromium on this machine.",
          },
        ],
        isError: true,
      };
    }

    try {
      const { pid, output } = await spawnChromium(binary, [url]);
      const trimmed = output.trim();
      return {
        content: [{
          type: "text",
          text: `✅ Opening ${url} in Chromium (pid ${pid}).` + (trimmed ? `\n\n${trimmed}` : ""),
        }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `❌ Error: ${(err as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ── Tool: detect_chromium ─────────────────────────────────────────────────────
server.tool(
  "detect_chromium",
  "Check whether Chromium or Chrome is installed and return the resolved binary path.",
  {},
  async () => {
    const binary = await findChromium();
    if (binary) {
      return {
        content: [{ type: "text", text: `✅ Found Chromium: ${binaryLabel(binary)}` }],
      };
    }
    return {
      content: [
        {
          type: "text",
          text: "❌ No Chromium/Chrome binary found. Install chromium-browser or google-chrome.",
        },
      ],
      isError: true,
    };
  }
);

// ── Start ─────────────────────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr so it doesn't pollute the MCP stdio stream
  console.error("chromium-mcp server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
