/*
 * gamepad.js
 * Lê o controle físico (joystick/gamepad USB) usando a Gamepad API do navegador
 * e também aceita o teclado como alternativa quando não há controle conectado.
 *
 * Expõe um objeto global `Input` com o estado normalizado dos comandos:
 *   thrust   : -1 (puxo total) .. +1 (empuxo total)
 *   steer    : -1 (esquerda)    .. +1 (direita)
 *   flow     :  0 .. 1   (fluxo de fluido)
 *   rotation :  0 .. 1   (rotação da coluna)
 *   clamp    : bool      (grampo fechado)
 *   modeBtn  : bool edge (trocar modo)
 *   estop    : bool      (parada de emergência ativada)
 *   connected: bool      (controle físico detectado)
 */
(function () {
  const state = {
    thrust: 0, steer: 0, flow: 0, rotation: 0,
    clamp: true, estop: false, connected: false,
    _modeEdge: false, _modePressed: false,
    _clampPressed: false, _estopPressed: false,
  };

  // ---- Teclado (fallback) ----
  const keys = {};
  window.addEventListener("keydown", (e) => {
    keys[e.key.toLowerCase()] = true;
    if (e.key === " ") e.preventDefault();
  });
  window.addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });

  // ---- Detecção de conexão ----
  window.addEventListener("gamepadconnected", () => updateConnected());
  window.addEventListener("gamepaddisconnected", () => updateConnected());
  function updateConnected() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    state.connected = Array.from(pads).some((p) => p);
  }

  function deadzone(v, dz = 0.12) {
    return Math.abs(v) < dz ? 0 : v;
  }

  function pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = Array.from(pads).find((p) => p);
    if (!gp) return false;

    // Eixos padrão (mapeamento "standard")
    const lY = deadzone(gp.axes[1] || 0); // analógico esquerdo Y
    const rX = deadzone(gp.axes[2] || 0); // analógico direito X

    state.thrust = -lY;          // para cima = empuxo (positivo)
    state.steer = rX;

    // Gatilhos: botões 6 (LT) e 7 (RT) em mapeamento standard
    const lt = gp.buttons[6] ? gp.buttons[6].value : 0;
    const rt = gp.buttons[7] ? gp.buttons[7].value : 0;
    state.flow = rt;
    state.rotation = lt;

    // Botão A (0) -> grampo (toggle); B (1) -> modo; START (9) -> e-stop
    handleEdge(gp.buttons[0] && gp.buttons[0].pressed, "_clampPressed", () => {
      state.clamp = !state.clamp;
    });
    state._modeEdge = false;
    handleEdge(gp.buttons[1] && gp.buttons[1].pressed, "_modePressed", () => {
      state._modeEdge = true;
    });
    handleEdge(gp.buttons[9] && gp.buttons[9].pressed, "_estopPressed", () => {
      state.estop = !state.estop;
    });
    return true;
  }

  function handleEdge(pressed, flag, onPress) {
    if (pressed && !state[flag]) onPress();
    state[flag] = pressed;
  }

  function pollKeyboard() {
    // Empuxo / puxo
    let t = 0;
    if (keys["w"]) t += 1;
    if (keys["s"]) t -= 1;
    state.thrust = t;

    // Direção
    let s = 0;
    if (keys["d"]) s += 1;
    if (keys["a"]) s -= 1;
    state.steer = s;

    // Fluido (setas cima/baixo ajustam gradualmente)
    if (keys["arrowup"]) state.flow = Math.min(1, state.flow + 0.02);
    if (keys["arrowdown"]) state.flow = Math.max(0, state.flow - 0.02);

    // Rotação (q/e)
    if (keys["e"]) state.rotation = Math.min(1, state.rotation + 0.02);
    if (keys["q"]) state.rotation = Math.max(0, state.rotation - 0.02);

    // Grampo (g) e parada (espaço) com borda
    handleEdge(!!keys["g"], "_clampPressed", () => { state.clamp = !state.clamp; });
    state._modeEdge = false;
    handleEdge(!!keys["m"], "_modePressed", () => { state._modeEdge = true; });
    handleEdge(!!keys[" "], "_estopPressed", () => { state.estop = !state.estop; });
  }

  // API pública: chamada a cada frame pela simulação
  window.Input = {
    state,
    poll() {
      updateConnected();
      if (!pollGamepad()) pollKeyboard();
      return state;
    },
  };
})();
