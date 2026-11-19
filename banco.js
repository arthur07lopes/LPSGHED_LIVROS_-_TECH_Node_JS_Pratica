// banco.js
// Aqui ficam a conexão com o banco de dados (SQLite) e os "modelos".
// Um modelo é a descrição de uma tabela: o Sequelize cria a tabela para nós.

const fs = require('fs');
const path = require('path');
const { Sequelize, DataTypes } = require('sequelize');

// O arquivo do banco fica na pasta "dados". Se ela não existir, criamos.
const pastaDados = path.join(__dirname, 'dados');
fs.mkdirSync(pastaDados, { recursive: true });

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
});

// Tabela de compras: liga um usuário a um livro.
const Compra = sequelize.define('Compra', {
  quantidade: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
});

// Relações: um usuário tem várias compras, e um livro também.
Usuario.hasMany(Compra);
Compra.belongsTo(Usuario);
Livro.hasMany(Compra);
Compra.belongsTo(Livro);

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

// Cria as tabelas (se ainda não existem) e coloca os livros de exemplo.
async function iniciarBanco() {
  await sequelize.sync();

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

  if ((await Livro.count()) === 0) {
    await Livro.bulkCreate(LIVROS_INICIAIS);
  }
}

module.exports = { Usuario, Livro, Compra, iniciarBanco };
