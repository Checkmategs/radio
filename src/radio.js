import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const AUDIO_EXT = /\.(mp3|wav|flac|ogg|oga|m4a|aac|opus|webm)$/i;
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

export function cleanName(name) {
  const base = path.basename(name || "без названия");
  return base.replace(/\.[^.]+$/, "") || base;
}

export class Radio {
  constructor({ tracksDir }) {
    this.tracksDir = tracksDir;
    this.library = [];
    this.queue = [];
    this.current = null;
    this.startedAt = null;
    this.ffmpeg = null;
    this.mode = "idle";
    this.generation = 0;
    this.listeners = new Set();
    this.subscribers = new Set();
    this.syncing = false;

    fs.mkdirSync(this.tracksDir, { recursive: true });
    this.tick = setInterval(() => {
      if (this.current) this.#notify();
    }, 1000);
    this.watcher = fs.watch(this.tracksDir, () => {
      clearTimeout(this.watchTimer);
      this.watchTimer = setTimeout(() => {
        this.syncFolder().catch(() => {});
      }, 400);
    });
    this.ready = this.syncFolder();
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

  async syncFolder() {
    if (this.syncing) {
      this.syncAgain = true;
      return;
    }
    this.syncing = true;
    try {
      const names = fs
        .readdirSync(this.tracksDir)
        .filter((name) => AUDIO_EXT.test(name) && !name.startsWith("."));
      names.sort((a, b) => a.localeCompare(b, "ru", { numeric: true, sensitivity: "base" }));

      const nextLibrary = [];
      for (const filename of names) {
        const filePath = path.join(this.tracksDir, filename);
        let stat;
        try {
          stat = fs.statSync(filePath);
        } catch {
          continue;
        }
        const prev = this.library.find((item) => item.filename === filename);
        if (prev && prev.mtime === stat.mtimeMs) {
          nextLibrary.push(prev);
          continue;
        }
        const duration = await probeDuration(filePath);
        if (!duration) continue;
        nextLibrary.push({
          id: filename,
          name: cleanName(filename),
          filename,
          duration,
          mtime: stat.mtimeMs,
          addedAt: Date.now(),
        });
      }

      this.library = nextLibrary;
      const ids = new Set(nextLibrary.map((item) => item.id));
      this.queue = this.queue.filter((id) => ids.has(id));
      if (this.current && !ids.has(this.current.id)) this.#advance();
      else this.#ensurePlaying();
      this.#notify();
    } finally {
      this.syncing = false;
      if (this.syncAgain) {
        this.syncAgain = false;
        await this.syncFolder();
      }
    }
  }

  getState() {
    const now = this.current
      ? {
          id: this.current.id,
          name: this.current.name,
          duration: this.current.duration,
          startedAt: this.startedAt,
          position: this.#position(),
        }
      : null;

    return {
      station: "91RADIO",
      frequency: "10.91",
      status: this.current ? "playing" : this.mode === "silence" ? "silence" : "idle",
      now,
      listeners: this.listeners.size,
    };
  }

  destroy() {
    clearInterval(this.tick);
    clearTimeout(this.watchTimer);
    try {
      this.watcher?.close();
    } catch {
      // ignore
    }
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

  #refill() {
    for (const track of this.library) this.queue.push(track.id);
  }

  #playNext() {
    if (this.queue.length === 0) this.#refill();
    const nextId = this.queue.shift();
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

    const filePath = path.join(this.tracksDir, track.filename);
    if (!fs.existsSync(filePath)) {
      this.library = this.library.filter((item) => item.id !== track.id);
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
}
