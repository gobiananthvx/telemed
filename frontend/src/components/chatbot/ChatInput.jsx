import React, { useState, useRef, useEffect } from 'react';
import { Send, Sparkles } from 'lucide-react';

export const ChatInput = ({ onSendMessage, isLoading, suggestions = [] }) => {
  const [input, setInput] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (!isLoading && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isLoading]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    onSendMessage(input.trim());
    setInput('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="p-3 bg-white border-t border-teal-100/80">
      {/* Suggestion Chips */}
      {suggestions && suggestions.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-2 mb-1">
          {suggestions.map((s, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => onSendMessage(s)}
              disabled={isLoading}
              className="tap-scale shrink-0 text-[11px] font-semibold text-teal-800 bg-teal-50 hover:bg-teal-100/80 border border-teal-200/80 rounded-full px-2.5 py-1 transition flex items-center gap-1 disabled:opacity-50"
            >
              <Sparkles className="w-3 h-3 text-teal-600" />
              <span>{s}</span>
            </button>
          ))}
        </div>
      )}

      {/* Input form */}
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isLoading ? "Thinking..." : "Ask Telemed Assistant..."}
          disabled={isLoading}
          className="flex-1 bg-slate-50 border border-slate-200 focus:border-teal-500 focus:bg-white rounded-xl px-3.5 py-2 text-xs text-slate-800 placeholder-slate-400 outline-none transition disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={!input.trim() || isLoading}
          className="tap-scale w-8 h-8 rounded-xl bg-teal-700 hover:bg-teal-800 text-white flex items-center justify-center transition disabled:opacity-40 shadow-xs shrink-0"
          aria-label="Send message"
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </form>
    </div>
  );
};
