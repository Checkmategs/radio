const STATION = /github\.io$/i.test(location.hostname) ? "http://127.0.0.1:9191" : "";

const playBtn = document.querySelector("#play");
const playIcon = document.querySelector("#play-icon");
const titleEl = document.querySelector("#title");
const hintEl = document.querySelector("#hint");
const player = document.querySelector("#player");
const karaokePrev = document.querySelector("#karaoke-prev");
const karaokeCurrent = document.querySelector("#karaoke-current");
const karaokeNext = document.querySelector("#karaoke-next");

let listening = false;
let audioCtx = null;
let sourceNode = null;
let analyser = null;
let radioState = null;
let karaokeTick = 0;
let hear = null;

function api(path) {
  const prefix = STATION || new URL(".", window.location.href).href.replace(/\/$/, "");
  return `${prefix}/${String(path).replace(/^\//, "")}`;
}

function render(state) {
  radioState = state;
  titleEl.textContent = state.now?.name || "Тишина";
  lockHear(state);
  paintKaraoke();
}

function lockHear(state) {
  const now = state?.now;
  if (!now?.startedAt || !listening || player.paused) return;
  if (hear && hear.startedAt === now.startedAt) return;
  hear = {
    startedAt: now.startedAt,
    origin: Number(now.position) || 0,
    audioMark: player.currentTime || 0,
  };
}

function currentPosition() {
  const now = radioState?.now;
  if (!now) return 0;
  if (hear && hear.startedAt === now.startedAt && listening && !player.paused) {
    return Math.min(now.duration || Infinity, hear.origin + (player.currentTime - hear.audioMark));
  }
  if (!now.startedAt) return 0;
  return Math.min(now.duration || Infinity, (Date.now() - now.startedAt) / 1000);
}

function paintKaraoke() {
  const lyrics = radioState?.now?.lyrics || [];
  if (!lyrics.length) {
    karaokePrev.textContent = "";
    karaokeCurrent.textContent = "";
    karaokeNext.textContent = "";
    return;
  }
  const pos = currentPosition();
  let index = -1;
  for (let i = 0; i < lyrics.length; i += 1) {
    if (lyrics[i].t <= pos) index = i;
  }
  karaokePrev.textContent = index > 0 ? lyrics[index - 1].text : "";
  karaokeNext.textContent = index >= 0 && lyrics[index + 1] ? lyrics[index + 1].text : "";
  if (index < 0) {
    karaokeCurrent.textContent = "";
    return;
  }
  const line = lyrics[index];
  karaokeCurrent.innerHTML = (line.words || [])
    .map((word) => `<span class="word${word.t <= pos ? " sung" : ""}">${escapeHtml(word.text)}</span>`)
    .join(" ");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function attachMeter() {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === "suspended") audioCtx.resume();
  if (!sourceNode) {
    sourceNode = audioCtx.createMediaElementSource(player);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.72;
    sourceNode.connect(analyser);
    analyser.connect(audioCtx.destination);
    window.Viz?.attach(analyser);
  }
}

async function start() {
  player.src = `${api("stream")}?t=${Date.now()}`;
  attachMeter();
  await player.play();
  listening = true;
  playBtn.dataset.on = "true";
  playIcon.textContent = "❚❚";
  hintEl.textContent = "";
  hear = null;
  try {
    const fresh = await fetch(api("api/state")).then((res) => res.json());
    render(fresh);
  } catch {
    lockHear(radioState);
  }
}

function stop() {
  listening = false;
  hear = null;
  player.pause();
  player.removeAttribute("src");
  player.load();
  playBtn.dataset.on = "false";
  playIcon.textContent = "▶";
}

player.addEventListener("playing", () => {
  if (!listening) return;
  hear = null;
  lockHear(radioState);
});

playBtn.addEventListener("click", async () => {
  try {
    if (listening) stop();
    else await start();
  } catch {
    hintEl.textContent = "Не удалось включить поток. Запустите npm start на этом компьютере.";
  }
});

function connectEvents() {
  const source = new EventSource(api("api/events"));
  source.addEventListener("message", (event) => {
    render(JSON.parse(event.data));
  });
  source.addEventListener("error", () => {
    source.close();
    fetch(api("api/state"))
      .then((res) => res.json())
      .then(render)
      .catch(() => {});
    setTimeout(connectEvents, 2000);
  });
}

connectEvents();

function loopKaraoke() {
  paintKaraoke();
  karaokeTick = requestAnimationFrame(loopKaraoke);
}

karaokeTick = requestAnimationFrame(loopKaraoke);
