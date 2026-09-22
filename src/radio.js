import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const STREAM_HEAD = ["-hide_banner", "-loglevel", "error", "-re"];
const AUDIO_OUT = [
  "-vn",
  "-f",
  "mp3",
  "-codec:a",
  "libmp3lame",
  "-b:a",
  "128k",
  "-ar",
  "44100",
  "-ac",
  "2",
  "pipe:1",
];

export function decodeOriginalName(name) {
  if (!name) return "без названия";
  if (/[\u0400-\u04FF]/.test(name)) return name;
  try {
    const repaired = Buffer.from(name, "latin1").toString("utf8");
    if (/[\u0400-\u04FF]/.test(repaired)) return repaired;
    return name;
  } catch {
    return name;
  }
}

function runProcess(bin, args) {
  return new Promise((resolve) => {
    const proc = spawn(bin, args);
    let out = "";
    let err = "";
    proc.stdout.on("data", (chunk) => {
      out += chunk;
    });
    proc.stderr.on("data", (chunk) => {
      err += chunk;
    });
    proc.on("error", () => resolve(null));
    proc.on("close", (code) => resolve({ out, err, code }));
  });
}

function parseSeconds(text) {
  const value = Number.parseFloat(String(text || "").trim());
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function parseFfmpegDuration(stderr) {
  const match = String(stderr).match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) return 0;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

export async function probeDuration(filePath) {
  for (const bin of ["ffprobe", "ffmpeg.ffprobe"]) {
    const result = await runProcess(bin, [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);
    const seconds = parseSeconds(result?.out);
    if (seconds) return seconds;
  }

  const fallback = await runProcess("ffmpeg", ["-hide_banner", "-i", filePath]);
  return parseFfmpegDuration(fallback?.err || "");
}

export class Radio {
  constructor({ dataDir }) {
    this.dataDir = dataDir;
    this.libraryDir = path.join(dataDir, "library");
    this.statePath = path.join(dataDir, "state.json");
    this.library = [];
    this.queue = [];
    this.current = null;
    this.startedAt = null;
    this.ffmpeg = null;
    this.mode = "idle";
    this.generation = 0;
    this.listeners = new Set();
    this.subscribers = new Set();

    fs.mkdirSync(this.libraryDir, { recursive: true });
    this.#load();
    this.tick = setInterval(() => {
      if (this.current) this.#notify();
    }, 1000);
  }

  subscribe(fn) {
    this.subscribers.add(fn);
    fn(this.getState());
    return () => this.subscribers.delete(fn);
  }

  addListener(res) {
    this.listeners.add(res);
    if (!this.current && this.mode !== "silence") this.#playSilence();
    this.#notify();
  }

  removeListener(res) {
    this.listeners.delete(res);
    this.#notify();
    if (this.listeners.size === 0 && this.mode === "silence") {
      this.#stopProcess();
      this.mode = "idle";
    }
  }

  async importFile({ originalName, storedName }) {
    const filePath = path.join(this.libraryDir, storedName);
    const duration = await probeDuration(filePath);
    if (!duration) {
      try {
        fs.unlinkSync(filePath);
      } catch {
        // ignore cleanup failure
      }
      throw new Error("Не удалось прочитать аудиофайл");
    }

    const track = {
      id: randomUUID(),
      name: cleanName(originalName),
      filename: storedName,
      duration,
      addedAt: Date.now(),
    };
    this.library.unshift(track);
    this.queue.push(track.id);
    this.#save();
    this.#ensurePlaying();
    this.#notify();
    return track;
  }

  enqueue(id) {
    const track = this.library.find((item) => item.id === id);
    if (!track) return false;
    this.queue.push(id);
    this.#save();
    this.#ensurePlaying();
    this.#notify();
    return true;
  }

  removeFromQueue(id) {
    const index = this.queue.indexOf(id);
    if (index === -1) return false;
    this.queue.splice(index, 1);
    this.#save();
    this.#notify();
    return true;
  }

  skip() {
    if (!this.current && this.queue.length === 0) return false;
    this.#advance();
    return true;
  }

  getState() {
    const now = this.current
      ? {
          ...publicTrack(this.current),
          startedAt: this.startedAt,
          position: this.#position(),
        }
      : null;

    return {
      station: "91RADIO",
      frequency: "10.91",
      status: this.current ? "playing" : this.mode === "silence" ? "silence" : "idle",
      now,
      queue: this.queue
        .map((id) => {
          const track = this.library.find((item) => item.id === id);
          return track ? publicTrack(track) : null;
        })
        .filter(Boolean),
      library: this.library.map(publicTrack),
      listeners: this.listeners.size,
    };
  }

  destroy() {
    clearInterval(this.tick);
    this.#stopProcess();
    for (const res of this.listeners) {
      try {
        res.end();
      } catch {
        // ignore
      }
    }
    this.listeners.clear();
    this.subscribers.clear();
  }

  #ensurePlaying() {
    if (this.current) return;
    this.#playNext();
  }

  #advance() {
    this.current = null;
    this.startedAt = null;
    this.#playNext();
  }

  #playNext() {
    const nextId = this.queue.shift();
    this.#save();
    if (!nextId) {
      this.current = null;
      this.startedAt = null;
      if (this.listeners.size > 0) this.#playSilence();
      else {
        this.#stopProcess();
        this.mode = "idle";
      }
      this.#notify();
      return;
    }

    const track = this.library.find((item) => item.id === nextId);
    if (!track) {
      this.#playNext();
      return;
    }

    const filePath = path.join(this.libraryDir, track.filename);
    if (!fs.existsSync(filePath)) {
      this.library = this.library.filter((item) => item.id !== track.id);
      this.#save();
      this.#playNext();
      return;
    }

    this.current = track;
    this.startedAt = Date.now();
    this.mode = "playing";
    this.#startFfmpeg(["-i", filePath, ...AUDIO_OUT]);
    this.#notify();
  }

  #playSilence() {
    this.mode = "silence";
    this.#startFfmpeg([
      "-f",
      "lavfi",
      "-i",
      "anullsrc=channel_layout=stereo:sample_rate=44100",
      ...AUDIO_OUT,
    ]);
    this.#notify();
  }

  #startFfmpeg(args) {
    this.#stopProcess();
    const generation = ++this.generation;
    const proc = spawn("ffmpeg", [...STREAM_HEAD, ...args]);
    this.ffmpeg = proc;
    proc.stdout.on("data", (chunk) => this.#broadcast(chunk));
    proc.stderr.on("data", () => {});
    proc.on("error", () => {
      if (this.generation === generation) this.#onProcessEnded(proc);
    });
    proc.on("close", () => {
      if (this.generation === generation) this.#onProcessEnded(proc);
    });
  }

  #onProcessEnded(proc) {
    if (this.ffmpeg !== proc) return;
    this.ffmpeg = null;
    if (this.mode === "playing") this.#advance();
    else this.mode = "idle";
  }

  #stopProcess() {
    this.generation += 1;
    if (!this.ffmpeg) return;
    const proc = this.ffmpeg;
    this.ffmpeg = null;
    proc.stdout.removeAllListeners("data");
    proc.kill("SIGTERM");
    setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        // already gone
      }
    }, 800).unref();
  }

  #broadcast(chunk) {
    for (const res of this.listeners) {
      try {
        res.write(chunk);
      } catch {
        this.listeners.delete(res);
      }
    }
  }

  #position() {
    if (!this.current || !this.startedAt) return 0;
    return Math.min(this.current.duration, (Date.now() - this.startedAt) / 1000);
  }

  #notify() {
    const state = this.getState();
    for (const fn of this.subscribers) {
      try {
        fn(state);
      } catch {
        this.subscribers.delete(fn);
      }
    }
  }

  #load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.statePath, "utf8"));
      this.library = Array.isArray(raw.library) ? raw.library : [];
      this.queue = Array.isArray(raw.queue) ? raw.queue : [];
    } catch {
      this.library = [];
      this.queue = [];
    }
  }

  #save() {
    const payload = JSON.stringify(
      { library: this.library, queue: this.queue },
      null,
      2,
    );
    const tmp = `${this.statePath}.tmp`;
    fs.writeFileSync(tmp, payload);
    fs.renameSync(tmp, this.statePath);
  }
}

function publicTrack(track) {
  return {
    id: track.id,
    name: track.name,
    duration: track.duration,
    addedAt: track.addedAt,
  };
}

function cleanName(name) {
  const base = path.basename(name || "без названия");
  return base.replace(/\.[^.]+$/, "") || base;
}
