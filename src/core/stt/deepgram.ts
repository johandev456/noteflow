import { z } from 'zod';
import type { SttEvents, SttProvider, TranscriptResult } from './types';

const LISTEN_URL = 'wss://api.deepgram.com/v1/listen';
const KEEP_ALIVE_MS = 8000;
const CLOSE_TIMEOUT_MS = 3000;
const MAX_INITIAL_FAILURES = 3;
const MAX_RECONNECTS = 10;
const MAX_PENDING_CHUNKS = 50; // ~5 s of audio at 100 ms per chunk

export interface DeepgramOptions {
  apiKey: string;
  language: string;
}

export function buildListenUrl(language: string): string {
  const params = new URLSearchParams({
    model: 'nova-3',
    language,
    encoding: 'linear16',
    sample_rate: '16000',
    channels: '1',
    interim_results: 'true',
    smart_format: 'true',
    endpointing: '300',
  });
  return `${LISTEN_URL}?${params.toString()}`;
}

export function backoffDelay(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 15000);
}

const resultsSchema = z.object({
  type: z.literal('Results'),
  is_final: z.boolean().optional(),
  channel: z.object({
    alternatives: z.array(z.object({ transcript: z.string() })).min(1),
  }),
});

/** Returns null for non-result messages and for empty transcripts. */
export function parseTranscript(data: unknown): TranscriptResult | null {
  const parsed = resultsSchema.safeParse(data);
  if (!parsed.success) return null;
  const text = parsed.data.channel.alternatives[0]?.transcript.trim() ?? '';
  if (!text) return null;
  return { text, isFinal: parsed.data.is_final ?? false };
}

export class DeepgramProvider implements SttProvider {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private everOpened = false;
  private closing = false;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pending: ArrayBuffer[] = [];

  constructor(
    private readonly opts: DeepgramOptions,
    private readonly events: SttEvents,
  ) {}

  connect(): void {
    this.events.onConnection(this.everOpened ? 'reconnecting' : 'connecting');
    // Browsers cannot set an Authorization header on WebSocket; Deepgram accepts the key as a subprotocol.
    const ws = new WebSocket(buildListenUrl(this.opts.language), ['token', this.opts.apiKey]);
    this.ws = ws;

    ws.onopen = () => {
      this.everOpened = true;
      this.attempt = 0;
      this.events.onConnection('open');
      this.startKeepAlive();
      for (const chunk of this.pending) ws.send(chunk);
      this.pending = [];
    };

    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      let json: unknown;
      try {
        json = JSON.parse(ev.data);
      } catch {
        return;
      }
      const result = parseTranscript(json);
      if (result) this.events.onTranscript(result);
    };

    ws.onclose = (ev) => {
      this.stopKeepAlive();
      if (this.ws === ws) this.ws = null;
      if (this.closing) {
        this.events.onConnection('closed');
        return;
      }
      this.handleUnexpectedClose(ev.code);
    };

    ws.onerror = () => {
      // Details are not exposed by browsers; handled in onclose.
    };
  }

  sendAudio(pcm: ArrayBuffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(pcm);
      return;
    }
    this.pending.push(pcm);
    if (this.pending.length > MAX_PENDING_CHUNKS) this.pending.shift();
  }

  close(): Promise<void> {
    this.closing = true;
    this.stopKeepAlive();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const ws = this.ws;
    if (!ws || ws.readyState === WebSocket.CLOSED) {
      this.events.onConnection('closed');
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        ws.close();
        resolve();
      }, CLOSE_TIMEOUT_MS);
      ws.addEventListener('close', () => {
        clearTimeout(timeout);
        resolve();
      });
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'CloseStream' }));
      } else {
        ws.close();
      }
    });
  }

  private handleUnexpectedClose(code: number): void {
    if (code === 1008) {
      this.events.onError({
        message: 'Deepgram rejected the connection (invalid API key?).',
        fatal: true,
      });
      this.events.onConnection('closed');
      return;
    }
    const failures = this.attempt + 1;
    if (!this.everOpened && failures >= MAX_INITIAL_FAILURES) {
      this.events.onError({
        message: 'Could not connect to Deepgram. Check your API key, credit balance and network.',
        fatal: true,
      });
      this.events.onConnection('closed');
      return;
    }
    if (failures > MAX_RECONNECTS) {
      this.events.onError({ message: 'Lost connection to Deepgram.', fatal: true });
      this.events.onConnection('closed');
      return;
    }
    this.events.onConnection('reconnecting');
    const delay = backoffDelay(this.attempt);
    this.attempt = failures;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private startKeepAlive(): void {
    this.stopKeepAlive();
    this.keepAliveTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'KeepAlive' }));
      }
    }, KEEP_ALIVE_MS);
  }

  private stopKeepAlive(): void {
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    this.keepAliveTimer = null;
  }
}
