import { request } from './core';

export interface NewsArticle {
  original_title: string;
  simplified_title: string;
  difficulty: string | null;
  words: { word: string; translation: string }[];
  source: string;
  link: string;
  image: string | null;
  preview: string | null;
}

export interface ArticleDetail {
  title: string;
  source: string;
  link: string;
  image: string | null;
  body: string | null;
  level: string | null;
  extractionFailed?: boolean;
  rewriteFailed?: boolean;
}

export interface StreamedArticleMeta {
  title: string;
  source: string;
  link: string;
  image: string | null;
  level: string | null;
}

interface StreamNewsArticleOptions {
  signal?: AbortSignal;
  onMeta?: (meta: StreamedArticleMeta) => void;
  onChunk?: (text: string) => void;
  onDone?: (article: ArticleDetail) => void;
}

export function getNews(lang: string, level?: string | null): Promise<NewsArticle[]> {
  const params = new URLSearchParams({ lang });
  if (level) params.set('level', level);
  return request(`/news?${params}`);
}

export function getNewsArticle(lang: string, index: number, level?: string | null): Promise<ArticleDetail> {
  const params = new URLSearchParams({ lang, index: String(index) });
  if (level && level !== 'Original') params.set('level', level);
  return request(`/news/article?${params}`);
}

export async function streamNewsArticleRewrite(
  lang: string,
  index: number,
  level: string,
  { signal, onMeta, onChunk, onDone }: StreamNewsArticleOptions = {},
): Promise<void> {
  const params = new URLSearchParams({ lang, index: String(index), level });
  const res = await fetch(`/api/news/article/stream?${params}`, {
    credentials: 'include',
    headers: { Accept: 'text/event-stream' },
    signal,
  });

  if (!res.ok) {
    let payload: any;
    try {
      payload = await res.json();
    } catch (parseErr) {
      console.error(`GET /news/article/stream failed to parse error response (${res.status}):`, parseErr);
      throw new Error(`GET /news/article/stream failed (${res.status} ${res.statusText})`);
    }
    throw new Error(payload.error ?? payload.message ?? `GET /news/article/stream failed (${res.status})`);
  }

  if (!res.body) {
    throw new Error('Streaming article response had no body');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const handleEvent = (eventName: string, payload: any) => {
    if (eventName === 'meta') {
      onMeta?.(payload as StreamedArticleMeta);
      return;
    }

    if (eventName === 'chunk') {
      if (typeof payload?.text === 'string' && payload.text) {
        onChunk?.(payload.text);
      }
      return;
    }

    if (eventName === 'done') {
      onDone?.(payload as ArticleDetail);
      return;
    }

    if (eventName === 'error') {
      throw new Error(payload?.error || 'Streaming rewrite failed');
    }
  };

  const processBuffer = () => {
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf('\n\n');

      const lines = rawEvent.split(/\r?\n/);
      let eventName = 'message';
      const dataLines: string[] = [];

      for (const line of lines) {
        if (line.startsWith('event:')) {
          eventName = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart());
        }
      }

      if (!dataLines.length) continue;
      handleEvent(eventName, JSON.parse(dataLines.join('\n')));
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    processBuffer();
    if (done) break;
  }

  if (buffer.trim()) {
    processBuffer();
  }
}
