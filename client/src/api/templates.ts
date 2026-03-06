import { request } from './core';
import type { StreamPostWord } from './classwork';

export interface TemplateUnitSummary {
  id: string;
  title: string;
  description: string;
  wordCount: number;
  previews?: { image: string; word: string }[];
}

export interface TemplateSummary {
  id: string;
  title: string;
  publisher: string;
  language: string;
  level: string;
  units: TemplateUnitSummary[];
}

export interface TemplateUnitDetail {
  textbook: { id: string; title: string; language: string };
  unit: { id: string; title: string; description: string; words: (string | StreamPostWord)[] };
}

export function getTemplates() {
  return request<{ templates: TemplateSummary[] }>('/templates');
}

export function getTemplateUnit(textbookId: string, unitId: string) {
  return request<TemplateUnitDetail>(`/templates/${textbookId}/${unitId}`);
}
