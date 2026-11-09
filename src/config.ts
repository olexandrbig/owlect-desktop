/**
 * Pure configuration: no electron import, so `node --test` can load it.
 * main.ts resolves the app URL once with `app.isPackaged`.
 */

export const PRODUCTION_URL = "https://owlect.app";

/**
 * Where the shell points. OWLECT_URL overrides it for local testing (`pnpm dev`
 * uses http://localhost:3000). A packaged build honours it only for a local
 * server (http://localhost:<port> or http://127.0.0.1:<port>), so an environment
 * variable cannot point an installed app, and the sign-in it hands out, at
 * another site. An unpackaged dev run keeps any http(s) value.
 */
export function resolveAppUrl(raw: string | undefined, isPackaged: boolean): string {
  if (!raw) return PRODUCTION_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return PRODUCTION_URL;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return PRODUCTION_URL;
  if (!isPackaged) return raw.replace(/\/+$/, "");
  const isLocalServer =
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
    url.port !== "" &&
    !url.username &&
    !url.password &&
    url.pathname === "/" &&
    !url.search &&
    !url.hash;
  return isLocalServer ? url.origin : PRODUCTION_URL;
}

/** Pages that stay in the app window. Everything else opens in the system browser. */
export function makeIsInAppUrl(appUrl: string): (url: string) => boolean {
  const origins = new Set([
    new URL(appUrl).origin,
    "https://owlect.app",
    "https://uk.owlect.app",
    "https://es.owlect.app",
  ]);
  return (url: string) => {
    try {
      return origins.has(new URL(url).origin);
    } catch {
      return false;
    }
  };
}

/** Only these leave the app (shell.openExternal must never get file:, javascript: or custom schemes). */
export function isExternalSafe(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:" || protocol === "mailto:";
  } catch {
    return false;
  }
}

export const PROTOCOL = "owlect";
export const RELEASES_API = "https://api.github.com/repos/olexandrbig/owlect-desktop/releases/latest";
export const DOWNLOAD_PAGE = "https://owlect.app/download";
/** The tag in the user agent ("OwlectDesktop/<v> (<tag>)") the website reads (owlect/src/lib/native.ts). */
export function platformTag(platform: string): "mac" | "win" | "linux" {
  if (platform === "darwin") return "mac";
  if (platform === "win32") return "win";
  return "linux";
}
export const PLATFORM = platformTag(process.platform);

/**
 * The "Scan Barcode" menu item. On a dashboard page the window keeps its loaded
 * collections and the preload fires the page event the search bar listens for;
 * anywhere else the dashboard is loaded with ?scan=1, which opens the scanner
 * once it mounts. Must match DESKTOP_OPEN_SCANNER_EVENT / DESKTOP_SCAN_PARAM in
 * owlect/src/lib/native.ts.
 */
export function scannerTarget(currentUrl: string, appUrl: string): { kind: "event" } | { kind: "load"; url: string } {
  try {
    const u = new URL(currentUrl);
    const onDashboard = makeIsInAppUrl(appUrl)(currentUrl) && (u.pathname === "/app" || u.pathname.startsWith("/app/"));
    if (onDashboard) return { kind: "event" };
  } catch {
    // no page yet, or not a URL: load the dashboard
  }
  return { kind: "load", url: `${appUrl}/app?scan=1` };
}
