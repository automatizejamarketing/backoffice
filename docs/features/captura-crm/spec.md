# Captura de contatos para o CRM

Status: implementado-localmente
Data: 2026-09-21
Etapa: implementação local em 2026-09-22; migração e publicação dos ambientes compartilhados pendentes.

## Fontes e evidências da entrevista de 2026-09-21

- Pedido do usuário: integrar o formulário `/captura` ao CRM do Automatize.
- Áudio `WhatsApp Audio 2026-09-21 at 11.59.13.opus`, transcrito localmente: identificar a origem Isaac e distinguir dono de food service de gestor de delivery. A grafia Isaac e os nomes dos perfis foram conferidos na página; a transcrição automática contém erros nesses termos.
- Referências remotas atualizadas por fetch em frontend e backoffice, incluindo main e staging. Nenhum merge, checkout ou alteração do trabalho local foi feito.
- Frontend origin/main `851392de`: o formulário existe, mas handleSubmit apenas chama preventDefault; não há persistência. Campos: perfil, nome, WhatsApp, email, faixa de faturamento e objetivo.
- `/captura` não existe na árvore de origin/staging consultada (`b95131d3`). Planejar explicitamente a base de implementação.
- Backoffice origin/main `c16ca40`: o CRM parte de users; crm_leads usa user_id como chave e eventos também exigem user_id. Os arquivos de consultas e regras do CRM não diferem do checkout local inspecionado.
- Na leitura inicial, o glossário definia lead como conta criada no produto. A decisão de captar contatos sem conta amplia esse conceito; o glossário foi atualizado, mas o código ainda exige conta.

## Requisitos trazidos pelo usuário e pelo áudio

- Mostrar os inscritos no CRM.
- Identificar a origem da campanha de Isaac e o perfil de atuação para abordagem comercial específica.
- Tratar o áudio como material de requisitos, sem autorização adicional para mensagens externas ou mudanças em produção.

## Decisões confirmadas

### 1. Captura cria somente contato comercial

- Resposta do usuário: "cria apenas o contato comercial."
- Enviar `/captura` registra o contato no CRM, sem criar conta de acesso e sem iniciar teste grátis.
- Um contato comercial pode existir sem conta no Automatize. Reaproveitamento e vínculo com conta seguem as decisões 2 e 5.
- Essa decisão não autoriza ativação, concessão de acesso ou mensagens automáticas.

### 2. Reaproveitar contato existente pelo e-mail

- Resposta do usuário à proposta: "Sim, aproveitamos."
- Quando o e-mail enviado já existe no CRM, registrar o novo envio e a identificação Isaac/perfil no contato existente.
- Preservar o histórico e a etapa comercial; não retornar automaticamente para Novo lead.
- Não criar outro contato para o mesmo e-mail.
- Preservação de nome/WhatsApp e vínculo com conta criada posteriormente seguem as decisões 4 e 5.

### 3. WhatsApp compartilhado não une contatos

- Resposta do usuário à proposta: "ok, beleza."
- Contatos com e-mails diferentes permanecem separados, mesmo quando informam o mesmo WhatsApp.
- O e-mail é a chave de deduplicação nesta primeira versão; não unir contatos automaticamente apenas por coincidência de telefone.

### 4. Preservar nome e WhatsApp já preenchidos

- Resposta do usuário à proposta: "pode seguir a sua recomendação".
- Ao reaproveitar um contato, preencher nome e WhatsApp somente quando os respectivos campos estiverem vazios.
- Guardar os dados informados no histórico do envio, inclusive quando divergirem dos dados atuais, para conferência pelo comercial.
- Não substituir automaticamente nome ou WhatsApp já preenchidos.
- Mudanças de perfil, faturamento e objetivo seguem a decisão 10.

### 5. Vincular conta criada posteriormente pelo mesmo e-mail

- Resposta do usuário à proposta: "sim, vai no recomendado".
- Quando um contato comercial criar uma conta no Automatize com o mesmo e-mail, vincular a conta automaticamente ao contato existente.
- Manter um único contato, preservando todo o histórico e a etapa comercial atual.
- Depois do vínculo, o CRM também exibe o estado da conta; a criação da conta não reinicia a etapa comercial.
- O vínculo não concede acesso ou inicia teste grátis por si só; esses estados continuam sendo definidos pelo produto.

### 6. Usar o funil atual com identificação de campanha e perfil

- Resposta do usuário à proposta: "Boa. vai no recomendado."
- Contatos novos de `/captura` entram no funil atual, na coluna Novo lead.
- Exibir a etiqueta Isaac e o perfil Dono de Food Service ou Gestor de Delivery / Consultor.
- Disponibilizar filtros de campanha/origem e perfil no CRM.
- Não criar uma etapa comercial exclusiva para Isaac. Contatos existentes preservam sua etapa, conforme a decisão 2.

### 7. Incluir contatos sem conta nas metas comerciais

- Resposta do usuário à proposta: "Sim".
- Contatos novos de `/captura` entram na base de leads da taxa de agendamento no mês da primeira captura, mesmo sem conta no Automatize.
- Reenvios e a criação posterior da conta não contam como um novo lead.
- Reaproveitar um contato existente não reinicia sua entrada na base comercial.
- Conversões em trial e cliente continuam dependendo dos eventos reais da conta vinculada, conforme as regras comerciais existentes.
- Preservar a exclusão de contatos internos/equipe da base qualificável.

### 8. Identificação de campanha não atribui comissão

- Resposta do usuário à proposta: "perfeito, boa".
- A etiqueta Isaac identifica a campanha no CRM, sem atribuir automaticamente futuras vendas ou comissões ao parceiro.
- Comissões e atribuição de vendas continuam seguindo as regras atuais dos links de afiliado.
- A integração de `/captura` não deve substituir uma atribuição de afiliado existente apenas por causa da etiqueta da campanha.

### 9. Confirmar envio e explicar a ativação posterior do teste

- Resposta do usuário à proposta: "Sim".
- Após salvar o envio com sucesso, mostrar a confirmação de recebimento e informar que a equipe entrará em contato pelo WhatsApp para apresentar a condição de Isaac e orientar a ativação do teste.
- Texto de referência aprovado: "Recebemos seus dados! Nossa equipe vai entrar em contato pelo WhatsApp para apresentar a condição do Isaac e orientar seu teste de 7 dias."
- A confirmação não significa que o teste já começou e não implica envio automático de mensagem por WhatsApp.

### 10. Usar as últimas respostas preenchidas de qualificação

- Resposta do usuário à proposta: "sim".
- Em reenvios, mostrar o último valor preenchido de perfil, faturamento e objetivo, mantendo as respostas anteriores no histórico.
- Campo opcional enviado vazio não apaga um valor existente.
- Nome e WhatsApp continuam seguindo a regra da decisão 4.

## Estado da entrevista

Regras de produto da captura confirmadas e entrevista conjunta concluída.
Implementação local concluída; ver [entrega e validação](../entrega-captura-embaixadores.md). A segunda frente está consolidada na
[especificação de embaixadores](../embaixadores/spec.md).
