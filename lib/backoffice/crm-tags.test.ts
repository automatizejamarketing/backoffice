import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  canManageCrmTags,
  crmTagInput,
  crmTagTextColor,
  DEFAULT_CRM_TAGS,
  resolveCrmTags,
} from "./crm-tags";
import type { BackofficeActor } from "@/lib/auth/rbac-core";

const actor = (
  role: BackofficeActor["role"],
  salesRole?: BackofficeActor["salesRole"],
): BackofficeActor => ({
  id: "local",
  email: "test@example.com",
  role,
  salesRole,
  source: "database",
});

test("only admins and commercial managers with CRM access edit tag settings", () => {
  assert.equal(canManageCrmTags(actor("admin")), true);
  assert.equal(canManageCrmTags(actor("comercial", "gestor_comercial")), true);
  assert.equal(canManageCrmTags(actor("comercial", "sdr")), false);
  assert.equal(
    canManageCrmTags(actor("comercial", "consultor_comercial")),
    false,
  );
  assert.equal(canManageCrmTags(actor("dev")), false);
  assert.equal(
    canManageCrmTags(actor("finance_viewer", "gestor_comercial")),
    false,
  );
});
test("validates stable keys, bounded names and safe colors", () => {
  const valid = {
    key: "source:isaac",
    name: "  Parceria Isaac  ",
    color: "#abcdef",
  };
  assert.deepEqual(crmTagInput.parse(valid), {
    ...valid,
    name: "Parceria Isaac",
    color: "#ABCDEF",
  });
  for (const patch of [
    { key: "unknown" },
    { name: " " },
    { name: "x".repeat(61) },
    { color: "red" },
    { color: "#123" },
    { color: "url(example)" },
    { unexpected: true },
  ])
    assert.equal(crmTagInput.safeParse({ ...valid, ...patch }).success, false);
});
test("renaming tags preserves attribution keys and fills missing settings", () => {
  const tags = resolveCrmTags([
    { key: "source:isaac", name: "Parceria Isaac", color: "#AABBCC" },
  ]);
  assert.equal(tags[0].key, "source:isaac");
  assert.equal(tags[0].name, "Parceria Isaac");
  assert.deepEqual(tags.slice(1), DEFAULT_CRM_TAGS.slice(1));
  assert.deepEqual(
    resolveCrmTags([{ key: "source:isaac", name: "", color: "invalid" }]),
    DEFAULT_CRM_TAGS,
  );
});
test("tag contrast supports both light and dark manager-selected colors", () => {
  assert.equal(crmTagTextColor("#FFFFFF"), "#000000");
  assert.equal(crmTagTextColor("#FFFF00"), "#000000");
  assert.equal(crmTagTextColor("#000000"), "#FFFFFF");
  assert.equal(crmTagTextColor("#6D28D9"), "#FFFFFF");
});
test("both apps share the tag migration and timestamp", () => {
  const base = new URL("../../", import.meta.url);
  assert.equal(
    readFileSync(
      new URL("lib/db/migrations/0121_crm_tag_settings.sql", base),
      "utf8",
    ),
    readFileSync(
      new URL("../frontend/lib/db/migrations/0128_crm_tag_settings.sql", base),
      "utf8",
    ),
  );
  const journal = (path: string) =>
    JSON.parse(readFileSync(new URL(path, base), "utf8")).entries.find(
      (e: { tag: string }) => e.tag.endsWith("_crm_tag_settings"),
    );
  assert.equal(
    journal("lib/db/migrations/meta/_journal.json").when,
    journal("../frontend/lib/db/migrations/meta/_journal.json").when,
  );
});
const enabled = process.env.RUN_CRM_TAG_DB_TESTS === "1";
if (
  enabled &&
  process.env.POSTGRES_URL !==
    "postgres://codex@127.0.0.1:55439/automatize_test"
)
  throw new Error("Use the disposable local fixture database only.");
test(
  "settings persist across reads with editor attribution and do not alter contact attribution",
  { skip: !enabled },
  async () => {
    const { db } = await import("@/lib/db");
    const { crmTagSetting } = await import("@/lib/db/schema");
    const { eq, sql } = await import("drizzle-orm");
    const { getCrmTags, saveCrmTag } = await import("@/lib/db/crm-tag-queries");
    const [previous] = await db
      .select()
      .from(crmTagSetting)
      .where(eq(crmTagSetting.key, "source:isaac"));
    const before = await db.execute(
      sql`select id, capture_source, capture_profile from crm_contacts order by id`,
    );
    try {
      await saveCrmTag(
        { key: "source:isaac", name: "Parceria de teste", color: "#123456" },
        "test@example.com",
      );
      assert.equal((await getCrmTags())[0].name, "Parceria de teste");
      const [saved] = await db
        .select()
        .from(crmTagSetting)
        .where(eq(crmTagSetting.key, "source:isaac"));
      assert.equal(saved.updatedBy, "test@example.com");
      await saveCrmTag(
        { key: "source:isaac", name: "Campanha teste", color: "#654321" },
        "manager@example.com",
      );
      assert.equal((await getCrmTags())[0].color, "#654321");
      const after = await db.execute(
        sql`select id, capture_source, capture_profile from crm_contacts order by id`,
      );
      assert.deepEqual([...after], [...before]);
    } finally {
      if (previous)
        await db
          .update(crmTagSetting)
          .set(previous)
          .where(eq(crmTagSetting.key, "source:isaac"));
      else
        await db
          .delete(crmTagSetting)
          .where(eq(crmTagSetting.key, "source:isaac"));
    }
  },
);
