// Barras 3D con Three.js para el tablero en vivo.
//
// Una cuadrícula X × Z de columnas (cada columna puede tener varios segmentos apilados).
// - Un solo eje de valores (Y) con marcas «redondas» y líneas finas en la pared del fondo.
// - Etiquetas en HTML encima del lienzo: nítidas y con los colores de texto del tema.
// - Tooltip por barra (raycasting); la barra señalada se resalta.
// - Arrastrar gira, la rueda acerca, doble clic vuelve a la vista inicial; con teclado, flechas y + / −.
// - Las alturas se animan hacia el valor nuevo y la barra que cambió destella (sin animación si se prefiere menos movimiento).
// - Dibuja solo cuando algo cambia (no consume la GPU en reposo).
import * as THREE from "/vendor/three/three.module.js";

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Máximo «redondo» y marcas del eje: 1, 2, 2,5 o 5 × 10ⁿ. */
export function niceScale(max, count = 4) {
  if (!(max > 0)) return { max: 1, ticks: [0, 0.25, 0.5, 0.75, 1] };
  const raw = max / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((candidate) => candidate >= raw) ?? 10 * power;
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let value = 0; value <= top + step / 2; value += step) ticks.push(value);
  return { max: top, ticks };
}

export class Bars3D {
  /**
   * @param {HTMLElement} host contenedor (posición relativa) donde va el lienzo
   * @param {object} options
   *   height: altura del mundo para el valor máximo · valueFormat: (n) => texto del eje
   *   tooltip: (cell) => HTML · label: texto accesible del lienzo
   */
  constructor(host, options) {
    this.host = host;
    this.options = { height: 4, cellSize: 1, barWidth: 0.62, rowGap: 1.6, ...options };
    this.cells = [];
    this.bars = new Map();
    this.labels = [];
    // zoom 1 = la escena completa cabe en el lienzo (se recalcula al cambiar el tamaño).
    this.view = { theta: -0.5, phi: 0.9, zoom: 1, ...(options.view ?? {}) };
    this.defaultView = { ...this.view };
    this.needsRender = true;
    this.hovered = null;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.canvas = this.renderer.domElement;
    this.canvas.className = "viz3d-canvas";
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute("role", "img");
    this.canvas.setAttribute("aria-label", options.label ?? "Gráfica 3D");

    this.overlay = document.createElement("div");
    this.overlay.className = "viz3d-labels";
    this.tip = document.createElement("div");
    this.tip.className = "viz3d-tip";
    this.tip.hidden = true;
    host.append(this.canvas, this.overlay, this.tip);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x445566, 1.6);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.5);
    this.sun.position.set(-6, 12, 9);
    this.scene.add(this.hemi, this.sun);
    this.geometry = new THREE.BoxGeometry(1, 1, 1);
    this.chrome = new THREE.Group();
    this.root.add(this.chrome);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    this.#bindControls();
    this.resizeObserver = new ResizeObserver(() => this.#resize());
    this.resizeObserver.observe(host);
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => this.refreshTheme());
    this.#resize();
    this.#loop();
  }

  /**
   * cells: [{ x, z, key, segments: [{ value, color }], label?, meta }]
   * xLabels / zLabels: textos de los ejes · direct: claves de celdas con etiqueta directa.
   */
  setData({ cells, xLabels, zLabels, xEvery = 1, direct = [] }) {
    const previous = new Map(this.cells.map((cell) => [cell.key, cell.segments.reduce((sum, s) => sum + s.value, 0)]));
    this.cells = cells;
    this.xLabels = xLabels;
    this.zLabels = zLabels;
    this.xEvery = xEvery;
    this.direct = new Set(direct);
    const peak = Math.max(0, ...cells.map((cell) => cell.segments.reduce((sum, s) => sum + s.value, 0)));
    this.scale = niceScale(peak);
    this.#buildChrome();

    const seen = new Set();
    for (const cell of cells) {
      seen.add(cell.key);
      let group = this.bars.get(cell.key);
      if (!group) {
        group = { meshes: [], cell, flash: 0 };
        this.bars.set(cell.key, group);
      }
      group.cell = cell;
      while (group.meshes.length < cell.segments.length) {
        const material = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.05 });
        const mesh = new THREE.Mesh(this.geometry, material);
        mesh.userData.key = cell.key;
        mesh.userData.height = 0;
        this.root.add(mesh);
        group.meshes.push(mesh);
      }
      while (group.meshes.length > cell.segments.length) this.#dispose(group.meshes.pop());
      const [px, pz] = this.#position(cell.x, cell.z);
      cell.segments.forEach((segment, index) => {
        const mesh = group.meshes[index];
        mesh.material.color.set(segment.color);
        mesh.userData.colorToken = segment.color;
        mesh.userData.target = (segment.value / this.scale.max) * this.options.height;
        mesh.userData.minimum = segment.marker ? 0.05 : 0;
        if (reducedMotion) mesh.userData.height = mesh.userData.target;
        const width = this.options.barWidth * (segment.inset ?? 1);
        mesh.scale.x = width;
        mesh.scale.z = width;
        mesh.position.x = px;
        mesh.position.z = pz;
      });
      const before = previous.get(cell.key);
      const now = cell.segments.reduce((sum, s) => sum + s.value, 0);
      if (before !== undefined && now !== before) group.flash = 1;
    }
    for (const [key, group] of this.bars) {
      if (seen.has(key)) continue;
      group.meshes.forEach((mesh) => this.#dispose(mesh));
      this.bars.delete(key);
    }
    this.needsRender = true;
  }

  refreshTheme() {
    for (const group of this.bars.values()) group.cell.segments.forEach((segment, i) => group.meshes[i]?.material.color.set(segment.color));
    this.#buildChrome();
    this.needsRender = true;
  }

  resetView() {
    Object.assign(this.view, this.defaultView);
    this.needsRender = true;
  }

  /* ───────────── internos ───────────── */
  #position(x, z) {
    const { cellSize } = this.options;
    const nx = this.xLabels.length;
    const nz = this.zLabels.length;
    return [(x - (nx - 1) / 2) * cellSize, (z - (nz - 1) / 2) * cellSize * this.options.rowGap];
  }

  #dispose(mesh) {
    this.root.remove(mesh);
    mesh.material.dispose();
  }

  #buildChrome() {
    this.chrome.clear();
    this.overlay.replaceChildren();
    this.labels = [];
    if (!this.xLabels) return;
    const nx = this.xLabels.length;
    const nz = this.zLabels.length;
    const halfX = (nx * this.options.cellSize) / 2;
    const halfZ = (nz * this.options.cellSize * this.options.rowGap) / 2;
    const H = this.options.height;
    const gridColor = new THREE.Color(css("--grid") || "#dfe6e8");
    const axisColor = new THREE.Color(css("--axis") || "#bfcbcf");

    // Piso: un plano apenas visible y líneas finas entre filas.
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(halfX * 2, halfZ * 2), new THREE.MeshBasicMaterial({ color: gridColor, transparent: true, opacity: 0.35 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.001;
    this.chrome.add(floor);

    const points = [];
    for (let z = 0; z <= nz; z++) {
      const pz = -halfZ + z * this.options.cellSize * this.options.rowGap;
      points.push(-halfX, 0, pz, halfX, 0, pz);
    }
    const tickPoints = [];
    for (const tick of this.scale.ticks) {
      const y = (tick / this.scale.max) * H;
      // Pared del fondo y pared izquierda: una línea por marca del eje.
      tickPoints.push(-halfX, y, -halfZ, halfX, y, -halfZ, -halfX, y, -halfZ, -halfX, y, halfZ);
    }
    const lines = (array, color) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(array, 3));
      return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color }));
    };
    this.chrome.add(lines(points, gridColor), lines(tickPoints, gridColor));
    this.chrome.add(lines([-halfX, 0, halfZ, halfX, 0, halfZ, -halfX, 0, -halfZ, -halfX, H, -halfZ], axisColor));

    // Etiquetas: X al frente, Z a la derecha, valores en la arista del fondo izquierda.
    this.xLabels.forEach((text, x) => {
      // Con etiquetas salteadas, la última (la más reciente) siempre se muestra.
      if ((nx - 1 - x) % this.xEvery !== 0) return;
      const [px] = this.#position(x, 0);
      this.#label(text, new THREE.Vector3(px, 0, halfZ + 0.45), "x");
    });
    this.zLabels.forEach((text, z) => {
      const [, pz] = this.#position(0, z);
      this.#label(text, new THREE.Vector3(halfX + 0.75, 0, pz), "z");
    });
    this.scale.ticks.forEach((tick) => {
      if (tick === 0) return;
      this.#label(this.options.valueFormat(tick), new THREE.Vector3(-halfX - 0.15, (tick / this.scale.max) * H, -halfZ), "y");
    });
    for (const cell of this.cells) {
      if (!this.direct.has(cell.key) || !cell.label) continue;
      const [px, pz] = this.#position(cell.x, cell.z);
      const total = cell.segments.reduce((sum, s) => sum + s.value, 0);
      this.#label(cell.label, new THREE.Vector3(px, (total / this.scale.max) * H + 0.25, pz), "direct");
    }
  }

  #label(text, position, axis) {
    const node = document.createElement("span");
    node.className = `viz3d-label viz3d-label-${axis}`;
    node.textContent = text;
    this.overlay.append(node);
    const offset = { x: "translate(-50%, 6px)", z: "translate(8px, -50%)", y: "translate(calc(-100% - 6px), -50%)", direct: "translate(-50%, -100%)" }[axis];
    this.labels.push({ node, position, offset });
  }

  /**
   * Distancia a la que la escena completa (con margen para las etiquetas) llena el lienzo en la vista inicial.
   * Búsqueda binaria proyectando las 8 esquinas; se guarda hasta que cambie la cuadrícula o el tamaño.
   */
  #fitRadius() {
    const nx = this.xLabels?.length ?? 1;
    const nz = this.zLabels?.length ?? 1;
    const key = `${nx}|${nz}|${this.camera.aspect.toFixed(3)}`;
    if (this.fit?.key === key) return this.fit.radius;
    const halfX = (nx * this.options.cellSize) / 2;
    const halfZ = (nz * this.options.cellSize * this.options.rowGap) / 2;
    const H = this.options.height;
    const corners = [];
    // A la derecha van los nombres de las filas y a la izquierda los valores del eje: más margen en X.
    for (const x of [-halfX - 1.1, halfX + 2.2]) for (const y of [0, H + 0.3]) for (const z of [-halfZ - 0.2, halfZ + 0.8]) corners.push(new THREE.Vector3(x, y, z));
    const target = new THREE.Vector3(0, H * 0.3, 0);
    const { theta, phi } = this.defaultView;
    const fits = (radius) => {
      this.camera.position.set(radius * Math.sin(phi) * Math.sin(theta), target.y + radius * Math.cos(phi), radius * Math.sin(phi) * Math.cos(theta));
      this.camera.lookAt(target);
      this.camera.updateMatrixWorld();
      const point = new THREE.Vector3();
      return corners.every((corner) => {
        point.copy(corner).project(this.camera);
        return Math.abs(point.x) <= 0.94 && Math.abs(point.y) <= 0.9;
      });
    };
    let lo = 1;
    let hi = 300;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    this.fit = { key, radius: hi };
    return hi;
  }

  #resize() {
    const { clientWidth: w, clientHeight: h } = this.host;
    if (!w || !h) return;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.needsRender = true;
  }

  #bindControls() {
    const canvas = this.canvas;
    let drag = null;
    canvas.addEventListener("pointerdown", (event) => {
      drag = { x: event.clientX, y: event.clientY, theta: this.view.theta, phi: this.view.phi };
      canvas.setPointerCapture(event.pointerId);
      this.#hideTip();
    });
    canvas.addEventListener("pointermove", (event) => {
      if (drag) {
        this.view.theta = drag.theta - (event.clientX - drag.x) * 0.008;
        this.view.phi = Math.min(1.45, Math.max(0.35, drag.phi - (event.clientY - drag.y) * 0.006));
        this.needsRender = true;
        return;
      }
      const rect = canvas.getBoundingClientRect();
      this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      this.#pick(event.clientX - rect.left, event.clientY - rect.top);
    });
    canvas.addEventListener("pointerup", () => (drag = null));
    canvas.addEventListener("pointerleave", () => this.#hideTip());
    canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        this.view.zoom = Math.min(1.8, Math.max(0.45, this.view.zoom * (1 + Math.sign(event.deltaY) * 0.08)));
        this.needsRender = true;
      },
      { passive: false },
    );
    canvas.addEventListener("dblclick", () => this.resetView());
    canvas.addEventListener("keydown", (event) => {
      const step = { ArrowLeft: [0.12, 0], ArrowRight: [-0.12, 0], ArrowUp: [0, -0.08], ArrowDown: [0, 0.08] }[event.key];
      if (step) {
        event.preventDefault();
        this.view.theta += step[0];
        this.view.phi = Math.min(1.45, Math.max(0.35, this.view.phi + step[1]));
      } else if (event.key === "+" || event.key === "-") {
        this.view.zoom = Math.min(1.8, Math.max(0.45, this.view.zoom * (event.key === "+" ? 0.92 : 1.08)));
      } else if (event.key === "0" || event.key === "Home") {
        this.resetView();
      } else return;
      this.needsRender = true;
    });
  }

  #pick(x, y) {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const meshes = [...this.bars.values()].flatMap((group) => group.meshes);
    const hit = this.raycaster.intersectObjects(meshes, false)[0];
    const key = hit?.object.userData.key ?? null;
    if (key !== this.hovered) {
      this.hovered = key;
      this.needsRender = true;
    }
    if (!key) return this.#hideTip();
    const cell = this.bars.get(key).cell;
    this.tip.innerHTML = this.options.tooltip(cell);
    this.tip.hidden = false;
    const tipWidth = this.tip.offsetWidth;
    const left = x + 14 + tipWidth > this.width ? x - tipWidth - 14 : x + 14;
    this.tip.style.transform = `translate(${Math.max(4, left)}px, ${Math.max(4, y - 10)}px)`;
    this.canvas.style.cursor = "pointer";
  }

  #hideTip() {
    this.tip.hidden = true;
    this.canvas.style.cursor = "grab";
    if (this.hovered) {
      this.hovered = null;
      this.needsRender = true;
    }
  }

  #loop() {
    const tick = () => {
      requestAnimationFrame(tick);
      let animating = false;
      for (const [key, group] of this.bars) {
        let base = 0;
        group.meshes.forEach((mesh) => {
          const target = Math.max(mesh.userData.target ?? 0, mesh.userData.minimum ?? 0);
          const delta = target - mesh.userData.height;
          if (Math.abs(delta) > 0.002) {
            mesh.userData.height += delta * 0.12;
            animating = true;
          } else mesh.userData.height = target;
          const h = Math.max(mesh.userData.height, 0.0001);
          mesh.scale.y = h;
          // 2 px «de aire» entre segmentos apilados (separación con el fondo).
          mesh.position.y = base + h / 2;
          base += h + (h > 0.01 ? 0.03 : 0);
          const glow = key === this.hovered ? 0.28 : group.flash * 0.6;
          mesh.material.emissive.setRGB(glow, glow, glow);
        });
        if (group.flash > 0) {
          group.flash = Math.max(0, group.flash - 0.015);
          animating = true;
        }
      }
      if (!animating && !this.needsRender) return;
      this.needsRender = false;
      this.#render();
    };
    requestAnimationFrame(tick);
  }

  #render() {
    const { theta, phi, zoom } = this.view;
    const radius = this.#fitRadius() * zoom;
    const target = new THREE.Vector3(0, this.options.height * 0.3, 0);
    this.camera.position.set(
      target.x + radius * Math.sin(phi) * Math.sin(theta),
      target.y + radius * Math.cos(phi),
      target.z + radius * Math.sin(phi) * Math.cos(theta),
    );
    this.camera.lookAt(target);
    this.renderer.render(this.scene, this.camera);
    const projected = new THREE.Vector3();
    for (const { node, position, offset } of this.labels) {
      projected.copy(position).project(this.camera);
      const x = (projected.x * 0.5 + 0.5) * this.width;
      const y = (-projected.y * 0.5 + 0.5) * this.height;
      node.style.transform = `translate(${x}px, ${y}px) ${offset}`;
      node.hidden = projected.z > 1;
    }
  }
}
