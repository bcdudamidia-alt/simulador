/*
 * gauges.js
 * Desenha mostradores circulares (estilo painel de máquina) em <canvas>.
 * Cada canvas com classe .gauge é registrado automaticamente.
 */
(function () {
  const gauges = [];

  document.querySelectorAll("canvas.gauge").forEach((cv) => {
    gauges.push({
      cv,
      ctx: cv.getContext("2d"),
      key: cv.dataset.key,
      label: cv.dataset.label,
      unit: cv.dataset.unit,
      max: parseFloat(cv.dataset.max),
      value: 0,
      display: 0,
    });
  });

  const START = Math.PI * 0.75;   // -135°
  const END = Math.PI * 2.25;     // +135°
  const SWEEP = END - START;

  function draw(g) {
    const { ctx, cv } = g;
    const w = cv.width, h = cv.height;
    const cx = w / 2, cy = h / 2 + 6, r = w / 2 - 16;
    ctx.clearRect(0, 0, w, h);

    // arco de fundo
    ctx.lineWidth = 12;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#1d2837";
    ctx.beginPath();
    ctx.arc(cx, cy, r, START, END);
    ctx.stroke();

    // arco preenchido
    const frac = Math.max(0, Math.min(1, g.display / g.max));
    const color = frac > 0.85 ? "#ef4444" : frac > 0.65 ? "#f5a623" : "#2e8bff";
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, r, START, START + SWEEP * frac);
    ctx.stroke();

    // valor numérico
    ctx.fillStyle = "#e6edf3";
    ctx.textAlign = "center";
    ctx.font = "bold 30px Segoe UI, sans-serif";
    ctx.fillText(Math.round(g.display), cx, cy + 6);

    ctx.fillStyle = "#8a97a8";
    ctx.font = "11px Segoe UI, sans-serif";
    ctx.fillText(g.unit, cx, cy + 26);

    ctx.fillStyle = "#f5a623";
    ctx.font = "bold 11px Segoe UI, sans-serif";
    ctx.fillText(g.label, cx, cy - r - 2);
  }

  window.Gauges = {
    set(key, value) {
      const g = gauges.find((x) => x.key === key);
      if (g) g.value = value;
    },
    render() {
      gauges.forEach((g) => {
        // suavização para um movimento de ponteiro realista
        g.display += (g.value - g.display) * 0.15;
        draw(g);
      });
    },
  };
})();
