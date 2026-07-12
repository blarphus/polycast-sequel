import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  let user: { id: string } | null = { id: 'user-1' };
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    get user() { return user; },
    setUser(value: { id: string } | null) { user = value; },
    join: vi.fn(async () => undefined),
    leave: vi.fn(),
    resetToggles: vi.fn(),
    socket: {
      on(event: string, handler: (...args: unknown[]) => void) {
        const entries = listeners.get(event) ?? new Set();
        entries.add(handler);
        listeners.set(event, entries);
      },
      off(event: string, handler: (...args: unknown[]) => void) { listeners.get(event)?.delete(handler); },
      emit: vi.fn(),
    },
    listeners,
  };
});

vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('../hooks/useGroupCall', () => ({
  useGroupCall: () => ({
    localStreamRef: { current: { getAudioTracks: () => [] } },
    remoteStreams: new Map(),
    participants: [],
    callStatus: 'connected',
    streamReady: true,
    join: mocks.join,
    leave: mocks.leave,
    peersRef: { current: new Map() },
  }),
}));
vi.mock('../hooks/useMediaToggles', () => ({
  useMediaToggles: () => ({
    isMuted: false,
    isCameraOff: false,
    toggleMute: vi.fn(),
    toggleCamera: vi.fn(),
    reset: mocks.resetToggles,
  }),
}));
vi.mock('../socket', () => ({ default: mocks.socket }));
vi.mock('../api', () => ({ leaveGroupCall: vi.fn(async () => undefined) }));
vi.mock('../transcription', () => ({
  TranscriptionService: class {
    start() {}
    stop() {}
    setMuted() {}
  },
}));

import { GroupCallProvider, useActiveGroupCall, type ActiveGroupCallValue } from '../contexts/GroupCallProvider';

function RouteProbe({ route, publish }: { route: string; publish: (value: ActiveGroupCallValue) => void }) {
  const value = useActiveGroupCall();
  useEffect(() => publish(value), [publish, value]);
  return <div data-route={route} data-room={value.postId ?? ''} />;
}

describe('GroupCallProvider app-shell ownership', () => {
  let root: Root;
  let container: HTMLDivElement;
  let latest: ActiveGroupCallValue | null;
  const publish = (value: ActiveGroupCallValue) => { latest = value; };

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    mocks.setUser({ id: 'user-1' });
    mocks.listeners.clear();
    vi.clearAllMocks();
    latest = null;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  function app(route: string) {
    return <GroupCallProvider><RouteProbe route={route} publish={publish} /></GroupCallProvider>;
  }

  it('persists one session across route content and tears it down on auth logout', async () => {
    const room = '11111111-1111-4111-8111-111111111111';
    await act(async () => root.render(app('/group-call/room')));
    await act(async () => latest!.joinRoom(room));
    expect(latest!.postId).toBe(room);
    expect(mocks.join).toHaveBeenCalledTimes(1);

    await act(async () => root.render(app('/home')));
    await act(async () => root.render(app('/group-call/room')));
    expect(latest!.postId).toBe(room);
    expect(mocks.join).toHaveBeenCalledTimes(1);
    expect(mocks.listeners.get('transcript')?.size).toBe(1);

    mocks.setUser(null);
    await act(async () => root.render(app('/home')));
    expect(mocks.leave).toHaveBeenCalledTimes(1);
    expect(mocks.resetToggles).toHaveBeenCalledTimes(1);
    expect(latest!.postId).toBeNull();
  });
});
