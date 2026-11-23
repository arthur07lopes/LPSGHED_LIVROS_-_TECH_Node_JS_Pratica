// server.js
// O servidor: recebe os pedidos do navegador, usa o banco e devolve páginas.

require('dotenv').config({ quiet: true }); // lê o arquivo .env (chaves do Stripe)

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const Stripe = require('stripe');
const { Op } = require('sequelize');
const { sequelize, Usuario, Livro, ItemCarrinho, Pedido, ItemPedido, iniciarBanco } = require('./banco');
const v = require('./validacao');

const app = express();

// Porta do servidor. Em hospedagens, a porta vem da variável de ambiente PORT;
// no seu computador, como ela não existe, usamos 3000.
const PORTA = process.env.PORT || 3000;

// Endereço do site: o Stripe usa para voltar para a loja depois do pagamento.
const URL_BASE = process.env.URL_BASE || `http://localhost:${PORTA}`;

// Cliente do Stripe. Com a chave de TESTE (sk_test_...) nenhum dinheiro de verdade é cobrado.
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
if (!stripe) {
  console.warn('Atenção: STRIPE_SECRET_KEY não definida no .env. Os pagamentos não vão funcionar.');
}

// Níveis aceitos no filtro da página inicial.
const NIVEIS = ['Iniciante', 'Intermediário', 'Avançado'];

// Limites de quantidade por livro em um mesmo pedido.
const QUANTIDADE_MINIMA = 1;
const QUANTIDADE_MAXIMA = 999;

// ---------- Configuração ----------
app.set('view engine', 'ejs'); // as páginas são arquivos .ejs (HTML com pedaços de JavaScript)
app.set('views', path.join(__dirname, 'views')); // e ficam na pasta "views"

// Função disponível dentro de todos os arquivos .ejs: 8990 vira "R$ 89,90".
app.locals.dinheiro = (centavos) =>
  (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// "Middlewares" são funções que rodam em toda requisição, na ordem em que aparecem aqui.
// Cada uma faz o seu trabalho e chama next() para passar a vez à seguinte.
app.use(express.static(path.join(__dirname, 'public'))); // entrega css e js direto da pasta "public"

// Webhook do Stripe: é o Stripe avisando, de servidor para servidor, que um pagamento mudou.
// IMPORTANTE: fica ANTES do express.json(). O Stripe assina o corpo "cru" da requisição;
// se o corpo for convertido antes, a assinatura deixa de bater.
app.post('/api/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(503).send('Webhook não configurado.');
  }

  let evento;
  try {
    evento = stripe.webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (erro) {
    console.error('Webhook com assinatura inválida:', erro.message);
    return res.status(400).send('Assinatura inválida.');
  }

  const sessao = evento.data.object;
  const pedidoId = sessao.metadata && sessao.metadata.pedidoId;

  if (pedidoId) {
    switch (evento.type) {
      case 'checkout.session.completed':
        // Cartão: já vem "paid". Boleto/Pix: vem "unpaid" e espera o evento abaixo.
        if (sessao.payment_status === 'paid') await confirmarPagamento(pedidoId, sessao.id);
        break;
      case 'checkout.session.async_payment_succeeded':
        await confirmarPagamento(pedidoId, sessao.id);
        break;
      case 'checkout.session.async_payment_failed':
        await encerrarPedido(pedidoId, sessao.id, 'falhou');
        break;
      case 'checkout.session.expired':
        await encerrarPedido(pedidoId, sessao.id, 'cancelado');
        break;
    }
  }

  res.json({ recebido: true });
});

app.use(express.urlencoded({ extended: false })); // lê os dados de formulários HTML
app.use(express.json()); // lê dados em JSON (para programas como curl e Postman)

// A sessão guarda quem está logado. O navegador recebe só um cookie com um código,
// e os dados de verdade ficam no servidor.
app.use(
  session({
    // Chave usada para assinar o cookie (impede que alguém forje um). Em produção,
    // defina a variável de ambiente SEGREDO com um valor longo e só seu.
    secret: process.env.SEGREDO || 'GabrielAtacadorDeNucas2026',
    resave: false, // não regrava a sessão se nada mudou nela
    saveUninitialized: false, // não cria sessão (nem cookie) para visitantes que não logaram
    cookie: {
      httpOnly: true, // o JavaScript da página não consegue ler o cookie (protege contra roubo por XSS)
      // "lax": o navegador só envia o cookie em requisições do nosso próprio site, ou quando
      // o usuário clica em um link vindo de fora. Impede que outro site envie formulários
      // em nome do usuário logado (ataque CSRF) sem atrapalhar quem chega por um link.
      sameSite: 'lax',
    },
  })
);

// Deixa dados prontos para todas as páginas. Tudo que vai em res.locals
// fica disponível dentro dos arquivos .ejs.
app.use((req, res, next) => {
  res.locals.usuario = req.session.usuario || null;

  // Aviso "de uma vez só" (mensagem flash): guardado na sessão por uma requisição
  // (por exemplo, antes de um redirect), mostrado na página seguinte e logo apagado.
  res.locals.mensagem = req.session.mensagem || null;
  delete req.session.mensagem;

  // Valores padrão, para os .ejs não darem erro quando a rota não define algum deles.
  res.locals.pagina = '';
  res.locals.busca = '';
  res.locals.nivel = '';
  res.locals.itensCarrinho = 0;
  next();
});

// Quantos livros há no carrinho de quem está logado (aparece no topo de todas as páginas).
app.use(async (req, res, next) => {
  if (req.session.usuario) {
    const soma = await ItemCarrinho.sum('quantidade', { where: { UsuarioId: req.session.usuario.id } });
    res.locals.itensCarrinho = soma || 0;
  }
  next();
});

// ---------- Funções de apoio ----------
// Programas (curl, Postman) pedem JSON; navegadores pedem HTML.
// O cabeçalho "Accept" da requisição diz o que o cliente prefere receber.
// req.accepts(['html', 'json']) devolve a opção preferida entre as duas;
// se o cliente aceita as duas igualmente, "html" ganha por vir primeiro na lista.
function querJson(req) {
  return req.accepts(['html', 'json']) === 'json';
}

// Guarda um aviso na sessão para aparecer na próxima página (veja "mensagem flash" acima).
// tipo: 'sucesso' ou 'erro'.
function avisar(req, tipo, texto) {
  req.session.mensagem = { tipo, texto };
}

// Barreira: só deixa passar quem já entrou.
function exigirLogin(req, res, next) {
  if (req.session.usuario) return next();
  if (querJson(req)) return res.status(401).json({ ok: false, erro: 'Faça login.' });
  avisar(req, 'erro', 'Entre na sua conta para ver a loja.');
  res.redirect('/login');
}

// Escreve "1 unidade" ou "3 unidades", com o plural certo.
const unidades = (n) => `${n} ${n === 1 ? 'unidade' : 'unidades'}`;

// Lê uma quantidade vinda do formulário. Campo vazio vale 1; valor inválido vira null.
function lerQuantidade(valor) {
  const campoVazio = valor === undefined || String(valor).trim() === '';
  if (campoVazio) return 1;

  const n = Number(valor); // "abc" vira NaN; "2.5" vira 2.5
  const ehInteiro = Number.isInteger(n);
  const dentroDoLimite = n >= QUANTIDADE_MINIMA && n <= QUANTIDADE_MAXIMA;
  return ehInteiro && dentroDoLimite ? n : null;
}

// Volta para a página de onde veio o pedido (sem sair do nosso site).
// O navegador informa a página anterior no cabeçalho "Referer" (sim, com esse erro de grafia
// histórico). Só usamos o endereço se ele for do nosso próprio site (mesmo "host"),
// para nunca redirecionar o usuário para outro site.
function paginaAnterior(req) {
  try {
    const url = new URL(req.get('referer')); // dá erro se o cabeçalho não existir
    if (url.host === req.get('host')) return url.pathname + url.search;
  } catch (e) {
    // sem "referer" (ou endereço inválido): cai no retorno abaixo
  }
  return '/'; // página inicial
}

// Responde a um erro: JSON para programas, aviso com foco para o navegador.
function falhar(req, res, status, texto, destino) {
  if (querJson(req)) return res.status(status).json({ ok: false, erro: texto });
  avisar(req, 'erro', texto);
  return res.redirect(destino || paginaAnterior(req));
}

// Texto explicando por que a quantidade não cabe no estoque (ou null se couber).
function erroDeEstoque(livro, quantidade) {
  if (livro.estoque === 0) return `O livro ${livro.titulo} está esgotado.`;
  if (quantidade > livro.estoque) {
    return `Temos apenas ${unidades(livro.estoque)} de ${livro.titulo} em estoque.`;
  }
  return null;
}

// Explica por que não dá para colocar mais unidades no carrinho, considerando
// quantas o usuário já tem lá (jaTem). Só é chamada quando a soma passa do estoque.
function textoEstoqueNoCarrinho(livro, jaTem) {
  const resto = livro.estoque - jaTem; // quantas ainda cabem

  if (resto <= 0) {
    return `Você já tem no carrinho todas as ${unidades(livro.estoque)} de ${livro.titulo} que temos em estoque.`;
  }
  if (jaTem === 0) {
    return `Temos apenas ${unidades(livro.estoque)} de ${livro.titulo} em estoque.`;
  }
  return `Temos apenas ${unidades(livro.estoque)} de ${livro.titulo} em estoque e você já tem ${jaTem} no carrinho. Você pode adicionar mais ${resto}.`;
}

// Barreira: só deixa passar se o Stripe estiver configurado.
function exigirStripe(req, res, next) {
  if (stripe) return next();
  return falhar(req, res, 503, 'O pagamento não está configurado ainda.', '/');
}

// Pedido pago: muda o status e tira do carrinho os livros que foram comprados.
// O "where status pendente" torna a função segura para ser chamada mais de uma vez
// (o Stripe repete eventos, e a página de sucesso também confirma): só a primeira vale.
async function confirmarPagamento(pedidoId, sessaoId) {
  await sequelize.transaction(async (t) => {
    const [alterados] = await Pedido.update(
      { status: 'pago' },
      { where: { id: Number(pedidoId), stripeSessionId: sessaoId, status: 'pendente' }, transaction: t }
    );
    if (alterados === 0) return;

    const pedido = await Pedido.findByPk(Number(pedidoId), { include: ItemPedido, transaction: t });
    await ItemCarrinho.destroy({
      where: { UsuarioId: pedido.UsuarioId, LivroId: pedido.ItemPedidos.map((i) => i.LivroId) },
      transaction: t,
    });
  });
}

// Pedido que não vai mais ser pago (cancelado, expirou ou falhou): marca o status e
// devolve ao estoque os livros que estavam reservados. Também só age sobre pedido "pendente".
async function encerrarPedido(pedidoId, sessaoId, status) {
  await sequelize.transaction(async (t) => {
    // sessaoId vazio = o pedido nem chegou a ter sessão no Stripe (ex.: erro ao criá-la).
    const onde = { id: Number(pedidoId), status: 'pendente' };
    if (sessaoId) onde.stripeSessionId = sessaoId;
    const [alterados] = await Pedido.update({ status }, { where: onde, transaction: t });
    if (alterados === 0) return;

    const itens = await ItemPedido.findAll({ where: { PedidoId: Number(pedidoId) }, transaction: t });
    for (const item of itens) {
      await Livro.update(
        { estoque: sequelize.literal(`estoque + ${Number(item.quantidade)}`) },
        { where: { id: item.LivroId }, transaction: t }
      );
    }
  });
}

// ---------- Páginas ----------
app.get('/', exigirLogin, async (req, res) => {
  const busca = (req.query.busca || '').trim();
  const nivel = NIVEIS.includes(req.query.nivel) ? req.query.nivel : '';

  const filtro = {};
  if (nivel) filtro.nivel = nivel;
  if (busca) {
    filtro[Op.or] = [
      { titulo: { [Op.like]: `%${busca}%` } },
      { autor: { [Op.like]: `%${busca}%` } },
    ];
  }

  const livros = await Livro.findAll({ where: filtro, order: [['titulo', 'ASC']] });
  const pedidos = await Pedido.findAll({
    where: { UsuarioId: req.session.usuario.id, status: 'pago' }, // só pedidos já pagos
    include: { model: ItemPedido, include: Livro },
    order: [['id', 'DESC']],
  });

  // Soma o valor de todos os pedidos (reduce vai acumulando o resultado em "soma").
  const total = pedidos.reduce((soma, p) => soma + p.totalCentavos, 0);

  // Conta quantos livros foram comprados no total: cada pedido tem vários itens,
  // então primeiro juntamos todos os itens numa lista só e depois somamos as quantidades.
  const todosOsItens = pedidos.flatMap((p) => p.ItemPedidos);
  const totalLivros = todosOsItens.reduce((soma, item) => soma + item.quantidade, 0);

  res.render('index', { titulo: 'Loja de livros', pagina: 'inicio', livros, pedidos, total, totalLivros, busca, nivel });
});

app.get('/cadastro', (req, res) => {
  if (req.session.usuario) return res.redirect('/');
  res.render('cadastro', { titulo: 'Criar conta', pagina: 'cadastro', erros: [], valores: {} });
});

app.get('/login', (req, res) => {
  if (req.session.usuario) return res.redirect('/');
  res.render('login', { titulo: 'Entrar', pagina: 'login', erros: [], valores: {} });
});

// ---------- API (recebe dados e salva no banco) ----------
app.post('/api/cadastro', async (req, res) => {
  const nome = (req.body.nome || '').trim();
  const email = (req.body.email || '').trim().toLowerCase();
  const senha = req.body.senha || '';
  const confirmacao = req.body.confirmacao || '';

  const erros = [];
  if (nome.length < 3) {
    erros.push({ campo: 'nome', texto: 'Digite seu nome com pelo menos 3 letras.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    erros.push({ campo: 'email', texto: 'Digite um e-mail válido, como nome@exemplo.com.' });
  } else if (await Usuario.findOne({ where: { email } })) {
    erros.push({ campo: 'email', texto: 'Este e-mail já tem cadastro. Tente entrar.' });
  }
  if (senha.length < 8) {
    erros.push({ campo: 'senha', texto: 'Crie uma senha com pelo menos 8 caracteres.' });
  }
  if (confirmacao !== senha) {
    erros.push({ campo: 'confirmacao', texto: 'A confirmação precisa ser igual à senha.' });
  }

  if (erros.length > 0) {
    if (querJson(req)) return res.status(400).json({ ok: false, erros });
    return res
      .status(400)
      .render('cadastro', { titulo: 'Criar conta', pagina: 'cadastro', erros, valores: { nome, email } });
  }

  const senhaHash = await bcrypt.hash(senha, 10);
  const novo = await Usuario.create({ nome, email, senhaHash });

  if (querJson(req)) {
    return res.status(201).json({ ok: true, usuario: { id: novo.id, nome: novo.nome, email: novo.email } });
  }
  avisar(req, 'sucesso', 'Conta criada com sucesso! Agora entre com seu e-mail e sua senha.');
  res.redirect('/login');
});

app.post('/api/login', async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const senha = req.body.senha || '';

  const usuario = await Usuario.findOne({ where: { email } });
  const senhaCerta = usuario ? await bcrypt.compare(senha, usuario.senhaHash) : false;

  if (!senhaCerta) {
    const erros = [{ campo: 'email', texto: 'E-mail ou senha incorretos. Confira e tente de novo.' }];
    if (querJson(req)) return res.status(401).json({ ok: false, erros });
    return res.status(401).render('login', { titulo: 'Entrar', pagina: 'login', erros, valores: { email } });
  }

  // Cria uma sessão nova ao entrar (mais seguro: impede que um código de sessão
  // obtido antes do login passe a valer para a conta logada).
  // regenerate() usa o estilo antigo de "callback"; este Promise o transforma
  // em algo que podemos esperar com await.
  await new Promise((resolver, rejeitar) => {
    req.session.regenerate((erro) => (erro ? rejeitar(erro) : resolver()));
  });
  req.session.usuario = { id: usuario.id, nome: usuario.nome };

  if (querJson(req)) return res.json({ ok: true, usuario: req.session.usuario });
  avisar(req, 'sucesso', `Você entrou como ${usuario.nome}.`);
  res.redirect('/');
});

// "Comprar" não cria o pedido: leva o usuário ao formulário de finalização.
// O pedido só é gravado quando esse formulário for enviado.
app.post('/api/comprar/:id', exigirLogin, async (req, res) => {
  const livro = await Livro.findByPk(Number(req.params.id));
  if (!livro) return falhar(req, res, 404, 'Esse livro não existe.', '/');

  const quantidade = lerQuantidade(req.body.quantidade);
  if (!quantidade) return falhar(req, res, 400, 'Digite uma quantidade inteira, de 1 em diante.');
  const problema = erroDeEstoque(livro, quantidade);
  if (problema) return falhar(req, res, 409, problema);

  const destino = `/finalizar?livro=${livro.id}&quantidade=${quantidade}`;
  if (querJson(req)) return res.json({ ok: true, finalizar: destino });
  res.redirect(destino);
});

// ---------- Carrinho ----------
app.get('/carrinho', exigirLogin, async (req, res) => {
  const itens = await ItemCarrinho.findAll({
    where: { UsuarioId: req.session.usuario.id },
    include: Livro,
    order: [[Livro, 'titulo', 'ASC']],
  });
  const total = itens.reduce((soma, i) => soma + i.Livro.precoCentavos * i.quantidade, 0);
  res.render('carrinho', { titulo: 'Seu carrinho', pagina: 'carrinho', itens, total });
});

app.post('/api/carrinho/adicionar/:id', exigirLogin, async (req, res) => {
  const usuarioId = req.session.usuario.id;
  const livro = await Livro.findByPk(Number(req.params.id));
  if (!livro) return falhar(req, res, 404, 'Esse livro não existe.', '/');

  const quantidade = lerQuantidade(req.body.quantidade);
  if (!quantidade) return falhar(req, res, 400, 'Digite uma quantidade inteira, de 1 em diante.');

  const item = await ItemCarrinho.findOne({ where: { UsuarioId: usuarioId, LivroId: livro.id } });
  const jaTem = item ? item.quantidade : 0;
  const novaQuantidade = jaTem + quantidade;

  if (livro.estoque === 0) return falhar(req, res, 409, `O livro ${livro.titulo} está esgotado.`);
  if (novaQuantidade > livro.estoque) {
    return falhar(req, res, 409, textoEstoqueNoCarrinho(livro, jaTem));
  }

  // Se o livro já está no carrinho, só aumenta a quantidade; senão, cria a linha.
  if (item) await item.update({ quantidade: novaQuantidade });
  else await ItemCarrinho.create({ UsuarioId: usuarioId, LivroId: livro.id, quantidade });

  const itensCarrinho = (await ItemCarrinho.sum('quantidade', { where: { UsuarioId: usuarioId } })) || 0;
  if (querJson(req)) {
    return res.status(201).json({ ok: true, livro: livro.titulo, quantidadeDoLivro: novaQuantidade, itensCarrinho });
  }
  avisar(req, 'sucesso', `${livro.titulo} foi adicionado ao carrinho. Quantidade deste livro: ${novaQuantidade}.`);
  res.redirect('/carrinho');
});

app.post('/api/carrinho/atualizar/:id', exigirLogin, async (req, res) => {
  const item = await ItemCarrinho.findOne({
    where: { UsuarioId: req.session.usuario.id, LivroId: Number(req.params.id) },
    include: Livro,
  });
  if (!item) return falhar(req, res, 404, 'Esse livro não está no seu carrinho.', '/carrinho');

  const quantidade = lerQuantidade(req.body.quantidade);
  if (!quantidade) return falhar(req, res, 400, 'Digite uma quantidade inteira, de 1 em diante.', '/carrinho');
  const problema = erroDeEstoque(item.Livro, quantidade);
  if (problema) return falhar(req, res, 409, problema, '/carrinho');

  await item.update({ quantidade });
  if (querJson(req)) return res.json({ ok: true, quantidade });
  avisar(req, 'sucesso', `Quantidade de ${item.Livro.titulo} alterada para ${quantidade}.`);
  res.redirect('/carrinho');
});

app.post('/api/carrinho/remover/:id', exigirLogin, async (req, res) => {
  const item = await ItemCarrinho.findOne({
    where: { UsuarioId: req.session.usuario.id, LivroId: Number(req.params.id) },
    include: Livro,
  });
  if (!item) return falhar(req, res, 404, 'Esse livro não está no seu carrinho.', '/carrinho');

  await item.destroy();
  if (querJson(req)) return res.json({ ok: true });
  avisar(req, 'sucesso', `${item.Livro.titulo} foi removido do carrinho.`);
  res.redirect('/carrinho');
});

// ---------- Finalização do pedido ----------
// Descobre o que está sendo comprado: um livro só (botão "Comprar": vem livro e quantidade)
// ou o carrinho inteiro. Confere o estoque. Devolve { erro, voltar } ou { itens, direta }.
async function itensDoPedido(usuarioId, fonte) {
  if (fonte.livro) {
    const livro = await Livro.findByPk(Number(fonte.livro));
    if (!livro) return { erro: 'Esse livro não existe.', voltar: '/' };
    const quantidade = lerQuantidade(fonte.quantidade);
    if (!quantidade) return { erro: 'Digite uma quantidade inteira, de 1 em diante.', voltar: '/' };
    const problema = erroDeEstoque(livro, quantidade);
    if (problema) return { erro: problema, voltar: '/' };
    return { direta: true, itens: [{ livro, quantidade }] };
  }

  const registros = await ItemCarrinho.findAll({
    where: { UsuarioId: usuarioId },
    include: Livro,
    order: [[Livro, 'titulo', 'ASC']],
  });
  if (registros.length === 0) return { erro: 'Seu carrinho está vazio.', voltar: '/carrinho' };
  for (const r of registros) {
    const problema = erroDeEstoque(r.Livro, r.quantidade);
    if (problema) return { erro: `${problema} Ajuste o carrinho antes de finalizar.`, voltar: '/carrinho' };
  }
  return { direta: false, itens: registros.map((r) => ({ livro: r.Livro, quantidade: r.quantidade })) };
}

// Soma preço x quantidade de cada item. Tudo em centavos, para evitar erros de arredondamento.
const totalDosItens = (itens) => itens.reduce((soma, i) => soma + i.livro.precoCentavos * i.quantidade, 0);

function telaFinalizar(res, status, pedido, erros, valores) {
  res.status(status).render('finalizar', {
    titulo: 'Finalizar pedido',
    pagina: 'finalizar',
    itens: pedido.itens,
    direta: pedido.direta,
    total: totalDosItens(pedido.itens),
    ufs: v.UFS,
    erros,
    valores,
  });
}

// Confere os campos do formulário de finalização, um por um.
// Devolve { erros, nascimento }: a lista de problemas (cada um diz qual campo e o texto
// do aviso) e a data de nascimento já convertida para AAAA-MM-DD.
function conferirFormulario(valores) {
  const erros = [];
  const adicionarErro = (campo, texto) => erros.push({ campo, texto });

  if (valores.nomeCompleto.length < 3) adicionarErro('nomeCompleto', 'Digite seu nome completo, com pelo menos 3 letras.');
  if (!v.cpfValido(valores.cpf)) adicionarErro('cpf', 'Digite um CPF válido, com 11 números. Exemplo: 529.982.247-25.');

  const nascimento = v.lerDataNascimento(valores.nascimento);
  if (!nascimento) adicionarErro('nascimento', 'Digite uma data de nascimento válida, no formato dia/mês/ano. Exemplo: 25/12/1990.');

  if (!v.telefoneValido(valores.telefone)) adicionarErro('telefone', 'Digite um telefone com DDD, de 10 ou 11 números. Exemplo: (55) 99999-8888.');
  if (!v.cepValido(valores.cep)) adicionarErro('cep', 'Digite um CEP com 8 números. Exemplo: 96810-000.');
  if (valores.logradouro.length < 3) adicionarErro('logradouro', 'Digite o nome da rua ou avenida.');
  if (!valores.numero) adicionarErro('numero', 'Digite o número do endereço, ou S/N se não houver.');
  if (valores.bairro.length < 2) adicionarErro('bairro', 'Digite o bairro.');
  if (valores.cidade.length < 2) adicionarErro('cidade', 'Digite a cidade.');
  if (!v.UFS.includes(valores.uf)) adicionarErro('uf', 'Escolha o estado na lista.');
  // Os dados de pagamento (cartão, Pix, boleto) são pedidos pelo Stripe, na página dele.

  return { erros, nascimento };
}

// Erro criado por nós para o caso "o estoque acabou durante a compra".
// Ter uma classe própria deixa o catch mais claro do que comparar textos de mensagem.
class SemEstoqueError extends Error {
  constructor(titulo) {
    super(`Sem estoque: ${titulo}`);
    this.titulo = titulo;
  }
}

app.get('/finalizar', exigirLogin, exigirStripe, async (req, res) => {
  const pedido = await itensDoPedido(req.session.usuario.id, req.query);
  if (pedido.erro) {
    avisar(req, 'erro', pedido.erro);
    return res.redirect(pedido.voltar);
  }
  telaFinalizar(res, 200, pedido, [], {
    nomeCompleto: req.session.usuario.nome,
    livro: req.query.livro,
    quantidade: req.query.quantidade,
  });
});

app.post('/api/finalizar', exigirLogin, exigirStripe, async (req, res) => {
  const usuarioId = req.session.usuario.id;
  const pedido = await itensDoPedido(usuarioId, req.body);
  if (pedido.erro) return falhar(req, res, 409, pedido.erro, pedido.voltar);

  // Lê um campo do formulário como texto, sem espaços nas pontas ("" se não veio nada).
  const texto = (campo) => String(req.body[campo] || '').trim();
  const valores = {
    livro: pedido.direta ? req.body.livro : '',
    quantidade: pedido.direta ? req.body.quantidade : '',
    nomeCompleto: texto('nomeCompleto'),
    cpf: texto('cpf'),
    nascimento: texto('nascimento'),
    telefone: texto('telefone'),
    cep: texto('cep'),
    logradouro: texto('logradouro'),
    numero: texto('numero'),
    complemento: texto('complemento'),
    bairro: texto('bairro'),
    cidade: texto('cidade'),
    uf: texto('uf'),
  };

  // Confere cada campo; "erros" fica vazio quando está tudo certo.
  // "nascimento" já vem no formato AAAA-MM-DD (ou null se a data for inválida).
  const { erros, nascimento } = conferirFormulario(valores);

  if (erros.length > 0) {
    if (querJson(req)) return res.status(400).json({ ok: false, erros });
    return telaFinalizar(res, 400, pedido, erros, valores);
  }

  // Tudo ou nada: reserva o estoque e grava o pedido (pendente) na mesma transação.
  // Se o cliente não pagar, o estoque volta (veja encerrarPedido).
  // Se qualquer passo der erro, a transação desfaz tudo o que já tinha sido feito nela.
  let criado;
  try {
    criado = await sequelize.transaction(async (t) => {
      for (const { livro, quantidade } of pedido.itens) {
        // Em SQL, isto vira: UPDATE Livros SET estoque = estoque - 2 WHERE id = 7 AND estoque >= 2
        // A conta é feita pelo próprio banco (sequelize.literal) e só vale se ainda houver
        // estoque suficiente, mesmo que outro cliente tenha comprado agora há pouco.
        // Number() garante que só um número entra no texto SQL.
        const [alterados] = await Livro.update(
          { estoque: sequelize.literal(`estoque - ${Number(quantidade)}`) },
          { where: { id: livro.id, estoque: { [Op.gte]: quantidade } }, transaction: t }
        );
        // Nenhuma linha alterada = a condição "estoque >= quantidade" falhou.
        if (alterados === 0) throw new SemEstoqueError(livro.titulo);
      }

      const novo = await Pedido.create(
        {
          UsuarioId: usuarioId,
          totalCentavos: totalDosItens(pedido.itens),
          nomeCompleto: valores.nomeCompleto,
          cpf: v.somenteDigitos(valores.cpf),
          dataNascimento: nascimento,
          telefone: v.somenteDigitos(valores.telefone),
          cep: v.somenteDigitos(valores.cep),
          logradouro: valores.logradouro,
          numero: valores.numero,
          complemento: valores.complemento,
          bairro: valores.bairro,
          cidade: valores.cidade,
          uf: valores.uf,
          formaPagamento: 'Stripe Checkout',
          status: 'pendente',
        },
        { transaction: t }
      );
      await ItemPedido.bulkCreate(
        pedido.itens.map(({ livro, quantidade }) => ({
          PedidoId: novo.id,
          LivroId: livro.id,
          quantidade,
          precoCentavos: livro.precoCentavos,
        })),
        { transaction: t }
      );
      // O carrinho só é esvaziado quando o pagamento for confirmado (veja confirmarPagamento).
      return novo;
    });
  } catch (e) {
    if (e instanceof SemEstoqueError) {
      return falhar(
        req,
        res,
        409,
        `Outro cliente acabou de comprar o livro ${e.titulo} e não temos mais estoque suficiente. Seu pedido não foi feito.`,
        pedido.direta ? '/' : '/carrinho'
      );
    }
    throw e; // outro tipo de erro: deixa o tratador de erros lá embaixo responder
  }

  // Cria a sessão de pagamento no Stripe. Preço e título vêm do nosso banco, nunca do formulário.
  try {
    const sessao = await stripe.checkout.sessions.create({
      mode: 'payment',
      locale: 'pt-BR',
      line_items: pedido.itens.map(({ livro, quantidade }) => ({
        quantity: quantidade,
        price_data: {
          currency: 'brl',
          unit_amount: livro.precoCentavos, // já está em centavos, como o Stripe pede
          product_data: { name: livro.titulo, description: livro.autor },
        },
      })),
      metadata: { pedidoId: String(criado.id) }, // volta no webhook: sabemos qual pedido é
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60, // 30 minutos para pagar (o mínimo do Stripe)
      success_url: `${URL_BASE}/pagamento/sucesso?pedido=${criado.id}`,
      cancel_url: `${URL_BASE}/pagamento/cancelado?pedido=${criado.id}`,
    });

    await criado.update({ stripeSessionId: sessao.id });

    if (querJson(req)) {
      return res.status(201).json({
        ok: true,
        pedido: { id: criado.id, total: criado.totalCentavos },
        urlPagamento: sessao.url,
      });
    }
    return res.redirect(303, sessao.url); // leva o cliente para a página de pagamento do Stripe
  } catch (erro) {
    console.error('Erro ao criar o pagamento:', erro);
    await encerrarPedido(criado.id, null, 'falhou'); // devolve o estoque reservado
    return falhar(req, res, 502, 'Não foi possível iniciar o pagamento. Tente de novo.', pedido.direta ? '/' : '/carrinho');
  }
});

// O Stripe devolve o cliente para cá depois do pagamento.
// Não confiamos só no endereço: perguntamos ao Stripe se o pagamento realmente aconteceu.
// (Isto também cobre o caso do webhook não ter chegado, como no computador de desenvolvimento.)
app.get('/pagamento/sucesso', exigirLogin, exigirStripe, async (req, res) => {
  const pedido = await Pedido.findOne({
    where: { id: Number(req.query.pedido) || 0, UsuarioId: req.session.usuario.id },
  });
  if (!pedido || !pedido.stripeSessionId) {
    avisar(req, 'erro', 'Não encontramos esse pedido.');
    return res.redirect('/');
  }

  const sessao = await stripe.checkout.sessions.retrieve(pedido.stripeSessionId);
  if (sessao.payment_status === 'paid') {
    await confirmarPagamento(pedido.id, sessao.id);
    avisar(req, 'sucesso', `Pagamento confirmado! Pedido número ${pedido.id} realizado. Veja na tabela Seus pedidos.`);
  } else {
    avisar(req, 'sucesso', `Recebemos o pedido número ${pedido.id}. Assim que o pagamento for confirmado, ele aparece em Seus pedidos.`);
  }
  res.redirect('/');
});

app.get('/pagamento/cancelado', exigirLogin, exigirStripe, async (req, res) => {
  const pedido = await Pedido.findOne({
    where: { id: Number(req.query.pedido) || 0, UsuarioId: req.session.usuario.id, status: 'pendente' },
  });
  if (pedido && pedido.stripeSessionId) {
    // Fecha a sessão no Stripe: sem isso, o cliente poderia voltar pelo botão "Voltar"
    // do navegador e pagar um pedido que já devolvemos ao estoque.
    try {
      await stripe.checkout.sessions.expire(pedido.stripeSessionId);
      await encerrarPedido(pedido.id, pedido.stripeSessionId, 'cancelado');
    } catch (erro) {
      console.error('Não foi possível encerrar a sessão do Stripe:', erro.message); // ex.: já foi paga
    }
  }
  avisar(req, 'erro', 'Pagamento cancelado. Nenhuma cobrança foi feita.');
  res.redirect('/');
});

app.get('/api/livros', async (req, res) => {
  res.json(await Livro.findAll({ order: [['titulo', 'ASC']] }));
});

app.post('/sair', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// ---------- Erros ----------
// Estas duas funções ficam por último de propósito: só são chamadas
// se nenhuma rota acima respondeu.

// Sem rota correspondente: página não encontrada.
app.use((req, res) => {
  res.status(404).render('erro', { titulo: 'Página não encontrada', texto: 'Não encontramos essa página.' });
});

// Erro inesperado. O Express reconhece um tratador de erros pelos 4 parâmetros
// (erro, req, res, next): mesmo sem usar o "next", ele precisa estar na lista.
app.use((erro, req, res, next) => {
  console.error(erro);
  res.status(500).render('erro', { titulo: 'Algo deu errado', texto: 'Tivemos um problema. Tente de novo.' });
});

// ---------- Liga o servidor ----------
// Primeiro prepara o banco; só depois começa a receber pedidos.
iniciarBanco()
  .then(() => {
    app.listen(PORTA, () => console.log(`Loja no ar: http://localhost:${PORTA}`));
  })
  .catch((erro) => {
    console.error('Não foi possível iniciar o banco:', erro);
    process.exit(1);
  });