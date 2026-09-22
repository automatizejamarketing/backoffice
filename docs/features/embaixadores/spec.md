# Acompanhamento de embaixadores

Status: implementado-localmente
Data: 2026-09-21
Etapa: implementação local em 2026-09-22; migração e publicação dos ambientes compartilhados pendentes.

## Fontes

- Pedido direto: visão separada para Bernardo acompanhar as tarefas dos embaixadores, afiliados especiais.
- Mensagem escrita fornecida pelo usuário e áudio `WhatsApp Audio 2026-09-21 at 11.30.19.opus`, transcrito localmente. As decisões da entrevista abaixo consolidam os requisitos; nenhum texto anexo amplia a autorização para ações externas.
- Programa vigente no código: referral_affiliates, vinculado a uma conta de usuário. A página affiliates legada encaminha para o programa atual.

## Requisitos apresentados

- Adicionar manualmente a partir dos afiliados existentes.
- Categorias: Embaixadores e Embaixadores Coprodutores.
- Formalização concluída depois da assinatura do contrato.
- Agendar onboarding; concluir a tarefa depois da reunião.
- Checagem de feedback sete dias depois da conclusão do onboarding.
- Depois do feedback, definir a data da primeira publicação; disponibilizar a conclusão no dia da publicação.
- Nos meses seguintes, renovar as tarefas de publicação no dia 1.
- Coprodutores têm uma trilha paralela após a formalização: brainstorm, apresentação do projeto em sete a dez dias, materiais de divulgação e produto, start. Equipes diferentes acompanham as duas trilhas.

## Pontos adicionais do áudio

- Benefício descrito: Starter e suporte gratuitos.
- Compromisso descrito: uma publicação em vídeo por mês (a transcrição automática sugere Reel). O acompanhamento aprovado registra manualmente a publicação; não foi solicitado validar seu formato nas redes sociais.
- Enviar briefing sete dias antes da publicação: diferença em relação à lista escrita resolvida pela decisão 2.
- A fala associa o avanço inicial ao resultado do período de teste: a decisão 27 define que concluir a checagem inclui a decisão manual de seguir para a primeira publicação.

## Decisões confirmadas

### 1. Acesso compartilhado com permissão específica

- Resposta do usuário à proposta: "isso".
- A aba é compartilhada com Bernardo, administradores e integrantes autorizados das equipes de publicidade e coprodução.
- Usar permissão específica de acesso à aba, sem exigir acesso administrativo completo para os demais integrantes.
- A decisão não autoriza ampliar o acesso desses integrantes a outras áreas do backoffice.
- Responsáveis e limites de edição seguem as decisões 17 a 19.

### 2. Briefing antes de cada publicação

- Resposta do usuário à proposta: "Sim".
- Incluir a tarefa Enviar briefing na primeira publicação e nas publicações mensais seguintes.
- O prazo é calculado automaticamente para sete dias antes da data da publicação.
- Ao definir ou alterar a data da publicação, atualizar o prazo do briefing ainda pendente.
- A tarefa registra trabalho da equipe; não implica envio automático de mensagens ou materiais.

### 3. Renovação mensal preserva ciclos anteriores

- Resposta do usuário à proposta: "sim, isso ai".
- No dia 1, criar um novo ciclo de publicação para os embaixadores que já estiverem na recorrência mensal.
- Cada ciclo possui suas próprias tarefas; a renovação não apaga nem desmarca tarefas antigas.
- Pendências vencidas de meses anteriores continuam visíveis como atrasadas, em paralelo às tarefas do mês atual.
- Exemplo aprovado: publicação de setembro não realizada continua atrasada quando surge, em outubro, a tarefa de definir a publicação de outubro.
- O marco de entrada na recorrência mensal segue a decisão 4.

### 4. Recorrência começa depois da primeira publicação concluída

- Resposta do usuário à proposta: "show, boa".
- Iniciar a recorrência no primeiro dia do mês seguinte à primeira publicação concluída.
- Não gerar ciclos mensais enquanto o embaixador ainda estiver no processo inicial, mesmo quando esse processo atravessar a virada do mês.
- Exemplo aprovado: onboarding em 28 de setembro, feedback em 5 de outubro e primeira publicação concluída em 15 de outubro; primeiro ciclo recorrente em 1º de novembro.

### 5. Explicar as regras em um modal Como funciona

- Pedido explícito do usuário: "isso tudo tem que estar em um modal de 'como funciona'. deixa tudo anotado".
- Disponibilizar um modal Como funciona na aba de Embaixadores.
- Explicar o processo inicial, as categorias, as trilhas paralelas, os prazos, o briefing, o início da recorrência, a renovação mensal e a preservação das pendências e do histórico.
- Incluir todas as regras operacionais confirmadas nesta entrevista.
- Usar linguagem voltada à equipe que opera o fluxo e exemplos de calendário, sem detalhes de implementação.
- Manter o conteúdo alinhado ao comportamento implementado. Conteúdo consolidado em [como-funciona.md](./como-funciona.md).
- Nesta etapa foram criados apenas os documentos; o modal ainda não foi implementado.

### 6. Prazos em dias corridos

- Resposta do usuário à proposta: "sim".
- Contar os prazos em dias corridos, incluindo fins de semana e feriados.
- Aplicar à checagem sete dias depois da conclusão do onboarding, ao briefing sete dias antes da publicação e à apresentação do projeto entre sete e dez dias depois do brainstorm.

### 7. Briefing para hoje quando a publicação estiver próxima

- Resposta do usuário à proposta: "sim".
- Se a publicação for marcada com menos de sete dias de antecedência, definir o prazo do briefing pendente para hoje, sem bloquear o agendamento.
- Mostrar o briefing entre as tarefas que precisam de atenção no dia.
- Exemplo aprovado: publicação marcada para daqui a três dias gera briefing com prazo hoje.
- Aplicar a regra à primeira publicação e aos ciclos mensais. Alterar a data da publicação não reabre um briefing já concluído.

### 8. Prazos derivados da data real de realização

- Resposta do usuário à proposta: "sim".
- Ao concluir uma reunião, sugerir hoje como data de realização e permitir informar a data passada em que ela efetivamente aconteceu.
- Calcular os prazos dependentes a partir da data real informada, não da data em que a equipe registrou a conclusão.
- Aplicar à checagem depois do onboarding e à apresentação do projeto depois do brainstorm.
- Exemplo aprovado: onboarding realizado na segunda e registrado na quinta gera checagem para a segunda seguinte.
- Preservar também quando a conclusão foi registrada e por quem, para distinguir o registro da realização.

### 9. Liberação manual com atalho na aba

- Resposta do usuário: "boa. mas deixe um botão de atalho pra ele liberar o starter".
- Concluir o onboarding registra a realização da reunião, sem conceder gratuidade automaticamente.
- Incluir um botão Liberar Starter para Bernardo executar a liberação manual a partir do acompanhamento do embaixador.
- Marcar ou corrigir uma tarefa não altera a assinatura ou o acesso por si só.
- Duração, créditos e permissão de liberação seguem as decisões 10 a 13, 19 e 21.

### 10. Vencimento escolhido na liberação

- Resposta do usuário: "vencimento escolhido na liberação".
- Bernardo escolhe a data de vencimento ao liberar manualmente o Starter.
- Exibir o vencimento na ficha do embaixador para acompanhamento e renovação manual conforme o combinado.
- Não conceder gratuidade sem prazo ou renovar automaticamente apenas porque a parceria continua ativa.
- Créditos e interação com assinatura paga ativa seguem as decisões 11 a 13 e 21.

### 11. Créditos mensais durante a gratuidade

- Resposta do usuário à proposta: "sim".
- A liberação gratuita inclui 250 créditos por ciclo mensal enquanto o benefício estiver válido, conforme a quantidade atual do plano.
- Alterar o vencimento não concede créditos extras nem reinicia o ciclo mensal.
- A concessão é parte do benefício gratuito, não uma cobrança ou pagamento de assinatura.
- Reexecuções da mesma concessão mensal não podem duplicar os créditos.

### 12. Assinatura paga ativa exige revisão antes da gratuidade

- Resposta do usuário à proposta: "sim".
- Bloquear o atalho Liberar Starter quando o embaixador já tiver uma assinatura paga ativa.
- Orientar a equipe a encaminhar o caso para um administrador revisar a assinatura e a concessão da gratuidade.
- O atalho não cancela cobranças recorrentes, substitui a assinatura existente ou reduz um plano superior.
- A revisão não constitui autorização para cancelar ou alterar automaticamente a assinatura.

### 13. Ciclo de créditos contado a partir da liberação

- Resposta do usuário à proposta: "sim".
- Conceder os primeiros 250 créditos ao liberar o benefício.
- As concessões seguintes ocorrem no mesmo dia dos meses seguintes, enquanto a gratuidade estiver válida.
- Exemplo aprovado: liberação em 21 de setembro, próxima concessão em 21 de outubro se o benefício continuar válido.
- O ciclo de créditos é independente dos ciclos de publicação, que continuam iniciando no dia 1.
- Alterar o vencimento preserva esse ciclo e não repete a concessão inicial, conforme a decisão 11.

### 14. Categoria de coprodução separada do cadastro de Expert

- Resposta do usuário à proposta: "sim".
- Escolher Embaixador Coprodutor habilita a trilha de acompanhamento da coprodução, respeitando seu início após a formalização.
- Não criar automaticamente perfil de Expert ao escolher essa categoria.
- Cadastro de Expert e condições de venda dos produtos continuam no fluxo existente, como ações separadas.
- A categoria não altera automaticamente produtos, participação financeira ou condições de venda.

### 15. Start representa o lançamento e início das vendas

- Resposta do usuário à proposta: "Sim, vai no recomendado".
- Start é o marco de lançamento do projeto e início das vendas.
- A equipe registra a data e marca a etapa como concluída quando o lançamento acontecer.
- O check documenta o marco; não publica produtos nem campanhas automaticamente.

### 16. Checklist de materiais

- Resposta do usuário à proposta: "Sim".
- A etapa Materiais de Divulgação e Produto possui itens separados para landing page, VSL, criativos e produto.
- Cada item pode permanecer pendente, ser marcado como concluído ou como Não se aplica.
- A etapa fica concluída quando não houver itens pendentes.
- Mostrar os itens separadamente para que a equipe identifique o que falta preparar para o lançamento.

### 17. Responsável por trilha

- Resposta do usuário à proposta: "sim".
- Cada embaixador tem um responsável pela trilha de publicidade.
- Embaixadores Coprodutores têm também um responsável pela trilha de coprodução.
- A mesma pessoa pode ser responsável pelas duas trilhas.
- Permitir filtrar o acompanhamento por responsável, incluindo as tarefas de Bernardo.
- A atribuição de responsável não restringe a edição, conforme a decisão 18; liberar Starter exige a permissão da decisão 19.

### 18. Edição compartilhada das trilhas com histórico

- Resposta do usuário à proposta: "sim".
- Qualquer integrante autorizado na aba pode atualizar as duas trilhas, mesmo sem ser o responsável atribuído.
- O responsável organiza e identifica o acompanhamento, sem restringir sozinho quem pode registrar reuniões ou concluir tarefas.
- Registrar quem alterou e quando no histórico.
- Essa decisão trata da edição do acompanhamento; não amplia automaticamente a permissão de conceder Starter.

### 19. Permissão específica para conceder e prorrogar Starter

- Resposta do usuário à proposta: "sim".
- Disponibilizar Liberar Starter somente para Bernardo e administradores.
- Separar essa permissão da edição das tarefas de acompanhamento.
- Os demais integrantes autorizados podem consultar o vencimento, mas não conceder nem prorrogar a gratuidade.
- A permissão é restrita ao benefício dos embaixadores e não concede administração geral de usuários ou acesso financeiro.

### 20. Encerramento da parceria preserva histórico e benefício vigente

- Resposta do usuário à proposta: "Sim".
- Permitir encerrar o acompanhamento quando a parceria terminar.
- Parar de gerar novos ciclos de publicação para a parceria encerrada.
- Preservar o histórico e as pendências existentes.
- O acesso Starter já concedido e seus créditos mensais continuam somente até o vencimento escolhido, sem renovação automática.
- Encerrar a parceria não revoga antecipadamente esse benefício nem altera automaticamente outras assinaturas.

### 21. Renovação após vencimento sem créditos retroativos

- Resposta do usuário à proposta: "sim".
- Ao renovar um benefício vencido, restabelecer o acesso até o novo vencimento escolhido.
- Manter o calendário original de créditos; as concessões retornam na próxima data do ciclo em que o benefício estiver válido.
- Não conceder créditos extras na renovação nem repor ciclos em que a gratuidade estava vencida.
- A renovação após vencimento não repete a concessão inicial nem reinicia o ciclo.

### 22. Conclusão sequencial por trilha

- Resposta do usuário à proposta: "sim".
- Concluir uma etapa exige que a etapa anterior da mesma trilha esteja concluída.
- Manter todas as etapas visíveis e permitir planejar datas antecipadamente.
- Após a formalização, publicidade e coprodução podem avançar de forma independente; nenhuma depende da conclusão da outra.
- A possibilidade de planejar uma data não dispensa os pré-requisitos de conclusão.

### 23. Correção de datas preserva tarefas concluídas

- Resposta do usuário à proposta: "sim".
- Ao corrigir uma data de realização, recalcular apenas os prazos derivados de tarefas ainda pendentes.
- Preservar as tarefas já concluídas; corrigir uma data não desfaz a realização de outra tarefa.
- Registrar a correção no histórico, com autor e data.
- Exemplo aprovado: corrigir a data do onboarding ajusta a checagem se ela estiver pendente, mas não desfaz uma checagem que já aconteceu.

### 24. Troca de categoria preserva a publicidade e o histórico

- Resposta do usuário à proposta: "sim".
- Permitir alterar a categoria depois do cadastro do embaixador.
- Ao mudar de Embaixador para Embaixador Coprodutor, abrir a trilha de coprodução, respeitando o requisito de formalização para seu avanço.
- Ao mudar de Embaixador Coprodutor para Embaixador, arquivar a trilha de coprodução e preservar seu histórico.
- A trilha de publicidade continua de onde estava, sem reiniciar tarefas ou ciclos em razão da troca.

### 25. Checagem obrigatória somente no processo inicial

- Resposta do usuário à proposta: "sim".
- Manter a checagem de feedback como tarefa obrigatória apenas no processo inicial.
- Disponibilizar observações livres para registrar feedbacks posteriores.
- Não criar uma tarefa mensal obrigatória de checagem de resultados; os ciclos recorrentes mantêm as tarefas de publicação e briefing já definidas.
- Esta decisão concilia o acompanhamento contínuo mencionado no áudio com a lista escrita de tarefas mensais.

### 26. Reabertura respeita as dependências de conclusão

- Resposta do usuário à proposta: "sim".
- Permitir desmarcar uma etapa concluída somente quando nenhuma etapa posterior dependente estiver concluída.
- Havendo conclusões posteriores dependentes, a equipe precisa desfazê-las primeiro, na ordem inversa das dependências.
- Preservar no histórico cada alteração, incluindo autor e data; desfazer uma conclusão não apaga o registro anterior.
- A regra considera dependências reais, sem bloquear pela existência de conclusões na outra trilha independente. A formalização é pré-requisito comum às duas trilhas.
- Corrigir apenas uma data continua seguindo a decisão 23, sem exigir desfazer tarefas já realizadas.

### 27. Checagem concluída representa decisão de seguir para publicação

- Resposta do usuário à proposta: "sim".
- Concluir a checagem significa que o feedback foi coletado e a equipe decidiu seguir para a primeira publicação.
- A avaliação é manual; não exigir uma meta automática de ROAS ou vendas.
- Quando ainda forem necessários ajustes antes de seguir, manter a checagem pendente e permitir registrar o motivo nas observações.

### 28. Data real para todas as conclusões

- Resposta do usuário à proposta: "sim sim sim".
- Aplicar a data real de realização a todas as conclusões, incluindo assinatura do contrato, publicação e Start.
- Sugerir hoje ao registrar uma conclusão, permitindo informar uma data anterior.
- Distinguir a data real de realização da data e autoria do registro no histórico.
- Usar a data real da primeira publicação para determinar o início da recorrência.
- Exemplo aprovado: publicação feita em 30 de setembro e registrada em 2 de outubro inicia a recorrência em outubro.

## Evidência do controle de acesso existente

- Inspeção de origin/main do backoffice: `components/account-access-sheet.tsx` abre Alterar acesso e edita a data de expiração, exibindo o histórico da conta.
- `lib/backoffice/user-field-updates.ts` persiste a mudança de expiração com auditoria; esse fluxo não seleciona plano nem concede créditos Starter.
- `app/(admin)/users/user-activation-actions.tsx` exige users:manage para alterar acesso. Apenas colocar um atalho para a interface atual não resolve uma permissão restrita ao benefício dos embaixadores.
- Editar apenas a expiração é insuficiente para entregar o benefício Starter com os créditos aprovados nesta entrevista.
- Inspeção de origin/main do frontend em `lib/credits/index.ts`: o ciclo de assinatura concede 250 créditos (25 imagens × 10 créditos), também usados no teste de sete dias. O controle de expiração do backoffice não executa essa concessão. A gratuidade inclui créditos conforme a decisão 11.

## Estado da entrevista

As decisões de produto discutidas estão confirmadas. O conteúdo do modal está
consolidado em [como-funciona.md](./como-funciona.md). Implementação local concluída em 2026-09-22; ver [entrega e validação](../entrega-captura-embaixadores.md). A publicação e a migração dos ambientes compartilhados são etapas separadas.

## Verificação necessária na implementação

- Preservar o trabalho local existente e trabalhar a partir de referências remotas atualizadas dos dois repositórios.
- Espelhar alterações de schema e coordenar migrations de frontend/backoffice sem aplicar mudanças em produção implicitamente.
- Validar as regras de dependência, datas reais, virada do mês, reabertura e preservação de histórico com testes de lógica.
- Validar permissões no servidor, inclusive liberação restrita de Starter e bloqueio quando houver assinatura paga ativa.
- Garantir uma concessão por ciclo de créditos, inclusive sob repetição de requisições, sem duplicar pagamento, receita ou conversão comercial.
- Conferir que o benefício concede os acessos Starter esperados e que vencimento, renovação e assinatura existente seguem as decisões aprovadas.
- Conferir o conteúdo do modal contra o comportamento real. Verificar a interface; não criar testes para alterações exclusivamente visuais nem executar build.
