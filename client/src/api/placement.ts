import { request } from './core';

export function getPlacementWords(language: string, level: string) {
  const params = new URLSearchParams({ language, level });
  return request<{ words: string[]; level: string }>(`/placement-test?${params}`);
}
