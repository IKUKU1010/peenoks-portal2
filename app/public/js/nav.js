(function () {
  document.querySelectorAll('.navbar').forEach(function (navbar) {
    const nav = navbar.querySelector('nav');
    if (!nav) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'nav-toggle';
    btn.setAttribute('aria-label', 'Toggle navigation menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.textContent = '\u2630'; // ☰

    navbar.insertBefore(btn, nav);

    btn.addEventListener('click', function () {
      const isOpen = nav.classList.toggle('open');
      btn.textContent = isOpen ? '\u2715' : '\u2630'; // ✕ or ☰
      btn.setAttribute('aria-expanded', String(isOpen));
    });

    // Closing the menu after picking a link keeps mobile navigation snappy
    nav.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        nav.classList.remove('open');
        btn.textContent = '\u2630';
        btn.setAttribute('aria-expanded', 'false');
      });
    });
  });
})();
