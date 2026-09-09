export const MAX_DEFENCE_FILES = 10;
export const MAX_DEFENCE_FILE_BYTES = 10 * 1024 * 1024;

export type DisputeDefenceFile = {
  name: string;
  contentType: string;
  size: number;
  storageKey?: string;
};

export type DisputeDefenceCase = {
  status: "open_full" | "open_partial" | "closed_valid" | "closed_revoked" | "closed_partial";
  deadlineAt: Date | null;
  originalProviderAccountId: string | null;
  submittedAt: Date | null;
  submissionState: "draft" | "unknown" | "submitted";
  files: DisputeDefenceFile[];
};

export type DisputeDefenceDecision =
  | { allowed: true; action: "submit" | "recover"; providerAccountId: string | null }
  | { allowed: false; reason: "case_closed" | "deadline_expired" | "not_reviewed" | "too_many_files" | "invalid_file" | "already_submitted" };

const ACCEPTED_CONTENT_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);

export function decideDisputeDefenceSubmission(input: {
  case: DisputeDefenceCase;
  reviewed: boolean;
  now: Date;
}): DisputeDefenceDecision {
  if (!input.case.status.startsWith("open_")) return { allowed: false, reason: "case_closed" };
  if (input.case.deadlineAt && input.case.deadlineAt <= input.now) return { allowed: false, reason: "deadline_expired" };
  if (!input.reviewed) return { allowed: false, reason: "not_reviewed" };
  if (input.case.files.length > MAX_DEFENCE_FILES) return { allowed: false, reason: "too_many_files" };
  if (input.case.files.some((file) => file.size <= 0 || file.size > MAX_DEFENCE_FILE_BYTES || !ACCEPTED_CONTENT_TYPES.has(file.contentType))) {
    return { allowed: false, reason: "invalid_file" };
  }
  if (input.case.submissionState === "submitted" || input.case.submittedAt) return { allowed: false, reason: "already_submitted" };
  return {
    allowed: true,
    action: input.case.submissionState === "unknown" ? "recover" : "submit",
    providerAccountId: input.case.originalProviderAccountId,
  };
}

export type DisputeDefenceProvider = {
  findSubmission(input: { providerAccountId: string | null }): Promise<{ id: string; result: string } | null>;
  submit(input: { providerAccountId: string | null; files: DisputeDefenceFile[] }): Promise<{ id: string; result: string }>;
};

export async function submitDisputeDefence(input: {
  case: DisputeDefenceCase;
  reviewed: boolean;
  now: Date;
  provider: DisputeDefenceProvider;
}): Promise<
  | { state: "submitted"; submissionId: string; result: string; recovered: boolean }
  | { state: "draft"; reason: Exclude<DisputeDefenceDecision, { allowed: true }>['reason'] }
  | { state: "unknown" }
> {
  const decision = decideDisputeDefenceSubmission(input);
  if (!decision.allowed) return { state: "draft", reason: decision.reason };
  try {
    if (decision.action === "recover") {
      const known = await input.provider.findSubmission({ providerAccountId: decision.providerAccountId });
      if (known) return { state: "submitted", submissionId: known.id, result: known.result, recovered: true };
      return { state: "unknown" };
    }
    const created = await input.provider.submit({ providerAccountId: decision.providerAccountId, files: input.case.files });
    return { state: "submitted", submissionId: created.id, result: created.result, recovered: false };
  } catch {
    return { state: "unknown" };
  }
}
