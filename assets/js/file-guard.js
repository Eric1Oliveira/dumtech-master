// Aberto direto do arquivo (file://), o navegador bloqueia os módulos ES e as fontes (CORS, origem "null"):
// o app não sobe. Em vez de "Carregando…" para sempre, a tela explica como abrir. Script clássico (CSP).
if (location.protocol === 'file:') {
  document.addEventListener('DOMContentLoaded', () => {
    const box = document.querySelector('#app .boot');
    if (!box) return;
    const link = document.createElement('a');
    link.href = 'http://127.0.0.1:5500/';
    link.textContent = 'http://127.0.0.1:5500';
    box.replaceChildren(
      'O DUMTech Master não abre direto do arquivo. No VS Code, clique em "Go Live" (Live Server) e use ',
      link,
      ' — ou rode "npm start" e abra http://127.0.0.1:5510.',
    );
  });
}
