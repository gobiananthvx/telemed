import React from 'react';
import { Bot, Sparkles, X } from 'lucide-react';

export const ChatbotButton = ({ isOpen, onClick, hasUnread }) => {
  return (
    <div className="fixed bottom-20 right-4 sm:bottom-6 sm:right-6 z-50">
      <button
        type="button"
        onClick={onClick}
        aria-label={isOpen ? "Close Telemed AI Assistant" : "Open Telemed AI Assistant"}
        title="Telemed AI Assistant"
        className="tap-scale group relative flex items-center justify-center w-13 h-13 sm:w-14 sm:h-14 rounded-2xl bg-gradient-to-tr from-teal-800 via-teal-700 to-teal-600 text-white shadow-floating hover:shadow-teal-glow hover:scale-105 transition-all duration-300 focus:outline-none focus:ring-4 focus:ring-teal-500/30"
      >
        {/* Subtle breathing ring */}
        {!isOpen && (
          <span className="absolute -inset-1 rounded-2xl bg-teal-500/20 blur-sm animate-pulse pointer-events-none" />
        )}

        {isOpen ? (
          <X className="w-6 h-6 transition-transform duration-200 group-hover:rotate-90" />
        ) : (
          <>
            <Bot className="w-6 h-6 sm:w-7 sm:h-7 transition-transform duration-200 group-hover:scale-110" />
            <Sparkles className="w-3.5 h-3.5 text-teal-200 absolute top-2.5 right-2.5 animate-bounce" style={{ animationDuration: '2s' }} />
          </>
        )}

        {/* Unread indicator */}
        {hasUnread && !isOpen && (
          <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-rose-500 rounded-full ring-2 ring-white" />
        )}

        {/* Tooltip on hover (desktop only) */}
        {!isOpen && (
          <span className="hidden sm:block absolute right-full mr-3 top-1/2 -translate-y-1/2 bg-slate-900 text-white text-[11px] font-semibold px-2.5 py-1.5 rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
            Telemed AI Assistant
          </span>
        )}
      </button>
    </div>
  );
};
