// validacao.js
// Funções que conferem os dados do formulário de finalização do pedido.
// Cada uma devolve true/false. Nada aqui consulta serviços externos.
// Os dados de pagamento (cartão etc.) não são conferidos aqui: o Stripe cuida disso.

const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
];

// Tira tudo que não é número: "529.982.247-25" vira "52998224725".
// \D na expressão regular significa "qualquer caractere que não seja dígito".
const somenteDigitos = (texto) => String(texto || '').replace(/\D/g, '');

// Confere o CPF. Os 2 últimos números são "dígitos verificadores": calculados a partir
// dos anteriores, servem para detectar erros de digitação.
function cpfValido(cpf) {
  const d = somenteDigitos(cpf);

  // Precisa ter 11 números e não pode ser repetido (111.111.111-11 passaria na conta,
  // mas não é um CPF real). A expressão /^(\d)\1{10}$/ significa "um dígito seguido
  // de mais 10 iguais a ele".
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;

  // Calcula o 1º dígito verificador (usando os 9 primeiros números) e depois o 2º
  // (usando os 10 primeiros). Em cada passo, "tamanho" é quantos números entram na conta.
  for (const tamanho of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < tamanho; i++) {
      // Cada número é multiplicado por um peso que começa em (tamanho + 1) e vai diminuindo:
      // para 9 números os pesos são 10, 9, 8 ... 2; para 10 números, 11, 10 ... 2.
      const peso = tamanho + 1 - i;
      soma += Number(d[i]) * peso;
    }
    // Regra oficial: multiplica a soma por 10 e pega o resto da divisão por 11.
    // Resto 10 conta como dígito 0, por isso o segundo "% 10".
    const digitoEsperado = ((soma * 10) % 11) % 10;
    if (digitoEsperado !== Number(d[tamanho])) return false;
  }
  return true;
}

// Aceita DD/MM/AAAA e devolve "AAAA-MM-DD" (formato do banco), ou null se a data não existir.
function lerDataNascimento(texto) {
  // Os parênteses na expressão regular "capturam" dia, mês e ano em partes separadas.
  const partes = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(texto || '').trim());
  if (!partes) return null;

  const [, diaTexto, mesTexto, anoTexto] = partes; // a posição 0 é o texto inteiro; pulamos
  const dia = Number(diaTexto);
  const mes = Number(mesTexto);
  const ano = Number(anoTexto);

  // O JavaScript "corrige" datas impossíveis em vez de dar erro: 31/02 vira 03/03.
  // Por isso criamos a data (mês começa em 0, daí "mes - 1") e conferimos se dia, mês e ano
  // continuam os mesmos. Se mudaram, a data digitada não existe.
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  const dataExiste =
    data.getUTCFullYear() === ano && data.getUTCMonth() === mes - 1 && data.getUTCDate() === dia;

  const muitoAntiga = ano < 1900;
  const noFuturo = data > new Date();
  if (!dataExiste || muitoAntiga || noFuturo) return null;

  return `${anoTexto}-${mesTexto}-${diaTexto}`;
}

function telefoneValido(telefone) {
  const d = somenteDigitos(telefone);
  return d.length === 10 || d.length === 11;
}

const cepValido = (cep) => somenteDigitos(cep).length === 8;

module.exports = {
  UFS,
  somenteDigitos,
  cpfValido,
  lerDataNascimento,
  telefoneValido,
  cepValido,
};
