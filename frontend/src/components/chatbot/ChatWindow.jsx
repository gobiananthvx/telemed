import React, { useRef, useEffect } from 'react';
import { Bot, Sparkles, Stethoscope, Calendar, FileText } from 'lucide-react';
import { ChatMessage } from './ChatMessage';

const DEFAULT_QUICK_ACTIONS = [
  { label: 'Find a doctor', icon: Stethoscope },
  { label: 'Show my appointments', icon: Calendar },
  { label: 'When is my next appointment?', icon: Calendar },
  { label: 'Show my prescriptions', icon: FileText },
  { label: 'Find a cardiologist', icon: Stethoscope },
];

export const ChatWindow = ({
  messages,
  isLoading,
  onSendMessage,
  onSelectDoctor,
  onSelectSlot,
  onConfirmBooking,
  onCancelBooking
}) => {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gradient-to-b from-slate-50/50 to-white no-scrollbar">
      {messages.length === 0 ? (
        /* Empty / Initial State */
        <div className="py-6 px-2 text-center animate-in fade-in duration-300">
          <div className="w-12 h-12 rounded-2xl bg-teal-100 text-teal-800 flex items-center justify-center mx-auto mb-3 shadow-subtle">
            <Bot className="w-6 h-6 text-teal-700" />
          </div>
          <h3 className="font-extrabold text-sm text-slate-900 mb-1">
            Telemed AI Assistant
          </h3>
          <p className="text-xs text-slate-500 leading-relaxed max-w-xs mx-auto mb-5">
            Hi! I can help you find doctors, check appointment slots, view prescriptions, and book consultations.
          </p>

          <div className="space-y-1.5 max-w-xs mx-auto">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-2">
              Suggested Requests
            </span>
            {DEFAULT_QUICK_ACTIONS.map((action, idx) => {
              const Icon = action.icon;
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => onSendMessage(action.label)}
                  className="tap-scale w-full text-left bg-white hover:bg-teal-50 border border-slate-200/80 hover:border-teal-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-700 hover:text-teal-900 transition flex items-center gap-2 shadow-2xs group"
                >
                  <Icon className="w-3.5 h-3.5 text-teal-600 group-hover:scale-110 transition-transform" />
                  <span>{action.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        /* Conversation Messages */
        messages.map((msg, idx) => (
          <ChatMessage
            key={msg.id || idx}
            message={msg}
            onSelectDoctor={onSelectDoctor}
            onSelectSlot={onSelectSlot}
            onConfirmBooking={onConfirmBooking}
            onCancelBooking={onCancelBooking}
          />
        ))
      )}

      {/* Typing / Loading Indicator */}
      {isLoading && (
        <div className="flex items-start gap-2 animate-in fade-in duration-200">
          <div className="w-7 h-7 rounded-xl bg-gradient-to-tr from-teal-700 to-teal-600 text-white flex items-center justify-center shrink-0 shadow-2xs mt-0.5">
            <Bot className="w-4 h-4" />
          </div>
          <div className="bg-white border border-teal-100 rounded-2xl rounded-tl-xs px-3.5 py-3 shadow-xs flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-teal-600 animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-2 h-2 rounded-full bg-teal-600 animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-2 h-2 rounded-full bg-teal-600 animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
};
