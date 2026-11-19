// server.js
// O servidor: recebe os pedidos do navegador, usa o banco e devolve páginas.

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const { Op } = require('sequelize');
const { Usuario, Livro, Compra, iniciarBanco } = require('./banco');

const app = express();
const PORTA = process.env.PORT || 3000;
const NIVEIS = ['Iniciante', 'Intermediário', 'Avançado'];

// ---------- Configuração ----------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Função disponível dentro de todos os arquivos .ejs: 8990 vira "R$ 89,90".
app.locals.dinheiro = (centavos) =>
  (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

app.use(express.static(path.join(__dirname, 'public'))); // css, js
app.use(express.urlencoded({ extended: false })); // lê formulários
app.use(express.json()); // lê JSON (para a API)
app.use(
  session({
    secret: process.env.SEGREDO || 'GabrielAtacadorDeNucas2026',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax' },
  })
);

// Roda em toda requisição: deixa dados prontos para todas as páginas.
app.use((req, res, next) => {
  res.locals.usuario = req.session.usuario || null;
  res.locals.mensagem = req.session.mensagem || null; // aviso de uma vez só
  res.locals.pagina = '';
  res.locals.busca = '';
  res.locals.nivel = '';
  delete req.session.mensagem;
  next();
});

// ---------- Funções de apoio ----------
// Programas (curl, Postman) pedem JSON; navegadores pedem HTML.
function querJson(req) {
  return req.accepts(['html', 'json']) === 'json';
}

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
  const pedidos = await Compra.findAll({
    where: { UsuarioId: req.session.usuario.id },
    include: Livro,
    order: [['id', 'DESC']],
  });
  const total = pedidos.reduce((soma, p) => soma + p.Livro.precoCentavos * p.quantidade, 0);

  res.render('index', { titulo: 'Loja de livros', pagina: 'inicio', livros, pedidos, total, busca, nivel });
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

  // Cria uma sessão nova ao entrar (mais seguro).
  await new Promise((ok, falha) => req.session.regenerate((e) => (e ? falha(e) : ok())));
  req.session.usuario = { id: usuario.id, nome: usuario.nome };

  if (querJson(req)) return res.json({ ok: true, usuario: req.session.usuario });
  avisar(req, 'sucesso', `Você entrou como ${usuario.nome}.`);
  res.redirect('/');
});

app.post('/api/comprar/:id', exigirLogin, async (req, res) => {
  const livro = await Livro.findByPk(Number(req.params.id));
  if (!livro) {
    if (querJson(req)) return res.status(404).json({ ok: false, erro: 'Livro não encontrado.' });
    avisar(req, 'erro', 'Esse livro não existe.');
    return res.redirect('/');
  }

  const compra = await Compra.create({ UsuarioId: req.session.usuario.id, LivroId: livro.id });

  if (querJson(req)) return res.status(201).json({ ok: true, compra: { id: compra.id, livro: livro.titulo } });
  avisar(req, 'sucesso', `Compra feita: ${livro.titulo}.`);
  res.redirect('/');
});

app.get('/api/livros', async (req, res) => {
  res.json(await Livro.findAll({ order: [['titulo', 'ASC']] }));
});

app.post('/sair', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// ---------- Erros ----------
app.use((req, res) => {
  res.status(404).render('erro', { titulo: 'Página não encontrada', texto: 'Não encontramos essa página.' });
});

app.use((erro, req, res, next) => {
  console.error(erro);
  res.status(500).render('erro', { titulo: 'Algo deu errado', texto: 'Tivemos um problema. Tente de novo.' });
});

// ---------- Liga o servidor ----------
iniciarBanco()
  .then(() => {
    app.listen(PORTA, () => console.log(`Loja no ar: http://localhost:${PORTA}`));
  })
  .catch((erro) => {
    console.error('Não foi possível iniciar o banco:', erro);
    process.exit(1);
  });