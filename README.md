# LPSGHEB_LIVROS_-_TECH_Node_JS_Pratica

Projeto educacional de loja de livros de programação feito pelos alunos do SENAI-RS Santa Cruz Do Sul.

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
- `/finalizar`: formulário de finalização do pedido (simulação, sem cobrança)

## Compras e estoque

- Cada livro começa com 5 unidades em estoque, compartilhadas entre todos os clientes.
- "Comprar" e "Adicionar ao carrinho" aceitam mais de uma unidade por vez.
- O pedido só é gravado quando o formulário de finalização é enviado; só então o estoque baixa.
- Dados pessoais e de pagamento são fictícios. Do cartão guardamos só os 4 últimos dígitos.

## Tecnologias

Node.js, Express, EJS, Sequelize, SQLite e bcryptjs.

## Acessibilidade

O site foi feito para funcionar com leitores de tela como o NVDA: títulos em ordem, regiões da
página, campos com rótulo, avisos que recebem o foco e navegação completa pelo teclado.
