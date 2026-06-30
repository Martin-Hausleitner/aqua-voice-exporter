# Screenpipe-UI integration — Aqua Voice engine

This folder holds the **UI wiring** that makes "Aqua Voice" a selectable transcription engine in the
Screenpipe Live UI, kept **out of the ws:29 working tree** so the manager can apply it deliberately.

> ⚠️ The Screenpipe Live UI (`packages/web/src/pages/LivePage.tsx`, `packages/live-bridge/`, …) is the
> in-flight WIP of lane **ws:29**. These changes are **additive only** — nothing of ws:29's logic is
> removed. Apply on top of the current `screenpipe-ui` working tree.

## Files

- `AquaEnginePanel.tsx` → copy to `screenpipe-ui/packages/web/src/pages/AquaEnginePanel.tsx`
  (brand-new file, self-contained; talks directly to the local `aqua-stt-bridge`).
- `LivePage.tsx.aqua.patch` → additive diff for `packages/web/src/pages/LivePage.tsx`.

## Apply

```bash
cd ~/code/screenpipe-ui
cp ~/code/aqua-voice-exporter/screenpipe-ui-integration/AquaEnginePanel.tsx packages/web/src/pages/
git apply ~/code/aqua-voice-exporter/screenpipe-ui-integration/LivePage.tsx.aqua.patch
```

(If `git apply` rejects due to drift, the patch is tiny — 4 hunks — and can be applied by hand:
add the `AquaEnginePanel` import + `sttEngines` const, an `sttEngine` state, an engine-aware label in
the header, an "Transcription engine" dropdown card, render `<AquaEnginePanel/>` when `aqua`, and wrap
the existing "Whisper settings" card in `{sttEngine === "whisper" && ( … )}`.)

## Run

```bash
# 1) start the Aqua bridge (separate terminal)
node ~/code/aqua-voice-exporter/aqua-stt-bridge/server.mjs       # http://127.0.0.1:4182

# 2) start the UI
cd ~/code/screenpipe-ui && bun run --cwd packages/web vite dev
# open /live → gear (Settings) → Engine: "Aqua Voice (avalon-v1.1)"
```

Selecting Aqua shows the Aqua panel; "Transcribe sample" / "Record mic" produce a **real Aqua
transcript** rendered live. Whisper remains the default engine; no ws:29 behaviour changes.

## Verified

See `../.proof/2026-07-01_aqua-engine-live.png` (full UI) and `..._panel.png` (real transcript:
*"Alles, was ich dir heute so gesagt habe, jetzt über Nacht …"*, model `avalon-v1.1`, 1380 ms).
