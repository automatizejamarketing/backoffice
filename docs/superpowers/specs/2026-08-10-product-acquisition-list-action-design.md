# Disponibilidade para aquisição na listagem de produtos

## Contexto

O Backoffice já permite editar o campo `salesEnabled` por meio do checkbox
“Disponível para aquisição” no formulário do produto. A listagem, porém, mostra
apenas o status editorial (`Rascunho`, `Publicado` ou `Arquivado`), então um
produto publicado com aquisição desabilitada não fica evidente sem abrir a
edição.

## Objetivo

Tornar indisponibilidade para aquisição visível na listagem e permitir que um
administrador habilite a aquisição diretamente pelo menu de ações do produto.

## Experiência aprovada

- Produtos com `salesEnabled: false` exibem a tag âmbar
  `Aquisição desabilitada` ao lado do status editorial atual.
- O menu de ações desses produtos exibe `Habilitar aquisição`.
- Produtos com aquisição habilitada não exibem a tag nem uma ação inversa no
  dropdown.
- A desativação continua disponível exclusivamente no formulário de edição,
  evitando uma ação destrutiva acidental na listagem.
- Durante a atualização, a ação fica desabilitada e mostra um indicador de
  carregamento para impedir envios duplicados.
- Em caso de sucesso, a listagem é recarregada e uma confirmação é exibida.
- Em caso de falha, o produto permanece inalterado e o erro retornado pela API é
  exibido.

## Implementação

A ação reutilizará o `PATCH /api/products/admin/[id]` existente, enviando o
payload completo do produto e alterando somente `salesEnabled` para `true`. A
montagem desse payload será centralizada em uma função pequena e pura, também
usada pelo fluxo de publicação, para evitar divergência entre as duas mutações.

Não haverá alteração de banco, schema ou contrato de API.

## Validação

- Teste focado na função que monta o payload, garantindo preservação dos campos
  do produto e alteração exclusiva de `salesEnabled` quando a ação for usada.
- Lint ou checagem estática focada nos arquivos alterados.
- Validação visual da tag, estado de carregamento e remoção da tag após sucesso.
- Não executar build, conforme a orientação do projeto.
