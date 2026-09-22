import express from "express";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeOriginalName, Radio } from "./radio.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TRACKS_DIR = path.join(ROOT, "tracks");
const PORT = Number(process.env.PORT || 9191);
const HOST = process.env.HOST || "127.0.0.1";

const radio = new Radio({ tracksDir: TRACKS_DIR });
const app = express();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, TRACKS_DIR),
  filename: (_req, file, cb) => {
    const raw = decodeOriginalName(file.originalname);
    const safe = path.basename(raw).replace(/[/\\]/g, "-") || "track";
    cb(null, safe);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024, files: 20 },
});

app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});
app.use(express.json());
app.use(express.static(path.join(ROOT, "public")));

app.get("/api/state", (_req, res) => {
  res.json(radio.getState());
});

app.get("/api/events", (req, res) => {
  req.socket.setTimeout(0);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-store");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  const send = (state) => {
    res.write(`data: ${JSON.stringify(state)}\n\n`);
  };
  const unsubscribe = radio.subscribe(send);
  req.on("close", unsubscribe);
});

app.get("/stream", (req, res) => {
  req.socket.setTimeout(0);
  res.setHeader("Content-Type", "audio/mpeg");
  res.setHeader("Cache-Control", "no-cache, no-store");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("icy-name", "91RADIO");
  res.setHeader("icy-genre", "LAN");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  radio.addListener(res);
  req.on("close", () => radio.removeListener(res));
});

app.post("/api/upload", upload.array("files", 20), async (req, res) => {
  try {
    const files = req.files || [];
    if (files.length === 0) {
      res.status(400).json({ error: "Файлы не пришли" });
      return;
    }
    await radio.syncFolder();
    res.json({
      imported: files.map((file) => ({
        name: decodeOriginalName(file.originalname).replace(/\.[^.]+$/, ""),
      })),
    });
  } catch (error) {
    res.status(400).json({ error: error.message || "Не удалось поставить в эфир" });
  }
});

app.post("/api/skip", (_req, res) => {
  radio.skip();
  res.json({ ok: true });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`91RADIO в эфире`);
  console.log(`  http://127.0.0.1:${PORT}/`);
  console.log(`  треки: ${TRACKS_DIR}`);
});

server.timeout = 0;
server.keepAliveTimeout = 0;

function shutdown() {
  radio.destroy();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
