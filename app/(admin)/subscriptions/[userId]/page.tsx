import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { UserSubscriptionPanel } from "@/components/user-subscription-panel";
import { getUserSubscriptionDetails } from "@/lib/db/admin-queries";

export default async function UserSubscriptionPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  const data = await getUserSubscriptionDetails(userId);

  if (!data) {
    notFound();
  }

  return (
    <div className="container space-y-6 px-4 py-8">
      <div className="flex items-center justify-between gap-4">
        <Link
          href="/subscriptions"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar para Assinaturas
        </Link>
        <Link
          href={`/users/${data.user.id}?tab=subscription`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Ir para perfil completo →
        </Link>
      </div>

      <UserSubscriptionPanel data={data} />
    </div>
  );
}
