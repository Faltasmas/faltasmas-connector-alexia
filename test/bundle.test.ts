import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const BUNDLE = new URL("../dist/connector.js", import.meta.url);
let text = "";
let loaded: any;

beforeAll(async () => {
  const proc = Bun.spawn(["bun", "run", "build"], { cwd: new URL("..", import.meta.url).pathname, stdout: "pipe", stderr: "pipe" });
  expect(await proc.exited).toBe(0);
  text = readFileSync(BUNDLE, "utf8");
  // Load like the phone app: plain function scope, no require/module.
  loaded = new Function(`${text}\nreturn globalThis.FaltasmasConnector;`)();
});

describe("bundle", () => {
  test("loads without require and exposes the connector manifest", () => {
    expect(loaded.connector.manifest.id).toBe("alexia-classroom");
  });
  test("exposes fetchAbsences as a function", () => {
    expect(typeof loaded.connector.fetchAbsences).toBe("function");
  });
  test("contains no node: references", () => {
    expect(text).not.toContain("node:");
  });
});
