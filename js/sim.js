/*
 * sim.js
 * Loop principal da simulação de perfuração horizontal direcional (HDD).
 * Modelo físico simplificado, suficiente para treino de coordenação dos comandos.
 */
(function () {
  // ----- Estado da máquina -----
  const sim = {
    // medidores
    pressao: 0, torque: 0, rotacao: 0, fluido: 0, forca: 0,
    // navegação
    barra: 0,        // comprimento perfurado (m)
    distancia: 0,    // distância horizontal (m)
    profundidade: 0, // profundidade atual (m)
    inclinacao: 0,   // % de inclinação (negativo = descendo)
    azimute: 0,      // graus
    // caminho (perfil): pares {x: dist horizontal, y: profundidade}
    path: [{ x: 0, y: 0 }],
    // operação
    modos: ["PERFURAÇÃO", "ALARGAMENTO", "PUXO DE TUBO"],
    modoIdx: 0,
    grampo: true,
    estop: false,
    // desempenho
    tempo: 0,
    penalidades: 0,
    eventos: 0,
    overpressure: 0,
  };

  const boreCv = document.getElementById("bore-canvas");
  const boreCtx = boreCv.getContext("2d");

  let last = performance.now();

  function update(dt) {
    const inp = Input.poll();
    sim.estop = inp.estop;
    sim.grampo = inp.clamp;
    if (inp._modeEdge) sim.modoIdx = (sim.modoIdx + 1) % sim.modos.length;

    // Parada de emergência zera tudo gradualmente
    if (sim.estop) {
      decayAll();
      commitMeters();
      return;
    }

    sim.tempo += dt;

    // Rotação da coluna (rpm) acompanha o gatilho de rotação
    const targetRot = inp.rotation * 110; // até ~110 rpm
    sim.rotacao = approach(sim.rotacao, targetRot, dt * 120);

    // Fluxo de fluido (l/min)
    const targetFlow = inp.flow * 380;
    sim.fluido = approach(sim.fluido, targetFlow, dt * 400);

    // Empuxo gera força (kN). Só avança o furo com grampo fechado.
    const thrust = inp.thrust; // -1..1
    const targetForca = Math.abs(thrust) * 190;
    sim.forca = approach(sim.forca, targetForca, dt * 200);

    // Torque depende de rotação e força aplicada
    sim.torque = clamp((sim.rotacao / 110) * 40 + (sim.forca / 190) * 50, 0, 100);

    // Pressão hidráulica: sobe com empuxo e torque, alivia com fluido adequado
    const fluidoIdeal = sim.rotacao > 5 ? 0.6 : 0.2; // fração do máximo desejada
    const fluidoFrac = sim.fluido / 380;
    const faltaFluido = Math.max(0, fluidoIdeal - fluidoFrac);
    const targetPressao = 60 + (sim.forca / 190) * 140 + faltaFluido * 200;
    sim.pressao = approach(sim.pressao, targetPressao, dt * 150);

    // Avanço do furo (só perfura para frente com rotação + grampo fechado)
    let avanco = 0;
    if (sim.grampo && thrust > 0.05 && sim.rotacao > 5) {
      avanco = thrust * 0.6 * dt; // m/s
    } else if (sim.grampo && thrust < -0.05) {
      avanco = thrust * 0.4 * dt; // puxo (recua)
    }

    if (Math.abs(avanco) > 1e-6) {
      // direção (azimute) ajustada pelo analógico direito
      sim.azimute = clamp(sim.azimute + inp.steer * 8 * dt, -45, 45);
      // inclinação alvo: a direção vertical é controlada pelo mesmo empuxo (descida natural)
      const inclTarget = -2 - sim.azimute * 0.05; // % descendo
      sim.inclinacao = approach(sim.inclinacao, inclTarget, dt * 2);

      sim.barra += Math.abs(avanco);
      sim.distancia += avanco * Math.cos((sim.azimute * Math.PI) / 180);
      sim.profundidade = clamp(
        sim.profundidade - (sim.inclinacao / 100) * avanco * 10,
        0, 30
      );
      sim.path.push({ x: sim.distancia, y: sim.profundidade });
      if (sim.path.length > 4000) sim.path.shift();
    }

    // ----- Eventos / penalidades de segurança -----
    if (sim.pressao > 255) {
      sim.overpressure += dt;
      sim.penalidades += dt * 4;
    }
    if (sim.forca > 175 && sim.fluido < 100) {
      sim.penalidades += dt * 5; // risco de travamento por falta de fluido
    }
    if (sim.rotacao > 100 && sim.torque > 90) {
      sim.penalidades += dt * 3;
    }

    commitMeters();
  }

  function decayAll() {
    sim.rotacao = approach(sim.rotacao, 0, 0.05 * 120);
    sim.fluido = approach(sim.fluido, 0, 0.05 * 400);
    sim.forca = approach(sim.forca, 0, 0.05 * 200);
    sim.torque = approach(sim.torque, 0, 0.05 * 100);
    sim.pressao = approach(sim.pressao, 0, 0.05 * 150);
  }

  function commitMeters() {
    Gauges.set("pressao", sim.pressao);
    Gauges.set("torque", sim.torque);
    Gauges.set("rotacao", sim.rotacao);
    Gauges.set("fluido", sim.fluido);
    Gauges.set("forca", sim.forca);
  }

  // ----- Desenho do perfil do furo -----
  function drawBore() {
    const w = boreCv.width, h = boreCv.height;
    const groundY = 70;
    boreCtx.clearRect(0, 0, w, h);

    // céu
    const sky = boreCtx.createLinearGradient(0, 0, 0, groundY);
    sky.addColorStop(0, "#1b2a3d");
    sky.addColorStop(1, "#243748");
    boreCtx.fillStyle = sky;
    boreCtx.fillRect(0, 0, w, groundY);

    // solo
    const soil = boreCtx.createLinearGradient(0, groundY, 0, h);
    soil.addColorStop(0, "#3a2a1c");
    soil.addColorStop(1, "#241a12");
    boreCtx.fillStyle = soil;
    boreCtx.fillRect(0, groundY, w, h - groundY);

    // linha do solo
    boreCtx.strokeStyle = "#5a4632";
    boreCtx.lineWidth = 2;
    boreCtx.beginPath();
    boreCtx.moveTo(0, groundY);
    boreCtx.lineTo(w, groundY);
    boreCtx.stroke();

    // grade de profundidade
    boreCtx.strokeStyle = "rgba(255,255,255,0.05)";
    boreCtx.lineWidth = 1;
    boreCtx.fillStyle = "#8a97a8";
    boreCtx.font = "10px Segoe UI";
    for (let d = 5; d <= 30; d += 5) {
      const y = groundY + (d / 30) * (h - groundY - 10);
      boreCtx.beginPath();
      boreCtx.moveTo(0, y);
      boreCtx.lineTo(w, y);
      boreCtx.stroke();
      boreCtx.fillText(d + " m", 4, y - 2);
    }

    // escala horizontal dinâmica
    const maxDist = Math.max(40, sim.distancia + 10);
    const sx = (w - 40) / maxDist;
    const sy = (h - groundY - 10) / 30;

    // caminho perfurado
    boreCtx.strokeStyle = "#2e8bff";
    boreCtx.lineWidth = 3;
    boreCtx.beginPath();
    sim.path.forEach((p, i) => {
      const x = 20 + p.x * sx;
      const y = groundY + p.y * sy;
      if (i === 0) boreCtx.moveTo(x, y);
      else boreCtx.lineTo(x, y);
    });
    boreCtx.stroke();

    // cabeça de perfuração (broca)
    const headX = 20 + sim.distancia * sx;
    const headY = groundY + sim.profundidade * sy;
    boreCtx.fillStyle = "#f5a623";
    boreCtx.beginPath();
    boreCtx.arc(headX, headY, 7, 0, Math.PI * 2);
    boreCtx.fill();
    boreCtx.fillStyle = "#fff";
    boreCtx.font = "10px Segoe UI";
    boreCtx.fillText("BROCA", headX + 10, headY + 3);

    // máquina na superfície
    boreCtx.fillStyle = "#f5a623";
    boreCtx.fillRect(8, groundY - 22, 34, 20);
    boreCtx.fillStyle = "#0a0e14";
    boreCtx.fillRect(30, groundY - 18, 10, 8);
  }

  // ----- HUD / textos -----
  function render() {
    Gauges.render();
    drawBore();

    setText("mode-text", sim.modos[sim.modoIdx]);
    setText("time-text", fmtTime(sim.tempo));

    // controle conectado
    const gpBadge = document.getElementById("gamepad-badge");
    const gpText = document.getElementById("gamepad-text");
    if (Input.state.connected) {
      gpBadge.className = "badge gp-on";
      gpText.textContent = "CONECTADO";
    } else {
      gpBadge.className = "badge gp-off";
      gpText.textContent = "TECLADO";
    }

    // navegação
    setText("nav-incl", sim.inclinacao.toFixed(1) + " %");
    setText("nav-azim", sim.azimute.toFixed(1) + "°");
    setText("nav-depth", sim.profundidade.toFixed(1) + " m");
    setText("nav-dist", sim.distancia.toFixed(1) + " m");
    setText("nav-bar", sim.barra.toFixed(2) + " m");

    // barras de controle
    setBar("bar-rotacao", (sim.rotacao / 110) * 100);
    setBarCenter("bar-empuxo", Input.state.thrust);
    setBar("bar-fluxo", (sim.fluido / 380) * 100);
    setBarCenter("bar-direcao", Input.state.steer);

    // toggles
    toggle("tg-grampo", sim.grampo, sim.grampo ? "FECHADO" : "ABERTO");
    toggle("tg-modo", true, sim.modos[sim.modoIdx]);
    const estopEl = document.getElementById("tg-estop");
    estopEl.classList.toggle("tripped", sim.estop);
    estopEl.querySelector("em").textContent = sim.estop ? "ACIONADA" : "OK";

    // alertas
    renderAlerts();

    // relatório
    renderReport();
  }

  function renderAlerts() {
    const el = document.getElementById("alerts");
    const a = [];
    if (sim.pressao > 255) a.push("PRESSÃO ALTA");
    if (sim.forca > 175 && sim.fluido < 100) a.push("FALTA DE FLUIDO");
    if (sim.torque > 90) a.push("TORQUE EXCESSIVO");
    if (sim.estop) a.push("PARADA DE EMERGÊNCIA");
    el.innerHTML = a.map((t) => `<span class="alert">⚠ ${t}</span>`).join("");
  }

  function renderReport() {
    // pontuação cai com penalidades acumuladas
    const score = Math.max(0, Math.round(100 - sim.penalidades));
    setText("score-num", score);
    const ring = document.getElementById("score-ring");
    const deg = (score / 100) * 360;
    const col = score > 80 ? "#36d399" : score > 50 ? "#f5a623" : "#ef4444";
    ring.style.background = `conic-gradient(${col} ${deg}deg, var(--line) ${deg}deg)`;

    const precisao = stars(Math.max(0, 5 - sim.overpressure / 3));
    const tempo = stars(sim.barra > 0 ? clamp(5 - sim.tempo / Math.max(1, sim.barra * 8), 0, 5) : 0);
    const fluidoStars = stars(clamp(5 - sim.penalidades / 10, 0, 5));
    const seg = stars(clamp(5 - sim.penalidades / 5, 0, 5));

    document.getElementById("report-list").innerHTML = `
      <li><span>Precisão de Perfuração</span><span class="stars">${precisao}</span></li>
      <li><span>Tempo de Execução</span><span class="stars">${tempo}</span></li>
      <li><span>Consumo de Fluido</span><span class="stars">${fluidoStars}</span></li>
      <li><span>Segurança na Operação</span><span class="stars">${seg}</span></li>
    `;
  }

  // ----- utilidades -----
  function approach(v, target, step) {
    if (v < target) return Math.min(target, v + step);
    if (v > target) return Math.max(target, v - step);
    return v;
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function setText(id, t) { document.getElementById(id).textContent = t; }
  function setBar(id, pct) { document.getElementById(id).style.width = clamp(pct, 0, 100) + "%"; }
  function setBarCenter(id, v) {
    // v vai de -1 a 1, barra cresce a partir do centro
    const el = document.getElementById(id);
    const pct = Math.abs(v) * 50;
    el.style.width = pct + "%";
    el.style.left = v >= 0 ? "50%" : 50 - pct + "%";
  }
  function toggle(id, active, text) {
    const el = document.getElementById(id);
    el.classList.toggle("active", !!active);
    el.querySelector("em").textContent = text;
  }
  function stars(n) {
    const full = Math.round(clamp(n, 0, 5));
    return "★".repeat(full) + "☆".repeat(5 - full);
  }
  function fmtTime(s) {
    const h = String(Math.floor(s / 3600)).padStart(2, "0");
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
    const sec = String(Math.floor(s % 60)).padStart(2, "0");
    return `${h}:${m}:${sec}`;
  }

  // ----- loop -----
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    render();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
