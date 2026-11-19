// server.js
// O servidor: recebe os pedidos do navegador, usa o banco e devolve páginas.

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const { Op } = require('sequelize');
const { sequelize, Usuario, Livro, ItemCarrinho, Pedido, ItemPedido, iniciarBanco } = require('./banco');
const v = require('./validacao');

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
  res.locals.itensCarrinho = 0;
  delete req.session.mensagem;
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

const unidades = (n) => `${n} ${n === 1 ? 'unidade' : 'unidades'}`;

// Lê uma quantidade vinda do formulário. Vazio vale 1; inválido vira null.
function lerQuantidade(valor) {
  if (valor === undefined || String(valor).trim() === '') return 1;
  const n = Number(valor);
  return Number.isInteger(n) && n >= 1 && n <= 999 ? n : null;
}

// Volta para a página de onde veio o pedido (sem sair do nosso site).
function paginaAnterior(req) {
  try {
    const url = new URL(req.get('referer'));
    if (url.host === req.get('host')) return url.pathname + url.search;
  } catch (e) {
    // sem "referer": usa a página inicial
  }
  return '/';
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
    where: { UsuarioId: req.session.usuario.id },
    include: { model: ItemPedido, include: Livro },
    order: [['id', 'DESC']],
  });
  const total = pedidos.reduce((soma, p) => soma + p.totalCentavos, 0);
  const totalLivros = pedidos.reduce(
    (soma, p) => soma + p.ItemPedidos.reduce((parcial, i) => parcial + i.quantidade, 0),
    0
  );

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

  // Cria uma sessão nova ao entrar (mais seguro).
  await new Promise((ok, falha) => req.session.regenerate((e) => (e ? falha(e) : ok())));
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
    const resto = livro.estoque - jaTem;
    const texto =
      resto <= 0
        ? `Você já tem no carrinho todas as ${unidades(livro.estoque)} de ${livro.titulo} que temos em estoque.`
        : jaTem === 0
          ? `Temos apenas ${unidades(livro.estoque)} de ${livro.titulo} em estoque.`
          : `Temos apenas ${unidades(livro.estoque)} de ${livro.titulo} em estoque e você já tem ${jaTem} no carrinho. Você pode adicionar mais ${resto}.`;
    return falhar(req, res, 409, texto);
  }

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

const totalDosItens = (itens) => itens.reduce((soma, i) => soma + i.livro.precoCentavos * i.quantidade, 0);

function telaFinalizar(res, status, pedido, erros, valores) {
  res.status(status).render('finalizar', {
    titulo: 'Finalizar pedido',
    pagina: 'finalizar',
    itens: pedido.itens,
    direta: pedido.direta,
    total: totalDosItens(pedido.itens),
    ufs: v.UFS,
    formas: v.FORMAS_PAGAMENTO,
    erros,
    valores,
  });
}

app.get('/finalizar', exigirLogin, async (req, res) => {
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

app.post('/api/finalizar', exigirLogin, async (req, res) => {
  const usuarioId = req.session.usuario.id;
  const pedido = await itensDoPedido(usuarioId, req.body);
  if (pedido.erro) return falhar(req, res, 409, pedido.erro, pedido.voltar);

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
    pagamento: texto('pagamento'),
    cartaoNome: texto('cartaoNome'),
    cartaoValidade: texto('cartaoValidade'),
    // o número e o código do cartão nunca voltam para a tela
  };
  const cartaoNumero = texto('cartaoNumero');
  const usaCartao = valores.pagamento === 'cartao_credito' || valores.pagamento === 'cartao_debito';

  const erros = [];
  const erro = (campo, textoErro) => erros.push({ campo, texto: textoErro });

  if (valores.nomeCompleto.length < 3) erro('nomeCompleto', 'Digite seu nome completo, com pelo menos 3 letras.');
  if (!v.cpfValido(valores.cpf)) erro('cpf', 'Digite um CPF válido, com 11 números. Exemplo: 529.982.247-25.');
  const nascimento = v.lerDataNascimento(valores.nascimento);
  if (!nascimento) erro('nascimento', 'Digite uma data de nascimento válida, no formato dia/mês/ano. Exemplo: 25/12/1990.');
  if (!v.telefoneValido(valores.telefone)) erro('telefone', 'Digite um telefone com DDD, de 10 ou 11 números. Exemplo: (55) 99999-8888.');
  if (!v.cepValido(valores.cep)) erro('cep', 'Digite um CEP com 8 números. Exemplo: 96810-000.');
  if (valores.logradouro.length < 3) erro('logradouro', 'Digite o nome da rua ou avenida.');
  if (!valores.numero) erro('numero', 'Digite o número do endereço, ou S/N se não houver.');
  if (valores.bairro.length < 2) erro('bairro', 'Digite o bairro.');
  if (valores.cidade.length < 2) erro('cidade', 'Digite a cidade.');
  if (!v.UFS.includes(valores.uf)) erro('uf', 'Escolha o estado na lista.');
  if (!v.FORMAS_PAGAMENTO[valores.pagamento]) erro('pagamento', 'Escolha uma forma de pagamento.');
  if (usaCartao) {
    if (!v.cartaoValido(cartaoNumero)) erro('cartaoNumero', 'Digite um número de cartão de teste válido. Exemplo: 4111 1111 1111 1111.');
    if (valores.cartaoNome.length < 3) erro('cartaoNome', 'Digite o nome como está no cartão.');
    if (!v.validadeCartaoValida(valores.cartaoValidade)) erro('cartaoValidade', 'Digite a validade no formato mês/ano, de um cartão que não venceu. Exemplo: 12/30.');
    if (!v.cvvValido(req.body.cartaoCvv)) erro('cartaoCvv', 'Digite o código de segurança, com 3 ou 4 números.');
  }

  if (erros.length > 0) {
    if (querJson(req)) return res.status(400).json({ ok: false, erros });
    return telaFinalizar(res, 400, pedido, erros, valores);
  }

  // Tudo ou nada: baixa o estoque e grava o pedido na mesma transação.
  // A baixa só acontece se ainda houver estoque, mesmo que outro cliente tenha comprado agora há pouco.
  let criado;
  try {
    criado = await sequelize.transaction(async (t) => {
      for (const { livro, quantidade } of pedido.itens) {
        const [alterados] = await Livro.update(
          { estoque: sequelize.literal(`estoque - ${Number(quantidade)}`) },
          { where: { id: livro.id, estoque: { [Op.gte]: quantidade } }, transaction: t }
        );
        if (alterados === 0) throw new Error(`SEM_ESTOQUE:${livro.titulo}`);
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
          formaPagamento: v.FORMAS_PAGAMENTO[valores.pagamento],
          cartaoFinal: usaCartao ? v.somenteDigitos(cartaoNumero).slice(-4) : null,
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
      if (!pedido.direta) await ItemCarrinho.destroy({ where: { UsuarioId: usuarioId }, transaction: t });
      return novo;
    });
  } catch (e) {
    if (String(e.message).startsWith('SEM_ESTOQUE:')) {
      const titulo = e.message.slice('SEM_ESTOQUE:'.length);
      return falhar(
        req,
        res,
        409,
        `Outro cliente acabou de comprar o livro ${titulo} e não temos mais estoque suficiente. Seu pedido não foi feito.`,
        pedido.direta ? '/' : '/carrinho'
      );
    }
    throw e;
  }

  if (querJson(req)) return res.status(201).json({ ok: true, pedido: { id: criado.id, total: criado.totalCentavos } });
  avisar(req, 'sucesso', `Pedido número ${criado.id} realizado! Esta é uma simulação: nada foi cobrado. Veja o pedido na tabela Seus pedidos.`);
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