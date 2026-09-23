import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type BrowserContext } from "playwright-core";
import { EXTENSION_DIR, unpackedExtensionId } from "./harness";

let context: BrowserContext;
let profile: string;

beforeAll(async () => {
  profile = mkdtempSync(join(tmpdir(), "clean-choice-profile-"));
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    args: [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`]
  });
});

afterAll(async () => {
  await context?.close();
  rmSync(profile, { recursive: true, force: true });
});

test("the unpacked extension loads and its popup persists the per-site switch", async () => {
  const errors: string[] = [];
  const popup = await context.newPage();
  popup.on("pageerror", (error) => errors.push(error.message));
  await popup.goto(`chrome-extension://${unpackedExtensionId(EXTENSION_DIR)}/popup.html`);

  await expect(popup.locator("h1").textContent()).resolves.toBe("Clean Choice");
  // The popup's own tab is not a web page, so it must refuse to scan.
  await popup.waitForFunction(() => document.getElementById("status")?.textContent === "Clean Choice cannot run on this page.");
  expect(await popup.locator("#scan").isDisabled()).toBe(true);

  await popup.evaluate(() => (globalThis as any).chrome.storage.local.set({ disabledOrigins: { "https://a.example": true } }));
  await popup.reload();
  const stored = await popup.evaluate(() => (globalThis as any).chrome.storage.local.get("disabledOrigins"));
  expect(stored).toEqual({ disabledOrigins: { "https://a.example": true } });
  expect(errors).toEqual([]);
});
