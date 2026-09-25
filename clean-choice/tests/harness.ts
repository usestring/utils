import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import type { Server } from "bun";

export const ROOT = resolve(import.meta.dir, "..");
export const EXTENSION_DIR = join(ROOT, "extension");
export const CONTENT_SCRIPT = join(EXTENSION_DIR, "content.js");

export function serveFixtures(): Server<undefined> {
  return Bun.serve({
    port: 0,
    fetch(request) {
      const { pathname } = new URL(request.url);
      if (!/^\/[\w-]+\.html$/.test(pathname)) return new Response("not found", { status: 404 });
      return new Response(Bun.file(join(ROOT, "fixtures", pathname)), {
        headers: { "content-type": "text/html; charset=utf-8" }
      });
    }
  });
}

// Chromium derives an unpacked extension's ID from the SHA-256 of its absolute path,
// mapping each hex digit of the first 16 bytes onto the letters a-p.
export function unpackedExtensionId(path: string): string {
  return [...createHash("sha256").update(path).digest("hex").slice(0, 32)]
    .map((digit) => String.fromCharCode(97 + parseInt(digit, 16)))
    .join("");
}
