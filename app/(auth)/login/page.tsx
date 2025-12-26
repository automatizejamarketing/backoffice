import { auth } from "@/app/(auth)/auth";
import { redirect } from "next/navigation";
import { LoginForm } from "./login-form";
import Image from "next/image";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  const params = await searchParams;

  // Se já estiver logado, redireciona para o dashboard
  if (session?.user) {
    redirect("/");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50">
      <div className="w-full max-w-md space-y-8 p-8">
        <div className="flex flex-col items-center gap-6">
          {/* Logo */}
          {/* biome-ignore lint/a11y/useAltText: Alt text provided */}
          <Image
            alt="AutomatizeJá"
            src="/logo/3.png"
            width={232}
            height={40}
            priority
          />
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
              Backoffice
            </h1>
            <p className="mt-2 text-sm text-zinc-600">
              Entre para acessar o painel administrativo
            </p>
          </div>
        </div>

        {params.error === "unauthorized" && (
          <div className="rounded-md border border-red-200 bg-red-50 p-4 text-center text-sm text-red-700">
            Seu email não está autorizado para acessar esta aplicação.
          </div>
        )}

        <LoginForm />
      </div>
    </div>
  );
}
