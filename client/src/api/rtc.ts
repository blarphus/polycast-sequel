import { request } from './core';

export function getIceServers() {
  return request<{ iceServers: RTCIceServer[]; turnAvailable: boolean }>('/ice-servers');
}
