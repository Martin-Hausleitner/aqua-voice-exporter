#!/usr/bin/env node
// Aqua STT Bridge — a thin local STT server that forwards audio to Aqua Voice's
// real transcription endpoint and returns real transcripts. Screenpipe (or any
// client) can POST audio here and get Aqua `avalon-v1.1` text back.
//
// The Aqua JWT is read from the local Aqua Voice settings.json AT RUNTIME and is
// never embedded, logged, or returned. See ../AQUA-PROTOCOL.md for the protocol.

import { createServer } from "node:http";
import { readFileSync, existsSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const PORT = Number(process.env.AQUA_BRIDGE_PORT ?? 4182);
const ENDPOINT = process.env.AQUA_ENDPOINT ?? "https://realtime.aquavoice.com/retranscribe";
const DATA_DIR = process.env.AQUA_DATA_DIR ?? join(homedir(), "Library", "Application Support", "Aqua Voice");
const SETTINGS = join(DATA_DIR, "settings.json");
const AUDIO_DIR = join(DATA_DIR, "audio");

function loadSettings() {
  if (!existsSync(SETTINGS)) throw new Error(`Aqua settings.json not found at ${SETTINGS}`);
  return JSON.parse(readFileSync(SETTINGS, "utf8"));
}

// Token is fetched fresh per request and kept only in local scope — never logged.
function getToken() {
  const t = loadSettings().token;
  if (!t) throw new Error("No Aqua JWT in settings.json (field 'token'). Is Aqua Voice signed in?");
  return t;
}

function defaultModel() {
  try { return loadSettings().transcriptionModel || "avalon-v1.1"; } catch { return "avalon-v1.1"; }
}
function defaultLanguage() {
  try { return loadSettings().language || "auto"; } catch { return "auto"; }
}

function listSamples() {
  if (!existsSync(AUDIO_DIR)) return [];
  return readdirSync(AUDIO_DIR)
    .filter((f) => /^AQ_.*\.wav$/.test(f))
    .map((f) => {
      const ms = Number(f.replace(/^AQ_/, "").replace(/\.wav$/, ""));
      return { name: f, bytes: readFileSync(join(AUDIO_DIR, f)).length, timestamp: String(ms) };
    })
    .sort((a, b) => Number(b.timestamp) - Number(a.timestamp));
}

// Transcode arbitrary audio bytes (e.g. browser webm/opus) to 16k mono wav via ffmpeg.
function toWav(bytes, inExt) {
  const dir = mkdtempSync(join(tmpdir(), "aqua-stt-"));
  const inPath = join(dir, `in.${inExt || "bin"}`);
  const outPath = join(dir, "out.wav");
  try {
    writeFileSync(inPath, bytes);
    const r = spawnSync("ffmpeg", ["-y", "-i", inPath, "-ar", "16000", "-ac", "1", "-f", "wav", outPath], { stdio: "ignore" });
    if (r.status !== 0 || !existsSync(outPath)) throw new Error("ffmpeg transcode failed");
    return readFileSync(outPath);
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

// Forward wav bytes to Aqua's real /retranscribe endpoint and return parsed JSON.
async function transcribeWav(wavBytes, { filename = "audio.wav", language, model, timestamp } = {}) {
  const token = getToken();
  const form = new FormData();
  form.append("audio", new Blob([wavBytes], { type: "audio/wav" }), filename);
  form.append("language", language || defaultLanguage());
  form.append("model", model || defaultModel());
  form.append("origin", "aqua_stt_bridge");
  if (timestamp) form.append("timestamp", String(timestamp));
  const res = await fetch(ENDPOINT, { method: "POST", body: form, headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  if (!res.ok) throw new Error(`Aqua HTTP ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};
function jsonRes(res, body, status = 200) {
  const s = JSON.stringify(body, null, 2);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...CORS });
  res.end(s);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  try {
    if (req.method === "OPTIONS") { res.writeHead(204, CORS); return res.end(); }

    if (url.pathname === "/health") {
      let hasToken = false, model = "avalon-v1.1";
      try { hasToken = !!loadSettings().token; model = defaultModel(); } catch {}
      return jsonRes(res, { ok: true, engine: "aqua", endpoint: ENDPOINT, model, language: defaultLanguage(), hasToken, samples: listSamples().length });
    }

    if (url.pathname === "/samples") return jsonRes(res, { data: listSamples() });

    if (url.pathname === "/transcribe" && req.method === "POST") {
      const ct = (req.headers["content-type"] || "").toLowerCase();
      const language = url.searchParams.get("language") || undefined;
      const model = url.searchParams.get("model") || undefined;
      const t0 = Date.now();

      // Mode A: replay a real local AQ_*.wav by name (deterministic real proof path)
      if (ct.includes("application/json")) {
        const body = JSON.parse((await readBody(req)).toString() || "{}");
        const name = body.sample;
        if (!name || !/^AQ_.*\.wav$/.test(name)) return jsonRes(res, { error: "bad_sample" }, 400);
        const p = join(AUDIO_DIR, name);
        if (!existsSync(p)) return jsonRes(res, { error: "sample_not_found", name }, 404);
        const wav = readFileSync(p);
        const out = await transcribeWav(wav, { filename: name, language, model: body.model, timestamp: name.replace(/^AQ_/, "").replace(/\.wav$/, "") });
        return jsonRes(res, { engine: "aqua", model: out.model || model || defaultModel(), sample: name, transcription: out.transcription, duration: out.duration, latencyMs: Date.now() - t0 });
      }

      // Mode B: raw audio bytes in body (e.g. browser mic). Transcode if not wav.
      const bytes = await readBody(req);
      if (!bytes.length) return jsonRes(res, { error: "empty_body" }, 400);
      let wav = bytes;
      if (!ct.includes("wav")) {
        const ext = ct.includes("webm") ? "webm" : ct.includes("ogg") ? "ogg" : ct.includes("mp4") || ct.includes("m4a") ? "m4a" : "bin";
        wav = toWav(bytes, ext);
      }
      const out = await transcribeWav(wav, { language, model });
      return jsonRes(res, { engine: "aqua", model: out.model || model || defaultModel(), transcription: out.transcription, duration: out.duration, latencyMs: Date.now() - t0 });
    }

    return jsonRes(res, { error: "not_found", path: url.pathname }, 404);
  } catch (err) {
    return jsonRes(res, { error: "bridge_error", message: err instanceof Error ? err.message : String(err) }, 500);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`aqua-stt-bridge listening on http://127.0.0.1:${PORT}  → ${ENDPOINT} (model ${defaultModel()})`);
});
