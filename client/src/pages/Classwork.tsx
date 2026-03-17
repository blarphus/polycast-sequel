// ---------------------------------------------------------------------------
// pages/Classwork.tsx — Class stream (Google Classroom-style)
// ---------------------------------------------------------------------------

import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useActiveClassroom } from '../hooks/useActiveClassroom';
import * as api from '../api';
import type { Classroom, StreamPost, StreamTopic } from '../api';
import { CreatePostModal, CreateMenu } from '../components/classwork/CreatePostModal';
import EditModal from '../components/classwork/EditModal';
import { TopicSection } from '../components/classwork/TopicSection';
import ClassroomPicker from '../components/classroom/ClassroomPicker';
import ClassroomSetupBanner from '../components/classroom/ClassroomSetupBanner';
import { PlusIcon, ChevronDownIcon, ChevronLeftIcon, CloseIcon, PeopleIcon } from '../components/icons';
import { toErrorMessage } from '../utils/errors';

// ---------------------------------------------------------------------------
// Main Classwork component
// ---------------------------------------------------------------------------

export default function Classwork() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isTeacher = user?.account_type === 'teacher';
  const [searchParams, setSearchParams] = useSearchParams();
  const classroomIdParam = searchParams.get('classroomId');
  const {
    classrooms,
    activeClassroom,
    activeClassroomId,
    setActiveClassroomId,
    loading: classroomsLoading,
    error: classroomsError,
    reloadClassrooms,
  } = useActiveClassroom(classroomIdParam);

  const [topics, setTopics] = useState<StreamTopic[]>([]);
  const [posts, setPosts] = useState<StreamPost[]>([]);
  const [studentCount, setStudentCount] = useState<number | undefined>(undefined);
  const [enrichingWordIds, setEnrichingWordIds] = useState<Map<string, Set<string>>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editingPost, setEditingPost] = useState<StreamPost | null>(null);
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const [createType, setCreateType] = useState<'material' | 'lesson' | 'word_list' | 'class_session' | null>(null);
  const [creatingTopic, setCreatingTopic] = useState(false);
  const [newTopicTitle, setNewTopicTitle] = useState('');
  const [dragItem, setDragItem] = useState<{ id: string; kind: 'post' | 'topic' } | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [expandedPosts, setExpandedPosts] = useState<Set<string>>(new Set());
  const [filterTopicId, setFilterTopicId] = useState<string | null>(null);

  const loadStream = useCallback(() => {
    if (!activeClassroomId) {
      setTopics([]);
      setPosts([]);
      setLoading(false);
      return Promise.resolve();
    }

    setLoading(true);
    setError('');
    const loader = activeClassroom?.is_default_migrated
      ? api.getStream(activeClassroomId)
      : api.getClassroomTopics(activeClassroomId).then((fetchedTopics) => ({
          topics: fetchedTopics as unknown as StreamTopic[],
          posts: [] as StreamPost[],
        }));

    return loader
      .then((result) => {
        setTopics(result.topics);
        setPosts(result.posts);
        if ('student_count' in result) setStudentCount((result as { student_count?: number }).student_count);
      })
      .catch((err: any) => {
        console.error('getStream failed:', err);
        setError(toErrorMessage(err));
      })
      .finally(() => setLoading(false));
  }, [activeClassroom, activeClassroomId]);

  useEffect(() => { loadStream(); }, [loadStream]);

  useEffect(() => {
    setShowCreateMenu(false);
    setCreateType(null);
    setCreatingTopic(false);
    setNewTopicTitle('');
    setEditingPost(null);
    setDragItem(null);
    setDragOverId(null);
    setExpandedPosts(new Set());
    setFilterTopicId(null);
  }, [activeClassroomId]);

  useEffect(() => {
    if (!activeClassroomId) return;
    const next = new URLSearchParams(searchParams);
    next.set('classroomId', activeClassroomId);
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [activeClassroomId, searchParams, setSearchParams]);

  // ---- Post handlers ----

  const handleDeletePost = (id: string) => setPosts((prev) => prev.filter((p) => p.id !== id));
  const handleEditPost = (post: StreamPost) => setEditingPost(post);
  const handleEditSaved = (updated: StreamPost) => {
    setPosts((prev) => prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)));
    setEditingPost(null);
  };
  const handleStudentUpdate = (partial: Partial<StreamPost> & { id: string }) => {
    setPosts((prev) => prev.map((p) => (p.id === partial.id ? { ...p, ...partial } : p)));
  };
  const handlePostCreated = (post: StreamPost) => {
    setPosts((prev) => [post, ...prev]);
    setCreateType(null);

    const unenriched = (post.words || []).filter((w) => !w.translation);
    if (unenriched.length > 0) {
      const wordIdSet = new Set(unenriched.map((w) => w.id));
      setEnrichingWordIds((prev) => new Map(prev).set(post.id, wordIdSet));

      const es = api.enrichPostStream(post.id);
      es.onmessage = (e) => {
        const data = JSON.parse(e.data);
        if (data.done) {
          setEnrichingWordIds((prev) => {
            const next = new Map(prev);
            next.delete(post.id);
            return next;
          });
          es.close();
          return;
        }
        if (data.error) {
          setEnrichingWordIds((prev) => {
            const next = new Map(prev);
            const set = next.get(post.id);
            if (set) { set.delete(data.word_id); if (set.size === 0) next.delete(post.id); }
            return next;
          });
          return;
        }
        setPosts((prev) => prev.map((p) => {
          if (p.id !== post.id) return p;
          return { ...p, words: (p.words || []).map((w) => w.id === data.word_id ? { ...w, ...data } : w) };
        }));
        setEnrichingWordIds((prev) => {
          const next = new Map(prev);
          const set = next.get(post.id);
          if (set) { set.delete(data.word_id); if (set.size === 0) next.delete(post.id); }
          return next;
        });
      };
      es.onerror = (e) => {
        console.error('enrichPostStream error:', e);
        es.close();
        setEnrichingWordIds((prev) => { const next = new Map(prev); next.delete(post.id); return next; });
      };
    }
  };

  const handleMovePost = async (postId: string, newTopicId: string | null) => {
    const post = posts.find((p) => p.id === postId);
    if (!post) return;
    setError('');
    setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, topic_id: newTopicId } : p)));
    try {
      await api.reorderStream([{ id: postId, kind: 'post', position: post.position ?? 0, topic_id: newTopicId }]);
    } catch (err: any) {
      console.error('Move post failed:', err);
      setError(toErrorMessage(err));
      setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, topic_id: post.topic_id } : p)));
    }
  };

  // ---- Topic handlers ----

  const handleRenameTopic = (updated: StreamTopic) => {
    setTopics((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
  };

  const handleDeleteTopic = async (topicId: string) => {
    if (!confirm('Delete this topic? Posts will be moved to "No Topic".')) return;
    try {
      setError('');
      await api.deleteTopic(topicId);
      setTopics((prev) => prev.filter((t) => t.id !== topicId));
      setPosts((prev) => prev.map((p) => (p.topic_id === topicId ? { ...p, topic_id: null } : p)));
    } catch (err: any) {
      console.error('Delete topic failed:', err);
      setError(toErrorMessage(err));
    }
  };

  const handleCreateTopic = async () => {
    if (!newTopicTitle.trim()) { setCreatingTopic(false); return; }
    try {
      setError('');
      const topic = activeClassroom?.is_default_migrated
        ? await api.createTopic(newTopicTitle.trim())
        : await api.createClassroomTopic(activeClassroomId!, newTopicTitle.trim());
      setTopics((prev) => [...prev, topic as StreamTopic]);
    } catch (err: any) {
      console.error('Create topic failed:', err);
      setError(toErrorMessage(err));
    } finally {
      setNewTopicTitle('');
      setCreatingTopic(false);
    }
  };

  const handleCreateMenuSelect = (type: 'material' | 'lesson' | 'word_list' | 'class_session' | 'topic') => {
    if (type === 'topic') {
      setCreatingTopic(true);
    } else {
      setCreateType(type);
    }
  };

  // ---- Collapse toggle ----

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // ---- Expand / Collapse all posts ----

  const toggleExpandPost = (postId: string) => {
    setExpandedPosts((prev) => {
      const next = new Set(prev);
      if (next.has(postId)) next.delete(postId); else next.add(postId);
      return next;
    });
  };

  const anyExpanded = expandedPosts.size > 0;

  const handleCollapseExpandAll = () => {
    if (anyExpanded) {
      setExpandedPosts(new Set());
    } else {
      setExpandedPosts(new Set(posts.map((p) => p.id)));
    }
  };

  // ---- Drag and drop ----

  const handleDragStartPost = (e: React.DragEvent, post: StreamPost) => {
    setDragItem({ id: post.id, kind: 'post' });
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOverPost = (postId: string) => {
    if (dragItem?.kind === 'post') setDragOverId(postId);
  };

  const handleDropPost = (e: React.DragEvent, targetPostId: string, topicId: string | null) => {
    e.preventDefault();
    if (!dragItem || dragItem.kind !== 'post' || dragItem.id === targetPostId) {
      setDragItem(null);
      setDragOverId(null);
      return;
    }

    const normalizeId = (id: string | null | undefined) => id ?? null;
    const topicPosts = posts
      .filter((p) => normalizeId(p.topic_id) === topicId)
      .sort((a, b) =>
        (a.position ?? 0) - (b.position ?? 0) ||
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );

    const dragIndex = topicPosts.findIndex((p) => p.id === dragItem.id);
    const targetIndex = topicPosts.findIndex((p) => p.id === targetPostId);
    if (dragIndex === -1 || targetIndex === -1) { setDragItem(null); setDragOverId(null); return; }

    const reordered = [...topicPosts];
    const [moved] = reordered.splice(dragIndex, 1);
    reordered.splice(targetIndex, 0, moved);

    const items = reordered.map((p, i) => ({ id: p.id, kind: 'post' as const, position: i, topic_id: topicId }));

    const previousPosts = posts;
    setPosts((prev) => {
      const others = prev.filter((p) => normalizeId(p.topic_id) !== topicId);
      return [...others, ...reordered.map((p, i) => ({ ...p, position: i }))];
    });

    api.reorderStream(items).catch((err: any) => {
      console.error('Reorder posts failed:', err);
      setError(toErrorMessage(err));
      setPosts(previousPosts);
    });

    setDragItem(null);
    setDragOverId(null);
  };

  const handleDragEndPost = () => {
    setDragItem(null);
    setDragOverId(null);
  };

  const handleDragStartTopic = (e: React.DragEvent, topic: StreamTopic) => {
    setDragItem({ id: topic.id, kind: 'topic' });
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOverTopic = (topicId: string) => {
    if (dragItem?.kind === 'topic') setDragOverId(topicId);
  };

  const handleDropTopic = (e: React.DragEvent, targetTopicId: string) => {
    e.preventDefault();
    if (!dragItem || dragItem.kind !== 'topic' || dragItem.id === targetTopicId) {
      setDragItem(null);
      setDragOverId(null);
      return;
    }

    const dragIndex = topics.findIndex((t) => t.id === dragItem.id);
    const targetIndex = topics.findIndex((t) => t.id === targetTopicId);
    if (dragIndex === -1 || targetIndex === -1) { setDragItem(null); setDragOverId(null); return; }

    const reordered = [...topics];
    const [moved] = reordered.splice(dragIndex, 1);
    reordered.splice(targetIndex, 0, moved);

    const previousTopics = topics;
    setTopics(reordered.map((t, i) => ({ ...t, position: i })));

    api.reorderStream(reordered.map((t, i) => ({ id: t.id, kind: 'topic' as const, position: i }))).catch((err: any) => {
      console.error('Reorder topics failed:', err);
      setError(toErrorMessage(err));
      setTopics(previousTopics);
    });

    setDragItem(null);
    setDragOverId(null);
  };

  // ---- Grouping ----

  const noTopicPosts = posts.filter((p) => !p.topic_id);
  const allowLegacyStreamManagement = !!(isTeacher && activeClassroom?.is_default_migrated);
  const showPhaseOnePlaceholder = !!activeClassroom && !activeClassroom.is_default_migrated && posts.length === 0;

  const isEmpty = posts.length === 0 && topics.length === 0 && !creatingTopic;

  // ---- Topic filtering ----

  const filteredTopics = filterTopicId
    ? topics.filter((t) => t.id === filterTopicId)
    : topics;

  const showNoTopic = filterTopicId === null;

  const handleClassroomChange = (classroomId: string) => {
    setActiveClassroomId(classroomId);
  };

  const handleClassroomUpdated = async (updated: Classroom) => {
    await reloadClassrooms();
    setActiveClassroomId(updated.id);
  };

  // Shared topic section props
  const topicSectionProps = {
    topics,
    isTeacher,
    allowTopicManagement: allowLegacyStreamManagement,
    onDeletePost: handleDeletePost,
    onEditPost: handleEditPost,
    onMovePost: handleMovePost,
    onRenameTopic: handleRenameTopic,
    onDeleteTopic: handleDeleteTopic,
    expandedPosts,
    onToggleExpandPost: toggleExpandPost,
    dragItem,
    dragOverId,
    onDragStartPost: handleDragStartPost,
    onDragOverPost: handleDragOverPost,
    onDropPost: handleDropPost,
    onDragEndPost: handleDragEndPost,
    onDragStartTopic: handleDragStartTopic,
    onDragOverTopic: handleDragOverTopic,
    onDropTopic: handleDropTopic,
    onStudentUpdate: handleStudentUpdate,
    enrichingWordIds,
    studentCount,
  };

  return (
    <div className="classwork-page">
      <div className="classwork-header">
        <div className="classwork-header-main">
          <div>
            <button className="channel-back-btn" onClick={() => navigate(-1)}>
              <ChevronLeftIcon size={18} /> Back
            </button>
            <h1 className="classwork-title">Classwork</h1>
          </div>
          <ClassroomPicker
            classrooms={classrooms}
            value={activeClassroomId}
            onChange={handleClassroomChange}
            label="Class"
          />
        </div>
        {isTeacher && activeClassroom && (
          <div className="classwork-header-actions">
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => navigate(`/students?classroomId=${activeClassroomId}`)}
              title="Students"
            >
              <PeopleIcon size={14} />
              Students
            </button>
            {allowLegacyStreamManagement ? (
              <>
                <button
                  className="btn btn-primary btn-sm stream-create-btn"
                  onClick={() => setShowCreateMenu((prev) => !prev)}
                >
                  <PlusIcon size={14} strokeWidth={2.5} />
                  Create
                  <ChevronDownIcon size={12} strokeWidth={2.5} style={{ marginLeft: '2px' }} />
                </button>
                {showCreateMenu && (
                  <CreateMenu
                    onSelect={handleCreateMenuSelect}
                    onClose={() => setShowCreateMenu(false)}
                  />
                )}
              </>
            ) : (
              <button
                className="btn btn-primary btn-sm stream-create-btn"
                onClick={() => setCreatingTopic(true)}
              >
                <PlusIcon size={14} strokeWidth={2.5} />
                Create topic
              </button>
            )}
          </div>
        )}
      </div>

      {/* Toolbar: topic filter + collapse/expand all */}
      {!isEmpty && !loading && !classroomsLoading && (
        <div className="classwork-toolbar">
          <select
            className="classwork-topic-filter"
            value={filterTopicId ?? ''}
            onChange={(e) => setFilterTopicId(e.target.value || null)}
          >
            <option value="">All topics</option>
            {topics.map((t) => (
              <option key={t.id} value={t.id}>{t.title}</option>
            ))}
          </select>
          <button className="classwork-collapse-all" onClick={handleCollapseExpandAll}>
            <CloseIcon size={14} strokeWidth={2.5} />
            {anyExpanded ? 'Collapse all' : 'Expand all'}
          </button>
        </div>
      )}

      {classroomsError && <div className="auth-error">{classroomsError}</div>}
      {error && <div className="auth-error">{error}</div>}
      {activeClassroom?.needs_setup && isTeacher && (
        <ClassroomSetupBanner classroom={activeClassroom} onUpdated={handleClassroomUpdated} />
      )}

      {classroomsLoading || loading ? (
        <div className="loading-screen"><div className="loading-spinner" /></div>
      ) : isEmpty ? (
        <div className="classwork-empty">
          {showPhaseOnePlaceholder
            ? isTeacher
              ? 'Assignments for this class will appear here in the next phase. You can already add topics and manage the roster for it.'
              : 'Assignments for this class will appear here once your teacher starts posting work to it.'
            : isTeacher
            ? 'No posts yet. Click "Create" to share materials, lessons, or word lists.'
            : "Your teacher hasn't posted anything yet, or you haven't been added to a class."}
        </div>
      ) : (
        <div className="classwork-feed">

          {/* No-topic section */}
          {showNoTopic && (noTopicPosts.length > 0 || (isTeacher && posts.length === 0 && topics.length === 0)) && (
            <TopicSection
              topic={null}
              posts={noTopicPosts}
              collapsed={collapsed.has('__no_topic__')}
              onToggleCollapse={() => toggleCollapse('__no_topic__')}
              {...topicSectionProps}
            />
          )}

          {/* Named topic sections */}
          {filteredTopics.map((topic) => (
            <TopicSection
              key={topic.id}
              topic={topic}
              posts={posts.filter((p) => p.topic_id === topic.id)}
              collapsed={collapsed.has(topic.id)}
              onToggleCollapse={() => toggleCollapse(topic.id)}
              {...topicSectionProps}
            />
          ))}

          {/* Inline new topic input */}
          {creatingTopic && (
            <div className="stream-topic-section stream-topic-section--creating">
              <div className="stream-topic-header">
                <input
                  className="stream-topic-rename-input"
                  placeholder="Topic name..."
                  value={newTopicTitle}
                  onChange={(e) => setNewTopicTitle(e.target.value)}
                  onBlur={handleCreateTopic}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateTopic();
                    if (e.key === 'Escape') { setCreatingTopic(false); setNewTopicTitle(''); }
                  }}
                  autoFocus
                />
              </div>
            </div>
          )}
        </div>
      )}

      {editingPost && editingPost.type !== 'word_list' && (
        <EditModal post={editingPost} onSave={handleEditSaved} onClose={() => setEditingPost(null)} />
      )}
      {editingPost && editingPost.type === 'word_list' && (
        <CreatePostModal
          defaultTab="word_list"
          topics={topics}
          user={user!}
          onCreated={handlePostCreated}
          onClose={() => setEditingPost(null)}
          editingPost={editingPost}
          onSaved={handleEditSaved}
        />
      )}

      {createType && (
        <CreatePostModal
          defaultTab={createType}
          topics={topics}
          user={user!}
          onCreated={handlePostCreated}
          onClose={() => setCreateType(null)}
        />
      )}
    </div>
  );
}
