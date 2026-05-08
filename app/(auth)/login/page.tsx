import { auth } from "@/app/(auth)/auth";
import { getCurrentBackofficeActor } from "@/lib/auth/rbac";
import { redirect } from "next/navigation";
import { LoginForm } from "./login-form";
import Image from "next/image";
import logo from "@/public/logo/3.png";

const errorMessages: Record<string, string> = {
  unauthorized: "Seu email não está autorizado para acessar esta aplicação.",
  magic_invalid: "O link de acesso é inválido. Solicite um novo link.",
  magic_used: "Este link já foi utilizado. Solicite um novo link.",
  magic_expired: "Este link expirou. Solicite um novo link.",
  magic_error: "Não foi possível validar o link. Tente novamente.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const [session, actor, params] = await Promise.all([
    auth(),
    getCurrentBackofficeActor(),
    searchParams,
  ]);

  // Se já estiver logado, redireciona para o dashboard
  if (session?.user || actor) {
    redirect("/");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50">
      <div className="w-full max-w-md space-y-8 p-8">
        <div className="flex flex-col items-center gap-6">
          {/* Logo */}
          <Image
            alt="AutomatizeJá"
            src={logo}
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

        {params.error && errorMessages[params.error] && (
          <div className="rounded-md border border-red-200 bg-red-50 p-4 text-center text-sm text-red-700">
            {errorMessages[params.error]}
          </div>
        )}

        <LoginForm />
      </div>
    </div>
  );
}
