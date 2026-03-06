import { request } from './core';

export interface NewsArticle {
  original_title: string;
  simplified_title: string;
  difficulty: string | null;
  words: { word: string; translation: string }[];
  source: string;
  link: string;
  image: string | null;
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
