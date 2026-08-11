import { requirePagePermission } from "@/lib/auth/rbac";
import { ReferralsNav } from "./referrals-nav";

export default async function ReferralsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePagePermission("affiliates:manage");
  return (
    <div>
      {/* A MESMA barra de abas em toda página da seção — ver referrals-nav. */}
      <ReferralsNav />
      {children}
    </div>
  );
}
