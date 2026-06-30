import { useCallback, useEffect, useRef, useState } from "react";

// Self-contained Aqua Voice STT engine panel. Talks to the local aqua-stt-bridge
// (see aqua-voice-exporter/aqua-stt-bridge) which forwards audio to Aqua's real
// /retranscribe endpoint and returns real transcripts. Kept in its own file so the
// ws:29 live WIP (LivePage/live-bridge) is only extended additively.

const DEFAULT_BRIDGE_URL = "http://127.0.0.1:4182";

export function getAquaBridgeUrl(): string {
  try {
    return window.localStorage.getItem("screenpipe-ui.aqua.bridgeUrl") || DEFAULT_BRIDGE_URL;
  } catch {
    return DEFAULT_BRIDGE_URL;
  }
}

interface AquaSample {
  name: string;
  bytes: number;
  timestamp: string;
}
interface AquaResult {
  transcription: string;
  model: string;
  sample?: string;
  duration?: number;
  latencyMs?: number;
}

export function AquaEnginePanel() {
  const [bridgeUrl, setBridgeUrl] = useState(getAquaBridgeUrl());
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [samples, setSamples] = useState<AquaSample[]>([]);
  const [sample, setSample] = useState("");
  const [result, setResult] = useState<AquaResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const h = await (await fetch(`${bridgeUrl}/health`)).json();
      setHealth(h);
      const s = await (await fetch(`${bridgeUrl}/samples`)).json();
      setSamples(s.data ?? []);
      if (!sample && s.data?.[0]) setSample(s.data[0].name);
    } catch (e) {
      setError(
        `Cannot reach Aqua bridge at ${bridgeUrl}. Start it: node aqua-stt-bridge/server.mjs`
      );
    }
  }, [bridgeUrl, sample]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const transcribeSample = useCallback(async () => {
    if (!sample) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`${bridgeUrl}/transcribe`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sample }),
      });
      const out = (await r.json()) as AquaResult & { error?: string };
      if (out.error) throw new Error(out.error);
      setResult(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : "transcribe failed");
    } finally {
      setBusy(false);
    }
  }, [bridgeUrl, sample]);

  const toggleRecord = useCallback(async () => {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (ev) => ev.data.size && chunksRef.current.push(ev.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        setBusy(true);
        setError(null);
        try {
          const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
          const r = await fetch(`${bridgeUrl}/transcribe?language=de`, {
            method: "POST",
            headers: { "content-type": rec.mimeType || "audio/webm" },
            body: blob,
          });
          const out = (await r.json()) as AquaResult & { error?: string };
          if (out.error) throw new Error(out.error);
          setResult(out);
        } catch (e) {
          setError(e instanceof Error ? e.message : "mic transcribe failed");
        } finally {
          setBusy(false);
        }
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
    } catch (e) {
      setError("Microphone not available");
    }
  }, [bridgeUrl, recording]);

  const online = !!health?.hasToken;

  return (
    <div className="flex-none rounded-md border border-emerald-800/60 bg-emerald-950/20 p-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-emerald-200">Aqua Voice engine</h2>
        <span
          className={`rounded px-2 py-0.5 text-[10px] ${
            online ? "bg-emerald-800/60 text-emerald-200" : "bg-red-900/60 text-red-200"
          }`}
        >
          {online ? `online · ${String(health?.model ?? "avalon-v1.1")}` : "bridge offline"}
        </span>
      </div>

      <p className="mb-2 text-[11px] leading-5 text-emerald-300/80">
        Live transcription via Aqua Voice (<code>realtime.aquavoice.com</code>). Pick a real sample or
        record the mic — the real Aqua transcript appears below.
      </p>

      <div className="grid gap-2">
        <label className="text-xs text-emerald-400/80">
          Sample audio
          <select
            value={sample}
            onChange={(e) => setSample(e.target.value)}
            className="mt-1 w-full rounded-md border border-emerald-800 bg-gray-900 px-2 py-2 text-sm text-gray-100 outline-none"
          >
            {samples.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name} ({Math.round(s.bytes / 1024)} KB)
              </option>
            ))}
          </select>
        </label>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={transcribeSample}
            disabled={busy || !sample || !online}
            className="flex-1 rounded-md border border-emerald-700 bg-emerald-800/40 px-3 py-2 text-sm text-emerald-100 disabled:opacity-40"
          >
            {busy ? "Transcribing…" : "Transcribe sample"}
          </button>
          <button
            type="button"
            onClick={toggleRecord}
            disabled={busy && !recording}
            className={`flex-1 rounded-md border px-3 py-2 text-sm disabled:opacity-40 ${
              recording
                ? "border-red-600 bg-red-800/40 text-red-100"
                : "border-emerald-700 bg-emerald-800/40 text-emerald-100"
            }`}
          >
            {recording ? "Stop & transcribe" : "Record mic"}
          </button>
        </div>

        <label className="text-xs text-emerald-400/70">
          Bridge URL
          <input
            value={bridgeUrl}
            onChange={(e) => {
              setBridgeUrl(e.target.value);
              try {
                window.localStorage.setItem("screenpipe-ui.aqua.bridgeUrl", e.target.value);
              } catch {
                /* ignore */
              }
            }}
            className="mt-1 w-full rounded-md border border-emerald-900 bg-gray-900 px-2 py-1.5 text-xs text-gray-300 outline-none"
          />
        </label>
      </div>

      {error && (
        <div className="mt-2 rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {result && (
        <div className="mt-3 rounded-md border border-emerald-800/60 bg-gray-950 p-3">
          <div className="mb-1 flex items-center gap-2 text-[10px] text-emerald-400/80">
            <span className="rounded bg-emerald-800/60 px-1.5 py-0.5">Aqua · {result.model}</span>
            {result.sample && <span>{result.sample}</span>}
            {typeof result.latencyMs === "number" && <span>{result.latencyMs} ms</span>}
            {typeof result.duration === "number" && <span>{result.duration.toFixed(1)} s audio</span>}
          </div>
          <p className="text-sm leading-6 text-gray-100">{result.transcription}</p>
        </div>
      )}
    </div>
  );
}
