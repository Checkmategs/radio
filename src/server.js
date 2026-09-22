import express from "express";
import multer from "multer";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { decodeOriginalName, Radio } from "./radio.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, "data");
const PORT = Number(process.env.PORT || 9191);
const HOST = process.env.HOST || "0.0.0.0";

const radio = new Radio({ dataDir: DATA_DIR });
const app = express();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, radio.libraryDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").slice(0, 8) || ".bin";
    cb(null, `${randomUUID()}${ext.toLowerCase()}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024, files: 20 },
});

app.disable("x-powered-by");
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
    const imported = [];
    for (const file of files) {
      imported.push(
        await radio.importFile({
          originalName: decodeOriginalName(file.originalname),
          storedName: file.filename,
        }),
      );
    }
    res.json({ imported: imported.map((track) => ({ id: track.id, name: track.name })) });
  } catch (error) {
    res.status(400).json({ error: error.message || "Не удалось поставить в эфир" });
  }
});

app.post("/api/queue", (req, res) => {
  const id = String(req.body?.id || "");
  if (!radio.enqueue(id)) {
    res.status(404).json({ error: "Трека нет в библиотеке" });
    return;
  }
  res.json({ ok: true });
});

app.delete("/api/queue/:id", (req, res) => {
  if (!radio.removeFromQueue(req.params.id)) {
    res.status(404).json({ error: "Этого трека нет в очереди" });
    return;
  }
  res.json({ ok: true });
});

app.post("/api/skip", (_req, res) => {
  radio.skip();
  res.json({ ok: true });
});

const server = app.listen(PORT, HOST, () => {
  const urls = lanUrls(PORT);
  console.log(`91RADIO в эфире`);
  for (const url of urls) console.log(`  ${url}`);
  console.log(`  поток: /stream`);
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

function lanUrls(port) {
  const urls = [`http://127.0.0.1:${port}/`];
  const nets = os.networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const item of list || []) {
      if (item.family === "IPv4" && !item.internal) {
        urls.push(`http://${item.address}:${port}/`);
      }
    }
  }
  return urls;
}
