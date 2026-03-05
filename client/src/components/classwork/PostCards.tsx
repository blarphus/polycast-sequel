// ---------------------------------------------------------------------------
// components/classwork/PostCards.tsx — Post card components (display)
// ---------------------------------------------------------------------------

import React, { useState, useRef } from 'react';
import * as api from '../../api';
import type { StreamPost, StreamTopic, StreamPostWord, StreamAttachment, LessonItem } from '../../api';
import { YouTubeIcon, FileIcon, ExternalLinkIcon, ChevronRightIcon, CheckIcon } from '../icons';
import { useClickOutside } from '../../hooks/useClickOutside';

// ---------------------------------------------------------------------------
// AttachmentLink (display only)
// ---------------------------------------------------------------------------

function AttachmentLink({ att }: { att: StreamAttachment }) {
  const url = att.url;
  const label = att.label || url;
  const isYoutube = url.includes('youtube.com/watch') || url.includes('youtu.be/');
  const isPdf = url.toLowerCase().endsWith('.pdf');

  return (
    <a className="stream-attachment-link" href={url} target="_blank" rel="noopener noreferrer">
      {isYoutube && <YouTubeIcon size={16} />}
      {isPdf && !isYoutube && <FileIcon size={16} />}
      {!isYoutube && !isPdf && <ExternalLinkIcon size={16} />}
      <span>{label}</span>
    </a>
  );
}

// ---------------------------------------------------------------------------
// Lesson items display
// ---------------------------------------------------------------------------

function LessonItemsList({ items }: { items: LessonItem[] }) {
  return (
    <div className="lesson-items-display">
      {items.map((item, i) => (
        <div key={i} className="lesson-item-display">
          <div className="lesson-item-display-number">{i + 1}</div>
          <div className="lesson-item-display-content">
            {item.title && <p className="lesson-item-display-title">{item.title}</p>}
            {item.body && <p className="lesson-item-display-body">{item.body}</p>}
            {item.attachments && item.attachments.length > 0 && (
              <div className="stream-attachments">
                {item.attachments.map((att, j) => (
                  <AttachmentLink key={j} att={att} />
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Post context menu (···)
// ---------------------------------------------------------------------------

function PostMenu({
  topics,
  currentTopicId,
  onEdit,
  onDelete,
  onMoveTo,
  onClose,
}: {
  topics: StreamTopic[];
  currentTopicId: string | null | undefined;
  onEdit: () => void;
  onDelete: () => void;
  onMoveTo: (topicId: string | null) => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [showMoveMenu, setShowMoveMenu] = useState(false);
  useClickOutside(menuRef, onClose);

  const moveTargets = topics.filter((t) => t.id !== currentTopicId);
  const canMoveToNoTopic = !!currentTopicId;

  return (
    <div ref={menuRef} className="stream-post-menu">
      <button className="stream-post-menu-item" onClick={() => { onEdit(); onClose(); }}>Edit</button>
      <button className="stream-post-menu-item stream-post-menu-item--danger" onClick={() => { onDelete(); onClose(); }}>Delete</button>
      {(moveTargets.length > 0 || canMoveToNoTopic) && (
        <>
          <div className="stream-post-menu-separator" />
          <div
            className="stream-post-menu-item stream-post-menu-item--has-submenu"
            onMouseEnter={() => setShowMoveMenu(true)}
            onMouseLeave={() => setShowMoveMenu(false)}
          >
            <span>Move to</span>
            <ChevronRightIcon size={12} strokeWidth={2.5} />
            {showMoveMenu && (
              <div className="stream-post-menu stream-post-submenu">
                {canMoveToNoTopic && (
                  <button className="stream-post-menu-item" onClick={() => { onMoveTo(null); onClose(); }}>
                    No Topic
                  </button>
                )}
                {moveTargets.map((t) => (
                  <button key={t.id} className="stream-post-menu-item" onClick={() => { onMoveTo(t.id); onClose(); }}>
                    {t.title}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Teacher post card with drag handle + ··· menu
// ---------------------------------------------------------------------------

export function TeacherPostCard({
  post,
  topics,
  onDelete,
  onEdit,
  onMoveTo,
  isDragOver,
  draggable,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  enrichingIds,
}: {
  post: StreamPost;
  topics: StreamTopic[];
  onDelete: (id: string) => void;
  onEdit: (post: StreamPost) => void;
  onMoveTo: (topicId: string | null) => void;
  isDragOver: boolean;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  enrichingIds?: Set<string>;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm('Delete this post? Students will no longer see it.')) return;
    setDeleting(true);
    try {
      await api.deletePost(post.id);
      onDelete(post.id);
    } catch (err) {
      console.error('Delete post failed:', err);
      setDeleting(false);
    }
  };

  const badgeLabel = post.type === 'material' ? 'Material' : post.type === 'lesson' ? 'Lesson' : post.type === 'class_session' ? 'Class Session' : 'Word List';

  return (
    <div
      className={`stream-post-card${post.type === 'lesson' ? ' stream-post-card--lesson' : ''}${isDragOver ? ' stream-post-drag-over' : ''}${draggable ? ' stream-post-card--draggable' : ''}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      <div className="stream-post-header">
        {draggable && <span className="stream-post-drag-handle">⠿</span>}
        <span className={`stream-post-type-badge${post.type === 'lesson' ? ' stream-post-type-badge--lesson' : ''}`}>
          {badgeLabel}
        </span>
        <span className="stream-post-date">{new Date(post.created_at).toLocaleDateString()}</span>
        <div style={{ position: 'relative', marginLeft: 'auto' }}>
          <button
            className="stream-post-menu-btn"
            onClick={(e) => { e.stopPropagation(); setMenuOpen((prev) => !prev); }}
            aria-label="Post options"
          >
            ···
          </button>
          {menuOpen && (
            <PostMenu
              topics={topics}
              currentTopicId={post.topic_id}
              onEdit={() => onEdit(post)}
              onDelete={handleDelete}
              onMoveTo={onMoveTo}
              onClose={() => setMenuOpen(false)}
            />
          )}
        </div>
      </div>

      {post.title && <h3 className="stream-post-title">{post.title}</h3>}

      {post.type === 'material' && (
        <>
          {post.body && <p className="stream-post-body">{post.body}</p>}
          {post.attachments && post.attachments.length > 0 && (
            <div className="stream-attachments">
              {post.attachments.map((att, i) => <AttachmentLink key={i} att={att} />)}
            </div>
          )}
        </>
      )}

      {post.type === 'lesson' && <LessonItemsList items={post.lesson_items || []} />}

      {post.type === 'word_list' && (
        <>
          {enrichingIds && enrichingIds.size > 0 && (
            <p className="word-list-enriching">Loading words…</p>
          )}
          <div className="stream-word-cards">
            {(post.words || []).slice(0, 6).map((w) => (
              enrichingIds?.has(w.id)
                ? <div key={w.id} className="stream-word-card stream-word-card--skeleton" />
                : <div key={w.id} className="stream-word-card">
                    {w.image_url && (
                      <img className="stream-word-card-img" src={api.proxyImageUrl(w.image_url)!} alt={w.word} loading="lazy" />
                    )}
                    <span className="stream-word-card-word">{w.word}</span>
                  </div>
            ))}
            {(post.word_count || 0) > 6 && (
              <div className="stream-word-card stream-word-card--more">
                +{(post.word_count || 0) - 6} more
              </div>
            )}
          </div>
          <p className="stream-word-count-label">{post.word_count || 0} words</p>
        </>
      )}

      {deleting && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>Deleting…</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Student post cards
// ---------------------------------------------------------------------------

export function StudentWordListCard({
  post,
  onUpdate,
}: {
  post: StreamPost;
  onUpdate: (updated: Partial<StreamPost> & { id: string }) => void;
}) {
  const [knownIds, setKnownIds] = useState<Set<string>>(new Set(post.known_word_ids || []));
  const [completed, setCompleted] = useState(post.completed || false);
  const [adding, setAdding] = useState(false);
  const [addResult, setAddResult] = useState<{ added: number; skipped: number } | null>(null);
  const [error, setError] = useState('');

  const words = post.words || [];
  const unknownCount = words.filter((w) => !knownIds.has(w.id)).length;

  const toggleKnown = async (word: StreamPostWord) => {
    const wasKnown = knownIds.has(word.id);
    const newKnown = !wasKnown;
    setKnownIds((prev) => {
      const next = new Set(prev);
      if (newKnown) next.add(word.id); else next.delete(word.id);
      return next;
    });
    try {
      await api.toggleWordKnown(post.id, word.id, newKnown);
    } catch (err: any) {
      console.error('toggleWordKnown failed:', err);
      setError(err instanceof Error ? err.message : String(err));
      setKnownIds((prev) => {
        const next = new Set(prev);
        if (wasKnown) next.add(word.id); else next.delete(word.id);
        return next;
      });
    }
  };

  const handleAddToDictionary = async () => {
    setAdding(true);
    setError('');
    try {
      const result = await api.addPostToDictionary(post.id);
      setAddResult(result);
      setCompleted(true);
      onUpdate({ id: post.id, completed: true });
    } catch (err: any) {
      console.error('addPostToDictionary failed:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="stream-post-card">
      <div className="stream-post-header">
        <span className="stream-post-type-badge">Word List</span>
        {post.target_language && (
          <span className="stream-lang-badge">{post.target_language.toUpperCase()}</span>
        )}
        <span className="stream-post-date">{new Date(post.created_at).toLocaleDateString()}</span>
      </div>
      {post.title && <h3 className="stream-post-title">{post.title}</h3>}
      {error && <div className="auth-error" style={{ marginBottom: '0.75rem' }}>{error}</div>}
      <div className="stream-word-cards">
        {words.map((w) => {
          const isKnown = knownIds.has(w.id);
          return (
            <button
              key={w.id}
              className={`stream-word-card stream-word-card--interactive${isKnown ? ' stream-word-card--known' : ''}`}
              onClick={() => toggleKnown(w)}
              title={isKnown ? 'Unmark as known' : 'Mark as known'}
            >
              {w.image_url && (
                <img className="stream-word-card-img" src={api.proxyImageUrl(w.image_url)!} alt={w.word} loading="lazy" />
              )}
              <span className="stream-word-card-word">{w.word}</span>
              {w.translation && <span className="stream-word-card-translation">{w.translation}</span>}
            </button>
          );
        })}
      </div>
      <div className="stream-word-known-counter">
        <span>{knownIds.size} known</span>
        <span className="stream-counter-dot">·</span>
        <span>{unknownCount} to add</span>
      </div>
      {completed || addResult ? (
        <div className="stream-completed-banner">
          <CheckIcon size={16} strokeWidth={2.5} />
          {addResult
            ? `Added ${addResult.added} word${addResult.added !== 1 ? 's' : ''} to your dictionary`
            : 'Added to your dictionary'}
        </div>
      ) : (
        <button
          className="btn btn-primary"
          disabled={unknownCount === 0 || adding}
          onClick={handleAddToDictionary}
          style={{ marginTop: '0.75rem' }}
        >
          {adding ? 'Adding…' : `Add ${unknownCount} Word${unknownCount !== 1 ? 's' : ''} to Dictionary`}
        </button>
      )}
    </div>
  );
}

export function StudentMaterialCard({ post }: { post: StreamPost }) {
  return (
    <div className="stream-post-card">
      <div className="stream-post-header">
        <span className="stream-post-type-badge">Material</span>
        <span className="stream-post-date">{new Date(post.created_at).toLocaleDateString()}</span>
      </div>
      {post.title && <h3 className="stream-post-title">{post.title}</h3>}
      {post.body && <p className="stream-post-body">{post.body}</p>}
      {post.attachments && post.attachments.length > 0 && (
        <div className="stream-attachments">
          {post.attachments.map((att, i) => <AttachmentLink key={i} att={att} />)}
        </div>
      )}
    </div>
  );
}

export function StudentLessonCard({ post }: { post: StreamPost }) {
  return (
    <div className="stream-post-card stream-post-card--lesson">
      <div className="stream-post-header">
        <span className="stream-post-type-badge stream-post-type-badge--lesson">Lesson</span>
        <span className="stream-post-date">{new Date(post.created_at).toLocaleDateString()}</span>
      </div>
      {post.title && <h3 className="stream-post-title">{post.title}</h3>}
      <LessonItemsList items={post.lesson_items || []} />
    </div>
  );
}
