import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isNewer, releaseVersion } from "../src/version";

describe("isNewer", () => {
  it("compares numerically, part by part", () => {
    assert.equal(isNewer("1.0.1", "1.0.0"), true);
    assert.equal(isNewer("1.10.0", "1.9.0"), true);
    assert.equal(isNewer("2.0", "1.9.9"), true);
    assert.equal(isNewer("1.0.0", "1.0.0"), false);
    assert.equal(isNewer("1.0", "1.0.0"), false);
    assert.equal(isNewer("0.9.9", "1.0.0"), false);
  });

  it("never claims a malformed version is newer", () => {
    assert.equal(isNewer("1.0.0-beta", "1.0.0"), false);
    assert.equal(isNewer("", "1.0.0"), false);
    assert.equal(isNewer("abc", "1.0.0"), false);
  });
});

describe("releaseVersion", () => {
  it("strips the v from a GitHub tag", () => {
    assert.equal(releaseVersion("v1.2.3"), "1.2.3");
    assert.equal(releaseVersion("1.2.3"), "1.2.3");
    assert.equal(releaseVersion(undefined), "");
  });
});
