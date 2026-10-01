import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readSource(relativePath: string) {
  return readFileSync(join(repositoryRoot, relativePath), "utf8");
}

/** Review sheets that can host portaled overlays (`SheetContent className="z-[N] …"`). */
const reviewSheets = {
  ReviewEditSheet: "app/(admin)/marketing/ai/flow-chrome.tsx",
  AiAdvancedAudienceSheet: "app/(admin)/marketing/ai/ai-advanced-audience-sheet.tsx",
};

/** z-index declared by the `SheetContent` of a review sheet file. */
function sheetZIndex(relativePath: string): number {
  const source = readSource(relativePath);
  const match = source.match(/<SheetContent[\s\S]*?className="[^"]*\bz-\[(\d+)\]/);
  assert.ok(match, `${relativePath} deveria declarar z-[N] no SheetContent`);
  return Number(match[1]);
}

function highestReviewSheetZIndex(): number {
  return Math.max(...Object.values(reviewSheets).map(sheetZIndex));
}

test("o wrapper dos overlays Radix fica acima dos sheets de revisão, com !important", () => {
  const css = readSource("app/globals.css");
  // Radix copies the content z-index inline onto the wrapper, so only !important wins.
  const match = css.match(
    /\[data-radix-popper-content-wrapper\]\s*\{[^}]*z-index:\s*(\d+)\s*!important/,
  );
  assert.ok(
    match,
    "globals.css deveria fixar z-index: N !important em [data-radix-popper-content-wrapper]",
  );
  for (const [name, path] of Object.entries(reviewSheets)) {
    assert.ok(
      Number(match[1]) > sheetZIndex(path),
      `wrapper z-index ${match[1]} precisa ser maior que o do ${name} (${sheetZIndex(path)})`,
    );
  }
});

test("o PopoverContent fica acima dos sheets de revisão e recebe cliques", () => {
  const source = readSource("components/ui/popover.tsx");
  assert.doesNotMatch(source, /\bz-50\b/, "PopoverContent não pode voltar para z-50");
  const zValues = [...source.matchAll(/\bz-\[(\d+)\]/g)].map((match) => Number(match[1]));
  assert.ok(zValues.length > 0, "PopoverContent deveria declarar z-[N]");
  for (const value of zValues) {
    assert.ok(
      value > highestReviewSheetZIndex(),
      `z-[${value}] precisa ser maior que o dos sheets de revisão (${highestReviewSheetZIndex()})`,
    );
  }
  assert.match(source, /\bpointer-events-auto\b/);
});
