import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { onScreenBounds } from "../src/window-bounds";

const main = { x: 0, y: 0, width: 1440, height: 875 };
const right = { x: 1440, y: 0, width: 1920, height: 1080 };

describe("onScreenBounds", () => {
  it("keeps a position that is on a display", () => {
    const b = { x: 100, y: 80, width: 1200, height: 820 };
    assert.deepEqual(onScreenBounds(b, [main]), b);
    assert.deepEqual(onScreenBounds({ ...b, x: 2000 }, [main, right]), { ...b, x: 2000 });
  });

  it("drops x/y when the window would open on a display that is gone", () => {
    assert.deepEqual(onScreenBounds({ x: 2000, y: 80, width: 1200, height: 820 }, [main]), { width: 1200, height: 820 });
    assert.deepEqual(onScreenBounds({ x: -5000, y: -5000, width: 800, height: 600 }, [main]), { width: 800, height: 600 });
  });

  it("treats a window that only touches an edge as off screen", () => {
    assert.deepEqual(onScreenBounds({ x: 1440, y: 0, width: 800, height: 600 }, [main]), { width: 800, height: 600 });
  });

  it("needs at least 100x50 px on one display, not a sliver", () => {
    // 99 px wide strip visible: too little to grab
    assert.deepEqual(onScreenBounds({ x: 1341, y: 0, width: 800, height: 600 }, [main]), { width: 800, height: 600 });
    // 49 px tall strip visible at the bottom
    assert.deepEqual(onScreenBounds({ x: 0, y: 826, width: 800, height: 600 }, [main]), { width: 800, height: 600 });
    // exactly 100 x 50 is enough
    const edge = { x: 1340, y: 825, width: 800, height: 600 };
    assert.deepEqual(onScreenBounds(edge, [main]), edge);
  });

  it("keeps the maximized flag whatever happens to the position", () => {
    assert.deepEqual(onScreenBounds({ x: 9000, y: 0, width: 800, height: 600, maximized: true }, [main]), {
      width: 800,
      height: 600,
      maximized: true,
    });
    const b = { x: 10, y: 10, width: 800, height: 600, maximized: true };
    assert.deepEqual(onScreenBounds(b, [main]), b);
  });

  it("passes bounds without a position through", () => {
    assert.deepEqual(onScreenBounds({ width: 1200, height: 820 }, [main]), { width: 1200, height: 820 });
  });
});
