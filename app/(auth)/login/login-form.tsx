"use client";

import { Loader2, Mail } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signInWithGoogle } from "../actions";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [devMagicLink, setDevMagicLink] = useState<string | null>(null);

  function showError(message: string) {
    setError(message);
    toast.error(message);
  }

  async function handleMagicLinkSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setIsSending(true);
    setError(null);
    setMessage(null);
    setDevMagicLink(null);

    try {
      const response = await fetch("/api/auth/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await response.json().catch(() => null)) as {
        ok?: boolean;
        sent?: boolean;
        devMagicLink?: string;
        error?: string;
      } | null;

      if (!response.ok) {
        showError(
          response.status === 403
            ? data?.error ??
                "Este e-mail não está autorizado para acessar o backoffice."
            : data?.error ?? "Não foi possível enviar o link. Verifique o e-mail.",
        );
        return;
      }

      if (!data?.ok) {
        showError("Não foi possível enviar o link. Tente novamente.");
        return;
      }

      setMessage(
        data.sent
          ? "Enviamos um link de acesso para o seu e-mail."
          : data.devMagicLink
            ? "Link gerado em modo local."
            : "Se o e-mail estiver autorizado, enviaremos um link de acesso.",
      );
      setDevMagicLink(data.devMagicLink ?? null);
    } catch {
      showError("Não foi possível enviar o link. Tente novamente.");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className="mt-8 space-y-5">
      <form action={signInWithGoogle}>
        <Button type="submit" className="w-full gap-2" size="lg">
          <GoogleIcon />
          Entrar com Google
        </Button>
      </form>

      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-zinc-300" />
        <span className="text-xs font-semibold text-zinc-600">ou</span>
        <div className="h-px flex-1 bg-zinc-300" />
      </div>

      <form
        className="space-y-3"
        onSubmit={handleMagicLinkSubmit}
      >
        <div className="space-y-2">
          <Label htmlFor="magic-link-email" className="text-zinc-800">
            E-mail
          </Label>
          <Input
            id="magic-link-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="voce@empresa.com"
            className="login-autofill-light h-10 border-zinc-300 bg-white text-sm text-zinc-950 shadow-xs placeholder:text-zinc-500 focus-visible:border-zinc-900 focus-visible:ring-zinc-900/20 md:text-sm"
            required
          />
        </div>

        <Button
          type="submit"
          variant="outline"
          className="w-full gap-2 border border-zinc-300 bg-white text-zinc-900 shadow-xs ring-0 hover:border-zinc-400 hover:bg-zinc-50 hover:text-zinc-950 hover:shadow-sm"
          size="lg"
          disabled={isSending}
        >
          {isSending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Mail className="size-4" />
          )}
          Enviar link de acesso
        </Button>
      </form>

      <div className="min-h-[76px]" aria-live="polite">
        {message && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            {message}
            {devMagicLink && (
              <a
                href={devMagicLink}
                className="mt-2 block break-all font-medium underline"
              >
                Abrir magic link local
              </a>
            )}
          </div>
        )}

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      className="h-5 w-5"
    >
      <path
        fill="currentColor"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="currentColor"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="currentColor"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="currentColor"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}
