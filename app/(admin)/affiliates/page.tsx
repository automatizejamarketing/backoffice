// Lápide do programa de afiliados v1 (ticket 15, ADR 0024).
//
// A tela antiga (aprovar, rejeitar, bloquear, criar afiliado, marcar conversão
// como paga) foi retirada no cutover. Ela era a única superfície humana capaz
// de escrever nas tabelas do v1 — mantê-la acessível faria de "nenhuma escrita
// nova chega às tabelas do v1" uma promessa que depende de ninguém clicar.
//
// A rota continua existindo, em vez de simplesmente sumir, porque operadores
// têm o endereço no histórico e em favoritos: um 404 os deixaria sem saber se
// o programa mudou ou se o backoffice quebrou. Esta página responde a pergunta
// e leva ao lugar certo.
//
// Nada aqui consulta o banco. As tabelas do v1 (`affiliates`,
// `affiliate_clicks`, `affiliate_conversions`, `affiliate_action_logs`)
// continuam intactas, e o que é aproveitável nelas é decisão separada.

import Link from "next/link";
import { Archive } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function AffiliatesV1DiscontinuedPage() {
  return (
    <div className="mx-auto w-full max-w-2xl p-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Archive className="size-4" aria-hidden="true" />
            Programa de afiliados v1 — descontinuado
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>
            Esta tela administrava o programa antigo. Ela saiu do ar no cutover:
            cliques, conversões e comissões passaram a ser registrados
            exclusivamente pelo programa novo.
          </p>
          <p>
            Os dados do v1 continuam no banco, intactos. Nada foi apagado e nada
            foi migrado — os códigos antigos, porém, não atribuem mais.
          </p>
          <Button asChild>
            <Link href="/referrals">Ir para Afiliados</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
