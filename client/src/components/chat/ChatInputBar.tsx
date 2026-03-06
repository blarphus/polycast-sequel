import React from 'react';
import { SendIcon } from '../icons';

interface ChatInputBarProps {
  input: string;
  sending: boolean;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onSend: () => void;
}

export default function ChatInputBar({
  input,
  sending,
  onChange,
  onKeyDown,
  onSend,
}: ChatInputBarProps) {
  return (
    <div className="chat-input-bar">
      <input
        className="chat-input"
        type="text"
        placeholder="Message..."
        value={input}
        onChange={onChange}
        onKeyDown={onKeyDown}
      />
      <button
        className="chat-send-btn"
        onClick={onSend}
        disabled={!input.trim() || sending}
      >
        <SendIcon size={20} />
      </button>
    </div>
  );
}
