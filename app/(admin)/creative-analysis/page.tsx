import { requirePagePermission } from "@/lib/auth/rbac";

import { CreativeAnalysisPlayground } from "./playground-client";

export const dynamic = "force-dynamic";

export default async function CreativeAnalysisPage() {
  await requirePagePermission("creative-analysis:manage");

  return <CreativeAnalysisPlayground />;
}
