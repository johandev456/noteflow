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

## Live notes (Phase 2)

1. In the options, set the LLM base URL, model and API key (default preset: Qwen `qwen3.8-flash` on the international endpoint) and press **Test LLM**.
2. Optionally enter the model prices (USD per 1M tokens) to see an estimated cost in the side panel.
3. Start a recording. Notes update after ~120 new words or ~45 s. Click a note to edit it (edited notes are never overwritten by the model) or press × to delete it.
4. On Stop, a final pass sets the title, a 3-5 line TL;DR and the section order.

## Notion export (Phase 3)

1. Create an internal integration at notion.so/my-integrations and copy its token.
2. In Notion, open the target database (or parent page), use **⋯ → Connections** and add the integration.
3. In the options, paste the token and the destination URL, choose the type, and press **Test Notion**.
4. On Stop the notes are exported automatically (toggle in options). The side panel also has **Sync now** / **Sync again**; syncing again updates the same page instead of creating a duplicate.

For a database, optional properties are filled when they exist with a matching type: `Date`, `URL`, `Duration` (number or text) and `Tags` (multi-select). The page body is: TL;DR, sections, decisions, action items (to-dos), open questions and a toggle with the full transcript.
