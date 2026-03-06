import React from 'react';
import type { Message } from '../../api';
import TokenizedText from '../TokenizedText';
import { TranslateIcon } from '../icons';
import { formatTime, getDateLabel, shouldShowDateSeparator } from '../../utils/dateFormat';

interface ChatMessageListProps {
  currentUserId?: string;
  loadingMore: boolean;
  messages: Message[];
  messagesContainerRef: React.RefObject<HTMLDivElement>;
  messagesEndRef: React.RefObject<HTMLDivElement>;
  nativeLang?: string;
  onScroll: () => void;
  onTranslate: (messageId: string, body: string) => void;
  onWordClick: (e: React.MouseEvent<HTMLSpanElement>, word: string, sentence: string) => void;
  savedWords: Set<string>;
  translating: Set<string>;
  translations: Map<string, string>;
  typing: boolean;
}

export default function ChatMessageList({
  currentUserId,
  loadingMore,
  messages,
  messagesContainerRef,
  messagesEndRef,
  nativeLang,
  onScroll,
  onTranslate,
  onWordClick,
  savedWords,
  translating,
  translations,
  typing,
}: ChatMessageListProps) {
  return (
    <div
      className="chat-messages"
      ref={messagesContainerRef}
      onScroll={onScroll}
    >
      {loadingMore && (
        <div className="chat-loading-more">
          <div className="loading-spinner" />
        </div>
      )}

      {messages.map((message, idx) => {
        const isSent = message.sender_id === currentUserId;
        return (
          <React.Fragment key={message.id}>
            {(idx === 0 || shouldShowDateSeparator(messages[idx - 1].created_at, message.created_at)) && (
              <div className="chat-date-separator">
                <span>{getDateLabel(message.created_at)}</span>
              </div>
            )}
            <div className={`chat-bubble-row ${isSent ? 'sent' : 'received'}`}>
              {!isSent && nativeLang && (
                <button
                  className={`chat-translate-btn${translations.has(message.id) ? ' translated' : ''}`}
                  onClick={() => onTranslate(message.id, message.body)}
                  disabled={translating.has(message.id)}
                  title="Translate"
                >
                  {translating.has(message.id) ? (
                    <div className="loading-spinner" style={{ width: 14, height: 14 }} />
                  ) : (
                    <TranslateIcon size={14} />
                  )}
                </button>
              )}
              <div className={`chat-bubble ${isSent ? 'sent' : 'received'}`}>
                <p className="chat-bubble-body">
                  <TokenizedText text={message.body} savedWords={savedWords} onWordClick={onWordClick} />
                </p>
                {translations.has(message.id) && (
                  <p className="chat-bubble-translation">{translations.get(message.id)}</p>
                )}
                <span className="chat-bubble-time">
                  {formatTime(message.created_at)}
                  {isSent && message.read_at && ' \u2713\u2713'}
                </span>
              </div>
            </div>
          </React.Fragment>
        );
      })}

      {typing && (
        <div className="chat-typing-indicator">typing...</div>
      )}

      <div ref={messagesEndRef} />
    </div>
  );
}
