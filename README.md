# NoteFlow

Chrome extension (MV3) that transcribes tab audio live, structures notes with AI and exports them to Notion. Personal use, bring your own keys, no backend. See `SPEC_NOTE_CLONE.md`.

## Development

```bash
pnpm install
pnpm dev        # dev build with HMR, writes .output/chrome-mv3-dev
pnpm build      # production build, writes .output/chrome-mv3
pnpm test       # vitest
pnpm compile    # type check
pnpm lint
```

## Load in Chrome

1. Run `pnpm build` (or `pnpm dev`).
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select `.output/chrome-mv3` (`.output/chrome-mv3-dev` for dev).
4. Click the NoteFlow icon to open the side panel. Open the extension's **Details → Extension options** to set API keys.

Keys are stored in `chrome.storage.local` only. `.env.example` is for development notes and is never read at runtime.

## Try live transcription (Phase 1)

1. In the extension options, paste a Deepgram API key and save.
2. Open a tab with audio (for example a YouTube video) and click the NoteFlow icon to open the side panel.
3. Press **Start** (or `Alt+Shift+N`). The transcript appears live and the tab keeps playing.
4. The capture applies to the tab that was active when you pressed Start.
