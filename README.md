# LPSGHED_LIVROS_-_TECH_Node_JS_Pratica

Projeto educacional de loja de livros de programação feito pelos alunos do SENAI-RS Santa Cruz Do Sul.

**LPSGHED Livros Tech**, desenvolvida por Arthur Santos Lopes, Gabriel Heineck Haberkamp e Eduardo Franceschetti Borges.

## Como rodar

1. Instale o Node.js (versão 20.17 ou mais nova) e o Git.
2. Baixe o projeto e entre na pasta dele.
3. Instale as dependências: `npm install`
4. Ligue o servidor: `npm start`
5. Abra no navegador: http://localhost:3000

## Páginas

- `/cadastro`: criar conta
- `/login`: entrar
- `/`: loja de livros e tabela "Seus pedidos" (precisa estar logado)
- `/carrinho`: carrinho de compras (salvo no banco, por usuário)
- `/finalizar`: formulário de finalização do pedido (leva ao pagamento de teste do Stripe)

## Compras e estoque

- Cada livro começa com 5 unidades em estoque, compartilhadas entre todos os clientes.
- "Comprar" e "Adicionar ao carrinho" aceitam mais de uma unidade por vez.
- Ao enviar o formulário de finalização, o pedido fica "pendente" e o estoque é reservado.
- O pagamento é feito na página do Stripe (modo de teste): a loja nunca vê nem guarda dados de cartão.
- Pagou: o pedido vira "pago" e aparece em "Seus pedidos". Cancelou, expirou ou falhou: o estoque volta.

## Configurar o pagamento (Stripe, modo teste)

1. Copie `.env.example` para `.env` e preencha `STRIPE_SECRET_KEY` (chave `sk_test_...` do painel do Stripe).
2. Para o Stripe avisar a loja dos pagamentos, rode `stripe listen --forward-to localhost:3000/api/webhook`
   e cole o `whsec_...` que ele mostrar em `STRIPE_WEBHOOK_SECRET`.
3. Cartão de teste: `4242 4242 4242 4242`, qualquer validade futura e qualquer código de segurança.

## Tecnologias

Node.js, Express, EJS, Sequelize, SQLite e bcryptjs.

## Acessibilidade

O site foi feito para funcionar com leitores de tela como o NVDA: títulos em ordem, regiões da
página, campos com rótulo, avisos que recebem o foco e navegação completa pelo teclado.
