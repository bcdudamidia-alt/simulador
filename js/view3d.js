/*
 * view3d.js — Visão 3D da perfuração (Three.js)
 * Corte transversal do terreno: parede de terra texturizada com camadas
 * (estratos), faixa de grama no topo, máquina na superfície e a trajetória do
 * furo descendo como tubo luminoso. Câmera baixa em 3/4, como na referência.
 */
(function () {
  if (typeof THREE === "undefined") {
    console.warn("Three.js não carregou — visão 3D indisponível.");
    return;
  }
  const container = document.getElementById("view3d-container");
  if (!container) return;

  const SOIL = {
    mole:    { base: "#6b4a2c", band: "#5a3d22" },
    medio:   { base: "#5c3f24", band: "#4c331c" },
    rochoso: { base: "#5a544c", band: "#48433d" },
    urbano:  { base: "#5e4a2e", band: "#4e3c24" },
  };

  // ---- Renderer ----
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xbcd2e6, 110, 320);
  scene.background = makeSky();
  function makeSky() {
    const c = document.createElement("canvas"); c.width = 4; c.height = 256;
    const x = c.getContext("2d");
    const g = x.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, "#3f74b0"); g.addColorStop(0.55, "#8fb5d8"); g.addColorStop(1, "#dcebf5");
    x.fillStyle = g; x.fillRect(0, 0, 4, 256);
    return new THREE.CanvasTexture(c);
  }

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1200);

  // ---- Luzes ----
  scene.add(new THREE.HemisphereLight(0xcfe0f0, 0x4a3a28, 0.9));
  const sun = new THREE.DirectionalLight(0xfff1d6, 1.1);
  sun.position.set(40, 70, 50);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -80; sc.right = 80; sc.top = 80; sc.bottom = -80; sc.near = 1; sc.far = 260;
  sun.shadow.bias = -0.0004;
  scene.add(sun);

  // ---- Textura de solo (estratos + ruído) ----
  function soilTexture(soil) {
    const c = document.createElement("canvas"); c.width = 256; c.height = 256;
    const x = c.getContext("2d");
    const g = x.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, soil.base); g.addColorStop(1, "#2a1c10");
    x.fillStyle = g; x.fillRect(0, 0, 256, 256);
    // estratos horizontais
    for (let i = 0; i < 7; i++) {
      const y = 24 + i * 32 + (Math.random() * 6 - 3);
      x.strokeStyle = soil.band; x.globalAlpha = 0.5; x.lineWidth = 2 + Math.random() * 3;
      x.beginPath(); x.moveTo(0, y);
      for (let xx = 0; xx <= 256; xx += 16) x.lineTo(xx, y + Math.sin(xx * 0.05 + i) * 2);
      x.stroke();
    }
    // ruído / pedras
    x.globalAlpha = 1;
    for (let i = 0; i < 700; i++) {
      const r = Math.random() * 1.8;
      x.fillStyle = Math.random() > 0.5 ? "rgba(0,0,0,0.18)" : "rgba(255,230,200,0.10)";
      x.beginPath(); x.arc(Math.random() * 256, Math.random() * 256, r, 0, 6.28); x.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 1.4);
    return t;
  }
  function grassTexture() {
    const c = document.createElement("canvas"); c.width = 128; c.height = 128;
    const x = c.getContext("2d");
    x.fillStyle = "#5f7d42"; x.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 900; i++) {
      x.fillStyle = Math.random() > 0.5 ? "rgba(120,150,80,0.5)" : "rgba(60,90,40,0.5)";
      x.fillRect(Math.random() * 128, Math.random() * 128, 1.5, 3);
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(20, 8);
    return t;
  }

  // ---- Volume de terra (corte) — face frontal (+z) em z=0 ----
  const EARTH_W = 240, EARTH_H = 34, EARTH_D = 50;
  let frontTex = soilTexture(SOIL.mole);
  const plain = new THREE.MeshLambertMaterial({ color: 0x4a3320 });
  const frontMat = new THREE.MeshLambertMaterial({ map: frontTex });
  // ordem das faces do box: +x,-x,+y,-y,+z,-z
  const earth = new THREE.Mesh(
    new THREE.BoxGeometry(EARTH_W, EARTH_H, EARTH_D),
    [plain, plain, plain, plain, frontMat, plain]
  );
  earth.position.set(60, -EARTH_H / 2, -EARTH_D / 2);
  earth.receiveShadow = true;
  scene.add(earth);

  // faixa de grama no topo da parede
  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(EARTH_W, EARTH_D),
    new THREE.MeshLambertMaterial({ map: grassTexture() })
  );
  grass.rotation.x = -Math.PI / 2;
  grass.position.set(60, 0.05, -EARTH_D / 2);
  grass.receiveShadow = true;
  scene.add(grass);

  // linhas de profundidade na face do corte
  for (let d = 10; d <= 30; d += 10) {
    const ln = new THREE.Mesh(
      new THREE.PlaneGeometry(EARTH_W, 0.12),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.10 })
    );
    ln.position.set(60, -d, 0.05);
    scene.add(ln);
  }

  // ---- Máquina (perfuratriz simplificada, mais detalhada) ----
  const rig = new THREE.Group();
  const yellow = new THREE.MeshLambertMaterial({ color: 0xf3a712 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x20262e });
  const steel = new THREE.MeshLambertMaterial({ color: 0x808890 });
  function part(geo, mat, x, y, z, g) {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true; (g || rig).add(m); return m;
  }
  part(new THREE.BoxGeometry(7, 1.4, 1.2), dark, 0, 0.7, -1.1);
  part(new THREE.BoxGeometry(7, 1.4, 1.2), dark, 0, 0.7, 1.1);
  for (let i = -3; i <= 3; i++) { // roletes da esteira
    part(new THREE.CylinderGeometry(0.7, 0.7, 1.3, 12), steel, i * 1, 0.7, -1.1).rotation.x = Math.PI / 2;
    part(new THREE.CylinderGeometry(0.7, 0.7, 1.3, 12), steel, i * 1, 0.7, 1.1).rotation.x = Math.PI / 2;
  }
  part(new THREE.BoxGeometry(5.2, 2.1, 2.8), yellow, -0.6, 2.5, 0);
  part(new THREE.BoxGeometry(2, 1.8, 2.2), dark, 1.9, 3, 0.1); // cabine
  part(new THREE.BoxGeometry(0.5, 1.2, 0.5), steel, -3, 3.6, 0); // escapamento
  const mast = part(new THREE.BoxGeometry(10, 0.6, 1.4), yellow, 3.6, 1.7, 0);
  mast.rotation.z = -Math.PI / 9;
  const carr = part(new THREE.BoxGeometry(1, 1, 1.6), steel, 1.5, 2.6, 0); // carro de avanço
  carr.rotation.z = -Math.PI / 9;
  rig.position.set(-2, 0, -3);
  rig.rotation.y = -0.12;
  scene.add(rig);

  // ---- Elementos de obra ----
  function cone(x, z) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.1, 12),
      new THREE.MeshLambertMaterial({ color: 0xff6a1a }));
    m.position.set(x, 0.55, z); m.castShadow = true; scene.add(m);
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.9),
      new THREE.MeshLambertMaterial({ color: 0x111111 }));
    b.position.set(x, 0.06, z); scene.add(b);
  }
  cone(6, -10); cone(11, -8); cone(3, -13); cone(15, -11);
  // contêiner de apoio
  const cont = new THREE.Mesh(new THREE.BoxGeometry(5, 2.4, 2.4),
    new THREE.MeshLambertMaterial({ color: 0x3a6ea5 }));
  cont.position.set(-12, 1.2, -14); cont.castShadow = true; cont.receiveShadow = true; scene.add(cont);
  // pilha de hastes
  const rack = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 7, 10), steel);
    r.rotation.z = Math.PI / 2; r.position.set(0, 0.35 + (i % 2) * 0.5, (i * 0.55) - 1);
    r.castShadow = true; rack.add(r);
  }
  rack.position.set(-3, 0, -16); scene.add(rack);

  // ---- Trajetória (tubo luminoso) ----
  let tube = null, lastLen = 0;
  const tubeMat = new THREE.MeshStandardMaterial({
    color: 0x36a2ff, emissive: 0x1f78ff, emissiveIntensity: 0.9, roughness: 0.3, metalness: 0.3,
  });
  function rebuildTube() {
    const path = Sim.path;
    if (!path || path.length < 2) return;
    const pts = path.map((p) => new THREE.Vector3(p.x, -p.y, (p.z || 0) + 0.35));
    const curve = new THREE.CatmullRomCurve3(pts);
    const segs = Math.min(800, Math.max(8, path.length));
    const geo = new THREE.TubeGeometry(curve, segs, 0.55, 12, false);
    if (tube) { scene.remove(tube); tube.geometry.dispose(); }
    tube = new THREE.Mesh(geo, tubeMat); tube.renderOrder = 2;
    scene.add(tube);
    lastLen = path.length;
  }

  const head = new THREE.Mesh(
    new THREE.ConeGeometry(0.8, 2, 16),
    new THREE.MeshStandardMaterial({ color: 0xffb01f, metalness: 0.7, roughness: 0.25, emissive: 0x4a3000 })
  );
  head.rotation.z = -Math.PI / 2; head.renderOrder = 3;
  scene.add(head);

  // ---- Órbita (câmera baixa, 3/4) ----
  const orbit = { az: 1.15, el: 0.26, dist: 40, target: new THREE.Vector3(8, -5, 0) };
  let dragging = false, px = 0, py = 0;
  container.addEventListener("mousedown", (e) => { dragging = true; px = e.clientX; py = e.clientY; });
  window.addEventListener("mouseup", () => (dragging = false));
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    orbit.az -= (e.clientX - px) * 0.005;
    orbit.el = clamp(orbit.el + (e.clientY - py) * 0.004, 0.06, 1.0);
    px = e.clientX; py = e.clientY;
  });
  container.addEventListener("wheel", (e) => {
    orbit.dist = clamp(orbit.dist + e.deltaY * 0.05, 16, 130); e.preventDefault();
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
      const s = SOIL[Sim.soil] || SOIL.mole;
      if (earth._soil !== Sim.soil) {
        earth._soil = Sim.soil;
        frontMat.map = soilTexture(s); frontMat.needsUpdate = true;
        plain.color.set(s.band);
      }
      if (Sim.path.length !== lastLen && frame % 4 === 0) rebuildTube();
      head.position.set(Sim.distancia, -Sim.profundidade, (Sim.lateral || 0) + 0.35);
      head.material.color.setHex(Sim.faults && Sim.faults.cabecote_preso ? 0xff4d4d : 0xffb01f);
      orbit.target.x += (Math.max(6, Sim.distancia * 0.5) - orbit.target.x) * 0.04;
      orbit.target.y += (-Math.max(6, Sim.profundidade) * 0.5 - orbit.target.y) * 0.04;
    }
    const cx = orbit.target.x + orbit.dist * Math.cos(orbit.el) * Math.cos(orbit.az);
    const cy = orbit.target.y + orbit.dist * Math.sin(orbit.el);
    const cz = orbit.target.z + orbit.dist * Math.cos(orbit.el) * Math.sin(orbit.az);
    camera.position.set(cx, Math.max(1.5, cy), cz);
    camera.lookAt(orbit.target);
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }
  rebuildTube();
  animate();
})();
