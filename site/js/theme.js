/* The Paper / Ink switch in the header. It changes this page only and
   stores nothing: with no choice made, the page follows the system setting. */
(() => {
  'use strict';
  const tones = [...document.querySelectorAll('.tone button')];
  if (!tones.length) return;
  const mqDark = matchMedia('(prefers-color-scheme: dark)');
  function sync(){
    const set = document.documentElement.dataset.theme;
    const dark = set ? set === 'dark' : mqDark.matches;
    tones.forEach(b => b.setAttribute('aria-pressed', String((b.dataset.tone === 'dark') === dark)));
  }
  tones.forEach(b => b.addEventListener('click', () => { document.documentElement.dataset.theme = b.dataset.tone; sync(); }));
  if (mqDark.addEventListener) mqDark.addEventListener('change', sync);
  sync();
})();
