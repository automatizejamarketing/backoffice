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

export const ACCEPTED_DEFENCE_CONTENT_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
] as const;
const ACCEPTED_CONTENT_TYPES = new Set<string>(ACCEPTED_DEFENCE_CONTENT_TYPES);

export function detectDefenceContentType(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  ) {
    return "application/pdf";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  return null;
}

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
