import { describe, expect, test } from "bun:test";
import { findOctoberCampaign } from "./whatsapp-october-templates";

describe("October campaign version association", () => {
  const sent = { id: "sent", template_name: "outubro_2026_0510_atendimento_v3", state: "completed", body: "Original sent message" };
  test("retains the completed campaign when the suggested template advances to v4", () => {
    expect(findOctoberCampaign([sent], "outubro_2026_0510_atendimento_v4")).toBe(sent);
  });
  test("prefers an explicitly saved current version", () => {
    const draft = { ...sent, id: "draft", template_name: "outubro_2026_0510_atendimento_v4", state: "draft" };
    expect(findOctoberCampaign([sent, draft], draft.template_name)).toBe(draft);
  });
  test("does not associate another October message or a similarly prefixed template", () => {
    expect(findOctoberCampaign([sent], "outubro_2026_0810_assinatura_v2")).toBeUndefined();
    expect(findOctoberCampaign([{template_name: "outubro_2026_0510_atendimento_extra_v3"}], "outubro_2026_0510_atendimento_v4")).toBeUndefined();
  });
  test("selects the newest saved previous version and leaves unsaved campaigns unconfigured", () => {
    const older = {...sent, id: "older", template_name: "outubro_2026_0510_atendimento_v2"};
    expect(findOctoberCampaign([sent, older], "outubro_2026_0510_atendimento_v4")).toBe(sent);
    expect(findOctoberCampaign([], "outubro_2026_0510_atendimento_v4")).toBeUndefined();
  });
  test("does not apply family matching to arbitrary custom campaigns", () => {
    expect(findOctoberCampaign([{template_name:"custom_v1"}], "custom_v2")).toBeUndefined();
  });
});
