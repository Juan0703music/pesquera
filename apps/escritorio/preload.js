// Puente mínimo entre las pantallas y el programa (aislado: las pantallas no tienen acceso a Node).
"use strict";
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mareaEscritorio", {
  /** Trae la ventana al frente (al tocar un aviso). */
  show: () => ipcRenderer.send("marea:mostrar"),
  /** Hace parpadear el botón de la barra de tareas si la ventana no está al frente. */
  attention: () => ipcRenderer.send("marea:atencion"),
  /** Pedidos abiertos (se ven al pasar el mouse por el ícono de la bandeja). */
  setOpenCount: (count) => ipcRenderer.send("marea:pedidos-abiertos", Number(count) || 0),
  info: () => ipcRenderer.invoke("marea:info"),
  // Solo funcionan desde las pantallas propias del programa (configurar y sin conexión).
  probarServidor: (url) => ipcRenderer.invoke("marea:probar", String(url)),
  guardarServidor: (url) => ipcRenderer.invoke("marea:guardar", String(url)),
  reintentar: () => ipcRenderer.send("marea:reintentar"),
});
