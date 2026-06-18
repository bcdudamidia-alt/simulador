/*
 * controls.js — controles na tela (mouse / toque)
 * Liga os joysticks, sliders e botões da interface ao gerenciador `Input`.
 * Permite operar o simulador sem teclado e sem controle físico.
 */
(function () {
  const os = window.Input.os;

  // ---------- Joysticks arrastáveis ----------
  function setupJoystick(el) {
    const axis = el.dataset.axis; // "y" = empuxo, "x" = direção
    const knob = el.querySelector(".knob");
    let dragging = false;

    function setFromEvent(e) {
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const px = (e.touches ? e.touches[0].clientX : e.clientX) - cx;
      const py = (e.touches ? e.touches[0].clientY : e.clientY) - cy;
      const r = rect.width / 2;

      if (axis === "y") {
        const v = clamp(py / r, -1, 1);
        os.thrust = -v;                 // para cima = empuxo positivo
        knob.style.transform = `translate(-50%, calc(-50% + ${v * r * 0.6}px))`;
      } else {
        const v = clamp(px / r, -1, 1);
        os.steer = v;
        knob.style.transform = `translate(calc(-50% + ${v * r * 0.6}px), -50%)`;
      }
    }

    function release() {
      dragging = false;
      if (axis === "y") os.thrust = 0; else os.steer = 0;
      knob.style.transform = "translate(-50%, -50%)";
      el.classList.remove("active");
    }

    function start(e) {
      dragging = true;
      el.classList.add("active");
      setFromEvent(e);
      e.preventDefault();
    }
    function move(e) { if (dragging) { setFromEvent(e); e.preventDefault(); } }

    el.addEventListener("mousedown", start);
    el.addEventListener("touchstart", start, { passive: false });
    window.addEventListener("mousemove", move);
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("mouseup", release);
    window.addEventListener("touchend", release);
  }

  document.querySelectorAll(".joystick").forEach(setupJoystick);

  // ---------- Sliders (fluido / rotação) ----------
  const slFlow = document.getElementById("sl-flow");
  const slRot = document.getElementById("sl-rot");
  let flowActive = false, rotActive = false;

  slFlow.addEventListener("input", () => { os.flow = slFlow.value / 100; });
  slRot.addEventListener("input", () => { os.rotation = slRot.value / 100; });
  bindActive(slFlow, (v) => (flowActive = v));
  bindActive(slRot, (v) => (rotActive = v));

  function bindActive(el, set) {
    ["mousedown", "touchstart"].forEach((ev) => el.addEventListener(ev, () => set(true)));
    ["mouseup", "touchend", "blur"].forEach((ev) => el.addEventListener(ev, () => set(false)));
  }

  // ---------- Botões de operação ----------
  document.getElementById("btn-grampo").addEventListener("click", () => Input.toggleClamp());
  document.getElementById("btn-modo").addEventListener("click", () => Input.requestMode());
  document.getElementById("btn-estop").addEventListener("click", () => Input.toggleEstop());

  // ---------- Botão "Conectar controle" ----------
  const status = document.getElementById("connect-status");
  document.getElementById("btn-connect").addEventListener("click", () => {
    const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : [];
    if (pads.length) {
      status.textContent = "✅ Controle conectado: " + pads[0].id;
      status.className = "ok";
    } else {
      status.textContent = "Nenhum controle detectado. Conecte um joystick/gamepad USB e PRESSIONE QUALQUER BOTÃO dele para o navegador reconhecer.";
      status.className = "warn";
    }
  });
  window.addEventListener("gamepadconnected", (e) => {
    status.textContent = "✅ Controle conectado: " + e.gamepad.id;
    status.className = "ok";
  });
  window.addEventListener("gamepaddisconnected", () => {
    status.textContent = "Controle desconectado. Use a tela, o teclado ou reconecte o USB.";
    status.className = "warn";
  });

  // ---------- Sincronização visual (sliders refletem teclado/gamepad) ----------
  const valFlow = document.getElementById("val-flow");
  const valRot = document.getElementById("val-rot");
  function syncLoop() {
    if (!flowActive) slFlow.value = Math.round(os.flow * 100);
    if (!rotActive) slRot.value = Math.round(os.rotation * 100);
    valFlow.textContent = Math.round(os.flow * 100) + "%";
    valRot.textContent = Math.round(os.rotation * 100) + "%";
    requestAnimationFrame(syncLoop);
  }
  requestAnimationFrame(syncLoop);

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
})();
