/*
 * view3d.js — Visão 3D da perfuração (Three.js)
 * Cena realista: céu em gradiente, terreno gramado, corte do solo (parede de
 * terra) com a trajetória do furo descendo, sombras, máquina detalhada e
 * elementos de obra. Lê o estado global `Sim`. Câmera orbitável segue a broca.
 */
(function () {
  if (typeof THREE === "undefined") {
    console.warn("Three.js não carregou — visão 3D indisponível.");
    return;
  }
  const container = document.getElementById("view3d-container");
  if (!container) return;

  const EARTH_COLORS = { mole: 0x6b4a2c, medio: 0x5c3f24, rochoso: 0x55504a, urbano: 0x5e4a2e };

  // ---- Renderer ----
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xaac4dd, 90, 230);

  // céu em gradiente (textura de canvas)
  scene.background = makeSky();
  function makeSky() {
    const c = document.createElement("canvas");
    c.width = 4; c.height = 256;
    const x = c.getContext("2d");
    const g = x.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, "#3f74b0");
    g.addColorStop(0.55, "#8db4d8");
    g.addColorStop(1, "#d7e6f2");
    x.fillStyle = g; x.fillRect(0, 0, 4, 256);
    return new THREE.CanvasTexture(c);
  }

  const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 1000);

  // ---- Luzes ----
  scene.add(new THREE.HemisphereLight(0xbfd4ec, 0x4a3a28, 0.85));
  const sun = new THREE.DirectionalLight(0xfff2d8, 1.15);
  sun.position.set(35, 55, 30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.near = 1; sc.far = 200;
  sun.shadow.bias = -0.0003;
  scene.add(sun);

  // ---- Terreno gramado (foreground, z > 0) ----
  const grassMat = new THREE.MeshLambertMaterial({ color: 0x5f7d42 });
  const field = new THREE.Mesh(new THREE.PlaneGeometry(200, 80), grassMat);
  field.rotation.x = -Math.PI / 2;
  field.position.set(40, 0.02, 25);
  field.receiveShadow = true;
  scene.add(field);

  // área de terra batida em volta da máquina
  const dirtMat = new THREE.MeshLambertMaterial({ color: 0x7a5a38 });
  const dirt = new THREE.Mesh(new THREE.CircleGeometry(14, 32), dirtMat);
  dirt.rotation.x = -Math.PI / 2;
  dirt.position.set(2, 0.03, 6);
  dirt.receiveShadow = true;
  scene.add(dirt);

  // ---- Corte do solo (parede de terra atrás da trajetória) ----
  const earthMat = new THREE.MeshLambertMaterial({ color: EARTH_COLORS.mole });
  const EARTH_W = 200, EARTH_H = 34, EARTH_D = 40;
  const earth = new THREE.Mesh(new THREE.BoxGeometry(EARTH_W, EARTH_H, EARTH_D), earthMat);
  earth.position.set(40, -EARTH_H / 2, -EARTH_D / 2); // topo em y=0, face frontal em z=0
  earth.receiveShadow = true;
  scene.add(earth);

  // faixa de grama no topo da parede de terra
  const topStrip = new THREE.Mesh(new THREE.PlaneGeometry(EARTH_W, EARTH_D), grassMat);
  topStrip.rotation.x = -Math.PI / 2;
  topStrip.position.set(40, 0.04, -EARTH_D / 2);
  topStrip.receiveShadow = true;
  scene.add(topStrip);

  // camadas de estratos na face do corte
  for (let i = 1; i <= 3; i++) {
    const strat = new THREE.Mesh(
      new THREE.PlaneGeometry(EARTH_W, 0.25),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.12 })
    );
    strat.position.set(40, -i * 8, 0.02);
    scene.add(strat);
  }
  // linhas de grade verticais na profundidade (referência)
  const depthLabels = new THREE.GridHelper(EARTH_W, 20, 0x000000, 0x000000);
  depthLabels.material.opacity = 0.06; depthLabels.material.transparent = true;
  depthLabels.position.set(40, 0.05, -EARTH_D / 2);
  scene.add(depthLabels);

  // ---- Máquina (perfuratriz simplificada) ----
  const rig = new THREE.Group();
  const yellow = new THREE.MeshLambertMaterial({ color: 0xf3a712 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x20262e });
  const steel = new THREE.MeshLambertMaterial({ color: 0x707880 });
  function addPart(geo, mat, x, y, z, group) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
    (group || rig).add(m); return m;
  }
  addPart(new THREE.BoxGeometry(6.4, 1.3, 1.1), dark, 0, 0.65, -0.9); // esteira esq
  addPart(new THREE.BoxGeometry(6.4, 1.3, 1.1), dark, 0, 0.65, 0.9);  // esteira dir
  addPart(new THREE.BoxGeometry(5, 2, 2.6), yellow, -0.5, 2.3, 0);    // corpo
  addPart(new THREE.BoxGeometry(1.8, 1.7, 2.1), dark, 1.7, 2.8, 0);   // cabine
  const mast = addPart(new THREE.BoxGeometry(9, 0.5, 1.3), yellow, 3.2, 1.6, 0); // lança
  mast.rotation.z = -Math.PI / 9;
  addPart(new THREE.CylinderGeometry(0.18, 0.18, 9, 8), steel, 3.2, 1.6, 0).rotation.z = Math.PI / 2 - Math.PI / 9; // trilho
  rig.position.set(-4, 0, 5);
  rig.rotation.y = -0.18;
  scene.add(rig);

  // ---- Elementos de obra ----
  function cone(x, z) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1, 12),
      new THREE.MeshLambertMaterial({ color: 0xff6a1a }));
    m.position.set(x, 0.5, z); m.castShadow = true; scene.add(m);
  }
  cone(8, 9); cone(12, 6); cone(6, 11); cone(16, 8);
  // pilha de hastes
  const rack = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 6, 10), steel);
    r.rotation.z = Math.PI / 2; r.position.set(0, 0.3 + (i % 2) * 0.45, (i * 0.5) - 0.7);
    r.castShadow = true; rack.add(r);
  }
  rack.position.set(-6, 0, 12); scene.add(rack);

  // ---- Trajetória (tubo) ----
  let tube = null, lastLen = 0;
  const tubeMat = new THREE.MeshStandardMaterial({
    color: 0x2f93ff, emissive: 0x12407a, emissiveIntensity: 0.6, roughness: 0.35, metalness: 0.4,
  });
  function rebuildTube() {
    const path = Sim.path;
    if (!path || path.length < 2) return;
    const pts = path.map((p) => new THREE.Vector3(p.x, -p.y, (p.z || 0) + 0.4));
    const curve = new THREE.CatmullRomCurve3(pts);
    const segs = Math.min(700, Math.max(8, path.length));
    const geo = new THREE.TubeGeometry(curve, segs, 0.5, 10, false);
    if (tube) { scene.remove(tube); tube.geometry.dispose(); }
    tube = new THREE.Mesh(geo, tubeMat);
    tube.castShadow = true;
    scene.add(tube);
    lastLen = path.length;
  }

  // ---- Broca ----
  const head = new THREE.Mesh(
    new THREE.ConeGeometry(0.7, 1.8, 14),
    new THREE.MeshStandardMaterial({ color: 0xffb01f, metalness: 0.6, roughness: 0.3, emissive: 0x3a2600 })
  );
  head.rotation.z = -Math.PI / 2; head.castShadow = true;
  scene.add(head);

  // ---- Órbita ----
  const orbit = { az: 2.2, el: 0.5, dist: 42, target: new THREE.Vector3(12, -6, 0) };
  let dragging = false, px = 0, py = 0;
  container.addEventListener("mousedown", (e) => { dragging = true; px = e.clientX; py = e.clientY; });
  window.addEventListener("mouseup", () => (dragging = false));
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    orbit.az -= (e.clientX - px) * 0.005;
    orbit.el = clamp(orbit.el + (e.clientY - py) * 0.005, 0.08, 1.3);
    px = e.clientX; py = e.clientY;
  });
  container.addEventListener("wheel", (e) => {
    orbit.dist = clamp(orbit.dist + e.deltaY * 0.05, 14, 120);
    e.preventDefault();
  }, { passive: false });
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize); resize();

  let frame = 0;
  function animate() {
    frame++;
    if (window.Sim) {
      earthMat.color.setHex(EARTH_COLORS[Sim.soil] || EARTH_COLORS.mole);
      if (Sim.path.length !== lastLen && frame % 4 === 0) rebuildTube();
      head.position.set(Sim.distancia, -Sim.profundidade, (Sim.lateral || 0) + 0.4);
      head.material.color.setHex(Sim.faults && Sim.faults.cabecote_preso ? 0xff4d4d : 0xffb01f);
      orbit.target.x += (Math.max(8, Sim.distancia * 0.55) - orbit.target.x) * 0.04;
      orbit.target.y += (-Sim.profundidade * 0.55 - orbit.target.y) * 0.04;
    }
    const cx = orbit.target.x + orbit.dist * Math.cos(orbit.el) * Math.cos(orbit.az);
    const cy = orbit.target.y + orbit.dist * Math.sin(orbit.el);
    const cz = orbit.target.z + orbit.dist * Math.cos(orbit.el) * Math.sin(orbit.az);
    camera.position.set(cx, Math.max(2, cy), cz);
    camera.lookAt(orbit.target);
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }
  rebuildTube();
  animate();
})();
