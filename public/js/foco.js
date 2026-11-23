// foco.js
// Ao abrir a página, leva o foco para o aviso (ou para o resultado da busca).
// Assim o leitor de tela NVDA lê a mensagem importante logo de cara.
const alvo = document.querySelector('[data-foco]');
if (alvo) {
  alvo.focus();
}

// Avisos marcados com data-anunciar (ex.: "Pedido número 1 realizado!") são lidos em voz alta
// pela região #anuncio. Esperamos um instante e só então escrevemos o texto nela: o leitor de
// tela anuncia mudanças, e não conteúdo que já estava na página ao carregar.
const aviso = document.querySelector('[data-anunciar]');
const anuncio = document.getElementById('anuncio');
if (aviso && anuncio) {
  setTimeout(() => {
    anuncio.textContent = aviso.textContent.trim();
  }, 300);
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
