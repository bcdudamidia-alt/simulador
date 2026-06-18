/*
 * lesson.js — Modo Aula (procedimento guiado)
 * Trilha de treinamento passo a passo baseada na seção 8 do guia operacional
 * da XZ200. Cada passo é validado em tempo real contra o estado da simulação
 * (window.Sim) e dos comandos (Input.state); só avança quando concluído.
 */
(function () {
  const S = () => window.Sim;
  const I = () => window.Input.state;

  const STEPS = [
    {
      title: "Verificação inicial (neutro)",
      instr: "Antes da partida, confirme que todos os comandos estão em neutro: sem empuxo, sem rotação e sem fluxo de lama.",
      check: () => Math.abs(I().thrust) < 0.05 && S().rotacao < 5 && S().vazao < 10,
    },
    {
      title: "Acionar a bomba de lama",
      instr: "Nunca perfure sem fluido. Aumente o fluxo de lama acima de 100 L/min (slider na tela ou gatilho do controle).",
      check: () => S().vazao > 100,
    },
    {
      title: "Iniciar a rotação da coluna",
      instr: "Inicie a rotação do cabeçote lentamente, acima de 30 rpm, sem forçar.",
      check: () => S().rotacao > 30,
    },
    {
      title: "Furo piloto — primeiros 3 m",
      instr: "Aplique empuxo suave e avance o furo até completar a primeira haste (3 m).",
      check: () => S().barra >= 2.98,
    },
    {
      title: "Adicionar nova haste",
      instr: "A haste chegou ao fim. Pare a rotação e o avanço e clique em ‘+ ADICIONAR HASTE’.",
      check: () => S().rods >= 2,
    },
    {
      title: "Continuar o furo até 6 m",
      instr: "Retome rotação e avanço mantendo o fluxo de lama. Avance até 6 m de perfuração.",
      check: () => S().barra >= 6,
    },
    {
      title: "Correção de trajetória",
      instr: "Faça uma correção de direção: use o joystick de direção e leve o azimute para além de 5°.",
      check: () => Math.abs(S().azimute) > 5,
    },
    {
      title: "Mudar para ALARGAMENTO",
      instr: "Concluído o piloto, troque a fase para ALARGAMENTO (botão MODO ou tecla M).",
      check: () => S().modos[S().modoIdx] === "ALARGAMENTO",
    },
    {
      title: "Parada de emergência",
      instr: "Treine a resposta a uma emergência: acione a PARADA de emergência.",
      check: () => S().estop === true,
    },
    {
      title: "Parada normal",
      instr: "Para finalizar, desarme a emergência e reduza rotação e fluxo de lama a zero (parada normal).",
      check: () => !S().estop && S().rotacao < 5 && S().vazao < 10,
    },
  ];

  // ---- Elementos ----
  const btn = document.getElementById("btn-lesson");
  const main = document.getElementById("lesson-main");
  const numEl = document.getElementById("lesson-num");
  const titleEl = document.getElementById("lesson-title");
  const instrEl = document.getElementById("lesson-instr");
  const statusEl = document.getElementById("lesson-status");
  const fillEl = document.getElementById("lesson-fill");

  let active = false;
  let idx = 0;
  let holdTimer = 0;     // tempo que a condição ficou verdadeira
  let advancing = false; // pausa entre passos

  btn.addEventListener("click", () => (active ? stop() : start()));

  function start() {
    active = true; idx = 0; holdTimer = 0; advancing = false;
    main.hidden = false;
    btn.textContent = "■ Encerrar Modo Aula";
    btn.classList.add("on");
    showStep();
  }
  function stop() {
    active = false;
    main.hidden = true;
    btn.textContent = "▶ Iniciar Modo Aula";
    btn.classList.remove("on");
  }

  function showStep() {
    const s = STEPS[idx];
    numEl.textContent = `Passo ${idx + 1}/${STEPS.length}`;
    titleEl.textContent = s.title;
    instrEl.textContent = s.instr;
    statusEl.textContent = "⏳ Em andamento…";
    statusEl.className = "lesson-status";
    fillEl.style.width = `${(idx / STEPS.length) * 100}%`;
  }

  function complete() {
    fillEl.style.width = `${((idx + 1) / STEPS.length) * 100}%`;
    statusEl.textContent = "✅ Passo concluído!";
    statusEl.className = "lesson-status ok";
    advancing = true;
    setTimeout(() => {
      idx++;
      advancing = false;
      if (idx >= STEPS.length) finish();
      else showStep();
    }, 1400);
  }

  function finish() {
    const score = document.getElementById("score-num").textContent;
    numEl.textContent = "Concluído";
    titleEl.textContent = "🎓 Treinamento concluído!";
    instrEl.textContent =
      "Você executou o procedimento completo do furo piloto ao alargamento. Desempenho geral: " +
      score + "/100. Reinicie o Modo Aula para treinar novamente.";
    statusEl.textContent = "✅ 100% dos passos";
    statusEl.className = "lesson-status ok";
    fillEl.style.width = "100%";
    btn.textContent = "▶ Reiniciar Modo Aula";
    btn.classList.remove("on");
    active = false;
  }

  // ---- Loop de avaliação ----
  let last = performance.now();
  function tick(now) {
    const dt = (now - last) / 1000;
    last = now;
    if (active && !advancing && window.Sim) {
      if (STEPS[idx].check()) {
        holdTimer += dt;
        if (holdTimer >= 0.4) { holdTimer = 0; complete(); }
      } else {
        holdTimer = 0;
      }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
