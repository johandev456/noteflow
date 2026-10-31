import type { Browser } from 'wxt/browser';
import { OpenAiCompatClient } from '../core/llm/client';
import { Structurer } from '../core/llm/structurer';
import { emptyUsage } from '../core/llm/usage';
import { deleteItem, editItem } from '../core/notes/reducer';
import { emptyNotes, hasContent } from '../core/notes/types';
import { describeNotionError, NotionClient } from '../core/notion/client';
import {
  exportToNotion,
  parseNotionId,
  resolveDestination,
  type ExportSession,
} from '../core/notion/exporter';
import { isNotionConfigured, loadSettings } from '../core/storage/settings';
import {
  send,
  type ExportState,
  type Message,
  type NotesSnapshot,
  type SessionSnapshot,
  type SessionStatus,
} from '../shared/messages';

const OFFSCREEN_PATH = 'offscreen.html';
const SESSION_KEY = 'lastSession';
const PERSIST_DEBOUNCE_MS = 3000;

/** What is kept of the latest recording so it can be exported later (Phase 4 moves this to IndexedDB). */
type SessionRecord = ExportSession & { notionUrl?: string };

interface StoredSession {
  record: SessionRecord | null;
  notes: NotesSnapshot;
}

export default defineBackground(() => {
  // The service worker can be suspended, so this is rebuilt from offscreen events when it wakes.
  let state: Omit<SessionSnapshot, 'notes' | 'export' | 'hasSession'> = {
    status: 'idle',
    connection: 'closed',
  };
  let notesSnap: NotesSnapshot = { notes: emptyNotes(), usage: emptyUsage(), busy: false };
  let exportState: ExportState = { status: 'idle' };
  let record: SessionRecord | null = null;
  let structurer: Structurer | null = null;
  let persistTimer: ReturnType<typeof setTimeout> | null = null;

  // Restore the last session after a service-worker restart so it can still be shown and exported.
  const restored = browser.storage.local
    .get(SESSION_KEY)
    .then((stored) => {
      const saved = stored[SESSION_KEY] as StoredSession | undefined;
      if (!saved || structurer) return;
      record = saved.record;
      notesSnap = { ...saved.notes, busy: false };
      if (record?.notionUrl) exportState = { status: 'done', url: record.notionUrl };
    })
    .catch(() => {});

  // Handling the click ourselves (instead of openPanelOnActionClick) grants activeTab on that tab,
  // which tabCapture requires. Click the icon on the tab you want to capture, then press Start.
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(console.error);
  browser.action.onClicked.addListener((tab) => {
    if (tab.id) browser.sidePanel.open({ tabId: tab.id }).catch(console.error);
  });

  function persistSoon(): void {
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
      persistTimer = null;
      persistNow();
    }, PERSIST_DEBOUNCE_MS);
  }

  function persistNow(): void {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = null;
    const stored: StoredSession = { record, notes: notesSnap };
    browser.storage.local.set({ [SESSION_KEY]: stored }).catch(() => {});
  }

  function setStatus(status: SessionStatus, error?: string, broadcast = true): void {
    state = { ...state, status, error };
    if (broadcast) send({ type: 'session/status', status, error });
    if (status === 'idle' || status === 'error') void closeOffscreen();
  }

  function updateNotes(patch: Partial<NotesSnapshot>): void {
    notesSnap = { ...notesSnap, ...patch };
    send({ type: 'notes/state', ...notesSnap });
    persistSoon();
  }

  function setExport(next: ExportState): void {
    exportState = next;
    send({ type: 'export/state', ...next });
  }

  async function hasOffscreen(): Promise<boolean> {
    const contexts = await browser.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT' as Browser.runtime.ContextType],
    });
    return contexts.length > 0;
  }

  async function ensureOffscreen(): Promise<void> {
    if (await hasOffscreen()) return;
    await browser.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['USER_MEDIA' as Browser.offscreen.Reason],
      justification: 'Capture and process tab audio for live transcription.',
    });
  }

  async function closeOffscreen(): Promise<void> {
    if (await hasOffscreen()) await browser.offscreen.closeDocument().catch(() => {});
  }

  function createStructurer(settings: Awaited<ReturnType<typeof loadSettings>>): Structurer | null {
    updateNotes({ notes: emptyNotes(), usage: emptyUsage(), busy: false, error: undefined });
    if (!settings.llmApiKey || !settings.llmBaseUrl || !settings.llmModel) {
      updateNotes({ error: 'Add your LLM API key in the extension options to get live notes.' });
      return null;
    }
    return new Structurer({
      llm: new OpenAiCompatClient({
        baseUrl: settings.llmBaseUrl,
        apiKey: settings.llmApiKey,
        model: settings.llmModel,
      }),
      config: {
        minWords: settings.triggerWords,
        maxWaitMs: settings.triggerSeconds * 1000,
        language: settings.notesLanguage,
      },
      notes: notesSnap.notes,
      usage: notesSnap.usage,
      onNotes: (notes) => updateNotes({ notes }),
      onUsage: (usage) => updateNotes({ usage }),
      onBusy: (busy) => updateNotes({ busy }),
      onError: (error) => updateNotes({ error: error ?? undefined }),
    });
  }

  async function startSession(): Promise<void> {
    if (state.status !== 'idle' && state.status !== 'error') return;
    setStatus('starting');
    try {
      const settings = await loadSettings();
      if (!settings.deepgramApiKey) {
        setStatus('error', 'Add your Deepgram API key in the extension options first.');
        return;
      }
      const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab?.id || /^(chrome|edge|about|chrome-extension):/.test(tab.url ?? '')) {
        setStatus('error', 'Open the tab you want to capture (a regular web page) and try again.');
        return;
      }
      const streamId = await browser.tabCapture.getMediaStreamId({ targetTabId: tab.id });
      await ensureOffscreen();
      structurer?.dispose();
      structurer = createStructurer(settings);
      record = { startedAt: Date.now(), tabUrl: tab.url, tabTitle: tab.title, transcript: [] };
      setExport({ status: 'idle' });
      send({
        type: 'offscreen/start',
        streamId,
        apiKey: settings.deepgramApiKey,
        language: settings.sttLanguage,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const hint = /not been invoked|activeTab/i.test(reason)
        ? 'Click the NoteFlow icon (or press Alt+Shift+N) while on the tab you want to capture, then press Start.'
        : '';
      setStatus('error', `Could not start capture: ${reason} ${hint}`.trim());
    }
  }

  function toggle(): void {
    if (state.status === 'recording' || state.status === 'paused') {
      send({ type: 'offscreen/stop' });
    } else {
      void startSession();
    }
  }

  async function exportNow(): Promise<void> {
    await restored;
    if (exportState.status === 'syncing') return;
    if (!record || (!hasContent(notesSnap.notes) && !record.transcript.length)) {
      setExport({ status: 'error', error: 'Nothing to export yet.' });
      return;
    }
    setExport({ status: 'syncing' });
    try {
      const settings = await loadSettings();
      const destinationId = parseNotionId(settings.notionDestination);
      if (!isNotionConfigured(settings) || !destinationId) {
        setExport({
          status: 'error',
          error: 'Set your Notion token and destination in the extension options.',
        });
        return;
      }
      const api = new NotionClient({ token: settings.notionToken });
      const dest = await resolveDestination(api, {
        type: settings.notionDestinationType,
        id: destinationId,
      });
      const result = await exportToNotion(api, dest, record, notesSnap.notes, {
        language: settings.notesLanguage,
        tags: settings.notionTags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        // Saved immediately so a failed export is retried on the same page, not duplicated.
        onPage: (page) => {
          if (record) record = { ...record, notionPageId: page.id, notionUrl: page.url };
          persistNow();
        },
      });
      if (record) record = { ...record, notionPageId: result.pageId, notionUrl: result.url };
      persistNow();
      setExport({ status: 'done', url: result.url });
    } catch (err) {
      setExport({ status: 'error', error: describeNotionError(err) });
    }
  }

  /** The recording ended: process pending text, run the final pass, then auto-export if enabled. */
  async function finishSession(): Promise<void> {
    const s = structurer;
    structurer = null;
    if (record) record = { ...record, endedAt: Date.now() };
    persistNow();
    await s?.finalize();
    persistNow();
    const hasData = hasContent(notesSnap.notes) || Boolean(record?.transcript.length);
    const settings = await loadSettings();
    if (hasData && settings.notionAutoExport && isNotionConfigured(settings)) await exportNow();
  }

  browser.commands.onCommand.addListener((command) => {
    if (command === 'toggle-recording') toggle();
  });

  browser.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
    switch (message.type) {
      case 'session/getState':
        restored.then(() =>
          sendResponse({
            ...state,
            notes: notesSnap,
            export: exportState,
            hasSession: Boolean(record),
          } satisfies SessionSnapshot),
        );
        return true; // respond asynchronously
      case 'session/start':
        void startSession();
        return;
      case 'session/stop':
        send({ type: 'offscreen/stop' });
        return;
      case 'session/pause':
        send({ type: 'offscreen/pause' });
        return;
      case 'session/resume':
        send({ type: 'offscreen/resume' });
        return;
      // Events emitted by the offscreen document: mirror them into our snapshot only.
      case 'session/status': {
        const was = state.status;
        setStatus(message.status, message.error, false);
        const ended = message.status === 'idle' || message.status === 'error';
        if (ended && was !== 'idle' && was !== 'error') void finishSession();
        return;
      }
      case 'stt/connection':
        state = { ...state, connection: message.state };
        return;
      case 'stt/transcript':
        if (message.isFinal) {
          structurer?.pushFinal(message.text);
          if (record) {
            record.transcript.push(message.text);
            persistSoon();
          }
        }
        return;
      case 'notes/edit':
        updateNotes({ notes: editItem(notesSnap.notes, message.id, message.text) });
        structurer?.setNotes(notesSnap.notes);
        return;
      case 'notes/delete':
        updateNotes({ notes: deleteItem(notesSnap.notes, message.id) });
        structurer?.setNotes(notesSnap.notes);
        return;
      case 'export/sync':
        if (state.status === 'idle' || state.status === 'error') void exportNow();
        return;
    }
  });
});
