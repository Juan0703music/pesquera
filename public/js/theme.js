// Aplica el tema elegido (claro u oscuro) antes de pintar la página, para que no destelle el equivocado.
// Sin elección guardada, la página sigue el tema del equipo (prefers-color-scheme).
(function () {
  try {
    var theme = localStorage.getItem("marea-tema");
    if (theme === "light" || theme === "dark") document.documentElement.setAttribute("data-theme", theme);
  } catch (error) {
    // Sin almacenamiento disponible: se usa el tema del equipo.
  }
})();
