import { request } from './core';

export interface Conversation {
  friend_id: string;
  friend_username: string;
  friend_display_name: string;
  online: boolean;
  last_message_body: string | null;
  last_message_at: string | null;
  last_message_sender_id: string | null;
  unread_count: number;
}

export interface Message {
  id: string;
  sender_id: string;
  receiver_id: string;
  body: string;
  read_at: string | null;
  created_at: string;
}

export interface MessagesPage {
  messages: Message[];
  has_more: boolean;
}

export function getConversations() {
  return request<Conversation[]>('/conversations');
}

export function getMessages(friendId: string, before?: string, limit?: number) {
  const params = new URLSearchParams();
  if (before) params.set('before', before);
  if (limit) params.set('limit', String(limit));
  const qs = params.toString();
  return request<MessagesPage>(`/messages/${friendId}${qs ? `?${qs}` : ''}`);
}

export function sendMessage(friendId: string, body: string) {
  return request<Message>(`/messages/${friendId}`, { method: 'POST', body: { body } });
}

export function markMessagesRead(friendId: string) {
  return request<{ updated: number }>(`/messages/${friendId}/read`, { method: 'POST' });
}
