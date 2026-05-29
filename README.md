# Aqua Voice Exporter

A Python script that reads all locally stored [Aqua Voice](https://aquavoice.com) data and exports it as structured JSON and optional CSV files — with a human-readable summary in the terminal.

> **Platform:** macOS only (Aqua Voice is a macOS app)  
> **Python:** 3.10+ (no external dependencies)

---

## What gets exported

Aqua Voice stores all data locally in:

```
~/Library/Application Support/Aqua Voice/
~/Library/Logs/Aqua Voice/
~/Library/Preferences/com.electron.aqua-voice.plist
```

This exporter reads and structures the following:

### `summary.json` — Overall statistics
| Field | Description |
|-------|-------------|
| `total_words_all_time` | Lifetime word count tracked by the app |
| `history_entries_stored` | Number of entries in the local history (max 100) |
| `history_period_start/end` | Date range of the stored history |
| `total_audio_minutes_in_history` | Total recorded audio (from history entries) |
| `audio_files_on_disk` | Number of `.wav` files stored locally |
| `audio_total_size_mb` | Total disk space used by audio files |
| `current_microphone` | Active microphone device name |
| `transcription_model` | Whisper variant used |
| `language` | Primary dictation language |
| `devices_tracked` | Number of distinct microphones ever used |

---

### `history.json` — Transcription history (last 100 entries)
Each entry contains:

| Field | Description |
|-------|-------------|
| `timestamp` | ISO 8601 timestamp (UTC) |
| `content` | AI-corrected/cleaned transcription text |
| `rawText` | Raw Whisper output before LLM post-processing |
| `sessionId` | Internal session identifier |
| `audioFilePath` | Relative path to the `.wav` recording |
| `audioDurationSeconds` | Length of the recorded audio |

> **Note:** Aqua Voice only keeps the last 100 history entries in `settings.json`. The `.wav` audio files persist on disk until manually deleted.

---

### `daily_stats.json` — Per-day statistics (derived from history)
| Field | Description |
|-------|-------------|
| `date` | YYYY-MM-DD |
| `transcriptions` | Total sessions that day |
| `transcriptions_with_text` | Sessions that produced text |
| `empty_or_cancelled` | Sessions cancelled or with no output |
| `total_audio_seconds` | Total audio recorded |
| `total_audio_minutes` | Same in minutes |
| `total_words_transcribed` | Word count from cleaned transcriptions |
| `avg_words_per_transcription` | Average words per session |
| `avg_duration_seconds` | Average session length |

---

### `devices.json` — Microphone / device breakdown
Derived from `mic_timings.json` which tracks latency per device.

| Field | Description |
|-------|-------------|
| `device_id` | SHA-256 hash of the device identifier |
| `label` | Human-readable microphone name (e.g. "AirPods", "Chat-Audeze Maxwell") |
| `sessions_tracked` | Number of timing samples collected |
| `avg_latency_ms` | Average mic-to-transcription latency in milliseconds |
| `min_latency_ms` / `max_latency_ms` | Latency range |
| `first_seen` / `last_seen` | Date range this device was used |

> History entries themselves don't record which device was used per-session. Device data comes from the latency tracker.

---

### `config.json` — App configuration
All settings from `settings.json` **except** the auth token and history. Includes:
- Hotkeys
- Word replacements / autocorrect rules
- Custom instructions (LLM post-processing prompt)
- Feature flags (deepContext, privacyMode, computerControl, etc.)
- Saved languages, notification history

---

### `server_stats.json` — Server-side statistics (all devices combined)
Retrieved from `https://core.aquavoice.com/users/stats/` using the token stored in `settings.json`.
This is the same data shown in the Aqua Voice app under Statistics.

> **Important:** This data is aggregated across **all your devices** — unlike the local history which only reflects the current machine.

| Field | Description |
|-------|-------------|
| `stats.total_words` | Lifetime word count across all devices |
| `stats.total_characters` | Total characters dictated |
| `stats.average_wpm` | Your average words per minute |
| `stats.faster_than_percent` | Percentile ranking vs. all Aqua Voice users |
| `stats.time_saved_hours` | Estimated hours saved vs. typing |
| `stats.sessions_count` | Total dictation sessions ever |
| `stats.current_streak_days` | Current daily usage streak |
| `stats.longest_streak_days` | All-time longest streak |
| `stats.level` | Gamification level (name, progress %, words to next) |
| `stats.top_app` | App you dictate into most |
| `daily_activity[]` | Full per-day history: `date`, `word_count`, `session_count` (since account creation) |
| `user.plan` | Subscription type (free / pro) |
| `user.member_since` | Account creation date |

> **Multi-device note:** Aqua Voice does not expose a device list API endpoint. The `mic_timings.json` file (local) is the only place where individual microphone devices are tracked. The server-side stats are device-agnostic.

---

### `server_profile.json` — Account profile
Retrieved from `https://core.aquavoice.com/users/profile/`.

| Field | Description |
|-------|-------------|
| `id` | User ID |
| `email` | Account email |
| `name` | Display name |
| `subscription_status` | active / inactive |
| `subscription.plan_type` | pro / free |
| `subscription.billing_interval` | annual / monthly |
| `token_balance` | API token usage balance |
| `referral_code` | Your referral code |

---

### `audio_files.json` — Audio file inventory
Metadata for every `.wav` file in the audio directory:

| Field | Description |
|-------|-------------|
| `filename` | `AQ_<epoch_ms>.wav` |
| `path` | Absolute path |
| `size_bytes` | File size |
| `timestamp_ms` | Epoch milliseconds from the filename |
| `timestamp_iso` | ISO 8601 timestamp |

---

## What is NOT exported by this script

| Data | Location | Notes |
|------|----------|-------|
| Auth token (JWT) | `settings.json → token` | Intentionally excluded |
| Audio file contents | `audio/*.wav` | Script lists metadata only — copy manually if needed |
| LevelDB data | `Local Storage/leveldb/` | Binary format; contains Electron/renderer state |
| Cookies / session storage | `Cookies`, `Session Storage/` | Electron web storage |
| Sentry error reports | `sentry/queue/` | Crash reports pending upload |
| Log files | `~/Library/Logs/Aqua Voice/` | Copy manually from that directory |

---

## Usage

```bash
# Basic export (JSON only)
python3 exporter.py

# Export to custom directory
python3 exporter.py --output ~/Documents/my_aqua_export

# Also write CSV files
python3 exporter.py --csv

# Skip audio file listing (faster)
python3 exporter.py --no-audio-list

# Custom data directory
python3 exporter.py --data-dir "/path/to/Aqua Voice"
```

### Output structure

```
aqua_voice_export/
├── summary.json        ← overall statistics
├── history.json        ← last 100 transcriptions
├── daily_stats.json    ← per-day aggregates
├── devices.json        ← per-microphone breakdown
├── config.json         ← app settings (no token)
├── audio_files.json    ← metadata for all .wav files
├── history.csv         ← (with --csv)
├── daily_stats.csv     ← (with --csv)
└── devices.csv         ← (with --csv)
```

---

## Local data structure reference

```
~/Library/Application Support/Aqua Voice/
├── settings.json           ← main config + last 100 transcriptions + word count
├── mic_timings.json        ← per-device latency measurements (all sessions)
├── audio/
│   └── AQ_<epoch_ms>.wav   ← raw audio recordings (not auto-deleted)
├── session_outcome_v2_outbox.json  ← streaming telemetry queued for upload
├── sentry/                 ← error reporting queue
│   ├── scope_v3.json       ← HTTP breadcrumbs + UI events
│   ├── session.json
│   └── queue/
├── Local Storage/leveldb/  ← Electron renderer state (binary)
├── Cache/                  ← HTTP cache
└── Preferences             ← Electron-level settings (spellcheck, device salt)

~/Library/Logs/Aqua Voice/
├── main.log                ← dictation sessions, latency, session IDs
├── main.old.log
└── bridge.log              ← AquaMacOSBridge communication

~/Library/Preferences/
└── com.electron.aqua-voice.plist   ← macOS-level prefs
```

---

## Privacy note

All data is local. This script reads only from your own machine and writes only to the output directory you specify. Nothing is uploaded.

The auth token in `settings.json` grants access to your Aqua Voice account at `core.aquavoice.com` and is intentionally not included in the export.
