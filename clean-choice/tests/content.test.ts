import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright-core";
import type { Server } from "bun";
import { CONTENT_SCRIPT, serveFixtures } from "./harness";

type Pair = {
  id: number;
  verdict: "flag" | "balanced";
  offer: { name: string; price: string | null; disabled: boolean };
  decline: { name: string; disabled: boolean };
  reasons: string[];
  applied: boolean;
};

let browser: Browser;
let server: Server<undefined>;
let page: Page;

beforeAll(async () => {
  server = serveFixtures();
  browser = await chromium.launch({ channel: "chromium" });
});

afterAll(async () => {
  await browser?.close();
  server?.stop(true);
});

beforeEach(async () => {
  page = await browser.newPage();
});

async function open(fixture: string): Promise<void> {
  await page.goto(new URL(`/${fixture}.html`, server.url).href);
  await page.addScriptTag({ path: CONTENT_SCRIPT });
}

function cc<T>(method: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(([name, params]) => (globalThis as any).__cleanChoice[name as string](...(params as unknown[])), [
    method,
    args
  ] as const) as Promise<T>;
}

const scan = async () => (await cc<{ pairs: Pair[] }>("scan")).pairs;
const clicks = () => page.evaluate(() => (window as any).__clicks as string[]);
const panelButtons = () => page.locator("[data-clean-choice-panel] button");

async function eventually<T extends boolean | number>(read: () => Promise<T>, expected: T): Promise<void> {
  const deadline = Date.now() + 2000;
  let actual = await read();
  while (actual !== expected && Date.now() < deadline) {
    await Bun.sleep(25);
    actual = await read();
  }
  expect(actual).toBe(expected);
}

describe("detection", () => {
  test("flags an upgrade button paired with underlined continue text", async () => {
    await open("asymmetric");
    const pairs = await scan();
    expect(pairs).toHaveLength(1);
    const [pair] = pairs;
    expect(pair!.verdict).toBe("flag");
    expect(pair!.offer.name).toBe("Upgrade");
    expect(pair!.offer.price).toBe("$89.00");
    expect(pair!.decline.name).toBe("Continue");
    expect(pair!.reasons.length).toBeGreaterThanOrEqual(2);
    expect(pair!.reasons.join(" ")).toContain("underlined");
  });

  test("reports an equally styled offer and decline as balanced", async () => {
    await open("balanced");
    const pairs = await scan();
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.verdict).toBe("balanced");
    expect(pairs[0]!.reasons.length).toBeLessThan(2);
  });

  test("ignores ordinary primary and secondary actions", async () => {
    await open("unrelated");
    expect(await scan()).toEqual([]);
  });

  test("never invents a price when the page shows none", async () => {
    await open("no-price");
    const [pair] = await scan();
    expect(pair!.verdict).toBe("flag");
    expect(pair!.offer.price).toBeNull();
    await cc("apply", pair!.id);
    expect(await panelButtons().allTextContents()).toEqual(["Get Premium", "Continue without this add-on"]);
  });
});

describe("replacement", () => {
  test("shows both choices equally and fires each original action once", async () => {
    await open("asymmetric");
    const [pair] = await scan();
    expect(await cc<boolean>("apply", pair!.id)).toBe(true);

    expect(await panelButtons().allTextContents()).toEqual(["Upgrade (+$89.00)", "Continue without upgrade"]);
    const [offerBox, declineBox] = await Promise.all([panelButtons().nth(0).boundingBox(), panelButtons().nth(1).boundingBox()]);
    expect(offerBox!.width).toBe(declineBox!.width);
    expect(offerBox!.height).toBe(declineBox!.height);
    expect(offerBox!.height).toBeGreaterThanOrEqual(44);
    expect(await page.locator('[data-action="upgrade"]').isVisible()).toBe(false);
    expect(await page.locator('[data-action="continue"]').isVisible()).toBe(false);
    expect(await clicks()).toEqual([]);

    await panelButtons().nth(1).click();
    expect(await clicks()).toEqual(["continue"]);
    await panelButtons().nth(0).click();
    expect(await clicks()).toEqual(["continue", "upgrade"]);
  });

  test("does not preselect or steal focus, and both choices are keyboard reachable", async () => {
    await open("asymmetric");
    await page.locator("#traveler").focus();
    const [pair] = await scan();
    await cc("apply", pair!.id);
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("traveler");

    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe("Upgrade (+$89.00)");
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe("Continue without upgrade");
    await page.keyboard.press("Enter");
    expect(await clicks()).toEqual(["continue"]);
  });

  test("preserves form state and undo restores the original presentation", async () => {
    await open("asymmetric");
    await page.locator("#traveler").fill("Ada Lovelace");
    const presentation = () =>
      page.evaluate(() =>
        ["upgrade", "continue"].map((action) => {
          const el = document.querySelector(`[data-action="${action}"]`)!;
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return [rect.x, rect.y, rect.width, rect.height, style.display, style.textDecorationLine];
        })
      );
    const before = await presentation();

    const [pair] = await scan();
    await cc("apply", pair!.id);
    expect(await page.locator("#traveler").inputValue()).toBe("Ada Lovelace");

    await cc("undo", pair!.id);
    expect(await presentation()).toEqual(before);
    expect(await page.locator("[data-clean-choice-panel]").count()).toBe(0);
    expect(await page.locator("#clean-choice-style").count()).toBe(0);
    expect(await page.locator("[data-clean-choice]").count()).toBe(0);
    expect(await page.locator("#traveler").inputValue()).toBe("Ada Lovelace");
  });

  test("mirrors a disabled original", async () => {
    await open("disabled");
    const [pair] = await scan();
    expect(pair!.verdict).toBe("flag");
    expect(pair!.decline.disabled).toBe(true);
    await cc("apply", pair!.id);
    expect(await panelButtons().nth(1).isDisabled()).toBe(true);
    expect(await panelButtons().nth(0).isDisabled()).toBe(false);

    await page.evaluate(() => document.querySelector<HTMLButtonElement>('[data-action="continue"]')!.removeAttribute("disabled"));
    await eventually(() => panelButtons().nth(1).isDisabled(), false);
    await panelButtons().nth(1).click();
    expect(await clicks()).toEqual(["continue"]);
  });

  test("follows controls the page re-renders, and fails open when they disappear", async () => {
    await open("replaced");
    const [pair] = await scan();
    await cc("apply", pair!.id);

    await page.evaluate(() => (window as any).rerender(2));
    await eventually(() => page.locator('[data-action="continue-2"]').isVisible(), false);
    expect(await page.locator("[data-clean-choice-panel]").count()).toBe(1);
    await panelButtons().nth(1).click();
    expect(await clicks()).toEqual(["continue-2"]);

    await page.evaluate(() => (window as any).replaceWithUnrelated());
    await eventually(() => page.locator("[data-clean-choice-panel]").count(), 0);
    expect(await page.locator("#clean-choice-style").count()).toBe(0);
  });

  test("the script is idempotent when injected twice", async () => {
    await open("asymmetric");
    await page.addScriptTag({ path: CONTENT_SCRIPT });
    const [pair] = await scan();
    await cc("apply", pair!.id);
    expect(await cc<boolean>("apply", pair!.id)).toBe(false);
    expect(await page.locator("[data-clean-choice-panel]").count()).toBe(1);
  });
});
