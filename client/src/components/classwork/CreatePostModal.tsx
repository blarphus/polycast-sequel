// ---------------------------------------------------------------------------
// components/classwork/CreatePostModal.tsx — Create-post components
// ---------------------------------------------------------------------------

import { useState, useRef } from 'react';
import * as api from '../../api';
import type { StreamPost, StreamTopic, StreamAttachment, LessonItem, WordOverride, Recurrence } from '../../api';

import WordListTab from './WordListTab';
import MaterialTab from './MaterialTab';
import LessonTab from './LessonTab';
import ClassSessionTab from './ClassSessionTab';
import { DocumentIcon, BookIcon, TypeIcon, CalendarIcon, CloseIcon } from '../icons';
import { useClickOutside } from '../../hooks/useClickOutside';

export { LANGUAGES } from './languages';

// ---------------------------------------------------------------------------
// Create post modal
// ---------------------------------------------------------------------------

export function CreatePostModal({
  defaultTab,
  topics,
  user,
  onCreated,
  onClose,
  editingPost,
  onSaved,
}: {
  defaultTab: 'material' | 'lesson' | 'word_list' | 'class_session';
  topics: StreamTopic[];
  user: { native_language: string | null; target_language: string | null };
  onCreated: (post: StreamPost) => void;
  onClose: () => void;
  editingPost?: StreamPost | null;
  onSaved?: (updated: StreamPost) => void;
}) {
  const isEditMode = !!editingPost;
  const [tab, setTab] = useState<'material' | 'lesson' | 'word_list' | 'class_session'>(defaultTab);
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(editingPost?.topic_id ?? null);

  const handleMaterialSubmit = async (data: { title: string; body: string; attachments: StreamAttachment[] }) => {
    const post = await api.createPost({ type: 'material', ...data, topic_id: selectedTopicId });
    onCreated(post);
  };

  const handleLessonSubmit = async (data: { title: string; lesson_items: LessonItem[] }) => {
    const post = await api.createPost({ type: 'lesson', ...data, topic_id: selectedTopicId });
    onCreated(post);
  };

  const handleClassSessionSubmit = async (data: { title: string; body?: string; scheduled_at?: string; duration_minutes?: number; recurrence?: Recurrence | null }) => {
    const post = await api.createPost({ type: 'class_session', ...data, topic_id: selectedTopicId });
    onCreated(post);
  };

  const handleWordListSubmit = async (data: { title: string; words: (string | WordOverride)[]; target_language: string }) => {
    const post = await api.createPost({ type: 'word_list', ...data, topic_id: selectedTopicId });
    onCreated(post);
  };

  const handleWordListEdit = async (data: { title: string; words: (string | WordOverride)[]; target_language: string }) => {
    if (!editingPost || !onSaved) return;
    const updated = await api.updatePost(editingPost.id, {
      title: data.title,
      words: data.words as WordOverride[],
      target_language: data.target_language,
      topic_id: selectedTopicId,
    });
    onSaved(updated);
  };

  return (
    <div className="stream-modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="stream-modal stream-create-modal">
        <div className="stream-create-modal-header">
          <h2 className="stream-modal-title">{isEditMode ? 'Edit Word List' : 'New Post'}</h2>
          <button className="stream-modal-close-btn" onClick={onClose} aria-label="Close">
            <CloseIcon size={18} strokeWidth={2.5} />
          </button>
        </div>

        {topics.length > 0 && (
          <div style={{ marginBottom: '1rem' }}>
            <label className="form-label">Topic (optional)</label>
            <select
              className="form-input"
              value={selectedTopicId || ''}
              onChange={(e) => setSelectedTopicId(e.target.value || null)}
            >
              <option value="">No Topic</option>
              {topics.map((t) => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </select>
          </div>
        )}

        {!isEditMode && (
          <div className="create-post-tabs">
            <button className={`create-post-tab${tab === 'material' ? ' active' : ''}`} onClick={() => setTab('material')}>Material</button>
            <button className={`create-post-tab${tab === 'lesson' ? ' active' : ''}`} onClick={() => setTab('lesson')}>Lesson</button>
            <button className={`create-post-tab${tab === 'word_list' ? ' active' : ''}`} onClick={() => setTab('word_list')}>Word List</button>
            <button className={`create-post-tab${tab === 'class_session' ? ' active' : ''}`} onClick={() => setTab('class_session')}>Class</button>
          </div>
        )}

        {tab === 'material' && !isEditMode && <MaterialTab onSubmit={handleMaterialSubmit} />}
        {tab === 'lesson' && !isEditMode && <LessonTab onSubmit={handleLessonSubmit} />}
        {tab === 'class_session' && !isEditMode && <ClassSessionTab onSubmit={handleClassSessionSubmit} />}
        {tab === 'word_list' && (
          <WordListTab
            defaultTargetLang={user?.target_language || ''}
            nativeLang={user?.native_language || ''}
            onSubmit={isEditMode ? handleWordListEdit : handleWordListSubmit}
            initialData={editingPost ? {
              title: editingPost.title || '',
              words: editingPost.words || [],
              target_language: editingPost.target_language || '',
            } : undefined}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// + Create dropdown menu
// ---------------------------------------------------------------------------

export function CreateMenu({
  onSelect,
  onClose,
}: {
  onSelect: (type: 'material' | 'lesson' | 'word_list' | 'class_session' | 'topic') => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  useClickOutside(menuRef, onClose);

  return (
    <div ref={menuRef} className="stream-create-dropdown">
      <button className="stream-create-menu-item" onClick={() => { onSelect('material'); onClose(); }}>
        <span className="stream-create-menu-icon"><DocumentIcon size={16} /></span> Material
      </button>
      <button className="stream-create-menu-item" onClick={() => { onSelect('lesson'); onClose(); }}>
        <span className="stream-create-menu-icon"><BookIcon size={16} /></span> Lesson
      </button>
      <button className="stream-create-menu-item" onClick={() => { onSelect('word_list'); onClose(); }}>
        <span className="stream-create-menu-icon"><TypeIcon size={16} /></span> Word List
      </button>
      <button className="stream-create-menu-item" onClick={() => { onSelect('class_session'); onClose(); }}>
        <span className="stream-create-menu-icon"><CalendarIcon size={16} /></span> Class Session
      </button>
      <div className="stream-create-menu-separator" />
      <button className="stream-create-menu-item" onClick={() => { onSelect('topic'); onClose(); }}>
        <span className="stream-create-menu-icon">+</span> New Topic
      </button>
    </div>
  );
}
