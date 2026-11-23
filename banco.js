// banco.js
// Aqui ficam a conexão com o banco de dados (SQLite) e os "modelos".
// Um modelo é a descrição de uma tabela: o Sequelize cria a tabela para nós.

const fs = require('fs');
const path = require('path');
const { Sequelize, DataTypes } = require('sequelize');

// O arquivo do banco fica na pasta "dados". Se ela não existir, criamos.
const pastaDados = path.join(__dirname, 'dados');
fs.mkdirSync(pastaDados, { recursive: true });

// Quantas unidades cada livro tem no estoque quando a loja começa.
const ESTOQUE_PADRAO = 5;

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.join(pastaDados, 'loja.sqlite'),
  logging: false, // troque por console.log para ver o SQL gerado
});

// Tabela de usuários. Nunca guardamos a senha, só o "hash" dela.
const Usuario = sequelize.define('Usuario', {
  nome: { type: DataTypes.STRING, allowNull: false },
  email: { type: DataTypes.STRING, allowNull: false, unique: true },
  senhaHash: { type: DataTypes.STRING, allowNull: false },
});

// Tabela de livros. O preço fica em centavos (8990 = R$ 89,90).
const Livro = sequelize.define('Livro', {
  titulo: { type: DataTypes.STRING, allowNull: false },
  autor: { type: DataTypes.STRING, allowNull: false },
  isbn: { type: DataTypes.STRING, allowNull: false },
  nivel: { type: DataTypes.STRING, allowNull: false },
  descricao: { type: DataTypes.TEXT, allowNull: false },
  precoCentavos: { type: DataTypes.INTEGER, allowNull: false },
  // Estoque compartilhado por todos os clientes da loja.
  estoque: { type: DataTypes.INTEGER, allowNull: false, defaultValue: ESTOQUE_PADRAO },
});

// Carrinho: cada linha é um livro (e a quantidade) no carrinho de um usuário.
// Adicionar ao carrinho NÃO tira do estoque: o estoque só baixa ao finalizar o pedido.
const ItemCarrinho = sequelize.define(
  'ItemCarrinho',
  { quantidade: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 } },
  { tableName: 'itens_carrinho', indexes: [{ unique: true, fields: ['UsuarioId', 'LivroId'] }] }
);

// Pedido: é criado quando o formulário de finalização é enviado, já como "pendente".
// Só vira "pago" quando o Stripe confirma o pagamento. Os dados do cartão são digitados
// na página do Stripe: a nossa loja nunca os vê nem os guarda.
// status: 'pendente' (esperando pagamento), 'pago', 'cancelado' ou 'falhou'.
// stripeSessionId: o código da sessão de pagamento no Stripe.
const Pedido = sequelize.define(
  'Pedido',
  {
    totalCentavos: { type: DataTypes.INTEGER, allowNull: false },
    nomeCompleto: DataTypes.STRING,
    cpf: DataTypes.STRING,
    dataNascimento: DataTypes.DATEONLY,
    telefone: DataTypes.STRING,
    cep: DataTypes.STRING,
    logradouro: DataTypes.STRING,
    numero: DataTypes.STRING,
    complemento: DataTypes.STRING,
    bairro: DataTypes.STRING,
    cidade: DataTypes.STRING,
    uf: DataTypes.STRING,
    formaPagamento: DataTypes.STRING,
    cartaoFinal: DataTypes.STRING, // não é mais usado (pedidos da época da simulação)
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'pendente' },
    stripeSessionId: { type: DataTypes.STRING, allowNull: true },
  },
  { tableName: 'pedidos' }
);

// Itens do pedido: livro, quantidade e o preço da hora da compra.
const ItemPedido = sequelize.define(
  'ItemPedido',
  {
    quantidade: { type: DataTypes.INTEGER, allowNull: false },
    precoCentavos: { type: DataTypes.INTEGER, allowNull: false },
  },
  { tableName: 'itens_pedido' }
);

// Relações.
Usuario.hasMany(ItemCarrinho);
ItemCarrinho.belongsTo(Usuario);
Livro.hasMany(ItemCarrinho);
ItemCarrinho.belongsTo(Livro);

Usuario.hasMany(Pedido);
Pedido.belongsTo(Usuario);
Pedido.hasMany(ItemPedido);
ItemPedido.belongsTo(Pedido);
Livro.hasMany(ItemPedido);
ItemPedido.belongsTo(Livro);

// Livros de exemplo. Títulos reais, preços fictícios (é um projeto de estudo).
const LIVROS_INICIAIS = [
  {
    titulo: 'JavaScript Eloquente',
    autor: 'Marijn Haverbeke',
    isbn: '9781593279509',
    nivel: 'Iniciante',
    descricao: 'Uma introdução moderna ao JavaScript, escrita em português, com exercícios práticos.',
    precoCentavos: 12990,
  },
  {
    titulo: 'Curso Intensivo de Python',
    autor: 'Eric Matthes',
    isbn: '9788575225035',
    nivel: 'Iniciante',
    descricao: 'Aprenda Python fazendo projetos do zero, passo a passo, nesta edição em português.',
    precoCentavos: 13990,
  },
  {
    titulo: 'Automatize Tarefas Maçantes com Python',
    autor: 'Al Sweigart',
    isbn: '9781593275990',
    nivel: 'Iniciante',
    descricao: 'Use Python para automatizar tarefas repetitivas do dia a dia, em português.',
    precoCentavos: 11990,
  },
  {
    titulo: 'JavaScript: As Partes Boas',
    autor: 'Douglas Crockford',
    isbn: '9780596517748',
    nivel: 'Intermediário',
    descricao: 'Um guia curto sobre as partes mais confiáveis do JavaScript, em português.',
    precoCentavos: 8990,
  },
  {
    titulo: 'Código Limpo',
    autor: 'Robert C. Martin',
    isbn: '9788576082675',
    nivel: 'Intermediário',
    descricao: 'Princípios para escrever código limpo, legível e fácil de manter, em português.',
    precoCentavos: 14990,
  },
  {
    titulo: 'O Programador Pragmático',
    autor: 'David Thomas e Andrew Hunt',
    isbn: '9788577807000',
    nivel: 'Intermediário',
    descricao: 'Hábitos e ideias práticas para quem quer crescer na profissão, nesta edição em português.',
    precoCentavos: 15990,
  },
  {
    titulo: 'Código Completo',
    autor: 'Steve McConnell',
    isbn: '9780735619678',
    nivel: 'Avançado',
    descricao: 'Um manual extenso sobre construção de software de qualidade, em português.',
    precoCentavos: 17990,
  },
  {
    titulo: 'Padrões de Projeto',
    autor: 'Erich Gamma e outros',
    isbn: '9780201633610',
    nivel: 'Avançado',
    descricao: 'O clássico catálogo de padrões de projeto orientado a objetos, em português.',
    precoCentavos: 16990,
  },
];

// Bancos criados antes do carrinho: o sync() não altera tabelas que já existem,
// então adicionamos o estoque e trazemos as compras antigas para a tabela de pedidos.
// (Se o seu banco é novo, esta função não faz nada.)
async function atualizarBancoAntigo() {
  // "QueryInterface" permite mexer na estrutura do banco: criar, alterar e apagar tabelas e colunas.
  const consulta = sequelize.getQueryInterface();

  // Se a tabela de livros ainda não tem a coluna "estoque", cria.
  const colunasLivro = await consulta.describeTable('Livros');
  if (!colunasLivro.estoque) {
    await consulta.addColumn('Livros', 'estoque', {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: ESTOQUE_PADRAO,
    });
  }

  // Pedidos criados antes do pagamento real não têm "status": eles já valiam como pagos.
  const colunasPedido = await consulta.describeTable('pedidos');
  if (!colunasPedido.status) {
    await consulta.addColumn('pedidos', 'status', { type: DataTypes.STRING, allowNull: false, defaultValue: 'pago' });
    // A partir de agora, pedido novo começa "pendente" (o padrão do modelo cuida disso).
  }
  if (!colunasPedido.stripeSessionId) {
    await consulta.addColumn('pedidos', 'stripeSessionId', { type: DataTypes.STRING, allowNull: true });
  }

  // A tabela antiga "Compras" guardava uma compra por linha. Se ela existir, copiamos
  // cada compra para o formato novo (um Pedido com um ItemPedido) e depois apagamos a antiga.
  const tabelas = await consulta.showAllTables();
  if (!tabelas.includes('Compras')) return;

  // Transação: ou a migração inteira funciona, ou nada muda no banco.
  await sequelize.transaction(async (transacao) => {
    const [antigas] = await sequelize.query('SELECT * FROM Compras', { transaction: transacao });
    for (const antiga of antigas) {
      const livro = await Livro.findByPk(antiga.LivroId, { transaction: transacao });
      if (!livro) continue;
      const pedido = await Pedido.create(
        {
          UsuarioId: antiga.UsuarioId,
          totalCentavos: livro.precoCentavos * antiga.quantidade,
          status: 'pago',
          createdAt: antiga.createdAt,
        },
        { transaction: transacao }
      );
      await ItemPedido.create(
        {
          PedidoId: pedido.id,
          LivroId: livro.id,
          quantidade: antiga.quantidade,
          precoCentavos: livro.precoCentavos,
        },
        { transaction: transacao }
      );
    }
    await consulta.dropTable('Compras', { transaction: transacao });
  });
}

// Cria as tabelas (se ainda não existem) e coloca os livros de exemplo.
async function iniciarBanco() {
  await sequelize.sync();
  await atualizarBancoAntigo();

  // Em versões antigas os livros tinham o título em inglês. Aqui, "título antigo: título novo".
  // Se algum livro com título antigo existir no banco, atualizamos para os dados em português.
  const TITULOS_ANTERIORES = {
    'Eloquent JavaScript': 'JavaScript Eloquente',
    'Python Crash Course': 'Curso Intensivo de Python',
    'Automate the Boring Stuff with Python': 'Automatize Tarefas Maçantes com Python',
    'JavaScript: The Good Parts': 'JavaScript: As Partes Boas',
    'Clean Code': 'Código Limpo',
    'The Pragmatic Programmer': 'O Programador Pragmático',
    'Code Complete': 'Código Completo',
    'Design Patterns': 'Padrões de Projeto',
  };

  for (const [tituloAntigo, tituloNovo] of Object.entries(TITULOS_ANTERIORES)) {
    const livro = await Livro.findOne({ where: { titulo: tituloAntigo } });
    if (livro) {
      const dadosNovos = LIVROS_INICIAIS.find((item) => item.titulo === tituloNovo);
      await livro.update(dadosNovos);
    }
  }

  // Banco vazio (primeira vez que a loja roda): cadastra os livros de exemplo.
  if ((await Livro.count()) === 0) {
    await Livro.bulkCreate(LIVROS_INICIAIS);
  }
}

module.exports = { sequelize, Usuario, Livro, ItemCarrinho, Pedido, ItemPedido, iniciarBanco };
