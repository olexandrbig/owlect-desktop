import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PRODUCTION_URL, isExternalSafe, makeIsInAppUrl, platformTag, resolveAppUrl, scannerTarget } from "../src/config";

describe("resolveAppUrl", () => {
  it("defaults to owlect.app", () => {
    assert.equal(PRODUCTION_URL, "https://owlect.app");
    assert.equal(resolveAppUrl(undefined, true), PRODUCTION_URL);
    assert.equal(resolveAppUrl(undefined, false), PRODUCTION_URL);
    assert.equal(resolveAppUrl("", true), PRODUCTION_URL);
  });

  it("lets a packaged build point only at a local server", () => {
    assert.equal(resolveAppUrl("http://localhost:3000", true), "http://localhost:3000");
    assert.equal(resolveAppUrl("http://localhost:3000/", true), "http://localhost:3000");
    assert.equal(resolveAppUrl("http://127.0.0.1:4000", true), "http://127.0.0.1:4000");
  });

  it("ignores any other OWLECT_URL in a packaged build", () => {
    for (const raw of [
      "https://evil.example",
      "http://evil.example:3000",
      "http://localhost.evil.example:3000",
      "http://localhost",
      "https://localhost:3000",
      "http://user@localhost:3000",
      "http://localhost:3000/phish",
      "file:///etc/passwd",
      "not a url",
    ]) {
      assert.equal(resolveAppUrl(raw, true), PRODUCTION_URL, raw);
    }
  });

  it("keeps any valid value in an unpackaged dev run", () => {
    assert.equal(resolveAppUrl("https://staging.example/", false), "https://staging.example");
    assert.equal(resolveAppUrl("not a url", false), PRODUCTION_URL);
  });
});

describe("in-app and external URLs", () => {
  const isInAppUrl = makeIsInAppUrl("http://localhost:3000");
  it("keeps the app origin and the three owlect.app hosts in the window", () => {
    for (const u of ["http://localhost:3000/app", "https://owlect.app/x", "https://uk.owlect.app", "https://es.owlect.app/c/1"]) {
      assert.equal(isInAppUrl(u), true, u);
    }
    for (const u of ["https://evil.example", "http://owlect.app", "https://owlect.app.evil.example", "file:///x", "junk"]) {
      assert.equal(isInAppUrl(u), false, u);
    }
  });

  it("only hands http(s) and mailto to the OS", () => {
    assert.equal(isExternalSafe("https://boardgamegeek.com"), true);
    assert.equal(isExternalSafe("mailto:support@owlect.app"), true);
    for (const u of ["file:///etc/passwd", "javascript:alert(1)", "owlect://x", "smb://host/share", "junk"]) {
      assert.equal(isExternalSafe(u), false, u);
    }
  });
});

describe("platformTag", () => {
  it("maps Node platforms to the tag the website reads from the user agent", () => {
    assert.equal(platformTag("darwin"), "mac");
    assert.equal(platformTag("win32"), "win");
    assert.equal(platformTag("linux"), "linux");
  });
});

describe("scannerTarget", () => {
  const APP = "https://owlect.app";
  it("uses the in-page event on a dashboard page, which keeps the loaded store", () => {
    assert.deepEqual(scannerTarget("https://owlect.app/app", APP), { kind: "event" });
    assert.deepEqual(scannerTarget("https://uk.owlect.app/app/collections/abc", APP), { kind: "event" });
  });
  it("loads /app?scan=1 from any other page, the offline screen, or no page", () => {
    const load = { kind: "load", url: "https://owlect.app/app?scan=1" };
    assert.deepEqual(scannerTarget("https://owlect.app/login", APP), load);
    assert.deepEqual(scannerTarget("https://owlect.app/apples", APP), load);
    assert.deepEqual(scannerTarget("file:///x/offline.html?retry=1", APP), load);
    assert.deepEqual(scannerTarget("", APP), load);
  });
});
