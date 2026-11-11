// Pantalla sin conexión (la muestra el service worker): vuelve sola al panel cuando el servidor responde.
(function () {
  // El service worker la muestra en la misma dirección que se intentó abrir: al volver la red, se recarga esa.
  var back = location.pathname === "/sin-conexion" ? "/app/pedidos" : location.pathname + location.search;
  document.getElementById("retry").setAttribute("href", back);
  function check() {
    fetch("/api/v1/health", { cache: "no-store" })
      .then(function (res) {
        if (res.ok) location.replace(back);
      })
      .catch(function () {});
  }
  setInterval(check, 5000);
  window.addEventListener("online", check);
})();
