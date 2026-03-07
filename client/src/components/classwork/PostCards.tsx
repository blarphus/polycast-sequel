import React from 'react';
import type { StreamPost, StreamTopic } from '../../api';
import { PostRow } from './PostRow';

function noop() {}

function renderCompatRow(
  post: StreamPost,
  {
    topics = [],
    isTeacher,
    onDeletePost = noop,
    onEditPost = noop,
    onMovePost = noop,
    onStudentUpdate = noop,
    enrichingIds,
    draggable,
    onDragStart,
    onDragOver,
    onDrop,
    onDragEnd,
    isDragOver = false,
  }: {
    topics?: StreamTopic[];
    isTeacher: boolean;
    onDeletePost?: (id: string) => void;
    onEditPost?: (post: StreamPost) => void;
    onMovePost?: (postId: string, topicId: string | null) => void;
    onStudentUpdate?: (partial: Partial<StreamPost> & { id: string }) => void;
    enrichingIds?: Set<string>;
    draggable?: boolean;
    onDragStart?: (e: React.DragEvent) => void;
    onDragOver?: (e: React.DragEvent) => void;
    onDrop?: (e: React.DragEvent) => void;
    onDragEnd?: () => void;
    isDragOver?: boolean;
  },
) {
  return (
    <PostRow
      post={post}
      topics={topics}
      isTeacher={isTeacher}
      expanded
      onToggleExpand={noop}
      onDeletePost={onDeletePost}
      onEditPost={onEditPost}
      onMovePost={onMovePost}
      onStudentUpdate={onStudentUpdate}
      enrichingIds={enrichingIds}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      isDragOver={isDragOver}
    />
  );
}

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
  onDragEnd?: () => void;
  enrichingIds?: Set<string>;
}) {
  return renderCompatRow(post, {
    topics,
    isTeacher: true,
    onDeletePost: onDelete,
    onEditPost: onEdit,
    onMovePost: (_postId, topicId) => onMoveTo(topicId),
    enrichingIds,
    draggable,
    onDragStart,
    onDragOver,
    onDrop,
    onDragEnd,
    isDragOver,
  });
}

export function StudentWordListCard({
  post,
  onUpdate,
}: {
  post: StreamPost;
  onUpdate: (updated: Partial<StreamPost> & { id: string }) => void;
}) {
  return renderCompatRow(post, {
    isTeacher: false,
    onStudentUpdate: onUpdate,
  });
}

export function StudentMaterialCard({ post }: { post: StreamPost }) {
  return renderCompatRow(post, { isTeacher: false });
}

export function StudentLessonCard({ post }: { post: StreamPost }) {
  return renderCompatRow(post, { isTeacher: false });
}
