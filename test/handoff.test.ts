import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { beginSignIn, exchangeFailed, findProtocolArg, isCallbackUrl, parseCallback } from "../src/handoff";

const APP = "https://owlect.app";
const T0 = 1_700_000_000_000;

function start(now = T0) {
  const url = new URL(beginSignIn(APP, now));
  return { url, state: url.searchParams.get("state")!, challenge: url.searchParams.get("challenge")! };
}
const callback = (state: string, code = "owd_abc") =>
  `owlect://auth/callback?${new URLSearchParams({ code, state }).toString()}`;

describe("beginSignIn", () => {
  it("opens the connect page on the given app URL with an S256 challenge and a fresh state", () => {
    const { url, state, challenge } = start();
    assert.equal(url.origin, APP);
    assert.equal(url.pathname, "/desktop/connect");
    assert.match(challenge, /^[A-Za-z0-9_-]{43}$/);
    assert.match(state, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(start().state, state);
  });
});

const FORGED = "attacker-state-attacker-state-attacker-xx";
const INVALID = { kind: "invalid" };
const USED = { kind: "already-used" };

describe("parseCallback", () => {
  it("returns the code and a verifier whose S256 hash is the challenge (PKCE)", () => {
    const { state, challenge } = start();
    const r = parseCallback(callback(state), T0 + 1000);
    assert.equal(r.kind, "ok");
    if (r.kind !== "ok") return;
    assert.equal(r.code, "owd_abc");
    assert.equal(createHash("sha256").update(r.verifier, "ascii").digest("base64url"), challenge);
  });

  it("is single use: a second identical callback is already-used, not invalid", () => {
    const { state } = start();
    assert.equal(parseCallback(callback(state), T0).kind, "ok");
    assert.deepEqual(parseCallback(callback(state), T0 + 1000), USED);
    // reloading the connect page and clicking again mints a fresh code for the same state
    assert.deepEqual(parseCallback(callback(state, "owd_other"), T0 + 2000), USED);
  });

  it("after a failed exchange, a repeat of the link is invalid again (so the user sees the dialog)", () => {
    const { state } = start();
    const r = parseCallback(callback(state), T0);
    assert.equal(r.kind, "ok");
    if (r.kind !== "ok") return;
    assert.equal(r.state, state);
    exchangeFailed(r.state);
    assert.deepEqual(parseCallback(callback(state), T0 + 1000), INVALID);
  });

  it("exchangeFailed for another state leaves the used state alone", () => {
    const { state } = start();
    assert.equal(parseCallback(callback(state), T0).kind, "ok");
    exchangeFailed(FORGED);
    assert.deepEqual(parseCallback(callback(state), T0 + 1000), USED);
  });

  it("forgets a used state after ten minutes", () => {
    const { state } = start();
    assert.equal(parseCallback(callback(state), T0).kind, "ok");
    assert.deepEqual(parseCallback(callback(state), T0 + 10 * 60 * 1000 + 1), INVALID);
  });

  it("rejects a state this app did not start (login CSRF) without clearing the pending sign-in", () => {
    const { state } = start();
    assert.deepEqual(parseCallback(callback(FORGED), T0), INVALID);
    assert.equal(parseCallback(callback(state), T0).kind, "ok");
  });

  it("a forged state after a finished sign-in is invalid, not already-used", () => {
    const { state } = start();
    assert.equal(parseCallback(callback(state), T0).kind, "ok");
    assert.deepEqual(parseCallback(callback(FORGED), T0), INVALID);
  });

  it("only honours the latest sign-in", () => {
    const first = start();
    const second = start();
    assert.deepEqual(parseCallback(callback(first.state), T0), INVALID);
    assert.equal(parseCallback(callback(second.state), T0).kind, "ok");
  });

  it("expires after ten minutes", () => {
    const { state } = start();
    assert.deepEqual(parseCallback(callback(state), T0 + 10 * 60 * 1000 + 1), INVALID);
  });

  it("rejects a missing code and anything that is not the callback", () => {
    const { state } = start();
    assert.deepEqual(parseCallback(`owlect://auth/callback?state=${state}`, T0), INVALID);
    assert.deepEqual(parseCallback(`owlect://other/callback?code=x&state=${state}`, T0), INVALID);
    assert.deepEqual(parseCallback(`https://auth/callback?code=x&state=${state}`, T0), INVALID);
    assert.deepEqual(parseCallback("not a url", T0), INVALID);
    // and none of those spent the pending sign-in
    assert.equal(parseCallback(callback(state), T0).kind, "ok");
  });
});

describe("isCallbackUrl", () => {
  it("recognises the sign-in callback whatever its query", () => {
    assert.equal(isCallbackUrl("owlect://auth/callback?code=x&state=y"), true);
    assert.equal(isCallbackUrl("owlect://auth/callback"), true);
    assert.equal(isCallbackUrl("owlect://auth/other"), false);
    assert.equal(isCallbackUrl("owlect://somewhere"), false);
    assert.equal(isCallbackUrl("https://owlect.app/auth/callback"), false);
    assert.equal(isCallbackUrl("::"), false);
  });
});

describe("findProtocolArg", () => {
  it("finds the owlect:// link in a second instance's argv", () => {
    assert.equal(findProtocolArg(["Owlect.exe", "--flag", "owlect://auth/callback?x=1"]), "owlect://auth/callback?x=1");
    assert.equal(findProtocolArg(["Owlect.exe"]), undefined);
  });
});
