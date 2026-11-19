// carrinho.js
// 1) Na vitrine: "Adicionar ao carrinho" sem recarregar a página, com um diálogo de confirmação.
// 2) Na finalização: mostra os campos do cartão só quando a forma de pagamento é cartão.
// Sem JavaScript tudo continua funcionando: o formulário envia e a página recarrega com um aviso.

const dialogo = document.getElementById('dialogo-carrinho');
const contador = document.getElementById('contador-carrinho');
const avisoErro = document.getElementById('aviso-dinamico');

function textoContador(n) {
  return ` (${n === 0 ? 'vazio' : n + (n === 1 ? ' item' : ' itens')})`;
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
      const botao = evento.submitter;
      if (!botao || !botao.hasAttribute('data-adicionar')) return; // "Comprar" segue o caminho normal
      evento.preventDefault();
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
  const atualizarCartao = () => {
    const escolhida = document.querySelector('input[name="pagamento"]:checked');
    const usaCartao = escolhida && (escolhida.value === 'cartao_credito' || escolhida.value === 'cartao_debito');
    dadosCartao.hidden = !usaCartao;
    dadosCartao.disabled = !usaCartao; // campos desativados não são enviados
  };
  document.querySelectorAll('input[name="pagamento"]').forEach((r) => r.addEventListener('change', atualizarCartao));
  atualizarCartao();
}

// 3) Botões de diminuir (−) e aumentar (+) ao lado de cada campo de quantidade.
//    No carrinho, a quantidade também é salva sozinha (o botão "Atualizar" some).
//    Quem usa o campo digitando: o envio acontece quando sai do campo ou aperta Enter.
document.querySelectorAll('input[type="number"][name="quantidade"]').forEach((campo) => {
  const form = campo.form;
  const automatico = form && form.hasAttribute('data-auto');
  const nome = campo.getAttribute('aria-label') || (campo.labels[0] ? campo.labels[0].textContent.trim() : 'Quantidade');
  const complemento = nome.replace(/^Quantidade/i, '').trim(); // "de Nome do livro"
  const minimo = Number(campo.min) || 1;
  const maximo = Number(campo.max) || 999;

  const criar = (texto, rotulo, passo) => {
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'botao-passo';
    botao.textContent = texto;
    botao.setAttribute('aria-label', `${rotulo} quantidade ${complemento}`);
    botao.addEventListener('click', () => {
      const atual = Number(campo.value) || minimo;
      const novo = Math.min(maximo, Math.max(minimo, atual + passo));
      campo.value = novo;
      aviso.textContent = `Quantidade ${complemento}: ${novo}`; // o NVDA lê o novo valor
      if (automatico) agendarEnvio();
    });
    return botao;
  };

  const aviso = document.createElement('span');
  aviso.className = 'so-leitor';
  aviso.setAttribute('role', 'status');

  const menos = criar('−', 'Diminuir', -1);
  const mais = criar('+', 'Aumentar', 1);
  campo.before(menos);
  campo.after(mais);
  mais.after(aviso);

  if (automatico) {
    let espera;
    // Espera um instante: assim dá para apertar + várias vezes antes de salvar.
    const agendarEnvio = () => {
      clearTimeout(espera);
      espera = setTimeout(() => form.requestSubmit(), 900);
    };
    campo.addEventListener('change', agendarEnvio);
    const atualizar = form.querySelector('[data-atualizar]');
    if (atualizar) atualizar.hidden = true;
  }
});
