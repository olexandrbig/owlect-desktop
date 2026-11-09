import path from "node:path";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  screen,
  session,
  shell,
  systemPreferences,
  type MenuItemConstructorOptions,
} from "electron";
import { autoUpdater } from "electron-updater";
import {
  DOWNLOAD_PAGE,
  PLATFORM,
  PROTOCOL,
  RELEASES_API,
  isExternalSafe,
  makeIsInAppUrl,
  resolveAppUrl,
  scannerTarget,
} from "./config";
import { beginSignIn, exchangeFailed, findProtocolArg, isCallbackUrl, parseCallback } from "./handoff";
import { isNewer, releaseVersion } from "./version";
import { onScreenBounds, type Bounds } from "./window-bounds";

/**
 * Owlect desktop: a thin window over owlect.app (docs/desktop-app/plan.md in the
 * main repo). All product UI is the website; this file only adds what a browser
 * tab cannot: deep-link sign-in, a dock/taskbar icon, menus, an offline screen,
 * and update checks.
 */

const PARTITION = "persist:owlect";
/** owlect.app, or a local server for testing (see resolveAppUrl). */
const APP_URL = resolveAppUrl(process.env.OWLECT_URL, app.isPackaged);
const isInAppUrl = makeIsInAppUrl(APP_URL);
const OFFLINE_FILE = path.join(__dirname, "offline.html");
const OFFLINE_URL = pathToFileURL(OFFLINE_FILE).href;

let win: BrowserWindow | null = null;
/** owlect:// links that arrived before `ready` (macOS cold start from the browser). */
const queuedCallbacks: string[] = [];

// ---------------------------------------------------------------- window state

const stateFile = () => path.join(app.getPath("userData"), "window-state.json");

/** Call after `ready`: reads the displays to drop a position that is now off screen. */
function loadBounds(): Bounds {
  try {
    const b = JSON.parse(fs.readFileSync(stateFile(), "utf8")) as Bounds;
    if (b.width >= 380 && b.height >= 400) {
      return onScreenBounds(b, screen.getAllDisplays().map((d) => d.workArea));
    }
  } catch {
    // first launch or unreadable: defaults
  }
  return { width: 1200, height: 820 };
}

function saveBounds() {
  if (!win || win.isMinimized() || win.isFullScreen()) return;
  // Normal (restored) bounds, so a maximized window comes back maximized over a
  // sensible restore size instead of a screen-sized "normal" window.
  const bounds: Bounds = { ...win.getNormalBounds(), maximized: win.isMaximized() };
  try {
    fs.writeFileSync(stateFile(), JSON.stringify(bounds));
  } catch {
    // not worth failing over
  }
}

// ---------------------------------------------------------------- window

function focusWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function openExternal(url: string) {
  if (isExternalSafe(url)) void shell.openExternal(url);
}

/** Loads an app URL. A failed load is handled by did-fail-load (offline screen), never thrown. */
function load(url: string): Promise<void> {
  return win ? win.loadURL(url).catch(() => undefined) : Promise.resolve();
}

function showOffline(failedUrl: string) {
  void win
    ?.loadFile(OFFLINE_FILE, { query: { retry: isInAppUrl(failedUrl) ? failedUrl : `${APP_URL}/app` } })
    .catch(() => undefined);
}

/** True only for our own offline.html, whatever its query. */
function isOfflinePage(url: string): boolean {
  try {
    const u = new URL(url);
    u.search = "";
    u.hash = "";
    return u.href === OFFLINE_URL;
  } catch {
    return false;
  }
}

/** Creates the app window and starts loading `initialPath` (the dashboard unless a menu item asked for a page). */
function createWindow(initialPath = "/app"): BrowserWindow {
  const { maximized, ...bounds } = loadBounds();
  const w = new BrowserWindow({
    ...bounds,
    minWidth: 380,
    minHeight: 400,
    title: "Owlect",
    backgroundColor: "#ffffff",
    show: false,
    webPreferences: {
      partition: PARTITION,
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: true,
    },
  });

  win = w;
  const wc = w.webContents;
  wc.setUserAgent(`${wc.getUserAgent()} OwlectDesktop/${app.getVersion()} (${PLATFORM})`);

  // Links that open a new window (target=_blank, window.open) go to the system
  // browser, owlect.app ones included: loading them here would replace the page
  // the user is on (the login screen's Terms link, a half-filled form).
  wc.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });

  // Anything off owlect.app (BGG, Discogs, Paddle checkout, Google) leaves the app.
  const guard = (event: Electron.Event, url: string) => {
    if (isInAppUrl(url) || isOfflinePage(url)) return;
    event.preventDefault();
    openExternal(url);
  };
  wc.on("will-navigate", guard);
  wc.on("will-redirect", guard);

  wc.on("did-fail-load", (_e, errorCode, _desc, validatedURL, isMainFrame) => {
    // -3 is ERR_ABORTED (a navigation we cancelled ourselves).
    if (isMainFrame && errorCode !== -3 && !validatedURL.startsWith("file://")) showOffline(validatedURL);
  });

  w.once("ready-to-show", () => {
    if (maximized) w.maximize();
    w.show();
  });
  w.on("close", saveBounds);
  w.on("closed", () => {
    if (win === w) win = null;
  });

  void load(`${APP_URL}${initialPath}`);
  return w;
}

// ---------------------------------------------------------------- sign-in handoff

ipcMain.handle("owlect:begin-sign-in", (event) => {
  // Only the owlect.app page in our own window may start a sign-in.
  if (!win || event.sender !== win.webContents || !isInAppUrl(event.senderFrame?.url ?? "")) return;
  void shell.openExternal(beginSignIn(APP_URL)).catch(() => undefined);
});

/** Entry point for every owlect:// link, from any OS delivery path. */
function handleDeepLink(raw: string) {
  if (!app.isReady()) {
    queuedCallbacks.push(raw);
    return;
  }
  // Any other owlect:// link only brings the app forward.
  if (!isCallbackUrl(raw)) return showWindow();
  void finishSignIn(raw).catch(() => undefined);
}

function showWindow() {
  if (!win) createWindow();
  focusWindow();
}

async function finishSignIn(raw: string) {
  const parsed = parseCallback(raw);
  // macOS keeps running with no window after it is closed: bring one back first.
  const w = win ?? createWindow();
  focusWindow();
  // A repeat of a link that already signed in ("Open Owlect again", a double
  // click): the first delivery is handling it, so just show the window.
  if (parsed.kind === "already-used") return;
  if (parsed.kind === "invalid") return signInFailed(w); // not ours, or expired

  // From the main process, through the window's own session: the Set-Cookie
  // lands in the window's cookie jar, and the code and verifier never enter the
  // page's JavaScript. Origin must be the app's own origin (a different one
  // fails Chromium's CORS check); in production the server accepts only owlect.app origins.
  let ok = false;
  try {
    const res = await session.fromPartition(PARTITION).fetch(`${APP_URL}/api/desktop/exchange`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", origin: new URL(APP_URL).origin },
      body: JSON.stringify({ code: parsed.code, verifier: parsed.verifier }),
    });
    ok = res.status === 200;
  } catch {
    // offline or refused: same message, the user starts again
  }
  if (!ok) {
    exchangeFailed(parsed.state); // a repeat of this link gets the dialog again, not silence
    return signInFailed(w);
  }
  await load(`${APP_URL}/app`);
}

/** At most one "Sign-in didn't finish" dialog at a time, however many links arrive. */
let signInFailedOpen = false;

function signInFailed(w: BrowserWindow) {
  if (w.isDestroyed() || signInFailedOpen) return;
  signInFailedOpen = true;
  void dialog
    .showMessageBox(w, {
      type: "warning",
      message: "Sign-in didn't finish",
      detail: "Start sign-in again from the Owlect window.",
    })
    .catch(() => undefined)
    .finally(() => {
      signInFailedOpen = false;
    });
}

// ---------------------------------------------------------------- camera permission

function setUpPermissions() {
  const ses = session.fromPartition(PARTITION);
  const allowed = new Set(["media", "clipboard-sanitized-write", "fullscreen"]);

  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const origin = details.requestingUrl ?? wc.getURL();
    if (!allowed.has(permission) || !isInAppUrl(origin)) return callback(false);
    if (permission === "media") {
      // Camera only (the barcode scanner). Any request that includes audio is refused.
      const types = "mediaTypes" in details ? (details.mediaTypes ?? []) : [];
      if (types.length === 0 || !types.every((t) => t === "video")) return callback(false);
      if (process.platform === "darwin") {
        void systemPreferences.askForMediaAccess("camera").then(callback, () => callback(false));
        return;
      }
    }
    callback(true);
  });

  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) => {
    if (!allowed.has(permission) || !isInAppUrl(requestingOrigin)) return false;
    return permission !== "media" || details.mediaType === "video";
  });
}

// ---------------------------------------------------------------- menu

function go(pathname: string) {
  if (win) void load(`${APP_URL}${pathname}`);
  else createWindow(pathname); // one navigation, not /app followed by the page
  focusWindow();
}

/** "Scan Barcode": opens the website's barcode scanner (webcam, or type the code). */
function openScanner() {
  const w = win ?? createWindow(`/app?scan=1`);
  if (w !== win) return focusWindow(); // a new window already loads /app?scan=1
  const target = scannerTarget(w.webContents.getURL(), APP_URL);
  if (target.kind === "event") w.webContents.send("owlect:open-scanner");
  else void load(target.url);
  focusWindow();
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: "Owlect",
            submenu: [
              { role: "about" },
              { type: "separator" },
              { label: "Settings…", accelerator: "CmdOrCtrl+,", click: () => go("/app/settings") },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          } as MenuItemConstructorOptions,
        ]
      : [
          {
            label: "File",
            submenu: [
              { label: "Settings", accelerator: "CmdOrCtrl+,", click: () => go("/app/settings") },
              { type: "separator" },
              { role: "quit" },
            ],
          } as MenuItemConstructorOptions,
        ]),
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { label: "Collections", accelerator: "CmdOrCtrl+1", click: () => go("/app") },
        { label: "Scan Barcode…", accelerator: "CmdOrCtrl+Shift+B", click: openScanner },
        { type: "separator" },
        {
          label: "Back",
          accelerator: isMac ? "Cmd+[" : "Alt+Left",
          click: () => win?.webContents.navigationHistory.goBack(),
        },
        {
          label: "Forward",
          accelerator: isMac ? "Cmd+]" : "Alt+Right",
          click: () => win?.webContents.navigationHistory.goForward(),
        },
        { role: "reload" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        { label: "Owlect Help", click: () => openExternal("https://owlect.app/wiki") },
        { label: "Download Page", click: () => openExternal(DOWNLOAD_PAGE) },
        { label: "Contact Support", click: () => openExternal("mailto:support@owlect.app") },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------- updates

const updateNoticeFile = () => path.join(app.getPath("userData"), "update-notice.json");

/** The release the user said "Later" to, so the notice doesn't come back every 6 hours. */
function dismissedVersion(): string | null {
  try {
    const { dismissed } = JSON.parse(fs.readFileSync(updateNoticeFile(), "utf8")) as { dismissed?: unknown };
    return typeof dismissed === "string" ? dismissed : null;
  } catch {
    return null;
  }
}

function dismissVersion(version: string) {
  try {
    fs.writeFileSync(updateNoticeFile(), JSON.stringify({ dismissed: version }));
  } catch {
    // not worth failing over
  }
}

/** A notice still on screen when the next 6-hourly check runs must not get a twin. */
let updateNoticeOpen = false;

/** Unsigned Mac builds can't self-update (Squirrel.Mac needs Developer ID), so they only notify. */
async function notifyIfNewerRelease() {
  if (updateNoticeOpen) return;
  try {
    const res = await fetch(RELEASES_API, { headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok) return;
    const { tag_name } = (await res.json()) as { tag_name?: string };
    const latest = releaseVersion(tag_name);
    if (!latest || !isNewer(latest, app.getVersion()) || latest === dismissedVersion() || !win) return;
    if (updateNoticeOpen) return; // another check got here while this one was fetching
    updateNoticeOpen = true;
    const { response } = await dialog
      .showMessageBox(win, {
        type: "info",
        buttons: ["Download", "Later"],
        defaultId: 0,
        cancelId: 1,
        message: `Owlect ${latest} is available`,
        detail: `You have ${app.getVersion()}. Download the new version and drag it into Applications to replace this one.`,
      })
      .finally(() => {
        updateNoticeOpen = false;
      });
    if (response === 0) openExternal(DOWNLOAD_PAGE);
    else dismissVersion(latest);
  } catch {
    // offline or rate-limited: try again next launch
  }
}

function checkForUpdates() {
  if (!app.isPackaged) return;
  if (process.platform === "win32") void autoUpdater.checkForUpdatesAndNotify().catch(() => undefined);
  else void notifyIfNewerRelease();
}

// ---------------------------------------------------------------- lifecycle

// Electron's documented single-instance pattern: a second instance hands its
// argv to the first and quits before doing any setup of its own.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const link = findProtocolArg(argv);
    if (link) handleDeepLink(link);
    else if (app.isReady()) showWindow();
  });

  if (process.defaultApp && process.argv.length >= 2) {
    // `electron .` in development: register with the script path so the OS can relaunch us.
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient(PROTOCOL);
  }

  // macOS delivers deep links here, possibly before `ready`.
  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  // Never let a page create webviews.
  app.on("web-contents-created", (_e, contents) => {
    contents.on("will-attach-webview", (event) => event.preventDefault());
  });

  void app.whenReady().then(() => {
    setUpPermissions();
    buildMenu();
    createWindow();
    checkForUpdates();
    setInterval(checkForUpdates, 6 * 60 * 60 * 1000);

    // Callbacks that arrived before ready (macOS), and a Windows cold start
    // from a deep link, whose URL is in our own argv.
    const coldLink = findProtocolArg(process.argv);
    for (const link of [...queuedCallbacks.splice(0), ...(coldLink ? [coldLink] : [])]) handleDeepLink(link);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else focusWindow();
    });
  });
}
