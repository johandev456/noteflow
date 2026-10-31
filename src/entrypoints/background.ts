import type { Browser } from 'wxt/browser';
import { loadSettings } from '../core/storage/settings';
import { send, type Message, type SessionSnapshot, type SessionStatus } from '../shared/messages';

const OFFSCREEN_PATH = 'offscreen.html';

export default defineBackground(() => {
  // The service worker can be suspended, so this is rebuilt from offscreen events when it wakes.
  let state: SessionSnapshot = { status: 'idle', connection: 'closed' };

  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

  function setStatus(status: SessionStatus, error?: string, broadcast = true): void {
    state = { ...state, status, error };
    if (broadcast) send({ type: 'session/status', status, error });
    if (status === 'idle' || status === 'error') void closeOffscreen();
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

  async function startSession(): Promise<void> {
    if (state.status !== 'idle' && state.status !== 'error') return;
    setStatus('starting');
    try {
      const { deepgramApiKey, sttLanguage } = await loadSettings();
      if (!deepgramApiKey) {
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
      send({ type: 'offscreen/start', streamId, apiKey: deepgramApiKey, language: sttLanguage });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      setStatus('error', `Could not start capture: ${reason}`);
    }
  }

  function toggle(): void {
    if (state.status === 'recording' || state.status === 'paused') {
      send({ type: 'offscreen/stop' });
    } else {
      void startSession();
    }
  }

  browser.commands.onCommand.addListener((command) => {
    if (command === 'toggle-recording') toggle();
  });

  browser.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
    switch (message.type) {
      case 'session/getState':
        sendResponse(state);
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
      case 'session/status':
        setStatus(message.status, message.error, false);
        return;
      case 'stt/connection':
        state = { ...state, connection: message.state };
        return;
    }
  });
});
