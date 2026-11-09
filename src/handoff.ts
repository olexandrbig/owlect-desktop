import { createHash, randomBytes } from "node:crypto";
import { PROTOCOL } from "./config";

/**
 * Sign-in through the user's browser (Google refuses OAuth inside embedded
 * windows). See docs/desktop-app/plan.md, Approach 3, in the main Owlect repo:
 *
 *   1. beginSignIn() makes a PKCE verifier + state and opens
 *      owlect.app/desktop/connect in the default browser.
 *   2. The user confirms there; the site redirects to
 *      owlect://auth/callback?code=…&state=…
 *   3. The OS hands that URL to this app; parseCallback() accepts it only if the
 *      state matches the sign-in this app started (blocks login CSRF).
 *   4. main.ts POSTs { code, verifier } to /api/desktop/exchange from the main
 *      process through the window's session, so the session cookie lands in the
 *      window's cookie jar and the secrets never enter the page.
 *
 * No electron import, so `node --test` can load it.
 */

type Pending = { verifier: string; state: string; startedAt: number };
let pending: Pending | null = null;
/** The state of the sign-in that last finished, so a repeat of its link is recognised. */
let used: { state: string; at: number } | null = null;

/** A sign-in left unfinished this long is dropped; a finished one is remembered this long. */
const PENDING_TTL_MS = 10 * 60 * 1000;

const b64url = (buf: Buffer) => buf.toString("base64url");

/** Starts a sign-in and returns the connect page URL on `appUrl` to open in the browser. */
export function beginSignIn(appUrl: string, now = Date.now()): string {
  const verifier = b64url(randomBytes(32));
  const state = b64url(randomBytes(32));
  pending = { verifier, state, startedAt: now };
  const challenge = b64url(createHash("sha256").update(verifier, "ascii").digest());
  const url = new URL("/desktop/connect", appUrl);
  url.search = new URLSearchParams({ challenge, state, utm_source: "desktop-app", utm_medium: "app" }).toString();
  return url.toString();
}

function callbackUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  return url.protocol === `${PROTOCOL}:` && url.hostname === "auth" && url.pathname === "/callback" ? url : null;
}

/** True for an owlect://auth/callback link, valid or not. */
export function isCallbackUrl(raw: string): boolean {
  return callbackUrl(raw) !== null;
}

export type CallbackResult =
  | { kind: "ok"; code: string; verifier: string; state: string }
  /** The link of a sign-in that already finished ("Open Owlect again", a double click). */
  | { kind: "already-used" }
  /** Not a sign-in this app started, expired, or malformed. */
  | { kind: "invalid" };

/**
 * Accepts a callback only for the sign-in this app started (single use). A
 * forged or stale link never touches the pending sign-in.
 */
export function parseCallback(raw: string, now = Date.now()): CallbackResult {
  const url = callbackUrl(raw);
  if (!url) return { kind: "invalid" };
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (used && state === used.state && now - used.at <= PENDING_TTL_MS) return { kind: "already-used" };
  const p = pending;
  if (!p || !code || !state || state !== p.state || now - p.startedAt > PENDING_TTL_MS) return { kind: "invalid" };
  pending = null;
  used = { state, at: now };
  return { kind: "ok", code, verifier: p.verifier, state };
}

/**
 * The exchange for `state` did not sign in (offline, refused). Forget it as
 * "used", so a repeat of the same link counts as invalid and the user is told
 * again to start over, instead of the window just coming forward signed out.
 */
export function exchangeFailed(state: string): void {
  if (used?.state === state) used = null;
}

/** Finds an owlect:// URL in a second instance's argv (Windows deep links). */
export function findProtocolArg(argv: string[]): string | undefined {
  return argv.find((a) => a.startsWith(`${PROTOCOL}://`));
}
