import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const emitted: Array<{ event: string; payload: unknown }> = [];
  const socket = {
    connected: true,
    on(event: string, handler: (...args: unknown[]) => void) {
      const entries = listeners.get(event) ?? new Set();
      entries.add(handler);
      listeners.set(event, entries);
      return socket;
    },
    off(event: string, handler: (...args: unknown[]) => void) {
      listeners.get(event)?.delete(handler);
      return socket;
    },
    emit(event: string, payload: unknown) {
      emitted.push({ event, payload });
      return socket;
    },
    trigger(event: string, payload?: unknown) {
      for (const handler of listeners.get(event) ?? []) handler(payload);
    },
  };
  return {
    socket,
    listeners,
    emitted,
    getIceServers: vi.fn(async () => ({ iceServers: [] })),
    joinGroupCall: vi.fn(async () => ({ groupCallId: 'call', participants: [] })),
    leaveGroupCall: vi.fn(async () => undefined),
    closePeerConnection: vi.fn(),
  };
});

vi.mock('../socket', () => ({ default: mocks.socket, socket: mocks.socket }));
vi.mock('../api', () => ({
  getIceServers: mocks.getIceServers,
  joinGroupCall: mocks.joinGroupCall,
  leaveGroupCall: mocks.leaveGroupCall,
}));
vi.mock('../webrtc', () => ({
  createPeerConnection: vi.fn(() => ({
    addTrack: vi.fn(),
    createOffer: vi.fn(async () => ({ type: 'offer', sdp: 'v=0' })),
    createAnswer: vi.fn(async () => ({ type: 'answer', sdp: 'v=0' })),
    setLocalDescription: vi.fn(async () => undefined),
    setRemoteDescription: vi.fn(async () => undefined),
  })),
  closePeerConnection: mocks.closePeerConnection,
  addIceCandidate: vi.fn(async () => undefined),
}));

import { useGroupCall } from '../hooks/useGroupCall';

type GroupCallValue = ReturnType<typeof useGroupCall>;

function Probe({ roomId, publish }: { roomId: string | null; publish: (value: GroupCallValue) => void }) {
  const value = useGroupCall(roomId);
  useEffect(() => publish(value), [publish, value]);
  return <div data-status={value.callStatus} />;
}

describe('group call lifecycle ownership', () => {
  let container: HTMLDivElement;
  let root: Root;
  let latest: GroupCallValue | null;
  let tracks: Array<{ stop: ReturnType<typeof vi.fn> }>;
  const publish = (value: GroupCallValue) => { latest = value; };

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    latest = null;
    tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => ({ getTracks: () => tracks })) },
    });
    mocks.listeners.clear();
    mocks.emitted.length = 0;
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('keeps one listener set, rejoins signaling after reconnect, rejects stale rooms, and tears down media', async () => {
    const room = '11111111-1111-4111-8111-111111111111';
    await act(async () => root.render(<Probe roomId={room} publish={publish} />));
    await act(async () => { await latest!.join(); });

    expect(latest!.callStatus).toBe('connected');
    expect(mocks.joinGroupCall).toHaveBeenCalledTimes(1);
    expect(mocks.emitted.filter(({ event }) => event === 'group:join')).toHaveLength(1);
    for (const event of ['group:offer', 'group:answer', 'group:ice', 'group:participant-left', 'connect']) {
      expect(mocks.listeners.get(event)?.size).toBe(1);
    }

    await act(async () => mocks.socket.trigger('connect'));
    expect(mocks.emitted.filter(({ event }) => event === 'group:join')).toHaveLength(2);
    expect(mocks.joinGroupCall).toHaveBeenCalledTimes(1);

    const diagnostics: unknown[] = [];
    window.addEventListener('polycast:fallback', ((event: CustomEvent) => diagnostics.push(event.detail)) as EventListener, { once: true });
    await act(async () => mocks.socket.trigger('group:participant-left', {
      roomId: '22222222-2222-4222-8222-222222222222',
      userId: '33333333-3333-4333-8333-333333333333',
      correlationId: 'stale-event-correlation',
      occurredAt: '2026-07-12T00:00:00.000Z',
    }));
    expect(diagnostics).toEqual([expect.objectContaining({ code: 'group_call_degraded', title: 'Stale group call event ignored' })]);

    await act(async () => root.render(<Probe roomId={null} publish={publish} />));
    expect(tracks.every((track) => track.stop.mock.calls.length === 1)).toBe(true);
    expect(mocks.leaveGroupCall).toHaveBeenCalledWith(room);
    for (const handlers of mocks.listeners.values()) expect(handlers.size).toBeLessThanOrEqual(1);
  });

  it('cancels an in-flight join and releases media when the target room changes', async () => {
    let releaseIce!: (value: { iceServers: never[] }) => void;
    mocks.getIceServers.mockImplementationOnce(() => new Promise((resolve) => { releaseIce = resolve; }));
    const firstRoom = '11111111-1111-4111-8111-111111111111';
    const nextRoom = '22222222-2222-4222-8222-222222222222';
    await act(async () => root.render(<Probe roomId={firstRoom} publish={publish} />));

    let pending!: Promise<void>;
    await act(async () => { pending = latest!.join(); });
    await act(async () => root.render(<Probe roomId={nextRoom} publish={publish} />));
    await act(async () => { releaseIce({ iceServers: [] }); await pending; });

    expect(tracks.every((track) => track.stop.mock.calls.length >= 1)).toBe(true);
    expect(mocks.joinGroupCall).not.toHaveBeenCalled();
    expect(mocks.emitted.some(({ event, payload }) => event === 'group:join' && (payload as { roomId: string }).roomId === firstRoom)).toBe(false);
  });
});
