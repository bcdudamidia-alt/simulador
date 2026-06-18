/*
 * sim.js — simulação da perfuratriz XCMG XZ200 (HDD)
 * Modelo calibrado pelos limites de referência do guia operacional:
 *   Força empurra/puxa ~225 kN | Rotação 0–150 rpm | Torque máx ~6350 N·m
 *   Vazão de lama até 250 L/min | Pressão de lama até 80 bar | Haste 60mm x 3 m
 */
(function () {
  // ----- Limites de referência (XZ200) -----
  const MAX = { forca: 225, rotacao: 150, vazao: 250, pressaoLama: 80, torque: 6350 };
  const ROD_LEN = 3; // comprimento da haste (m)

  // ----- Perfis de solo (afetam física e risco) -----
  const SOLOS = {
    mole:    { nome: "SOLO MOLE",   avanco: 1.2, resist: 0.5, lama: 0.4, redes: false },
    medio:   { nome: "SOLO MÉDIO",  avanco: 0.8, resist: 1.0, lama: 0.6, redes: false },
    rochoso: { nome: "SOLO ROCHOSO",avanco: 0.4, resist: 1.9, lama: 0.8, redes: false },
    urbano:  { nome: "ZONA URBANA", avanco: 0.7, resist: 1.1, lama: 0.7, redes: true },
  };

  // ----- Definições de falha (baseadas na seção 9 do guia) -----
  const FAULT_DEFS = {
    pressao_lama: {
      nome: "PRESSÃO DE LAMA ALTA",
      causa: "Bico entupido, solo fechando o furo ou fluido insuficiente.",
      acao: "Reduza o avanço e aumente o fluxo de lama.",
      resolve: () => sim.pressaoLama < 55 && Input.state.thrust < 0.4,
    },
    cabecote_preso: {
      nome: "CABEÇOTE PRESO",
      causa: "Solo duro, falta de fluido ou torque excessivo.",
      acao: "Não force o torque. Reduza o empuxo e retraia com cuidado.",
      resolve: () => Input.state.thrust <= 0.05,
    },
    pouco_retorno: {
      nome: "POUCO RETORNO DE LAMA",
      causa: "Perda de circulação / solo absorvendo o fluido.",
      acao: "Reduza o avanço e ajuste a mistura de lama.",
      resolve: () => Input.state.thrust < 0.3 && sim.vazao > 120,
    },
    perda_sonda: {
      nome: "PERDA DE SINAL DA SONDA",
      causa: "Interferência, bateria da sonda ou profundidade.",
      acao: "Pare o avanço até recuperar a localização confiável.",
      resolve: () => Math.abs(Input.state.thrust) < 0.05,
    },
    contato_rede: {
      nome: "CONTATO COM REDE SUBTERRÂNEA",
      causa: "A ferramenta atingiu rede de energia/gás/água.",
      acao: "ACIONE A PARADA DE EMERGÊNCIA e isole a área imediatamente.",
      resolve: () => sim.estop,
      critical: true,
    },
  };

  const sim = {
    pressaoLama: 0, torque: 0, rotacao: 0, vazao: 0, forca: 0,
    barra: 0, distancia: 0, profundidade: 0, inclinacao: 0, azimute: 0,
    lateral: 0,
    path: [{ x: 0, y: 0, z: 0 }],
    modos: ["FURO PILOTO", "ALARGAMENTO", "RETROARRASTO"],
    modoIdx: 0,
    grampo: true,
    estop: false,
    soil: "mole",
    rods: 1,
    needRod: false,
    faults: {},          // id -> { since }
    tempo: 0,
    penalidades: 0,
    overpressure: 0,
  };

  const boreCv = document.getElementById("bore-canvas");
  const boreCtx = boreCv.getContext("2d");
  const eventLog = []; // mensagens de evento (texto, ts)
  let last = performance.now();

  // ---------------- ENTRADA DE UI ----------------
  document.querySelectorAll(".soil-btn").forEach((b) => {
    b.addEventListener("click", () => {
      document.querySelectorAll(".soil-btn").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      sim.soil = b.dataset.soil;
      logEvent("Cenário alterado para " + SOLOS[sim.soil].nome);
    });
  });

  document.getElementById("btn-add-rod").addEventListener("click", addRod);
  document.getElementById("btn-fault").addEventListener("click", simulateFault);

  function addRod() {
    const btn = document.getElementById("btn-add-rod");
    if (sim.rotacao > 10 || Math.abs(Input.state.thrust) > 0.1) {
      logEvent("⚠ Pare a rotação e o empuxo (zere os dois) antes de adicionar a haste.");
      sim.penalidades += 3;
      flashBtn(btn, "flash-err");
      return;
    }
    sim.rods += 1;
    sim.needRod = false;
    logEvent("✅ Haste adicionada. Total: " + sim.rods + " (" + (sim.rods * ROD_LEN).toFixed(1) + " m)");
    flashBtn(btn, "flash-ok");
  }

  function flashBtn(el, cls) {
    el.classList.remove("flash-ok", "flash-err");
    void el.offsetWidth; // reinicia a animação
    el.classList.add(cls);
  }

  function simulateFault() {
    const ids = Object.keys(FAULT_DEFS).filter((id) => {
      if (id === "contato_rede") return SOLOS[sim.soil].redes;
      return true;
    });
    const id = ids[Math.floor(Math.random() * ids.length)];
    activateFault(id);
  }

  function activateFault(id) {
    if (sim.faults[id]) return;
    sim.faults[id] = { since: sim.tempo };
    logEvent("⚠ FALHA: " + FAULT_DEFS[id].nome + " — " + FAULT_DEFS[id].acao);
  }

  function logEvent(text) {
    eventLog.unshift({ text, t: sim.tempo });
    if (eventLog.length > 8) eventLog.pop();
  }

  // ---------------- LOOP ----------------
  function update(dt) {
    const inp = Input.poll();
    sim.estop = inp.estop;
    sim.grampo = inp.clamp;
    if (inp._modeEdge) {
      sim.modoIdx = (sim.modoIdx + 1) % sim.modos.length;
      logEvent("Modo: " + sim.modos[sim.modoIdx]);
    }

    if (sim.estop) { decayAll(); resolveFaults(); commitMeters(); sim.tempo += dt; return; }
    sim.tempo += dt;

    const solo = SOLOS[sim.soil];

    // Rotação e vazão acompanham os comandos
    sim.rotacao = approach(sim.rotacao, inp.rotation * MAX.rotacao, dt * 160);
    sim.vazao = approach(sim.vazao, inp.flow * MAX.vazao, dt * 280);

    // Força de empuxo
    const thrust = inp.thrust;
    sim.forca = approach(sim.forca, Math.abs(thrust) * MAX.forca, dt * 240);

    // Torque depende de rotação, força e resistência do solo
    const torqueAlvo =
      (sim.rotacao / MAX.rotacao) * 2200 +
      (sim.forca / MAX.forca) * 3800 * solo.resist;
    sim.torque = approach(sim.torque, clamp(torqueAlvo, 0, MAX.torque + 200), dt * 8000);

    // Pressão de lama: sobe com avanço/resistência e quando há pouco fluido
    const vazaoFrac = sim.vazao / MAX.vazao;
    const vazaoIdeal = sim.rotacao > 5 ? solo.lama : 0.15;
    const faltaLama = Math.max(0, vazaoIdeal - vazaoFrac);
    const pAlvo = 8 + (sim.forca / MAX.forca) * 40 * solo.resist + faltaLama * 70;
    sim.pressaoLama = approach(sim.pressaoLama, clamp(pAlvo, 0, 95), dt * 60);

    // Avanço do furo (bloqueado se faltar haste ou houver falha de bloqueio)
    sim.needRod = sim.barra >= sim.rods * ROD_LEN - 0.02;
    const bloqueado = sim.faults.cabecote_preso;
    let avanco = 0;
    if (sim.grampo && !sim.needRod && !bloqueado && thrust > 0.05 && sim.rotacao > 5) {
      avanco = thrust * 0.45 * solo.avanco * dt;
    } else if (sim.grampo && thrust < -0.05) {
      avanco = thrust * 0.4 * dt; // puxo / retorno
    }

    if (Math.abs(avanco) > 1e-6) {
      sim.azimute = clamp(sim.azimute + inp.steer * 8 * dt, -45, 45);
      const inclTarget = -2 - sim.azimute * 0.05;
      sim.inclinacao = approach(sim.inclinacao, inclTarget, dt * 2);
      const rad = (sim.azimute * Math.PI) / 180;
      sim.barra = Math.max(0, sim.barra + avanco);
      sim.distancia = Math.max(0, sim.distancia + avanco * Math.cos(rad));
      sim.lateral += avanco * Math.sin(rad);
      sim.profundidade = clamp(sim.profundidade - (sim.inclinacao / 100) * avanco * 10, 0, 30);
      sim.path.push({ x: sim.distancia, y: sim.profundidade, z: sim.lateral });
      if (sim.path.length > 4000) sim.path.shift();
    }

    evaluateFaults(dt, solo);
    commitMeters();
  }

  // Dispara/avalia falhas automáticas conforme condições da operação
  function evaluateFaults(dt, solo) {
    if (sim.pressaoLama > 72) activateFault("pressao_lama");
    if (sim.torque > MAX.torque * 0.92 && sim.vazao < 80) activateFault("cabecote_preso");
    if (sim.forca > MAX.forca * 0.8 && sim.vazao < 60 && Input.state.thrust > 0.3) activateFault("pouco_retorno");
    // contato com rede: chance baixa ao perfurar em zona urbana
    if (solo.redes && Input.state.thrust > 0.1 && Math.random() < 0.0008) activateFault("contato_rede");

    // penalidades enquanto falhas estão ativas
    for (const id in sim.faults) {
      sim.penalidades += dt * (FAULT_DEFS[id].critical ? 12 : 3);
    }
    if (sim.pressaoLama > 75) sim.overpressure += dt;
    resolveFaults();
  }

  function resolveFaults() {
    for (const id in sim.faults) {
      if (FAULT_DEFS[id].resolve()) {
        delete sim.faults[id];
        logEvent("✅ Resolvida: " + FAULT_DEFS[id].nome);
      }
    }
  }

  function decayAll() {
    sim.rotacao = approach(sim.rotacao, 0, 6);
    sim.vazao = approach(sim.vazao, 0, 14);
    sim.forca = approach(sim.forca, 0, 10);
    sim.torque = approach(sim.torque, 0, 400);
    sim.pressaoLama = approach(sim.pressaoLama, 0, 4);
  }

  function commitMeters() {
    Gauges.set("pressao", sim.pressaoLama);
    Gauges.set("torque", sim.torque);
    Gauges.set("rotacao", sim.rotacao);
    Gauges.set("fluido", sim.vazao);
    Gauges.set("forca", sim.forca);
  }

  // ---------------- PAINEL DE NAVEGAÇÃO (gráfico técnico) ----------------
  function lerpColor(a, b, t) {
    const ah = parseInt(a.slice(1), 16), bh = parseInt(b.slice(1), 16);
    const ar = ah >> 16, ag = (ah >> 8) & 255, ab = ah & 255;
    const br = bh >> 16, bg = (bh >> 8) & 255, bb = bh & 255;
    const r = Math.round(ar + (br - ar) * t), g = Math.round(ag + (bg - ag) * t), bl = Math.round(ab + (bb - ab) * t);
    return `rgb(${r},${g},${bl})`;
  }
  function depthColor(f) {
    return f < 0.5 ? lerpColor("#2fe0a0", "#ffb01f", f / 0.5) : lerpColor("#ffb01f", "#ff4d4d", (f - 0.5) / 0.5);
  }

  function drawBore() {
    const w = boreCv.width, h = boreCv.height;
    const ml = 12, mt = 26, mr = 48, mb = 14;
    const plotW = w - ml - mr, plotH = h - mt - mb;
    const maxDepth = 30;
    const maxDist = Math.max(60, Math.ceil((sim.distancia + 12) / 20) * 20);
    const mapX = (d) => ml + (d / maxDist) * plotW;
    const mapY = (z) => mt + (z / maxDepth) * plotH;

    boreCtx.clearRect(0, 0, w, h);
    // fundo do gráfico
    boreCtx.fillStyle = "#070b11";
    roundRect(boreCtx, ml, mt, plotW, plotH, 6); boreCtx.fill();

    // grade
    boreCtx.font = "600 10px 'JetBrains Mono', monospace";
    boreCtx.textAlign = "center";
    for (let d = 0; d <= maxDist; d += 20) {
      const x = mapX(d);
      boreCtx.strokeStyle = "rgba(120,150,180,0.10)"; boreCtx.lineWidth = 1;
      boreCtx.beginPath(); boreCtx.moveTo(x, mt); boreCtx.lineTo(x, mt + plotH); boreCtx.stroke();
      boreCtx.fillStyle = "#5d6b7d";
      boreCtx.fillText(d, x, mt - 9);
    }
    boreCtx.textAlign = "left";
    for (let z = 0; z <= maxDepth; z += 5) {
      const y = mapY(z);
      const major = z % 10 === 0;
      boreCtx.strokeStyle = major ? "rgba(120,150,180,0.14)" : "rgba(120,150,180,0.06)"; boreCtx.lineWidth = 1;
      boreCtx.beginPath(); boreCtx.moveTo(ml, y); boreCtx.lineTo(ml + plotW, y); boreCtx.stroke();
      if (major) {
        boreCtx.fillStyle = "#5d6b7d";
        boreCtx.fillText((z === 0 ? "0" : "−" + z) + " m", ml + plotW + 6, y + 3);
      }
    }
    // títulos dos eixos
    boreCtx.fillStyle = "#8595a8";
    boreCtx.font = "600 9px 'Rajdhani', sans-serif";
    boreCtx.textAlign = "left"; boreCtx.fillText("DISTÂNCIA (m)", ml, 11);
    boreCtx.textAlign = "right"; boreCtx.fillText("PROF.", w - 4, 11);

    // linha de superfície
    boreCtx.strokeStyle = "rgba(76,107,58,0.9)"; boreCtx.lineWidth = 2;
    boreCtx.beginPath(); boreCtx.moveTo(ml, mapY(0)); boreCtx.lineTo(ml + plotW, mapY(0)); boreCtx.stroke();

    // trajetória de projeto (referência) — entrada e nível alvo
    boreCtx.setLineDash([5, 5]);
    boreCtx.strokeStyle = "rgba(140,160,185,0.35)"; boreCtx.lineWidth = 1.5;
    boreCtx.beginPath();
    boreCtx.moveTo(mapX(0), mapY(0));
    boreCtx.lineTo(mapX(9), mapY(12));
    boreCtx.lineTo(mapX(maxDist), mapY(12));
    boreCtx.stroke();
    boreCtx.setLineDash([]);

    // trajetória real (gradiente por profundidade) com brilho
    boreCtx.lineWidth = 3.2; boreCtx.lineCap = "round"; boreCtx.lineJoin = "round";
    boreCtx.shadowBlur = 8;
    for (let i = 1; i < sim.path.length; i++) {
      const p0 = sim.path[i - 1], p1 = sim.path[i];
      const f = clamp(p1.y / maxDepth, 0, 1);
      const c = depthColor(f);
      boreCtx.strokeStyle = c; boreCtx.shadowColor = c;
      boreCtx.beginPath();
      boreCtx.moveTo(mapX(p0.x), mapY(p0.y));
      boreCtx.lineTo(mapX(p1.x), mapY(p1.y));
      boreCtx.stroke();
    }
    boreCtx.shadowBlur = 0;

    // marcas de emenda de haste
    boreCtx.fillStyle = "rgba(180,200,220,0.7)";
    for (let m = ROD_LEN; m < sim.barra; m += ROD_LEN) {
      const idx = Math.floor((m / Math.max(0.001, sim.barra)) * (sim.path.length - 1));
      const p = sim.path[idx]; if (!p) continue;
      boreCtx.beginPath(); boreCtx.arc(mapX(p.x), mapY(p.y), 2, 0, Math.PI * 2); boreCtx.fill();
    }

    // cabeça de perfuração (broca)
    const hx = mapX(sim.distancia), hy = mapY(sim.profundidade);
    const hc = sim.faults.cabecote_preso ? "#ff4d4d" : "#2f93ff";
    boreCtx.save();
    boreCtx.shadowBlur = 14; boreCtx.shadowColor = hc;
    boreCtx.fillStyle = hc;
    boreCtx.beginPath(); boreCtx.arc(hx, hy, 5.5, 0, Math.PI * 2); boreCtx.fill();
    boreCtx.restore();
    boreCtx.strokeStyle = "rgba(255,255,255,0.5)"; boreCtx.lineWidth = 1.5;
    boreCtx.beginPath(); boreCtx.arc(hx, hy, 9, 0, Math.PI * 2); boreCtx.stroke();

    // glifo da máquina no ponto de entrada
    boreCtx.fillStyle = "#ffb01f";
    boreCtx.fillRect(mapX(0) - 2, mapY(0) - 14, 22, 11);
    boreCtx.fillStyle = "#0a0e14";
    boreCtx.fillRect(mapX(0) + 12, mapY(0) - 11, 6, 5);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---------------- HUD ----------------
  function render() {
    Gauges.render();
    drawBore();

    setText("mode-text", sim.modos[sim.modoIdx]);
    setText("phase-text", sim.modos[sim.modoIdx]);
    setText("time-text", fmtTime(sim.tempo));
    setText("rod-count", sim.rods);
    setText("rod-len", "(" + (sim.rods * ROD_LEN).toFixed(1) + " m)");

    // estado do botão de adicionar haste (pronto / bloqueado)
    const addBtn = document.getElementById("btn-add-rod");
    const canAdd = sim.rotacao <= 10 && Math.abs(Input.state.thrust) <= 0.1;
    addBtn.classList.toggle("ready", canAdd);
    addBtn.classList.toggle("blocked", !canAdd);
    addBtn.title = canAdd
      ? "Pronto para adicionar haste"
      : "Zere a rotação e o empuxo para adicionar a haste";
    addBtn.textContent = canAdd
      ? (sim.needRod ? "+ ADICIONAR HASTE ✓" : "+ ADICIONAR HASTE")
      : "⏸ PARE ROTAÇÃO/EMPUXO";

    const gpBadge = document.getElementById("gamepad-badge");
    const gpText = document.getElementById("gamepad-text");
    gpBadge.className = "badge " + (Input.state.connected ? "gp-on" : "gp-off");
    gpText.textContent = Input.state.connected ? "CONECTADO" : "TECLADO";

    setText("nav-incl", sim.inclinacao.toFixed(1) + " %");
    setText("nav-azim", sim.azimute.toFixed(1) + "°");
    setText("nav-depth", sim.profundidade.toFixed(1) + " m");
    setText("nav-dist", sim.distancia.toFixed(1) + " m");
    setText("nav-bar", sim.barra.toFixed(2) + " m");

    setBar("bar-rotacao", (sim.rotacao / MAX.rotacao) * 100);
    setBarCenter("bar-empuxo", Input.state.thrust);
    setBar("bar-fluxo", (sim.vazao / MAX.vazao) * 100);
    setBarCenter("bar-direcao", Input.state.steer);

    toggle("tg-grampo", sim.grampo, sim.grampo ? "FECHADO" : "ABERTO");
    toggle("tg-modo", true, sim.modos[sim.modoIdx]);
    const estopEl = document.getElementById("tg-estop");
    estopEl.classList.toggle("tripped", sim.estop);
    estopEl.querySelector("em").textContent = sim.estop ? "ACIONADA" : "OK";

    renderAlerts();
    renderEvents();
    renderReport();
  }

  function renderAlerts() {
    const a = [];
    if (sim.pressaoLama > 72) a.push("PRESSÃO LAMA ALTA");
    if (sim.torque > MAX.torque * 0.9) a.push("TORQUE EXCESSIVO");
    if (sim.needRod) a.push("ADICIONAR HASTE");
    if (sim.estop) a.push("PARADA DE EMERGÊNCIA");
    document.getElementById("alerts").innerHTML =
      a.map((t) => `<span class="alert">⚠ ${t}</span>`).join("");
  }

  function renderEvents() {
    const active = Object.keys(sim.faults);
    let html = "";
    active.forEach((id) => {
      const f = FAULT_DEFS[id];
      html += `<li class="evt fault${f.critical ? " critical" : ""}">
        <b>⚠ ${f.nome}</b>
        <span class="cause">${f.causa}</span>
        <span class="action">➜ ${f.acao}</span></li>`;
    });
    eventLog.slice(0, 6).forEach((e) => {
      html += `<li class="evt log"><span>${fmtTime(e.t)}</span> ${e.text}</li>`;
    });
    if (!html) html = `<li class="evt log">Operação normal. Nenhuma falha ativa.</li>`;
    document.getElementById("event-list").innerHTML = html;
  }

  function renderReport() {
    const score = Math.max(0, Math.round(100 - sim.penalidades));
    setText("score-num", score);
    const ring = document.getElementById("score-ring");
    const deg = (score / 100) * 360;
    const col = score > 80 ? "#36d399" : score > 50 ? "#f5a623" : "#ef4444";
    ring.style.background = `conic-gradient(${col} ${deg}deg, var(--line) ${deg}deg)`;

    const precisao = stars(Math.max(0, 5 - sim.overpressure / 3));
    const tempo = stars(sim.barra > 0 ? clamp(5 - sim.tempo / Math.max(1, sim.barra * 6), 0, 5) : 0);
    const fluidoStars = stars(clamp(5 - sim.penalidades / 12, 0, 5));
    const seg = stars(clamp(5 - sim.penalidades / 6, 0, 5));
    document.getElementById("report-list").innerHTML = `
      <li><span>Precisão de Perfuração</span><span class="stars">${precisao}</span></li>
      <li><span>Tempo de Execução</span><span class="stars">${tempo}</span></li>
      <li><span>Consumo de Fluido</span><span class="stars">${fluidoStars}</span></li>
      <li><span>Segurança na Operação</span><span class="stars">${seg}</span></li>`;
  }

  // ---------------- utilidades ----------------
  function approach(v, t, step) { return v < t ? Math.min(t, v + step) : Math.max(t, v - step); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function setText(id, t) { const el = document.getElementById(id); if (el) el.textContent = t; }
  function setBar(id, pct) { document.getElementById(id).style.width = clamp(pct, 0, 100) + "%"; }
  function setBarCenter(id, v) {
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
  function stars(n) { const f = Math.round(clamp(n, 0, 5)); return "★".repeat(f) + "☆".repeat(5 - f); }
  function fmtTime(s) {
    const h = String(Math.floor(s / 3600)).padStart(2, "0");
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
    const sec = String(Math.floor(s % 60)).padStart(2, "0");
    return `${h}:${m}:${sec}`;
  }

  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    render();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // Expõe estado para a visão 3D (view3d.js)
  window.Sim = sim;
})();
