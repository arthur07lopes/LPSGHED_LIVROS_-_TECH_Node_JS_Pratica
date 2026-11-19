// validacao.js
// Funções que conferem os dados do formulário de finalização do pedido.
// Cada uma devolve true/false. Nada aqui consulta serviços externos:
// quando houver uma API de pagamento, ela entra por cima destas conferências.

const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
];

const FORMAS_PAGAMENTO = {
  cartao_credito: 'Cartão de crédito (fictício)',
  cartao_debito: 'Cartão de débito (fictício)',
  pix: 'Pix (fictício)',
  boleto: 'Boleto (fictício)',
};

const somenteDigitos = (texto) => String(texto || '').replace(/\D/g, '');

function cpfValido(cpf) {
  const d = somenteDigitos(cpf);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  for (const tamanho of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < tamanho; i++) soma += Number(d[i]) * (tamanho + 1 - i);
    const digito = ((soma * 10) % 11) % 10;
    if (digito !== Number(d[tamanho])) return false;
  }
  return true;
}

// Aceita DD/MM/AAAA e devolve "AAAA-MM-DD", ou null se a data não existir.
function lerDataNascimento(texto) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(texto || '').trim());
  if (!m) return null;
  const [dia, mes, ano] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  const existe = data.getUTCFullYear() === ano && data.getUTCMonth() === mes - 1 && data.getUTCDate() === dia;
  if (!existe || ano < 1900 || data > new Date()) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function telefoneValido(telefone) {
  const d = somenteDigitos(telefone);
  return d.length === 10 || d.length === 11;
}

const cepValido = (cep) => somenteDigitos(cep).length === 8;

// Algoritmo de Luhn: confere se o número do cartão é plausível.
function cartaoValido(numero) {
  const d = somenteDigitos(numero);
  if (d.length < 13 || d.length > 19) return false;
  let soma = 0;
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[d.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    soma += n;
  }
  return soma % 10 === 0;
}

// Validade no formato MM/AA; vale até o último dia do mês indicado.
function validadeCartaoValida(texto) {
  const m = /^(\d{2})\/(\d{2})$/.exec(String(texto || '').trim());
  if (!m) return false;
  const mes = Number(m[1]);
  const ano = 2000 + Number(m[2]);
  if (mes < 1 || mes > 12) return false;
  return new Date(ano, mes, 1) > new Date();
}

const cvvValido = (cvv) => /^\d{3,4}$/.test(String(cvv || '').trim());

module.exports = {
  UFS,
  FORMAS_PAGAMENTO,
  somenteDigitos,
  cpfValido,
  lerDataNascimento,
  telefoneValido,
  cepValido,
  cartaoValido,
  validadeCartaoValida,
  cvvValido,
};
