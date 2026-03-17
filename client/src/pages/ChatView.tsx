import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useSavedWords } from '../hooks/useSavedWords';
import type { PopupState } from '../textTokens';
import WordPopup from '../components/WordPopup';
import ChatHeader from '../components/chat/ChatHeader';
import ChatInputBar from '../components/chat/ChatInputBar';
import ChatMessageList from '../components/chat/ChatMessageList';
import { useChatConversation } from '../hooks/useChatConversation';
import { useMessageTranslations } from '../hooks/useMessageTranslations';

export default function ChatView() {
  const { friendId } = useParams<{ friendId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [popup, setPopup] = useState<PopupState | null>(null);

  const { savedWordsSet, isWordSaved, isDefinitionSaved, addWord, addOptimistic } = useSavedWords();

  function handleWordClick(e: React.MouseEvent<HTMLSpanElement>, word: string, sentence: string) {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setPopup({ word, sentence, rect });
  }

  const nativeLang = user?.native_language ?? undefined;
  const targetLang = user?.target_language ?? undefined;
  const {
    friendInfo,
    friendOnline,
    handleInputChange,
    handleKeyDown,
    handleScroll,
    handleSend,
    input,
    loading,
    loadingMore,
    messages,
    messagesContainerRef,
    messagesEndRef,
    sending,
    typing,
  } = useChatConversation({ friendId, userId: user?.id });
  const { handleTranslate, translating, translations } = useMessageTranslations({
    nativeLang,
    targetLang,
  });

  const friendName = friendInfo?.display_name || friendInfo?.username;

  if (loading) {
    return (
      <div className="chat-page">
        <div className="loading-screen">
          <div className="loading-spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className="chat-page">
      <ChatHeader
        friendName={friendName}
        friendOnline={friendOnline}
        onBack={() => navigate('/chats')}
        onCall={() => navigate(`/call/${friendId}?role=caller`)}
      />
      <ChatMessageList
        currentUserId={user?.id}
        loadingMore={loadingMore}
        messages={messages}
        messagesContainerRef={messagesContainerRef}
        messagesEndRef={messagesEndRef}
        nativeLang={nativeLang}
        onScroll={handleScroll}
        onTranslate={handleTranslate}
        onWordClick={handleWordClick}
        savedWords={savedWordsSet}
        translating={translating}
        translations={translations}
        typing={typing}
      />
      <ChatInputBar
        input={input}
        sending={sending}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onSend={handleSend}
      />

      {popup && nativeLang && (
        <WordPopup
          word={popup.word}
          sentence={popup.sentence}
          nativeLang={nativeLang}
          targetLang={targetLang}
          anchorRect={popup.rect}
          onClose={() => setPopup(null)}
          isWordSaved={isWordSaved}
          isDefinitionSaved={isDefinitionSaved}
          onSaveWord={addWord}
          onOptimisticSave={addOptimistic}
        />
      )}
    </div>
  );
}
