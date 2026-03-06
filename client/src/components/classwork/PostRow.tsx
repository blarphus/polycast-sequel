// ---------------------------------------------------------------------------
// components/classwork/PostRow.tsx — Compact post row with click-to-expand
// ---------------------------------------------------------------------------

import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import * as api from '../../api';
import type { StreamPost, StreamTopic, StreamPostWord, LessonItem, Recurrence } from '../../api';
import {
  DocumentIcon,
  BookIcon,
  TypeIcon,
  CalendarIcon,
  ChevronRightIcon,
  CheckIcon,
  MoreVerticalIcon,
} from '../icons';
import { useClickOutside } from '../../hooks/useClickOutside';
import AttachmentLink from '../AttachmentLink';
import { formatRelativeTime } from '../../utils/dateFormat';
import { DAY_LABELS } from './languages';
import { formatUsDateTime } from '../../utils/dateFormat';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function postIcon(type: StreamPost['type']) {
  const iconProps = { size: 16, strokeWidth: 2 };
  switch (type) {
    case 'material':
      return <DocumentIcon {...iconProps} />;
    case 'lesson':
      return <BookIcon {...iconProps} />;
    case 'word_list':
      return <TypeIcon {...iconProps} />;
    case 'class_session':
      return <CalendarIcon {...iconProps} />;
  }
}

const DAY_NAMES = ['', ...DAY_LABELS];

function formatRecurrence(rec: Recurrence): string {
  const dayStr = rec.days.map((d) => DAY_NAMES[d]).join(', ');
  const timeParts = rec.time.split(':');
  const h = parseInt(timeParts[0]);
  const m = timeParts[1];
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `Every ${dayStr} at ${h12}:${m} ${ampm}`;
}

function isJoinable(post: StreamPost): boolean {
  const now = Date.now();
  if (post.recurrence) {
    const [h, m] = post.recurrence.time.split(':').map(Number);
    const today = new Date();
    today.setHours(h, m, 0, 0);
    return now >= today.getTime() - 5 * 60 * 1000;
  }
  if (post.scheduled_at) {
    const scheduled = new Date(post.scheduled_at).getTime();
    return now >= scheduled - 5 * 60 * 1000;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Lesson items display (reused from PostCards but kept local to avoid exports)
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
// Post context menu (teacher only)
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
// Student word list body (interactive cards + known counter + add-to-dictionary)
// ---------------------------------------------------------------------------

function StudentWordListBody({
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
    <>
      {error && <div className="auth-error" style={{ marginBottom: '0.75rem' }}>{error}</div>}
      <div className="stream-word-cards">
        {words.map((w) => {
          const isKnown = knownIds.has(w.id);
          return (
            <button
              key={w.id}
              className={`stream-word-card stream-word-card--interactive${isKnown ? ' stream-word-card--known' : ''}`}
              onClick={(e) => { e.stopPropagation(); toggleKnown(w); }}
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
          onClick={(e) => { e.stopPropagation(); handleAddToDictionary(); }}
          style={{ marginTop: '0.75rem' }}
        >
          {adding ? 'Adding...' : `Add ${unknownCount} Word${unknownCount !== 1 ? 's' : ''} to Dictionary`}
        </button>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Expanded content for each post type
// ---------------------------------------------------------------------------

function ExpandedContent({
  post,
  isTeacher,
  onStudentUpdate,
  enrichingIds,
}: {
  post: StreamPost;
  isTeacher: boolean;
  onStudentUpdate: (partial: Partial<StreamPost> & { id: string }) => void;
  enrichingIds?: Set<string>;
}) {
  const navigate = useNavigate();

  if (post.type === 'material') {
    return (
      <>
        {post.body && <p className="stream-post-body">{post.body}</p>}
        {post.attachments && post.attachments.length > 0 && (
          <div className="stream-attachments">
            {post.attachments.map((att, i) => <AttachmentLink key={i} att={att} />)}
          </div>
        )}
      </>
    );
  }

  if (post.type === 'lesson') {
    return <LessonItemsList items={post.lesson_items || []} />;
  }

  if (post.type === 'word_list') {
    if (isTeacher) {
      return (
        <>
          {enrichingIds && enrichingIds.size > 0 && (
            <p className="word-list-enriching">Loading words...</p>
          )}
          <div className="stream-word-cards">
            {(post.words || []).slice(0, 6).map((w) =>
              enrichingIds?.has(w.id)
                ? <div key={w.id} className="stream-word-card stream-word-card--skeleton" />
                : <div key={w.id} className="stream-word-card">
                    {w.image_url && (
                      <img className="stream-word-card-img" src={api.proxyImageUrl(w.image_url)!} alt={w.word} loading="lazy" />
                    )}
                    <span className="stream-word-card-word">{w.word}</span>
                  </div>
            )}
            {(post.word_count || 0) > 6 && (
              <div className="stream-word-card stream-word-card--more">
                +{(post.word_count || 0) - 6} more
              </div>
            )}
          </div>
          <p className="stream-word-count-label">{post.word_count || 0} words</p>
        </>
      );
    }
    return <StudentWordListBody post={post} onUpdate={onStudentUpdate} />;
  }

  if (post.type === 'class_session') {
    const joinable = isJoinable(post);
    return (
      <>
        <div className="class-session-details">
          {post.recurrence ? (
            <span className="class-session-schedule">{formatRecurrence(post.recurrence)}</span>
          ) : post.scheduled_at ? (
            <span className="class-session-schedule">{formatUsDateTime(post.scheduled_at)}</span>
          ) : null}
          {post.duration_minutes && (
            <span className="class-session-duration">{post.duration_minutes} min</span>
          )}
        </div>
        {post.body && <p className="stream-post-body">{post.body}</p>}
        <button
          className={`btn class-session-action-btn${isTeacher || joinable ? ' btn-primary' : ' btn-secondary'}`}
          disabled={!isTeacher && !joinable}
          onClick={(e) => { e.stopPropagation(); navigate(`/group-call/${post.id}`); }}
        >
          {isTeacher ? 'Start Class' : joinable ? 'Join Class' : 'Not yet'}
        </button>
      </>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// PostRow — compact row component
// ---------------------------------------------------------------------------

export function PostRow({
  post,
  topics,
  isTeacher,
  expanded,
  onToggleExpand,
  onDeletePost,
  onEditPost,
  onMovePost,
  onStudentUpdate,
  enrichingIds,
  draggable,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  isDragOver,
}: {
  post: StreamPost;
  topics: StreamTopic[];
  isTeacher: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onDeletePost: (id: string) => void;
  onEditPost: (post: StreamPost) => void;
  onMovePost: (postId: string, topicId: string | null) => void;
  onStudentUpdate: (partial: Partial<StreamPost> & { id: string }) => void;
  enrichingIds?: Set<string>;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
  isDragOver?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm('Delete this post? Students will no longer see it.')) return;
    setDeleting(true);
    try {
      await api.deletePost(post.id);
      onDeletePost(post.id);
    } catch (err) {
      console.error('Delete post failed:', err);
      setDeleting(false);
    }
  };

  const title = post.title || (post.type === 'material' ? 'Material' : post.type === 'lesson' ? 'Lesson' : post.type === 'class_session' ? 'Class Session' : 'Word List');
  const dateStr = `Posted ${formatRelativeTime(post.created_at)}`;

  return (
    <div
      className={`post-row-wrapper${isDragOver ? ' stream-post-drop-indicator' : ''}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      <div
        className={`post-row${expanded ? ' post-row--expanded' : ''}`}
        onClick={onToggleExpand}
      >
        {isTeacher && draggable && (
          <span className="post-row-drag-handle">⠿</span>
        )}
        <span className="post-row-icon">
          {postIcon(post.type)}
        </span>
        <span className="post-row-title">{title}</span>
        <span className="post-row-date">{dateStr}</span>
        {isTeacher && (
          <div style={{ position: 'relative' }}>
            <button
              className="post-row-menu-btn"
              onClick={(e) => { e.stopPropagation(); setMenuOpen((prev) => !prev); }}
              aria-label="Post options"
            >
              <MoreVerticalIcon size={16} />
            </button>
            {menuOpen && (
              <PostMenu
                topics={topics}
                currentTopicId={post.topic_id}
                onEdit={() => onEditPost(post)}
                onDelete={handleDelete}
                onMoveTo={(topicId) => onMovePost(post.id, topicId)}
                onClose={() => setMenuOpen(false)}
              />
            )}
          </div>
        )}
      </div>
      {expanded && (
        <div className="post-row-expanded-content" onClick={(e) => e.stopPropagation()}>
          <ExpandedContent
            post={post}
            isTeacher={isTeacher}
            onStudentUpdate={onStudentUpdate}
            enrichingIds={enrichingIds}
          />
          {deleting && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>Deleting...</div>}
        </div>
      )}
    </div>
  );
}
