import { fileURLToPath } from "node:url";
// SITE_CONTRACT.md section 9: the switch-on PR must change every public
// sentence that promises text never leaves the device. The contract's
// pattern must catch every such sentence the site has today, and none of the
// sentences that replace them (RT fix round 1: the first list missed ten).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const contract = readFileSync(fileURLToPath(new URL("../SITE_CONTRACT.md", import.meta.url)), "utf8");
const section9 = contract.split("## 9. ")[1]!.split("\n## 10. ")[0]!;
const pattern = new RegExp(/```\n([^\n]+)\n```/.exec(section9)![1]!, "i");

/** Read static repository HTML for this assertion; never a renderer or sanitizer. */
function staticText(source: string): string {
  let visible = "";
  let inTag = false;
  let quote = "";
  for (const char of source) {
    if (!inTag) {
      if (char === "<") inTag = true;
      else visible += char;
    } else if (quote) {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") quote = char;
    else if (char === ">") inTag = false;
  }
  if (inTag) throw new Error("unterminated tag in static site source");
  return visible
    .replace(/&rsquo;/g, "’")
    .replace(/\s+/g, " ");
}

function text(path: string): string {
  const source = readFileSync(`${root}${path}`, "utf8");
  return path.endsWith(".html") ? staticText(source) : source.replace(/\s+/g, " ");
}

const rows = section9
  .split("\n")
  .filter((l) => l.startsWith("| `"))
  .map((l) => l.split(" | ").map((c) => c.replace(/^\| /, "").replace(/ \|$/, "")));

describe("the switch-on PR's list of public promises", () => {
  it("reads promises across inline tags and quoted tag attributes", () => {
    expect(staticText('Text <em title="a > b">never</em> leaves your device.')).toBe("Text never leaves your device.");
    expect(() => staticText("Text <em")).toThrow("unterminated");
  });
  it("has a row for every file where the pattern finds a promise today", () => {
    const files = ["site/pages/index.html", "site/pages/privacy.html", "site/js/checker.js", "README.md", "site/README.md", "SECURITY.md"];
    for (const f of files) {
      const found = [...text(f).matchAll(new RegExp(pattern.source, "gi"))].map((m) => m[0]);
      if (found.length === 0) continue;
      const listed = rows.filter((r) => r[0]!.includes(f)).length;
      expect(listed, `${f}: ${found.join(" / ")}`).toBeGreaterThanOrEqual(found.length);
    }
  });

  it("catches every 'Today' sentence and no 'After' sentence", () => {
    expect(rows.length).toBeGreaterThanOrEqual(17);
    for (const [where, today, after] of rows) {
      const unchanged = after!.includes("unchanged");
      if (!unchanged && !where!.includes("Check it yourself")) expect(today, where).toMatch(pattern);
      expect(after, where).not.toMatch(pattern);
    }
  });

  it("the Explain section and the consent line promise nothing the pattern catches", () => {
    const s8 = contract.split("## 8. ")[1]!.split("\n## 9. ")[0]!;
    const s4 = contract.split("## 4. ")[1]!.split("\n## 5. ")[0]!;
    for (const quote of [...s8.split("\n"), ...s4.split("\n")].filter((l) => l.startsWith("> "))) {
      expect(quote).not.toMatch(pattern);
    }
  });
});
