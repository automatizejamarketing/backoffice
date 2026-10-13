import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md space-y-2 px-4 py-16 text-center">
      <h1 className="text-lg font-semibold">Cliente não encontrado</h1>
      <p className="text-sm text-muted-foreground">
        Ele pode não estar mais ativo (sem assinatura nem acesso válido) ou não estar na sua carteira.
      </p>
      <Link href="/trafego" className="text-sm text-primary hover:underline">
        Voltar para Tráfego
      </Link>
    </div>
  );
}
