import { contextBridge, ipcRenderer } from "electron";

/**
 * The only bridge between owlect.app and the app. Read by the login page's
 * DesktopSignIn component in the main repo
 * (src/app/(dynamic)/(auth)/login/desktop-sign-in.tsx).
 */
contextBridge.exposeInMainWorld("owlectDesktop", {
  beginSignIn: (): Promise<void> => ipcRenderer.invoke("owlect:begin-sign-in"),
  platform: process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : "linux",
});

// "Scan Barcode" menu item: the dashboard's search bar listens for this event
// (DESKTOP_OPEN_SCANNER_EVENT in owlect/src/lib/native.ts). The preload shares
// the page's DOM, so a plain window event reaches it without exposing anything.
ipcRenderer.on("owlect:open-scanner", () => {
  window.dispatchEvent(new Event("owlect:open-scanner"));
});
