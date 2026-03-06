// ---------------------------------------------------------------------------
// components/classwork/TopicSection.tsx — Topic section with post grouping
// ---------------------------------------------------------------------------

import React, { useState, useRef } from 'react';
import * as api from '../../api';
import type { StreamPost, StreamTopic } from '../../api';
import { TeacherPostCard, StudentWordListCard, StudentMaterialCard, StudentLessonCard } from './PostCards';
import { TeacherClassSessionCard, StudentClassSessionCard } from './ClassSessionCard';
import { ChevronUpIcon } from '../icons';
import { useClickOutside } from '../../hooks/useClickOutside';

// ---------------------------------------------------------------------------
// Topic context menu (rename, delete)
// ---------------------------------------------------------------------------

function TopicMenu({
  onRename,
  onDelete,
  onClose,
}: {
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  useClickOutside(menuRef, onClose);

  return (
    <div ref={menuRef} className="stream-post-menu">
      <button className="stream-post-menu-item" onClick={() => { onRename(); onClose(); }}>Rename</button>
      <button className="stream-post-menu-item stream-post-menu-item--danger" onClick={() => { onDelete(); onClose(); }}>Delete</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Topic section
// ---------------------------------------------------------------------------

export function TopicSection({
  topic,
  posts,
  topics,
  isTeacher,
  allowTopicManagement = true,
  collapsed,
  onToggleCollapse,
  onDeletePost,
  onEditPost,
  onMovePost,
  onRenameTopic,
  onDeleteTopic,
  dragItem,
  dragOverId,
  onDragStartPost,
  onDragOverPost,
  onDropPost,
  onDragEndPost,
  onDragStartTopic,
  onDragOverTopic,
  onDropTopic,
  onStudentUpdate,
  enrichingWordIds,
}: {
  topic: StreamTopic | null;
  posts: StreamPost[];
  topics: StreamTopic[];
  isTeacher: boolean;
  allowTopicManagement?: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onDeletePost: (id: string) => void;
  onEditPost: (post: StreamPost) => void;
  onMovePost: (postId: string, topicId: string | null) => void;
  onRenameTopic: (updated: StreamTopic) => void;
  onDeleteTopic: (topicId: string) => void;
  dragItem: { id: string; kind: 'post' | 'topic' } | null;
  dragOverId: string | null;
  onDragStartPost: (e: React.DragEvent, post: StreamPost) => void;
  onDragOverPost: (postId: string) => void;
  onDropPost: (e: React.DragEvent, targetPostId: string, topicId: string | null) => void;
  onDragEndPost: () => void;
  onDragStartTopic: (e: React.DragEvent, topic: StreamTopic) => void;
  onDragOverTopic: (topicId: string) => void;
  onDropTopic: (e: React.DragEvent, targetTopicId: string) => void;
  onStudentUpdate: (partial: Partial<StreamPost> & { id: string }) => void;
  enrichingWordIds: Map<string, Set<string>>;
}) {
  const [topicMenuOpen, setTopicMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameTitle, setRenameTitle] = useState(topic?.title || '');

  const isNoTopic = topic === null;
  const topicId = topic?.id ?? null;
  const canManageTopics = isTeacher && allowTopicManagement;
  const isBeingDragged = canManageTopics && !isNoTopic && dragItem?.id === topic?.id && dragItem?.kind === 'topic';
  const isDropTarget = canManageTopics && !isNoTopic && dragOverId === topic?.id && dragItem?.kind === 'topic';

  const sortedPosts = [...posts].sort((a, b) =>
    (a.position ?? 0) - (b.position ?? 0) ||
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  const handleRenameSubmit = async () => {
    if (!renameTitle.trim() || !topic) { setRenaming(false); return; }
    try {
      const updated = await api.updateTopic(topic.id, { title: renameTitle.trim() });
      onRenameTopic(updated);
    } catch (err) {
      console.error('Rename topic failed:', err);
    } finally {
      setRenaming(false);
    }
  };

  return (
    <div
      className={`stream-topic-section${isNoTopic ? ' stream-no-topic-section' : ''}${isDropTarget ? ' stream-topic-section--drop-target' : ''}`}
      onDragOver={!isNoTopic && canManageTopics ? (e) => { if (dragItem?.kind === 'topic') { e.preventDefault(); onDragOverTopic(topic!.id); } } : undefined}
      onDrop={!isNoTopic && canManageTopics ? (e) => { if (dragItem?.kind === 'topic') onDropTopic(e, topic!.id); } : undefined}
    >
      <div
        className={`stream-topic-header${isBeingDragged ? ' stream-topic-header--dragging' : ''}`}
        draggable={canManageTopics && !isNoTopic}
        onDragStart={canManageTopics && !isNoTopic ? (e) => onDragStartTopic(e, topic!) : undefined}
        onDragEnd={canManageTopics && !isNoTopic ? () => {} : undefined}
      >
        {canManageTopics && !isNoTopic && (
          <span className="stream-topic-drag-handle">⠿</span>
        )}

        {renaming ? (
          <input
            className="stream-topic-rename-input"
            value={renameTitle}
            onChange={(e) => setRenameTitle(e.target.value)}
            onBlur={handleRenameSubmit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRenameSubmit();
              if (e.key === 'Escape') setRenaming(false);
            }}
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="stream-topic-title">
            {isNoTopic ? 'No Topic' : topic!.title}
          </span>
        )}

        <span className="stream-topic-count">{posts.length}</span>

        <button
          className={`stream-topic-chevron${collapsed ? ' stream-topic-chevron--collapsed' : ''}`}
          onClick={onToggleCollapse}
          aria-label={collapsed ? 'Expand' : 'Collapse'}
        >
          <ChevronUpIcon size={14} strokeWidth={2.5} />
        </button>

        {canManageTopics && !isNoTopic && !renaming && (
          <div style={{ position: 'relative' }}>
            <button
              className="stream-topic-menu-btn"
              onClick={(e) => { e.stopPropagation(); setTopicMenuOpen((prev) => !prev); }}
              aria-label="Topic options"
            >
              ···
            </button>
            {topicMenuOpen && (
              <TopicMenu
                onRename={() => { setRenameTitle(topic!.title); setRenaming(true); }}
                onDelete={() => onDeleteTopic(topic!.id)}
                onClose={() => setTopicMenuOpen(false)}
              />
            )}
          </div>
        )}
      </div>

      {!collapsed && (
        <div className="stream-topic-posts">
          {sortedPosts.length === 0 && (
            <div className="stream-topic-empty">
              {isNoTopic ? 'No unassigned posts.' : 'No posts in this topic.'}
            </div>
          )}
          {sortedPosts.map((post) => {
            if (isTeacher) {
              // Class sessions get their own specialized card
              if (post.type === 'class_session') {
                return (
                  <div
                    key={post.id}
                    className={dragOverId === post.id && dragItem?.kind === 'post' ? 'stream-post-drop-indicator' : ''}
                    draggable={true}
                    onDragStart={(e) => onDragStartPost(e, post)}
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (dragItem?.kind === 'post') onDragOverPost(post.id); }}
                    onDrop={(e) => { e.stopPropagation(); onDropPost(e, post.id, topicId); }}
                    onDragEnd={onDragEndPost}
                  >
                    <TeacherClassSessionCard post={post} />
                  </div>
                );
              }
              return (
                <div
                  key={post.id}
                  className={dragOverId === post.id && dragItem?.kind === 'post' ? 'stream-post-drop-indicator' : ''}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (dragItem?.kind === 'post') onDragOverPost(post.id); }}
                  onDrop={(e) => { e.stopPropagation(); onDropPost(e, post.id, topicId); }}
                >
                  <TeacherPostCard
                    post={post}
                    topics={topics}
                    onDelete={onDeletePost}
                    onEdit={onEditPost}
                    onMoveTo={(newTopicId) => onMovePost(post.id, newTopicId)}
                    isDragOver={dragOverId === post.id && dragItem?.kind === 'post'}
                    draggable={true}
                    onDragStart={(e) => onDragStartPost(e, post)}
                    onDragEnd={onDragEndPost}
                    enrichingIds={enrichingWordIds.get(post.id)}
                  />
                </div>
              );
            }

            // Student view
            const showTeacherLabel = !isNoTopic && !!post.teacher_name;
            if (post.type === 'class_session') {
              return (
                <React.Fragment key={post.id}>
                  {showTeacherLabel && <div className="stream-teacher-label">{post.teacher_name}</div>}
                  <StudentClassSessionCard post={post} />
                </React.Fragment>
              );
            } else if (post.type === 'word_list') {
              return (
                <React.Fragment key={post.id}>
                  {showTeacherLabel && <div className="stream-teacher-label">{post.teacher_name}</div>}
                  <StudentWordListCard post={post} onUpdate={onStudentUpdate} />
                </React.Fragment>
              );
            } else if (post.type === 'lesson') {
              return (
                <React.Fragment key={post.id}>
                  {showTeacherLabel && <div className="stream-teacher-label">{post.teacher_name}</div>}
                  <StudentLessonCard post={post} />
                </React.Fragment>
              );
            } else {
              return (
                <React.Fragment key={post.id}>
                  {showTeacherLabel && <div className="stream-teacher-label">{post.teacher_name}</div>}
                  <StudentMaterialCard post={post} />
                </React.Fragment>
              );
            }
          })}
        </div>
      )}
    </div>
  );
}
