import { describe, expect, test } from "bun:test";
// @ts-expect-error plain-JS extension module without type declarations
import { isDisabled, originOf, setDisabled } from "../extension/site-settings.js";

describe("site settings", () => {
  test("keys settings by origin and refuses non-web pages", () => {
    expect(originOf("https://booking.example.com/checkout?step=3")).toBe("https://booking.example.com");
    expect(originOf("chrome://extensions")).toBeNull();
    expect(originOf("not a url")).toBeNull();
  });

  test("disabling one site leaves others enabled, and re-enabling removes the entry", () => {
    const off = setDisabled({}, "https://a.example", true);
    expect(isDisabled(off, "https://a.example")).toBe(true);
    expect(isDisabled(off, "https://b.example")).toBe(false);
    expect(setDisabled(off, "https://a.example", false)).toEqual({});
    expect(isDisabled(off, null)).toBe(false);
  });
});
