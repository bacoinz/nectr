import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SECURITY_HEADERS } from "./headers";

function parseHeadersFile(text: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s+([\w-]+):\s*(.+)$/.exec(line);
    if (match) headers[match[1]!] = match[2]!.trim();
  }
  return headers;
}

describe("security headers", () => {
  it("public/_headers matches the headers the Worker sets", () => {
    const fromFile = parseHeadersFile(readFileSync("public/_headers", "utf8"));
    expect(fromFile).toEqual(SECURITY_HEADERS);
  });
});
