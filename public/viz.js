(() => {
  const canvas = document.querySelector("#viz");
  const ctx = canvas.getContext("2d", { alpha: false });
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  let analyser = null;
  let wave = new Uint8Array(1024);
  let freq = new Uint8Array(128);
  let dpr = 1;
  let w = 0;
  let h = 0;
  let hue = 140;

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    w = innerWidth;
    h = innerHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#050208";
    ctx.fillRect(0, 0, w, h);
  }

  function energy() {
    if (!analyser) return 0.22 + 0.08 * Math.sin(performance.now() / 400);
    analyser.getByteFrequencyData(freq);
    let sum = 0;
    const n = Math.min(freq.length, 40);
    for (let i = 0; i < n; i += 1) sum += freq[i];
    return Math.min(1, sum / (n * 180));
  }

  function sampleWave() {
    if (analyser) {
      analyser.getByteTimeDomainData(wave);
      return;
    }
    const t = performance.now() / 1000;
    for (let i = 0; i < wave.length; i += 1) {
      const x = i / wave.length;
      const v =
        Math.sin(x * 18 + t * 3.2) * 0.55 +
        Math.sin(x * 41 + t * 1.7) * 0.28 +
        Math.sin(x * 7 - t * 2.4) * 0.17;
      wave[i] = 128 + v * 70;
    }
  }

  function feedback(level) {
    ctx.save();
    ctx.globalAlpha = 0.86;
    ctx.translate(w / 2, h / 2);
    ctx.rotate((0.012 + level * 0.02) * Math.sin(performance.now() / 1800));
    ctx.scale(1.035 + level * 0.04, 1.035 + level * 0.04);
    ctx.translate(-w / 2, -h / 2);
    ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, w, h);
    ctx.restore();
    ctx.fillStyle = "rgba(4, 1, 8, 0.12)";
    ctx.fillRect(0, 0, w, h);
  }

  function plasma(level, t) {
    hue = (hue + 0.35 + level * 1.2) % 360;
    ctx.globalCompositeOperation = "lighter";
    const blobs = 5;
    for (let i = 0; i < blobs; i += 1) {
      const a = t * (0.4 + i * 0.13) + i * 1.7;
      const x = w * 0.5 + Math.cos(a) * w * (0.18 + i * 0.04);
      const y = h * 0.5 + Math.sin(a * 1.3 + i) * h * (0.16 + i * 0.03);
      const r = (90 + i * 40 + level * 120) * (0.7 + 0.5 * Math.sin(t + i));
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const h0 = (hue + i * 48) % 360;
      g.addColorStop(0, `hsla(${h0}, 100%, 60%, ${0.18 + level * 0.22})`);
      g.addColorStop(0.45, `hsla(${(h0 + 40) % 360}, 100%, 50%, 0.08)`);
      g.addColorStop(1, "hsla(0, 0%, 0%, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  function scope(level) {
    sampleWave();
    ctx.lineWidth = 1.6 + level * 2;
    ctx.strokeStyle = `hsla(${(hue + 80) % 360}, 100%, 62%, 0.95)`;
    ctx.shadowColor = `hsla(${(hue + 80) % 360}, 100%, 55%, 0.8)`;
    ctx.shadowBlur = 12 + level * 18;
    ctx.beginPath();
    const mid = h * 0.52;
    const amp = h * (0.08 + level * 0.16);
    for (let i = 0; i < wave.length; i += 1) {
      const x = (i / (wave.length - 1)) * w;
      const y = mid + ((wave[i] - 128) / 128) * amp;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  function frame(now) {
    const t = now / 1000;
    const level = energy();
    if (!reduced) {
      feedback(level);
      plasma(level, t);
      scope(level);
    } else {
      ctx.fillStyle = "#050208";
      ctx.fillRect(0, 0, w, h);
      plasma(0.15, t * 0.2);
    }
    requestAnimationFrame(frame);
  }

  window.Viz = {
    attach(next) {
      analyser = next;
      wave = new Uint8Array(analyser.fftSize);
      freq = new Uint8Array(analyser.frequencyBinCount);
    },
  };

  resize();
  addEventListener("resize", resize);
  requestAnimationFrame(frame);
})();
