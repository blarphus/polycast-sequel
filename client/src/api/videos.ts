import { request } from './core';
import { emitFallbackDiagnostic, type FallbackDiagnostic } from '../utils/fallbackDiagnostics';

export interface VideoSummary {
  id: string;
  youtube_id: string;
  title: string;
  channel: string;
  language: string;
  duration_seconds: number | null;
  transcript_status: 'missing' | 'processing' | 'ready' | 'failed';
  transcript_source?: 'manual' | 'auto' | 'none' | 'innertube' | 'youtubei';
  cefr_level: string | null;
  transcript_progress: number;
}

export interface TranscriptSegment {
  text: string;
  offset: number;
  duration: number;
}

export interface VideoDetail extends VideoSummary {
  transcript: TranscriptSegment[] | null;
  transcript_last_error?: string | null;
  transcript_error?: string;
}

export interface TrendingVideo {
  youtube_id: string;
  title: string;
  channel: string;
  thumbnail: string;
  duration_seconds: number | null;
  published_at: string;
  has_captions?: boolean;
}

export interface ChannelSummary {
  name: string;
  handle: string;
  channelId: string;
  thumbnails: string[];
}

export interface ChannelDetail {
  channel: { name: string; handle: string };
  videos: TrendingVideo[];
}

export interface LessonSummary {
  id: string;
  title: string;
  thumbnails: string[];
  videoCount: number;
}

export interface LessonDetail {
  lesson: { id: string; title: string };
  videos: TrendingVideo[];
}

function detectUserRegion(): string {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    const parts = locale.split('-');
    if (parts.length >= 2) {
      const region = parts[parts.length - 1].toUpperCase();
      if (region.length === 2) return region;
    }
  } catch (error) {
    emitFallbackDiagnostic({
      code: 'region_detection_fallback',
      severity: 'info',
      title: 'Regional video filtering unavailable',
      message: 'Browser locale detection failed, so video requests will use the provider default region.',
      detail: error instanceof Error ? error.message : String(error),
    }, { source: 'web.videos', operation: 'detect-user-region' });
  }
  return '';
}

export function getVideo(id: string) {
  return request<VideoDetail>(`/videos/${id}`);
}

export function addVideo(url: string, language: string) {
  return request<VideoDetail>('/videos', { method: 'POST', body: { url, language } });
}

export function getTrendingVideos(lang: string) {
  const region = detectUserRegion();
  const params = new URLSearchParams({ lang });
  if (region) params.set('userRegion', region);
  return request<TrendingVideo[]>(`/videos/trending?${params}`, { cacheTtlMs: 300_000 });
}

export function getChannels(lang: string) {
  return request<ChannelSummary[]>(`/videos/channels?lang=${encodeURIComponent(lang)}`, { cacheTtlMs: 300_000 });
}

export function getChannelVideos(handle: string, lang: string) {
  const region = detectUserRegion();
  const params = new URLSearchParams({ lang });
  if (region) params.set('userRegion', region);
  return request<ChannelDetail>(`/videos/channel/${encodeURIComponent(handle)}?${params}`);
}

export function getLessons(lang: string) {
  const region = detectUserRegion();
  const params = new URLSearchParams({ lang });
  if (region) params.set('userRegion', region);
  return request<LessonSummary[]>(`/videos/lessons?${params}`);
}

export function getLessonVideos(id: string, lang: string) {
  const region = detectUserRegion();
  const params = new URLSearchParams({ lang });
  if (region) params.set('userRegion', region);
  return request<LessonDetail>(`/videos/lesson/${encodeURIComponent(id)}?${params}`);
}

export function searchVideos(query: string, lang: string) {
  const region = detectUserRegion();
  const params = new URLSearchParams({ q: query, lang });
  if (region) params.set('userRegion', region);
  return request<TrendingVideo[]>(`/videos/search?${params}`);
}

export function retryVideoTranscript(id: string) {
  return request<VideoDetail>(`/videos/${id}/transcript/retry`, { method: 'POST' });
}

export async function checkVideoPlayability(videoIds: string[]): Promise<{ blocked: Set<string>; shorts: Set<string> }> {
  const data = await request<{ success: boolean; results: Record<string, string | { status: string; isShort: boolean; diagnostic?: FallbackDiagnostic }> }>(
    '/videos/playability',
    { method: 'POST', body: { videoIds } },
  );
  if (!data.success || !data.results) {
    throw new Error('Playability service returned an invalid response');
  }
  const blocked = new Set<string>();
  const shorts = new Set<string>();
  for (const [id, result] of Object.entries(data.results)) {
    if (typeof result === 'string') {
      if (result !== 'OK') blocked.add(id);
    } else {
      const r = result as { status: string; isShort: boolean; diagnostic?: FallbackDiagnostic };
      if (r.diagnostic) {
        emitFallbackDiagnostic(r.diagnostic, { source: 'web.video', operation: 'check-playability' });
      }
      if (r.status !== 'OK') blocked.add(id);
      if (r.isShort) shorts.add(id);
    }
  }
  return { blocked, shorts };
}

export async function fetchTranscriptFromWorker(youtubeId: string, lang: string): Promise<TranscriptSegment[]> {
  const params = new URLSearchParams({ youtubeId, lang });
  const data = await request<{ segments: TranscriptSegment[] }>(`/videos/transcript/youtube?${params}`);
  if (!Array.isArray(data.segments)) throw new Error('Transcript service returned an invalid response');
  return data.segments;
}

export function uploadTranscript(videoId: string, segments: TranscriptSegment[]): Promise<VideoDetail> {
  return request<VideoDetail>(`/videos/${videoId}/transcript`, {
    method: 'PUT',
    body: { segments },
  });
}
