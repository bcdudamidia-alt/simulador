/*
 * view3d.js — Visão 3D da perfuração (Three.js)
 * Renderiza a máquina na superfície, o volume de solo e a trajetória do furo
 * em tempo real, lendo o estado global `Sim`. A câmera segue a broca e o
 * usuário pode orbitar (arrastar) e aproximar (scroll).
 */
(function () {
  if (typeof THREE === "undefined") {
    console.warn("Three.js não carregou — visão 3D indisponível.");
    return;
  }
  const container = document.getElementById("view3d-container");
  if (!container) return;

  const SOIL_COLORS = { mole: 0x4a3420, medio: 0x3f2c1a, rochoso: 0x3a352f, urbano: 0x40331f };

  // ---- Cena ----
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0d121b, 60, 160);

  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1000);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  container.appendChild(renderer.domElement);

  // ---- Luzes ----
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const sun = new THREE.DirectionalLight(0xffffff, 0.9);
  sun.position.set(30, 50, 20);
  scene.add(sun);

  // ---- Céu ----
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(300, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0x1b2a3d, side: THREE.BackSide })
  );
  scene.add(sky);

  // ---- Superfície ----
  const surface = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 60),
    new THREE.MeshLambertMaterial({ color: 0x4c6b3a })
  );
  surface.rotation.x = -Math.PI / 2;
  surface.position.set(40, 0, 0);
  scene.add(surface);

  // ---- Volume de solo (cutaway translúcido) ----
  const soilMat = new THREE.MeshLambertMaterial({
    color: SOIL_COLORS.mole, transparent: true, opacity: 0.35, depthWrite: false,
  });
  const soil = new THREE.Mesh(new THREE.BoxGeometry(120, 30, 60), soilMat);
  soil.position.set(40, -15, 0);
  scene.add(soil);

  // grade de profundidade (plano vertical de referência)
  const gridDepth = new THREE.GridHelper(60, 12, 0x335577, 0x223344);
  gridDepth.rotation.z = Math.PI / 2;
  gridDepth.position.set(40, -15, -30);
  scene.add(gridDepth);

  // ---- Máquina (réplica simplificada da perfuratriz) ----
  const rig = new THREE.Group();
  const yellow = new THREE.MeshLambertMaterial({ color: 0xf5a623 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x222831 });
  // esteira
  const track = new THREE.Mesh(new THREE.BoxGeometry(6, 1.2, 3), dark);
  track.position.y = 0.6; rig.add(track);
  // corpo
  const body = new THREE.Mesh(new THREE.BoxGeometry(4.5, 2, 2.6), yellow);
  body.position.set(-0.5, 2.2, 0); rig.add(body);
  // cabine
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 2), dark);
  cab.position.set(1.6, 2.6, 0); rig.add(cab);
  // lança/rampa de perfuração inclinada ~15°
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(7, 0.4, 1.2), yellow);
  ramp.position.set(3.2, 1.4, 0);
  ramp.rotation.z = -Math.PI / 9;
  rig.add(ramp);
  rig.position.set(-3, 0, 0);
  scene.add(rig);

  // ---- Broca (cabeça de perfuração) ----
  const head = new THREE.Mesh(
    new THREE.ConeGeometry(0.6, 1.6, 12),
    new THREE.MeshLambertMaterial({ color: 0xf5a623 })
  );
  head.rotation.z = -Math.PI / 2;
  scene.add(head);

  // ---- Trajetória (tubo) ----
  let tube = null;
  let lastLen = 0;
  const tubeMat = new THREE.MeshLambertMaterial({ color: 0x2e8bff });

  function rebuildTube() {
    const path = Sim.path;
    if (!path || path.length < 2) return;
    const pts = path.map((p) => new THREE.Vector3(p.x, -p.y, p.z || 0));
    const curve = new THREE.CatmullRomCurve3(pts);
    const segs = Math.min(600, Math.max(8, path.length));
    const geo = new THREE.TubeGeometry(curve, segs, 0.45, 8, false);
    if (tube) { scene.remove(tube); tube.geometry.dispose(); }
    tube = new THREE.Mesh(geo, tubeMat);
    scene.add(tube);
    lastLen = path.length;
  }

  // ---- Órbita simples (mouse / toque) ----
  const orbit = { az: -0.7, el: 0.5, dist: 45, target: new THREE.Vector3(10, -5, 0) };
  let dragging = false, px = 0, py = 0;
  container.addEventListener("mousedown", (e) => { dragging = true; px = e.clientX; py = e.clientY; });
  window.addEventListener("mouseup", () => (dragging = false));
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    orbit.az -= (e.clientX - px) * 0.005;
    orbit.el = clamp(orbit.el + (e.clientY - py) * 0.005, 0.05, 1.4);
    px = e.clientX; py = e.clientY;
  });
  container.addEventListener("wheel", (e) => {
    orbit.dist = clamp(orbit.dist + e.deltaY * 0.05, 12, 110);
    e.preventDefault();
  }, { passive: false });

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // ---- Resize ----
  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  resize();

  // ---- Loop ----
  let frame = 0;
  function animate() {
    frame++;
    if (window.Sim) {
      // cor do solo conforme cenário
      soilMat.color.setHex(SOIL_COLORS[Sim.soil] || SOIL_COLORS.mole);

      // reconstrói o tubo periodicamente conforme o furo avança
      if (Sim.path.length !== lastLen && frame % 4 === 0) rebuildTube();

      // posição da broca
      head.position.set(Sim.distancia, -Sim.profundidade, Sim.lateral || 0);
      head.material.color.setHex(Sim.faults && Sim.faults.cabecote_preso ? 0xef4444 : 0xf5a623);

      // alvo da câmera segue a broca suavemente
      orbit.target.x += (Sim.distancia * 0.6 - orbit.target.x) * 0.04;
      orbit.target.y += (-Sim.profundidade * 0.6 - orbit.target.y) * 0.04;
    }

    // posiciona a câmera em órbita ao redor do alvo
    const cx = orbit.target.x + orbit.dist * Math.cos(orbit.el) * Math.cos(orbit.az);
    const cy = orbit.target.y + orbit.dist * Math.sin(orbit.el);
    const cz = orbit.target.z + orbit.dist * Math.cos(orbit.el) * Math.sin(orbit.az);
    camera.position.set(cx, cy, cz);
    camera.lookAt(orbit.target);

    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }
  rebuildTube();
  animate();
})();
