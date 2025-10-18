(function(){
  const root = document.documentElement;
  const stored = localStorage.getItem('theme') || 'light';
  function setTheme(next){
    root.dataset.theme = next;
    localStorage.setItem('theme', next);
    const icon = document.getElementById('theme-icon');
    if (icon) icon.textContent = next === 'light' ? '☀️' : '🌙';
  }
  setTheme(stored);
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.addEventListener('click', () => {
    setTheme((root.dataset.theme || 'light') === 'light' ? 'dark' : 'light');
  });
})();
