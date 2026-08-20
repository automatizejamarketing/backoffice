Assunto: Sandbox 5529 — 3 pontos de acompanhamento (metadata, validade do Pix, cancelamento)

Olá, obrigado pelas respostas. Testamos os três pontos e chegamos a resultados que
precisamos confirmar com vocês antes do corte.

------------------------------------------------------------------
1) O `metadata` continua não persistindo — inclusive com o exemplo de vocês

Refizemos o teste usando exatamente o payload do exemplo que vocês enviaram
(`"metadata": { "cd_fatura": "abc123" }`, uma única chave) e o retorno continua vazio,
tanto na resposta da criação quanto no GET seguinte:

  POST /v1/bills  { ..., "metadata": { "cd_fatura": "abc123" } }
    -> resposta da criação: "metadata": {}
    -> GET /v1/bills/{id}:  "metadata": {}

E não é só em faturas. No merchant 5529 o campo volta vazio em TODOS os recursos que
consultamos, inclusive nos que criamos enviando metadata:

  - bills          -> {}
  - subscriptions  -> {}   (ex.: 1213969, 1213970)
  - customers      -> {}   (ex.: 3255681)

Como vocês disseram que fizeram um GET e receberam o campo preenchido, parece ser algo
específico da conta. **Existe alguma habilitação de conta para o metadata?** Ou o teste de
vocês foi feito em outro merchant?

Já seguimos a recomendação de usar o `code` como referência, então isso não nos bloqueia
mais — mas queremos entender se em produção o comportamento será o mesmo, porque isso
muda o que podemos assumir no corte.

------------------------------------------------------------------
2) A validade do QR Pix não acompanha o `due_at` — e isso conflita com a nossa régua

Vocês mencionaram que o lead time padrão é de 24h e pode ser ampliado até 10 dias.
Tentamos ampliar pelo `due_at` da fatura e ele **não** afeta a validade do QR:

  sem due_at        -> due_at 21/08 23:59 | QR expira 21/08 07:09
  due_at +7 dias    -> due_at 27/08 23:59 | QR expira 21/08 07:10
  due_at +10 dias   -> due_at 30/08 23:59 | QR expira 21/08 07:10
  due_at +15 dias   -> due_at 04/09 23:59 | QR expira 21/08 07:10

Ou seja: a fatura passa a vencer em 7, 10 ou 15 dias, mas o
`max_days_to_keep_waiting_payment` da transação fica sempre em ~24h.

Isso é um problema concreto para nós: **nossa régua de renovação envia o QR ao cliente
3 dias antes do vencimento do acesso** (e um segundo aviso a 1 dia). Com validade de 24h,
o QR enviado no D-3 já está morto quando o cliente vai pagar no D-2.

  a) Como se amplia o lead time para além das 24h? É configuração de conta, ou existe um
     campo na criação da fatura que não estamos usando?
  b) Conseguem ampliar para ~10 dias no merchant 5529 (sandbox) e nos orientar sobre como
     pedir o mesmo em produção?

------------------------------------------------------------------
3) Cancelamento de Pix — entendido

Ficou claro que o cancelamento de boleto/Pix/BolePix não é possível no sandbox e que em
produção funciona. Vamos deixar esses dois casos de teste para o ensaio em produção,
antes do corte. Só confirmando: **em produção, o `DELETE /v1/bills/{id}` de uma fatura
Pix com transação ainda em aberto retorna 200 e invalida o QR?** É disso que dependemos
quando o cliente troca de plano e o QR do plano antigo precisa deixar de ser pagável.

Obrigado.
