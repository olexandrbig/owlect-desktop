# Owlect for Mac, Windows and Linux

The desktop app for [Owlect](https://owlect.app), the collection tracker. It is a thin
[Electron](https://www.electronjs.org/) window over `https://owlect.app/app`: every feature
is the website, so the app is always up to date with it. The app adds a dock/taskbar icon,
menus, an offline screen, browser-based sign-in and update checks.

**Download:** [owlect.app/download](https://owlect.app/download), or the
[latest release](https://github.com/olexandrbig/owlect-desktop/releases/latest).

The design and the reasoning behind it live in `docs/desktop-app/plan.md` in the main
Owlect repository.

## How it works

- **Remote window.** The app loads owlect.app (and its `uk.` / `es.` hosts). Any other
  link (BoardGameGeek, Discogs, checkout, help) opens in your default browser.
- **Sign-in through your browser.** Google does not allow sign-in inside embedded app
  windows. "Sign in with your browser" opens `owlect.app/desktop/connect` in your browser;
  you confirm the account there, the site sends a one-time code back through an
  `owlect://` link, and the app trades it (with a PKCE verifier only the app knows) for a
  session. The trade runs from the app's main process, so the code never enters the page.
  A sign-in link the app did not start (or one that expired) is refused with a "Sign-in
  didn't finish" message.
- **Camera.** The website's barcode scanner works with the webcam. macOS asks for camera
  access the first time. **View > Scan Barcode** (Cmd/Ctrl+Shift+B) opens it from anywhere.
- **Updates.** Windows updates itself from GitHub Releases. Mac builds are not signed with
  a paid Apple certificate, so they can't self-update: the app tells you when a new
  version is out. Download opens the download page; Later hides the notice until the
  next version.

## Unsigned builds

These builds are not signed with paid Apple or Microsoft certificates (yet), so the first
launch shows a warning:

- **Mac:** open Owlect, close the "Apple could not verify" message, then go to
  System Settings > Privacy & Security and click **Open Anyway**. On macOS 14 or earlier,
  right-click the app and choose Open.
- **Windows:** on "Windows protected your PC", click **More info**, then **Run anyway**.

## Development

Requires Node 24+ and pnpm.

```bash
pnpm install
pnpm start            # against https://owlect.app
pnpm dev              # against http://localhost:3000 (the main repo's `pnpm dev`)
```

```bash
pnpm test             # node --test over the pure modules (handoff, config, version, window bounds)
```

If `pnpm install` skips Electron's binary download, run `node node_modules/electron/install.js`.

Deep links (`owlect://`) only reach a packaged app on macOS, because the URL scheme is
registered in the app bundle's Info.plist. To test sign-in end to end, package first:

```bash
pnpm dist:mac         # release/Owlect-mac.dmg (universal, ad-hoc signed)
pnpm dist:win         # release/Owlect-Setup.exe (build on Windows or in CI)
```

Run a packaged build against a local server (a packaged build only honours
`OWLECT_URL` for `http://localhost:<port>` or `http://127.0.0.1:<port>`):
`OWLECT_URL=http://localhost:3000 release/mac-universal/Owlect.app/Contents/MacOS/Owlect`

## CI builds

`.github/workflows/build.yml` runs the tests, then builds on macOS, Windows and Linux runners:

- **Run workflow** (Actions tab, or `gh workflow run build.yml --ref <branch>`): the
  installers (`Owlect-mac.dmg`, `Owlect-Setup.exe`, `Owlect-linux-x86_64.AppImage`,
  `.deb`) are attached to the run as artifacts.
- **Push a tag** like `v1.0.0`: the same builds are uploaded to a **draft** GitHub Release.
  Check the files, then publish it.

## Releasing

1. Bump `version` in `package.json` and commit.
2. Push a tag `v<version>`. CI builds every platform and uploads them to a draft release.
3. Publish the release. The download links on owlect.app always point at the latest one
   (`Owlect-mac.dmg`, `Owlect-Setup.exe`), and Windows clients pick it up from `latest.yml`.
