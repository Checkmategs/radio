import express from "express";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Radio } from "./radio.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TRACKS_DIR = path.join(ROOT, "tracks");
const PORT = Number(process.env.PORT || 9191);
const HOST = process.env.HOST || "0.0.0.0";

const radio = new Radio({ tracksDir: TRACKS_DIR });
const app = express();

app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});
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

const server = app.listen(PORT, HOST, () => {
  console.log(`91RADIO в эфире`);
  for (const url of lanUrls(PORT)) console.log(`  ${url}`);
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
