// foco.js
// Ao abrir a página, leva o foco para o aviso (ou para o resultado da busca).
// Assim o leitor de tela NVDA lê a mensagem importante logo de cara.
const alvo = document.querySelector('[data-foco]');
if (alvo) {
  alvo.focus();
}

document.querySelectorAll('.botao-olho').forEach((botao) => {
  botao.addEventListener('click', () => {
    const campo = document.getElementById(botao.getAttribute('aria-controls'));
    const mostrar = campo.type === 'password';

    campo.type = mostrar ? 'text' : 'password';
    botao.classList.toggle('esta-visivel', mostrar);
    botao.setAttribute('aria-label', mostrar ? 'Ocultar senha' : 'Mostrar senha');
  });
});
