import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readSource(relativePath: string) {
  return readFileSync(join(repositoryRoot, relativePath), "utf8");
}

/** z-index of the review sheet (`ReviewEditSheet` → `SheetContent className="z-[N] …"`). */
function reviewSheetZIndex(): number {
  const source = readSource("app/(admin)/marketing/ai/flow-chrome.tsx");
  const match = source.match(/<SheetContent[\s\S]*?className="[^"]*\bz-\[(\d+)\]/);
  assert.ok(match, "ReviewEditSheet deveria declarar z-[N] no SheetContent");
  return Number(match[1]);
}

test("o wrapper dos overlays Radix fica acima do sheet de revisão", () => {
  const css = readSource("app/globals.css");
  const match = css.match(/\[data-radix-popper-content-wrapper\]\s*\{[^}]*z-index:\s*(\d+)/);
  assert.ok(match, "globals.css deveria fixar o z-index de [data-radix-popper-content-wrapper]");
  assert.ok(
    Number(match[1]) > reviewSheetZIndex(),
    `wrapper z-index ${match[1]} precisa ser maior que o do sheet (${reviewSheetZIndex()})`,
  );
});

test("o PopoverContent fica acima do sheet de revisão e recebe cliques", () => {
  const source = readSource("components/ui/popover.tsx");
  assert.doesNotMatch(source, /\bz-50\b/, "PopoverContent não pode voltar para z-50");
  const zValues = [...source.matchAll(/\bz-\[(\d+)\]/g)].map((match) => Number(match[1]));
  assert.ok(zValues.length > 0, "PopoverContent deveria declarar z-[N]");
  for (const value of zValues) {
    assert.ok(value > reviewSheetZIndex(), `z-[${value}] precisa ser maior que o do sheet`);
  }
  assert.match(source, /\bpointer-events-auto\b/);
});
