import type { Browser } from 'wxt/browser';
import { OpenAiCompatClient } from '../core/llm/client';
import { Structurer } from '../core/llm/structurer';
import { emptyUsage } from '../core/llm/usage';
import { deleteItem, editItem } from '../core/notes/reducer';
import { emptyNotes } from '../core/notes/types';
import { loadSettings } from '../core/storage/settings';
import {
  send,
  type Message,
  type NotesSnapshot,
  type SessionSnapshot,
  type SessionStatus,
} from '../shared/messages';

const OFFSCREEN_PATH = 'offscreen.html';
const NOTES_KEY = 'notesSnapshot';

export default defineBackground(() => {
  // The service worker can be suspended, so this is rebuilt from offscreen events when it wakes.
  let state: Omit<SessionSnapshot, 'notes'> = { status: 'idle', connection: 'closed' };
  let notesSnap: NotesSnapshot = { notes: emptyNotes(), usage: emptyUsage(), busy: false };
  let structurer: Structurer | null = null;

  // Restore the last notes after a service-worker restart so the panel can still show them.
  browser.storage.session
    .get(NOTES_KEY)
    .then((stored) => {
      const saved = stored[NOTES_KEY] as NotesSnapshot | undefined;
      if (saved && !structurer) notesSnap = { ...saved, busy: false };
    })
    .catch(() => {});

  // Handling the click ourselves (instead of openPanelOnActionClick) grants activeTab on that tab,
  // which tabCapture requires. Click the icon on the tab you want to capture, then press Start.
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(console.error);
  browser.action.onClicked.addListener((tab) => {
    if (tab.id) browser.sidePanel.open({ tabId: tab.id }).catch(console.error);
  });

  function setStatus(status: SessionStatus, error?: string, broadcast = true): void {
    state = { ...state, status, error };
    if (broadcast) send({ type: 'session/status', status, error });
    if (status === 'idle' || status === 'error') void closeOffscreen();
  }

  function updateNotes(patch: Partial<NotesSnapshot>): void {
    notesSnap = { ...notesSnap, ...patch };
    send({ type: 'notes/state', ...notesSnap });
    browser.storage.session.set({ [NOTES_KEY]: notesSnap }).catch(() => {});
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

  /** The recording ended: process any pending text and run the final pass. */
  function finishNotes(): void {
    const s = structurer;
    structurer = null;
    void s?.finalize();
  }

  browser.commands.onCommand.addListener((command) => {
    if (command === 'toggle-recording') toggle();
  });

  browser.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
    switch (message.type) {
      case 'session/getState':
        sendResponse({ ...state, notes: notesSnap } satisfies SessionSnapshot);
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
        if (ended && was !== 'idle' && was !== 'error') finishNotes();
        return;
      }
      case 'stt/connection':
        state = { ...state, connection: message.state };
        return;
      case 'stt/transcript':
        if (message.isFinal) structurer?.pushFinal(message.text);
        return;
      case 'notes/edit':
        updateNotes({ notes: editItem(notesSnap.notes, message.id, message.text) });
        structurer?.setNotes(notesSnap.notes);
        return;
      case 'notes/delete':
        updateNotes({ notes: deleteItem(notesSnap.notes, message.id) });
        structurer?.setNotes(notesSnap.notes);
        return;
    }
  });
});
