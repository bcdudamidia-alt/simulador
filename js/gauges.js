/*
 * gauges.js
 * Mostradores circulares estilo painel de máquina, desenhados em <canvas>:
 * escala graduada, arco luminoso e ponteiro. Registra automaticamente todo
 * canvas com a classe .gauge.
 */
(function () {
  const gauges = [];

  document.querySelectorAll("canvas.gauge").forEach((cv) => {
    // densidade de pixels para nitidez em telas retina
    const dpr = window.devicePixelRatio || 1;
    const w = cv.width, h = cv.height;
    cv.width = w * dpr; cv.height = h * dpr;
    cv.style.width = w + "px"; cv.style.height = h + "px";
    const ctx = cv.getContext("2d");
    ctx.scale(dpr, dpr);
    gauges.push({
      cv, ctx, w, h,
      key: cv.dataset.key,
      label: cv.dataset.label,
      unit: cv.dataset.unit,
      max: parseFloat(cv.dataset.max),
      value: 0, display: 0,
    });
  });

  const START = Math.PI * 0.75;   // -135°
  const END = Math.PI * 2.25;     // +135°
  const SWEEP = END - START;

  function colorFor(frac) {
    if (frac > 0.85) return "#ff4d4d";
    if (frac > 0.65) return "#ffb01f";
    return "#2f93ff";
  }

  function draw(g) {
    const { ctx, w, h } = g;
    const cx = w / 2, cy = h / 2 + 8, r = w / 2 - 20;
    ctx.clearRect(0, 0, w, h);

    const frac = Math.max(0, Math.min(1, g.display / g.max));
    const color = colorFor(frac);

    // marcações da escala (ticks)
    const ticks = 10;
    for (let i = 0; i <= ticks; i++) {
      const a = START + (SWEEP * i) / ticks;
      const inner = i % 5 === 0 ? r - 14 : r - 9;
      const lit = i / ticks <= frac;
      ctx.strokeStyle = lit ? color : "#2a3a4d";
      ctx.lineWidth = i % 5 === 0 ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (r - 2), cy + Math.sin(a) * (r - 2));
      ctx.lineTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      ctx.stroke();
    }

    // arco de fundo
    ctx.lineWidth = 9;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#192634";
    ctx.beginPath();
    ctx.arc(cx, cy, r - 22, START, END);
    ctx.stroke();

    // arco luminoso
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, r - 22, START, START + SWEEP * frac);
    ctx.stroke();
    ctx.restore();

    // ponteiro
    const ang = START + SWEEP * frac;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-4, 0);
    ctx.lineTo(r - 26, -2);
    ctx.lineTo(r - 26, 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // cubo central
    ctx.fillStyle = "#2a3a4d";
    ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI * 2); ctx.fill();

    // valor numérico
    ctx.fillStyle = "#eef4fb";
    ctx.textAlign = "center";
    ctx.font = "700 32px 'Rajdhani', sans-serif";
    ctx.fillText(formatVal(g.display, g.max), cx, cy + 6);

    ctx.fillStyle = "#8595a8";
    ctx.font = "500 11px 'Inter', sans-serif";
    ctx.fillText(g.unit, cx, cy + 24);

    ctx.fillStyle = color;
    ctx.font = "600 11px 'Rajdhani', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(g.label, cx, 18);
  }

  function formatVal(v, max) {
    if (max >= 1000) return Math.round(v).toLocaleString("pt-BR");
    return Math.round(v);
  }

  window.Gauges = {
    set(key, value) {
      const g = gauges.find((x) => x.key === key);
      if (g) g.value = value;
    },
    render() {
      gauges.forEach((g) => {
        g.display += (g.value - g.display) * 0.15;
        draw(g);
      });
    },
  };
})();
