import { getCurrentBackofficeActor } from "@/lib/auth/rbac";
import { redirect } from "next/navigation";

export default async function EmbedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Match (admin)/layout: magic-link sessions have an actor via cookie but no
  // NextAuth `session.user`. Requiring both bounced the iframe to /login → /.
  const actor = await getCurrentBackofficeActor();

  if (!actor) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">{children}</div>
    </div>
  );
}
