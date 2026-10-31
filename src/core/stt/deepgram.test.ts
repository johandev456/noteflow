import { describe, expect, it } from 'vitest';
import { backoffDelay, buildListenUrl, checkDeepgramKey, parseTranscript } from './deepgram';

describe('buildListenUrl', () => {
  it('requests nova-3 linear16 16 kHz with interim results', () => {
    const url = new URL(buildListenUrl('multi'));
    expect(url.host).toBe('api.deepgram.com');
    expect(url.searchParams.get('model')).toBe('nova-3');
    expect(url.searchParams.get('language')).toBe('multi');
    expect(url.searchParams.get('encoding')).toBe('linear16');
    expect(url.searchParams.get('sample_rate')).toBe('16000');
    expect(url.searchParams.get('interim_results')).toBe('true');
  });
});

describe('parseTranscript', () => {
  const msg = (transcript: string, is_final: boolean) => ({
    type: 'Results',
    is_final,
    channel: { alternatives: [{ transcript }] },
  });

  it('parses final and interim results', () => {
    expect(parseTranscript(msg('hola mundo', true))).toEqual({ text: 'hola mundo', isFinal: true });
    expect(parseTranscript(msg('hola', false))).toEqual({ text: 'hola', isFinal: false });
  });

  it('ignores empty transcripts and other message types', () => {
    expect(parseTranscript(msg('  ', true))).toBeNull();
    expect(parseTranscript({ type: 'Metadata' })).toBeNull();
    expect(parseTranscript('nope')).toBeNull();
  });
});

describe('checkDeepgramKey', () => {
  const fakeFetch = (res: Response | Error) =>
    (async () => {
      if (res instanceof Error) throw res;
      return res;
    }) as unknown as typeof fetch;

  it('maps statuses to valid, invalid and unknown', async () => {
    expect(await checkDeepgramKey('k', fakeFetch(new Response('{}', { status: 200 })))).toEqual({
      status: 'valid',
    });
    expect(await checkDeepgramKey('k', fakeFetch(new Response('{}', { status: 401 })))).toEqual({
      status: 'invalid',
    });
    expect(
      await checkDeepgramKey('k', fakeFetch(new Response('{}', { status: 403 }))),
    ).toMatchObject({
      status: 'unknown',
    });
    expect(await checkDeepgramKey('k', fakeFetch(new TypeError('offline')))).toMatchObject({
      status: 'unknown',
    });
  });

  it('sends the key with the Token scheme', async () => {
    let auth = '';
    const spy = (async (_url: string, init: RequestInit) => {
      auth = (init.headers as Record<string, string>).Authorization ?? '';
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    await checkDeepgramKey('abc', spy);
    expect(auth).toBe('Token abc');
  });
});

describe('backoffDelay', () => {
  it('grows exponentially and caps at 15 s', () => {
    expect(backoffDelay(0)).toBe(1000);
    expect(backoffDelay(2)).toBe(4000);
    expect(backoffDelay(10)).toBe(15000);
  });
});
