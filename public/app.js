const base = new URL(".", window.location.href).pathname;

function api(path) {
  return `${base}${String(path).replace(/^\//, "")}`;
}

const listenBtn = document.querySelector("#listen");
const player = document.querySelector("#player");
const volume = document.querySelector("#volume");
const lamp = document.querySelector("#lamp");
const lampText = document.querySelector("#lamp-text");
const nowTitle = document.querySelector("#now-title");
const nowClock = document.querySelector("#now-clock");
const progressBar = document.querySelector("#progress-bar");
const progress = document.querySelector("#progress");
const crowd = document.querySelector("#crowd");
const queueEl = document.querySelector("#queue");
const queueEmpty = document.querySelector("#queue-empty");
const libraryEl = document.querySelector("#library");
const libraryEmpty = document.querySelector("#library-empty");
const drop = document.querySelector("#drop");
const fileInput = document.querySelector("#file");
const statusEl = document.querySelector("#status");
const skipBtn = document.querySelector("#skip");
const needle = document.querySelector("#needle");
const vuBar = document.querySelector("#vu-bar");

let listening = false;
let analyser = null;
let audioCtx = null;
let sourceNode = null;
let raf = 0;

function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const m = Math.floor(total / 60);
  const s = String(total % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function plural(n, one, few, many) {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last > 1 && last < 5) return few;
  if (last === 1) return one;
  return many;
}

function render(state) {
  const onAir = state.status === "playing";
  lamp.dataset.lit = String(onAir);
  lampText.textContent = onAir ? "В ЭФИРЕ" : "ТИШИНА";
  nowTitle.textContent = state.now?.name || "Тишина";

  const duration = state.now?.duration || 0;
  const position = state.now?.position || 0;
  const pct = duration ? Math.min(100, (position / duration) * 100) : 0;
  progressBar.style.width = `${pct}%`;
  progress.setAttribute("aria-valuenow", String(Math.round(pct)));
  nowClock.textContent = `${formatTime(position)} / ${formatTime(duration)}`;

  const count = state.listeners || 0;
  crowd.textContent =
    count === 0
      ? "никто не слушает"
      : `${count} ${plural(count, "слушатель", "слушателя", "слушателей")}`;

  queueEl.innerHTML = "";
  state.queue.forEach((track, index) => {
    const li = document.createElement("li");
    li.className = "row";
    li.innerHTML = `<span>${index + 1}. ${escapeHtml(track.name)} <small>${formatTime(track.duration)}</small></span>`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "убрать";
    remove.addEventListener("click", () => {
      fetch(api(`api/queue/${track.id}`), { method: "DELETE" });
    });
    li.append(remove);
    queueEl.append(li);
  });
  queueEmpty.classList.toggle("hidden", state.queue.length > 0);

  libraryEl.innerHTML = "";
  state.library.forEach((track) => {
    const li = document.createElement("li");
    li.className = "row";
    li.innerHTML = `<span>${escapeHtml(track.name)} <small>${formatTime(track.duration)}</small></span>`;
    const add = document.createElement("button");
    add.type = "button";
    add.textContent = "в очередь";
    add.addEventListener("click", () => {
      fetch(api("api/queue"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: track.id }),
      });
    });
    li.append(add);
    libraryEl.append(li);
  });
  libraryEmpty.classList.toggle("hidden", state.library.length > 0);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function startListening() {
  player.src = `${api("stream")}?t=${Date.now()}`;
  player.volume = Number(volume.value);
  await player.play();
  listening = true;
  listenBtn.dataset.on = "true";
  listenBtn.textContent = "Выключить";
  setupMeter();
}

function stopListening() {
  listening = false;
  player.pause();
  player.removeAttribute("src");
  player.load();
  listenBtn.dataset.on = "false";
  listenBtn.textContent = "Слушать эфир";
  cancelAnimationFrame(raf);
  vuBar.style.width = "0%";
  needle.style.transform = "translateX(-50%) rotate(0deg)";
}

function setupMeter() {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === "suspended") audioCtx.resume();
  if (!sourceNode) {
    sourceNode = audioCtx.createMediaElementSource(player);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    sourceNode.connect(analyser);
    analyser.connect(audioCtx.destination);
  }
  const data = new Uint8Array(analyser.frequencyBinCount);
  const tick = () => {
    analyser.getByteFrequencyData(data);
    const avg = data.reduce((sum, value) => sum + value, 0) / data.length;
    const level = Math.min(1, avg / 140);
    vuBar.style.width = `${Math.round(level * 100)}%`;
    needle.style.transform = `translateX(-50%) rotate(${(level - 0.15) * 18}deg)`;
    raf = requestAnimationFrame(tick);
  };
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(tick);
}

async function uploadFiles(files) {
  if (!files.length) return;
  const body = new FormData();
  for (const file of files) body.append("files", file);
  statusEl.textContent = `Ставлю в эфир: ${files.length} файл(ов)…`;
  let res;
  try {
    res = await fetch(api("api/upload"), { method: "POST", body });
  } catch {
    statusEl.textContent = "Нет связи с эфиром. Откройте http://10.91.0.55/radio/";
    return;
  }
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    statusEl.textContent =
      payload.error ||
      (res.status === 405
        ? "Эта страница не принимает файлы. Откройте http://10.91.0.55/radio/"
        : "Не удалось загрузить");
    return;
  }
  const names = (payload.imported || []).map((item) => item.name).join(", ");
  statusEl.textContent = names ? `В очереди: ${names}` : "Готово";
}

listenBtn.addEventListener("click", async () => {
  try {
    if (listening) stopListening();
    else await startListening();
  } catch (error) {
    statusEl.textContent = "Браузер не дал включить звук — нажмите ещё раз.";
  }
});

volume.addEventListener("input", () => {
  player.volume = Number(volume.value);
});

skipBtn.addEventListener("click", () => {
  fetch(api("api/skip"), { method: "POST" });
});

fileInput.addEventListener("change", () => {
  uploadFiles([...fileInput.files]);
  fileInput.value = "";
});

["dragenter", "dragover"].forEach((eventName) => {
  drop.addEventListener(eventName, (event) => {
    event.preventDefault();
    drop.classList.add("over");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  drop.addEventListener(eventName, (event) => {
    event.preventDefault();
    drop.classList.remove("over");
  });
});

drop.addEventListener("drop", (event) => {
  uploadFiles([...event.dataTransfer.files]);
});

function connectEvents() {
  const source = new EventSource(api("api/events"));
  source.addEventListener("message", (event) => {
    render(JSON.parse(event.data));
  });
  source.addEventListener("error", () => {
    source.close();
    setTimeout(connectEvents, 1500);
  });
}

connectEvents();
