// Aplica o tema antes da primeira pintura (evita piscar claro→escuro).
// Script clássico e externo: a CSP bloqueia scripts inline.
(() => {
  let pref = 'system';
  try { pref = localStorage.getItem('dum.theme') || 'system'; } catch { /* modo privado */ }
  const dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
})();
