import { describe, expect, it } from 'vitest';
import {
  API_CONTRACT_SOURCE_HASH,
  API_GOLDEN_FIXTURES,
  type APIContractTranscriptResponse,
  type CallSignal,
  type ExtensionMessage,
  type GroupCallSignal,
} from '../generated/apiContract';

describe('generated API contract fixtures', () => {
  it('types the transcript, socket, and extension fixtures from one source hash', () => {
    const transcript: APIContractTranscriptResponse = API_GOLDEN_FIXTURES.transcriptResponse;
    const signal: GroupCallSignal = API_GOLDEN_FIXTURES.groupCallSignal;
    const callSignal: CallSignal = API_GOLDEN_FIXTURES.callSignal;
    const extension: ExtensionMessage = API_GOLDEN_FIXTURES.extensionMessage;
    expect(API_CONTRACT_SOURCE_HASH).toMatch(/^[a-f0-9]{64}$/);
    expect(transcript.segments[0].words[1]).toEqual({ text: 'mundo', offset: 450 });
    expect(signal.roomId).toBe('22222222-2222-4222-8222-222222222222');
    expect(callSignal.callId).toBe('55555555-5555-4555-8555-555555555555');
    expect(extension.type).toBe('MATCH_PAGE_TOKENS');
  });
});
