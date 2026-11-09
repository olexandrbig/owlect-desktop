// Cross-platform `pnpm test`: compile the pure modules and tests, then run node --test.
import { rmSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

rmSync(".test-dist", { recursive: true, force: true });
const tsc = path.join("node_modules", "typescript", "bin", "tsc");
execFileSync(process.execPath, [tsc, "-p", "tsconfig.test.json"], { stdio: "inherit" });
const dir = path.join(".test-dist", "test");
const files = readdirSync(dir).filter((f) => f.endsWith(".test.js")).map((f) => path.join(dir, f));
execFileSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
