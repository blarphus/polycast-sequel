import { useCallback, useEffect, useMemo, useState } from 'react';
import * as api from '../api';
import type { Classroom } from '../api';
import { useAuth } from './useAuth';

function getStorageKey(userId: string) {
  return `polycast:activeClassroom:${userId}`;
}

export function useActiveClassroom(preferredClassroomId?: string | null) {
  const { user } = useAuth();
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [activeClassroomId, setActiveClassroomId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const userId = user?.id ?? null;

  const chooseClassroomId = useCallback((items: Classroom[], preferredId?: string | null) => {
    if (items.length === 0) return null;
    if (preferredId && items.some((item) => item.id === preferredId)) {
      return preferredId;
    }

    if (userId) {
      const storedId = window.localStorage.getItem(getStorageKey(userId));
      if (storedId && items.some((item) => item.id === storedId)) {
        return storedId;
      }
    }

    return items[0].id;
  }, [userId]);

  const loadClassrooms = useCallback(async () => {
    if (!userId) {
      setClassrooms([]);
      setActiveClassroomId(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const items = await api.getClassrooms();
      setClassrooms(items);
      setActiveClassroomId((current) => {
        if (current && items.some((item) => item.id === current)) {
          return current;
        }
        return chooseClassroomId(items, preferredClassroomId);
      });
    } catch (err) {
      console.error('Failed to load classrooms:', err);
      setError(err instanceof Error ? err.message : 'Failed to load classrooms');
    } finally {
      setLoading(false);
    }
  }, [chooseClassroomId, preferredClassroomId, userId]);

  useEffect(() => {
    loadClassrooms();
  }, [loadClassrooms]);

  useEffect(() => {
    if (!userId || !activeClassroomId) return;
    window.localStorage.setItem(getStorageKey(userId), activeClassroomId);
  }, [activeClassroomId, userId]);

  useEffect(() => {
    if (!preferredClassroomId) return;
    if (classrooms.some((item) => item.id === preferredClassroomId)) {
      setActiveClassroomId(preferredClassroomId);
    }
  }, [classrooms, preferredClassroomId]);

  const activeClassroom = useMemo(
    () => classrooms.find((item) => item.id === activeClassroomId) ?? null,
    [activeClassroomId, classrooms],
  );

  return {
    classrooms,
    activeClassroom,
    activeClassroomId,
    setActiveClassroomId,
    loading,
    error,
    reloadClassrooms: loadClassrooms,
  };
}
