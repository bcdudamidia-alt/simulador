/*
 * gamepad.js — gerenciador de entrada
 * Unifica três fontes de comando, com a seguinte prioridade:
 *   1. Controle físico (Gamepad API), se conectado
 *   2. Teclado + controles na tela (mouse/toque), combinados
 *
 * Expõe o objeto global `Input`:
 *   state    : estado final normalizado lido pela simulação
 *   os       : valores dos controles na tela (escritos por controls.js)
 *   toggleClamp() / requestMode() / toggleEstop() : acionados pelos botões da tela
 *   poll()   : recalcula `state` (chamado a cada frame)
 */
(function () {
  const state = {
    thrust: 0,    // -1 (puxo) .. +1 (empuxo)
    steer: 0,     // -1 (esq.) .. +1 (dir.)
    flow: 0,      // 0 .. 1
    rotation: 0,  // 0 .. 1
    clamp: true,
    estop: false,
    connected: false,
    _modeEdge: false,
  };

  // Controles na tela (persistentes para fluido/rotação; momentâneos p/ joysticks)
  const os = { thrust: 0, steer: 0, flow: 0, rotation: 0 };

  // Toggles pendentes — disparados por qualquer fonte e consumidos no poll
  let pendingClamp = false, pendingMode = false, pendingEstop = false;

  // ---- Teclado ----
  const keys = {};
  window.addEventListener("keydown", (e) => {
    keys[e.key.toLowerCase()] = true;
    if (e.key === " ") e.preventDefault();
  });
  window.addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });

  // ---- Detecção de conexão do gamepad ----
  window.addEventListener("gamepadconnected", updateConnected);
  window.addEventListener("gamepaddisconnected", updateConnected);
  function updateConnected() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    state.connected = Array.from(pads).some((p) => p);
  }

  const edgeFlags = {};
  function edge(pressed, key, onPress) {
    if (pressed && !edgeFlags[key]) onPress();
    edgeFlags[key] = !!pressed;
  }
  function deadzone(v, dz = 0.12) { return Math.abs(v) < dz ? 0 : v; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function readGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = Array.from(pads).find((p) => p);
    if (!gp) return false;

    state.thrust = -deadzone(gp.axes[1] || 0);
    state.steer = deadzone(gp.axes[2] || 0);
    state.flow = gp.buttons[7] ? gp.buttons[7].value : 0;     // RT
    state.rotation = gp.buttons[6] ? gp.buttons[6].value : 0; // LT
    os.flow = state.flow;        // espelha p/ sliders na tela
    os.rotation = state.rotation;

    edge(gp.buttons[0] && gp.buttons[0].pressed, "gp0", () => (pendingClamp = true));
    edge(gp.buttons[1] && gp.buttons[1].pressed, "gp1", () => (pendingMode = true));
    edge(gp.buttons[9] && gp.buttons[9].pressed, "gp9", () => (pendingEstop = true));
    return true;
  }

  function readKeyboardAndScreen() {
    // Fluido e rotação: persistentes, ajustados por teclado (sliders escrevem em os)
    if (keys["arrowup"]) os.flow = clamp(os.flow + 0.02, 0, 1);
    if (keys["arrowdown"]) os.flow = clamp(os.flow - 0.02, 0, 1);
    if (keys["e"]) os.rotation = clamp(os.rotation + 0.02, 0, 1);
    if (keys["q"]) os.rotation = clamp(os.rotation - 0.02, 0, 1);

    // Empuxo/direção: teclado (momentâneo) + joystick na tela
    let kbT = 0;
    if (keys["w"]) kbT += 1;
    if (keys["s"]) kbT -= 1;
    let kbS = 0;
    if (keys["d"]) kbS += 1;
    if (keys["a"]) kbS -= 1;

    state.thrust = clamp(kbT + os.thrust, -1, 1);
    state.steer = clamp(kbS + os.steer, -1, 1);
    state.flow = os.flow;
    state.rotation = os.rotation;

    edge(!!keys["g"], "kbG", () => (pendingClamp = true));
    edge(!!keys["m"], "kbM", () => (pendingMode = true));
    edge(!!keys[" "], "kbSpace", () => (pendingEstop = true));
  }

  window.Input = {
    state,
    os,
    toggleClamp() { pendingClamp = true; },
    requestMode() { pendingMode = true; },
    toggleEstop() { pendingEstop = true; },
    poll() {
      updateConnected();
      state._modeEdge = false;

      if (!readGamepad()) readKeyboardAndScreen();

      // Aplica toggles vindos de qualquer fonte (inclui botões na tela)
      if (pendingClamp) { state.clamp = !state.clamp; pendingClamp = false; }
      if (pendingMode) { state._modeEdge = true; pendingMode = false; }
      if (pendingEstop) { state.estop = !state.estop; pendingEstop = false; }

      return state;
    },
  };
})();
