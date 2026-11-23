// carrinho.js
// 1) Na vitrine: "Adicionar ao carrinho" sem recarregar a página, com um diálogo de confirmação.
// 2) Na finalização: mostra os campos do cartão só quando a forma de pagamento é cartão.
// Sem JavaScript tudo continua funcionando: o formulário envia e a página recarrega com um aviso.

const dialogo = document.getElementById('dialogo-carrinho');
const contador = document.getElementById('contador-carrinho');
const avisoErro = document.getElementById('aviso-dinamico');

// Texto ao lado de "Carrinho" no topo da página: " (vazio)", " (1 item)" ou " (3 itens)".
function textoContador(n) {
  if (n === 0) return ' (vazio)';
  const palavra = n === 1 ? 'item' : 'itens';
  return ` (${n} ${palavra})`;
}

function mostrarErro(texto) {
  avisoErro.querySelector('p').textContent = texto;
  avisoErro.hidden = false;
  avisoErro.focus(); // o NVDA lê o aviso porque o foco vai para ele
}

if (dialogo && typeof dialogo.showModal === 'function') {
  let botaoOrigem = null;

  dialogo.addEventListener('close', () => {
    if (botaoOrigem) botaoOrigem.focus(); // devolve o foco ao botão que abriu o diálogo
  });
  document.getElementById('continuar-compras').addEventListener('click', () => dialogo.close());

  document.querySelectorAll('.form-livro').forEach((form) => {
    form.addEventListener('submit', async (evento) => {
      // "submitter" é o botão que foi clicado para enviar o formulário.
      const botao = evento.submitter;
      if (!botao || !botao.hasAttribute('data-adicionar')) return; // "Comprar" segue o caminho normal
      evento.preventDefault(); // impede o envio normal (que recarregaria a página)
      avisoErro.hidden = true;

      let resposta;
      try {
        resposta = await fetch(form.action, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams(new FormData(form)),
        });
      } catch (e) {
        form.submit(); // sem rede para o fetch: usa o envio normal do formulário
        return;
      }

      // Se a resposta não for JSON válido, .catch devolve null em vez de dar erro.
      const dados = await resposta.json().catch(() => null);
      if (!dados || !dados.ok) {
        mostrarErro(dados && dados.erro ? dados.erro : 'Não foi possível adicionar ao carrinho. Tente de novo.');
        return;
      }

      if (contador) contador.textContent = textoContador(dados.itensCarrinho);
      document.getElementById('texto-dialogo-carrinho').textContent =
        `${dados.livro}. Quantidade deste livro no carrinho: ${dados.quantidadeDoLivro}.`;
      botaoOrigem = botao;
      dialogo.showModal();
      document.getElementById('titulo-dialogo-carrinho').focus();
    });
  });
}

const dadosCartao = document.getElementById('dados-cartao');
if (dadosCartao) {
  // <fieldset id="dados-cartao">: esconde os campos do cartão, a menos que a forma
  // de pagamento escolhida seja cartão de crédito ou de débito.
  const atualizarCartao = () => {
    const escolhida = document.querySelector('input[name="pagamento"]:checked'); // null se nenhuma
    const valor = escolhida ? escolhida.value : '';
    const usaCartao = valor === 'cartao_credito' || valor === 'cartao_debito';
    dadosCartao.hidden = !usaCartao;
    dadosCartao.disabled = !usaCartao; // campos desativados não são enviados com o formulário
  };
  document.querySelectorAll('input[name="pagamento"]').forEach((r) => r.addEventListener('change', atualizarCartao));
  atualizarCartao();
}

// 3) Botões de diminuir (−) e aumentar (+) ao lado de cada campo de quantidade.
//    No carrinho, a quantidade também é salva sozinha (o botão "Atualizar" some).
//    Quem usa o campo digitando: o envio acontece quando sai do campo ou aperta Enter.
document.querySelectorAll('input[type="number"][name="quantidade"]').forEach((campo) => {
  const form = campo.form;
  const automatico = form && form.hasAttribute('data-auto'); // true = salva sozinho (carrinho)

  // Nome do campo para o leitor de tela. Ex.: "Quantidade de Código Limpo".
  const nome = campo.getAttribute('aria-label') || (campo.labels[0] ? campo.labels[0].textContent.trim() : 'Quantidade');
  const complemento = nome.replace(/^Quantidade/i, '').trim(); // tira a 1ª palavra: sobra "de Código Limpo"

  // Limites do campo (atributos min e max do HTML). Se não existirem ou forem 0,
  // o "|| valor" usa o valor padrão. Number('') é 0, que conta como "não definido".
  const minimo = Number(campo.min) || 1;
  const maximo = Number(campo.max) || 999;

  // --- Salvamento automático (só no carrinho) ---
  let espera; // guarda o temporizador pendente
  // Em vez de enviar a cada clique, espera 0,9 s sem novos cliques e só então envia.
  // Cada novo clique cancela o temporizador anterior e começa outro (técnica "debounce"),
  // assim dá para apertar + várias vezes e enviar uma única vez.
  const agendarEnvio = () => {
    clearTimeout(espera);
    espera = setTimeout(() => form.requestSubmit(), 900);
  };

  // Texto invisível na tela, mas lido pelo NVDA: avisa o novo valor a cada clique.
  // role="status" faz o leitor anunciar o texto sempre que ele mudar.
  const aviso = document.createElement('span');
  aviso.className = 'so-leitor';
  aviso.setAttribute('role', 'status');

  // Garante que o número fique entre o mínimo e o máximo.
  // Math.max(minimo, valor): se o valor for menor que o mínimo, vence o mínimo.
  // Math.min(maximo, ...): se o resultado passar do máximo, vence o máximo.
  // Exemplo com mínimo 1 e máximo 5: 0 vira 1, 3 continua 3, 9 vira 5.
  const manterNosLimites = (numero) => Math.min(maximo, Math.max(minimo, numero));

  // Cria um botão "−" ou "+". "passo" é quanto soma ao valor: -1 diminui, +1 aumenta.
  const criarBotao = (texto, rotulo, passo) => {
    const botao = document.createElement('button');
    botao.type = 'button'; // "button" não envia o formulário ao clicar
    botao.className = 'botao-passo';
    botao.textContent = texto;
    botao.setAttribute('aria-label', `${rotulo} quantidade ${complemento}`);
    botao.addEventListener('click', () => {
      const atual = Number(campo.value) || minimo; // campo vazio ou inválido: começa do mínimo
      const novo = manterNosLimites(atual + passo);
      campo.value = novo;
      aviso.textContent = `Quantidade ${complemento}: ${novo}`;
      if (automatico) agendarEnvio();
    });
    return botao;
  };

  // Coloca os botões ao redor do campo: [−] campo [+] aviso
  const menos = criarBotao('−', 'Diminuir', -1);
  const mais = criarBotao('+', 'Aumentar', 1);
  campo.before(menos);
  campo.after(mais);
  mais.after(aviso);

  if (automatico) {
    campo.addEventListener('change', agendarEnvio); // também salva quando o usuário digita
    const atualizar = form.querySelector('[data-atualizar]');
    if (atualizar) atualizar.hidden = true; // o botão "Atualizar" deixa de ser necessário
  }
});
