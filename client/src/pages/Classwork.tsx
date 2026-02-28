// ---------------------------------------------------------------------------
// pages/Classwork.tsx — Class stream (Google Classroom-style)
// ---------------------------------------------------------------------------

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import * as api from '../api';
import type { StreamPost, StreamTopic } from '../api';
import { CreatePostModal, CreateMenu } from '../components/classwork/CreatePostModal';
import EditModal from '../components/classwork/EditModal';
import { TopicSection } from '../components/classwork/TopicSection';

// ---------------------------------------------------------------------------
// Main Classwork component
// ---------------------------------------------------------------------------

export default function Classwork() {
  const { user } = useAuth();
  const isTeacher = user?.account_type === 'teacher';

  const [topics, setTopics] = useState<StreamTopic[]>([]);
  const [posts, setPosts] = useState<StreamPost[]>([]);
  const [enrichingWordIds, setEnrichingWordIds] = useState<Map<string, Set<string>>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editingPost, setEditingPost] = useState<StreamPost | null>(null);
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const [createType, setCreateType] = useState<'material' | 'lesson' | 'word_list' | null>(null);
  const [creatingTopic, setCreatingTopic] = useState(false);
  const [newTopicTitle, setNewTopicTitle] = useState('');
  const [dragItem, setDragItem] = useState<{ id: string; kind: 'post' | 'topic' } | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const loadStream = useCallback(() => {
    setLoading(true);
    setError('');
    api.getStream()
      .then(({ topics: fetchedTopics, posts: fetchedPosts }) => {
        setTopics(fetchedTopics);
        setPosts(fetchedPosts);
      })
      .catch((err: any) => {
        console.error('getStream failed:', err);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadStream(); }, [loadStream]);

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
    setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, topic_id: newTopicId } : p)));
    try {
      await api.reorderStream([{ id: postId, kind: 'post', position: post.position ?? 0, topic_id: newTopicId }]);
    } catch (err: any) {
      console.error('Move post failed:', err);
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
      await api.deleteTopic(topicId);
      setTopics((prev) => prev.filter((t) => t.id !== topicId));
      setPosts((prev) => prev.map((p) => (p.topic_id === topicId ? { ...p, topic_id: null } : p)));
    } catch (err: any) {
      console.error('Delete topic failed:', err);
    }
  };

  const handleCreateTopic = async () => {
    if (!newTopicTitle.trim()) { setCreatingTopic(false); return; }
    try {
      const topic = await api.createTopic(newTopicTitle.trim());
      setTopics((prev) => [...prev, topic]);
    } catch (err: any) {
      console.error('Create topic failed:', err);
    } finally {
      setNewTopicTitle('');
      setCreatingTopic(false);
    }
  };

  const handleCreateMenuSelect = (type: 'material' | 'lesson' | 'word_list' | 'topic') => {
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

    setPosts((prev) => {
      const others = prev.filter((p) => normalizeId(p.topic_id) !== topicId);
      return [...others, ...reordered.map((p, i) => ({ ...p, position: i }))];
    });

    api.reorderStream(items).catch((err: any) => {
      console.error('Reorder posts failed:', err);
      loadStream();
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

    setTopics(reordered.map((t, i) => ({ ...t, position: i })));

    api.reorderStream(reordered.map((t, i) => ({ id: t.id, kind: 'topic' as const, position: i }))).catch((err: any) => {
      console.error('Reorder topics failed:', err);
      loadStream();
    });

    setDragItem(null);
    setDragOverId(null);
  };

  // ---- Grouping ----

  const noTopicPosts = posts.filter((p) => !p.topic_id);

  const isEmpty = posts.length === 0 && topics.length === 0 && !creatingTopic;

  return (
    <div className="classwork-page">
      <div className="classwork-header">
        <h1 className="classwork-title">Classwork</h1>
        {isTeacher && (
          <div style={{ position: 'relative' }}>
            <button
              className="btn btn-primary btn-sm stream-create-btn"
              onClick={() => setShowCreateMenu((prev) => !prev)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Create
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginLeft: '2px' }}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {showCreateMenu && (
              <CreateMenu
                onSelect={handleCreateMenuSelect}
                onClose={() => setShowCreateMenu(false)}
              />
            )}
          </div>
        )}
      </div>

      {error && <div className="auth-error">{error}</div>}

      {loading ? (
        <div className="loading-screen"><div className="loading-spinner" /></div>
      ) : isEmpty ? (
        <div className="classwork-empty">
          {isTeacher
            ? 'No posts yet. Click "Create" to share materials, lessons, or word lists.'
            : "Your teacher hasn't posted anything yet, or you haven't been added to a class."}
        </div>
      ) : (
        <div className="classwork-feed">

          {/* No-topic section */}
          {(noTopicPosts.length > 0 || (isTeacher && posts.length === 0 && topics.length === 0)) && (
            <TopicSection
              topic={null}
              posts={noTopicPosts}
              topics={topics}
              isTeacher={isTeacher}
              collapsed={collapsed.has('__no_topic__')}
              onToggleCollapse={() => toggleCollapse('__no_topic__')}
              onDeletePost={handleDeletePost}
              onEditPost={handleEditPost}
              onMovePost={handleMovePost}
              onRenameTopic={handleRenameTopic}
              onDeleteTopic={handleDeleteTopic}
              dragItem={dragItem}
              dragOverId={dragOverId}
              onDragStartPost={handleDragStartPost}
              onDragOverPost={handleDragOverPost}
              onDropPost={handleDropPost}
              onDragEndPost={handleDragEndPost}
              onDragStartTopic={handleDragStartTopic}
              onDragOverTopic={handleDragOverTopic}
              onDropTopic={handleDropTopic}
              onStudentUpdate={handleStudentUpdate}
              enrichingWordIds={enrichingWordIds}
            />
          )}

          {/* Named topic sections */}
          {topics.map((topic) => (
            <TopicSection
              key={topic.id}
              topic={topic}
              posts={posts.filter((p) => p.topic_id === topic.id)}
              topics={topics}
              isTeacher={isTeacher}
              collapsed={collapsed.has(topic.id)}
              onToggleCollapse={() => toggleCollapse(topic.id)}
              onDeletePost={handleDeletePost}
              onEditPost={handleEditPost}
              onMovePost={handleMovePost}
              onRenameTopic={handleRenameTopic}
              onDeleteTopic={handleDeleteTopic}
              dragItem={dragItem}
              dragOverId={dragOverId}
              onDragStartPost={handleDragStartPost}
              onDragOverPost={handleDragOverPost}
              onDropPost={handleDropPost}
              onDragEndPost={handleDragEndPost}
              onDragStartTopic={handleDragStartTopic}
              onDragOverTopic={handleDragOverTopic}
              onDropTopic={handleDropTopic}
              onStudentUpdate={handleStudentUpdate}
              enrichingWordIds={enrichingWordIds}
            />
          ))}

          {/* Inline new topic input */}
          {creatingTopic && (
            <div className="stream-topic-section stream-topic-section--creating">
              <div className="stream-topic-header">
                <input
                  className="stream-topic-rename-input"
                  placeholder="Topic name…"
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

      {editingPost && (
        <EditModal post={editingPost} onSave={handleEditSaved} onClose={() => setEditingPost(null)} />
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
