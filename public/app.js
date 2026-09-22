const STATION = /github\.io$/i.test(location.hostname)
  ? "http://10.91.0.238:9191"
  : "";

const playBtn = document.querySelector("#play");
const playIcon = document.querySelector("#play-icon");
const titleEl = document.querySelector("#title");
const hintEl = document.querySelector("#hint");
const player = document.querySelector("#player");

let listening = false;

function api(path) {
  return `${STATION}/${String(path).replace(/^\//, "")}`;
}

function render(state) {
  titleEl.textContent = state.now?.name || "Тишина";
}

async function start() {
  player.src = `${api("stream")}?t=${Date.now()}`;
  await player.play();
  listening = true;
  playBtn.dataset.on = "true";
  playIcon.textContent = "❚❚";
  hintEl.textContent = "";
}

function stop() {
  listening = false;
  player.pause();
  player.removeAttribute("src");
  player.load();
  playBtn.dataset.on = "false";
  playIcon.textContent = "▶";
}

playBtn.addEventListener("click", async () => {
  try {
    if (listening) stop();
    else await start();
  } catch {
    hintEl.textContent = "Не удалось включить поток с этой машинки.";
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
      .catch(() => {
        if (!STATION) {
          hintEl.textContent = "Сервер выключен. Запустите npm start на машинке.";
        }
      });
    setTimeout(connectEvents, 2000);
  });
}

if (STATION) {
  hintEl.textContent = "Play включает эфир с машинки в подсети.";
}

connectEvents();
