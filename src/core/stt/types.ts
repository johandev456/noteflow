export type ConnectionState = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface TranscriptResult {
  text: string;
  isFinal: boolean;
}

export interface SttError {
  message: string;
  /** Fatal errors will not be retried; the session should stop. */
  fatal: boolean;
}

export interface SttEvents {
  onTranscript(result: TranscriptResult): void;
  onConnection(state: ConnectionState): void;
  onError(error: SttError): void;
}

/** Streaming speech-to-text provider. Audio is PCM16 mono 16 kHz. */
export interface SttProvider {
  connect(): void;
  sendAudio(pcm: ArrayBuffer): void;
  /** Flush pending results and close. Resolves when the socket is closed. */
  close(): Promise<void>;
}
