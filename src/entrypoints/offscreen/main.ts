/**
 * Offscreen document: owns the tab audio stream, the AudioWorklet and the STT socket.
 * It lives here because the MV3 service worker is suspended when idle.
 */
import { DeepgramProvider } from '../../core/stt/deepgram';
import type { SttProvider } from '../../core/stt/types';
import { send, type Message } from '../../shared/messages';

interface ActiveSession {
  stream: MediaStream;
  ctx: AudioContext;
  stt: SttProvider;
  paused: boolean;
  stopping: boolean;
}

let session: ActiveSession | null = null;

async function start(streamId: string, apiKey: string, language: string): Promise<void> {
  if (session) return;
  // `mandatory` constraints for tab capture are Chrome-specific and absent from the DOM typings.
  const constraints = {
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
    video: false,
  } as unknown as MediaStreamConstraints;
  const stream = await navigator.mediaDevices.getUserMedia(constraints);

  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  // Capturing mutes the tab for the user; route it back to the speakers.
  source.connect(ctx.destination);

  await ctx.audioWorklet.addModule(browser.runtime.getURL('/pcm-worklet.js'));
  const worklet = new AudioWorkletNode(ctx, 'pcm-processor');
  const silent = ctx.createGain();
  silent.gain.value = 0; // keeps the worklet in the rendering graph without doubling the audio
  source.connect(worklet).connect(silent).connect(ctx.destination);

  const stt = new DeepgramProvider(
    { apiKey, language },
    {
      onTranscript: (r) => send({ type: 'stt/transcript', text: r.text, isFinal: r.isFinal }),
      onConnection: (state) => send({ type: 'stt/connection', state }),
      onError: (e) => {
        send({ type: 'session/status', status: 'error', error: e.message });
        if (e.fatal) void teardown();
      },
    },
  );
  const active: ActiveSession = { stream, ctx, stt, paused: false, stopping: false };
  session = active;

  worklet.port.onmessage = (ev: MessageEvent<{ pcm: ArrayBuffer; level: number }>) => {
    if (active.paused) return;
    stt.sendAudio(ev.data.pcm);
    send({ type: 'audio/level', level: ev.data.level });
  };

  // Tab closed or capture revoked.
  stream.getAudioTracks()[0]?.addEventListener('ended', () => void stop());

  stt.connect();
  send({ type: 'session/status', status: 'recording' });
}

async function stop(): Promise<void> {
  const active = session;
  if (!active || active.stopping) return;
  active.stopping = true;
  send({ type: 'session/status', status: 'stopping' });
  await active.stt.close(); // CloseStream flushes the last final results
  await teardown();
  send({ type: 'session/status', status: 'idle' });
}

async function teardown(): Promise<void> {
  const active = session;
  session = null;
  if (!active) return;
  active.stream.getTracks().forEach((t) => t.stop());
  await active.ctx.close().catch(() => {});
}

function setPaused(paused: boolean): void {
  if (!session) return;
  session.paused = paused;
  if (paused) send({ type: 'audio/level', level: 0 });
  send({ type: 'session/status', status: paused ? 'paused' : 'recording' });
}

browser.runtime.onMessage.addListener((message: Message) => {
  switch (message.type) {
    case 'offscreen/start':
      start(message.streamId, message.apiKey, message.language).catch((err: unknown) => {
        void teardown();
        const reason = err instanceof Error ? err.message : String(err);
        send({
          type: 'session/status',
          status: 'error',
          error: `Could not capture tab audio: ${reason}`,
        });
      });
      break;
    case 'offscreen/stop':
      void stop();
      break;
    case 'offscreen/pause':
      setPaused(true);
      break;
    case 'offscreen/resume':
      setPaused(false);
      break;
  }
});
