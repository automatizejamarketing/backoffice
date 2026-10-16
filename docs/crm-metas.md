# Metas do comercial — decisões e pendências

Combinado com o João em 14/09/2026 para o Bernardo (gestor comercial).
Vocabulário: `CONTEXT.md`, seção "CRM comercial". Cálculo:
`lib/db/crm-goals-queries.ts`; regras puras: `lib/backoffice/crm-goals.ts`.

## Decisões

- Métricas por cargo, sem atribuição individual por lead: tudo de agendamento
  é do SDR (Vinicius) e tudo de reunião/conversão é do consultor (Davi),
  inclusive o que o Bernardo fechar. Quando houver um segundo SDR, aí entra um
  campo "responsável" no lead.
- Mês calendário (BRT), modo **fluxo do período**: numerador e denominador
  contam o que aconteceu dentro do mês, sem exigir o mesmo grupo de leads.
- Semáforo: verde ≥ meta, laranja até 10 pontos percentuais abaixo
  (`CRM_GOAL_NEAR_POINTS`), vermelho além. Sem meta ou sem volume: neutro.
- Metas guardadas por mês (`crm_goals`), herdando o mês anterior mais
  recente; padrão em código quando nunca foi editada (60% agendamento, 75%
  trial, conversão real sem meta). Só mês corrente e futuros aceitam edição.
- "Virou trial" e "virou cliente" vêm do produto (`subscriptions` e
  `payments`), não do status manual do kanban. Sem comparar com a data do
  status: a primeira versão exigia assinatura criada depois do status
  Reunião realizada/Trial feito, mas o time marca o status depois do fato
  (em 16/09/2026, 51 de 51 reuniões do mês tinham assinatura anterior ao
  status), então as duas conversões apareciam como 0.
- Denominador de agendamento exclui contas sem telefone e contas da equipe
  (`isInternalLeadEmail`). O kanban continua mostrando tudo.

## Pendências para o Bernardo

1. **Fluxo do período vs. coorte.** Hoje é fluxo. A coorte ("das contas
   criadas no mês, quantas agendaram, em qualquer data") é a conversão real
   daquela safra, mas fica baixa no fim do mês. Trocar é escrever a variante
   em `getCrmGoalsDashboard` e escolher pela métrica; as regras puras não
   mudam.
2. **Lead que ativa trial sozinho, sem reunião.** Hoje entra no denominador
   da taxa de agendamento (é conta qualificável) e não entra no numerador, o
   que puxa a taxa do SDR para baixo. Alternativas: tirar do denominador
   quem virou trial sem passar por agendamento, ou contar como agendado.

## Operação depois do deploy

- Migration `0109_crm_goals_sales_roles` (backoffice) / espelho no frontend,
  `when=1799600000000`. Rodar `bun run db:migrate` em staging e em prod.
- Tela Equipe: Bernardo (sócio) → papel `admin` + cargo gestor comercial;
  Vinicius → `comercial` + SDR; Davi → `comercial` + consultor comercial.
  Isso tira Vinicius e Davi de admin (Vinicius também saiu de
  `ADMIN_EMAILS` em `lib/config.ts`, senão a lista sobreporia o banco).
- Meses anteriores a 10/09/2026 (lançamento do CRM) não têm eventos, então
  aparecem sem dados.
