import type { Browser } from 'wxt/browser';
import { OpenAiCompatClient } from '../core/llm/client';
import { Structurer } from '../core/llm/structurer';
import { emptyUsage, type Usage } from '../core/llm/usage';
import { deleteItem, editItem } from '../core/notes/reducer';
import { emptyNotes, hasContent, type NotesState } from '../core/notes/types';
import { describeNotionError, NotionClient } from '../core/notion/client';
import { exportToNotion, parseNotionId, resolveDestination } from '../core/notion/exporter';
import { isNotionConfigured, loadSettings, type Settings } from '../core/storage/settings';
import {
  deleteSession,
  findActiveSession,
  getSession,
  listSessions,
  migrateLegacySession,
  newSession,
  saveSession,
  type SessionRow,
} from '../core/storage/sessions';
import {
  send,
  type ExportState,
  type Message,
  type NotesSnapshot,
  type SessionSnapshot,
  type SessionStatus,
} from '../shared/messages';

const OFFSCREEN_PATH = 'offscreen.html';
const PERSIST_DEBOUNCE_MS = 3000;
const ACTIVE: SessionStatus[] = ['starting', 'recording', 'paused', 'stopping'];

export default defineBackground(() => {
  // The service worker can be suspended; everything below is rebuilt from IndexedDB by recover().
  let state: { status: SessionStatus; connection: SessionSnapshot['connection']; error?: string } =
    {
      status: 'idle',
      connection: 'closed',
    };
  let notesSnap: NotesSnapshot = { notes: emptyNotes(), usage: emptyUsage(), busy: false };
  let exports: Record<string, ExportState> = {};
  /** The active recording, or the latest finished session. */
  let row: SessionRow | null = null;
  let structurer: Structurer | null = null;
  let persistTimer: ReturnType<typeof setTimeout> | null = null;

  const restored = recover().catch(console.error);

  // Handling the click ourselves (instead of openPanelOnActionClick) grants activeTab on that tab,
  // which tabCapture requires. Click the icon on the tab you want to capture, then press Start.
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(console.error);
  browser.action.onClicked.addListener((tab) => {
    if (tab.id) browser.sidePanel.open({ tabId: tab.id }).catch(console.error);
  });

  // ---- persistence -------------------------------------------------------------------------

  function persistSoon(): void {
    if (persistTimer) return;
    persistTimer = setTimeout(persistNow, PERSIST_DEBOUNCE_MS);
  }

  function persistNow(): void {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = null;
    if (!row) return;
    row = { ...row, notes: notesSnap.notes, usage: notesSnap.usage };
    saveSession(row)
      .then(() => send({ type: 'history/changed' }))
      .catch(console.error);
  }

  function adopt(session: SessionRow): void {
    row = session;
    notesSnap = { notes: session.notes, usage: session.usage, busy: false };
    if (session.notionUrl) exports[session.id] = { status: 'done', url: session.notionUrl };
  }

  /** After a service-worker restart: reload the latest session and re-attach to a live recording. */
  async function recover(): Promise<void> {
    await migrateLegacySession().catch(console.error);
    const active = await findActiveSession();
    if (active) {
      const status = (await hasOffscreen()) ? await offscreenStatus() : 'idle';
      if (status !== 'idle') {
        adopt(active);
        state = { status, connection: 'open' };
        structurer = buildStructurer(await loadSettings(), active.notes, active.usage);
        return;
      }
      // The browser was closed (or the capture ended) mid-recording: keep what was saved.
      await saveSession({ ...active, status: 'done', endedAt: active.endedAt ?? active.updatedAt });
    }
    const [latest] = await listSessions(1);
    if (latest) adopt(latest);
  }

  async function offscreenStatus(): Promise<'recording' | 'paused' | 'idle'> {
    try {
      const reply = await Promise.race([
        browser.runtime.sendMessage({ type: 'offscreen/getStatus' }),
        new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 1500)),
      ]);
      const status = (reply as { status?: string } | undefined)?.status;
      return status === 'paused' ? 'paused' : status === 'idle' ? 'idle' : 'recording';
    } catch {
      return 'recording';
    }
  }

  // ---- state helpers -----------------------------------------------------------------------

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

  function setExport(sessionId: string, next: ExportState): void {
    exports = { ...exports, [sessionId]: next };
    send({ type: 'export/state', sessionId, ...next });
  }

  function announceCurrent(): void {
    send({
      type: 'session/current',
      sessionId: row?.id ?? null,
      startedAt: row && ACTIVE.includes(state.status) ? row.startedAt : null,
      transcript: row?.transcript ?? [],
    });
  }

  // ---- offscreen document ------------------------------------------------------------------

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

  // ---- recording ---------------------------------------------------------------------------

  function buildStructurer(settings: Settings, notes: NotesState, usage: Usage): Structurer | null {
    if (!settings.llmApiKey || !settings.llmBaseUrl || !settings.llmModel) return null;
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
      notes,
      usage,
      onNotes: (n) => updateNotes({ notes: n }),
      onUsage: (u) => updateNotes({ usage: u }),
      onBusy: (busy) => updateNotes({ busy }),
      onError: (error) => updateNotes({ error: error ?? undefined }),
    });
  }

  async function startSession(): Promise<void> {
    await restored;
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
      updateNotes({ notes: emptyNotes(), usage: emptyUsage(), busy: false, error: undefined });
      structurer = buildStructurer(settings, notesSnap.notes, notesSnap.usage);
      if (!structurer) {
        updateNotes({ error: 'Add your LLM API key in the extension options to get live notes.' });
      }
      row = newSession({ tabUrl: tab.url, tabTitle: tab.title });
      persistNow();
      announceCurrent();

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

  /** The recording ended: process pending text, run the final pass, then auto-export if enabled. */
  async function finishSession(): Promise<void> {
    const s = structurer;
    structurer = null;
    const id = row?.id;
    if (row) row = { ...row, status: 'done', endedAt: Date.now() };
    persistNow();
    await s?.finalize();
    persistNow();

    const hasData = hasContent(notesSnap.notes) || Boolean(row?.transcript.length);
    if (id && !hasData) {
      // Nothing was captured (for example the capture failed to start): do not keep an empty session.
      await deleteSession(id);
      row = null;
      send({ type: 'history/changed' });
      announceCurrent();
      return;
    }
    const settings = await loadSettings();
    if (id && settings.notionAutoExport && isNotionConfigured(settings)) await exportNow(id);
  }

  // ---- Notion export -----------------------------------------------------------------------

  function remember(id: string, page: { id: string; url?: string }): void {
    const link = { notionPageId: page.id, notionUrl: page.url };
    if (row?.id === id) {
      row = { ...row, ...link };
      persistNow();
      return;
    }
    void getSession(id).then(async (stored) => {
      if (!stored) return;
      await saveSession({ ...stored, ...link });
      send({ type: 'history/changed' });
    });
  }

  async function exportNow(sessionId?: string): Promise<void> {
    await restored;
    const id = sessionId ?? row?.id;
    if (!id || exports[id]?.status === 'syncing') return;

    let target: SessionRow | undefined;
    if (row?.id === id) {
      row = { ...row, notes: notesSnap.notes, usage: notesSnap.usage };
      target = row;
    } else {
      target = await getSession(id);
    }
    if (!target) return setExport(id, { status: 'error', error: 'Session not found.' });
    if (!hasContent(target.notes) && !target.transcript.length) {
      return setExport(id, { status: 'error', error: 'Nothing to export yet.' });
    }

    setExport(id, { status: 'syncing' });
    try {
      const settings = await loadSettings();
      const destinationId = parseNotionId(settings.notionDestination);
      if (!isNotionConfigured(settings) || !destinationId) {
        return setExport(id, {
          status: 'error',
          error: 'Set your Notion token and destination in the extension options.',
        });
      }
      const api = new NotionClient({ token: settings.notionToken });
      const dest = await resolveDestination(api, {
        type: settings.notionDestinationType,
        id: destinationId,
      });
      const result = await exportToNotion(api, dest, target, target.notes, {
        language: settings.notesLanguage,
        tags: settings.notionTags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        // Saved as soon as the page exists so a failed export is retried on it, not duplicated.
        onPage: (page) => remember(id, page),
      });
      remember(id, { id: result.pageId, url: result.url });
      setExport(id, { status: 'done', url: result.url });
    } catch (err) {
      setExport(id, { status: 'error', error: describeNotionError(err) });
    }
  }

  async function removeSession(id: string): Promise<void> {
    if (row?.id === id && ACTIVE.includes(state.status)) return; // never delete a live recording
    await deleteSession(id);
    delete exports[id];
    if (row?.id === id) {
      row = null;
      notesSnap = { notes: emptyNotes(), usage: emptyUsage(), busy: false };
      send({ type: 'notes/state', ...notesSnap });
      announceCurrent();
    }
    send({ type: 'history/changed' });
  }

  // ---- wiring ------------------------------------------------------------------------------

  browser.commands.onCommand.addListener((command) => {
    if (command === 'toggle-recording') toggle();
  });

  function handle(message: Message, sendResponse: (response: unknown) => void): void {
    switch (message.type) {
      case 'session/getState':
        sendResponse({
          status: state.status,
          connection: state.connection,
          error: state.error,
          notes: notesSnap,
          sessionId: row?.id ?? null,
          startedAt: row && ACTIVE.includes(state.status) ? row.startedAt : null,
          transcript: row?.transcript ?? [],
          exports,
        } satisfies SessionSnapshot);
        return;
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
        if (message.isFinal && row) {
          structurer?.pushFinal(message.text);
          row.transcript.push(message.text);
          persistSoon();
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
      case 'export/sync': {
        const other = message.sessionId && message.sessionId !== row?.id;
        if (other || state.status === 'idle' || state.status === 'error') {
          void exportNow(message.sessionId);
        }
        return;
      }
      case 'session/delete':
        void removeSession(message.sessionId);
        return;
    }
  }

  browser.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
    // Handled only after recovery, in arrival order, so no event is lost on a cold start.
    void restored.then(() => handle(message, sendResponse));
    return message.type === 'session/getState'; // keeps the channel open for the async response
  });
});
