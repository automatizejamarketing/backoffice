import { auth } from "@/app/(auth)/auth";
import { redirect } from "next/navigation";
import { LoginForm } from "./login-form";
import Image from "next/image";
import logoLight from "@/public/logo/3.png";
import logoDark from "@/public/logo/9.png";

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
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-md space-y-8 p-8">
        <div className="flex flex-col items-center gap-6">
          {/* Logo for light mode */}
          <Image
            alt="AutomatizeJá"
            src={logoLight}
            height={40}
            priority
            className="block dark:hidden"
          />
          {/* Logo for dark mode */}
          <Image
            alt="AutomatizeJá"
            src={logoDark}
            height={40}
            priority
            className="hidden dark:block"
          />
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Backoffice
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Entre para acessar o painel administrativo
            </p>
          </div>
        </div>

        {params.error === "unauthorized" && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-center text-sm text-destructive">
            Seu email não está autorizado para acessar esta aplicação.
          </div>
        )}

        <LoginForm />
      </div>
    </div>
  );
}
