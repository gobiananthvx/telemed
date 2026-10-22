import React from 'react';
import { Bot, Minus, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import { ChatWindow } from './ChatWindow';
import { ChatInput } from './ChatInput';

export const ChatbotPopup = ({
  isOpen,
  onClose,
  onClearSession,
  messages,
  isLoading,
  suggestions,
  onSendMessage,
  onSelectDoctor,
  onSelectSlot,
  onConfirmBooking,
  onCancelBooking,
  voiceMode,
  onToggleVoiceMode,
  triggerListen,
  onActivateVoice
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed bottom-22 right-4 sm:bottom-24 sm:right-6 z-50 w-[calc(100vw-2rem)] sm:w-[420px] h-[560px] sm:h-[640px] max-h-[80vh] bg-white rounded-2xl shadow-floating border border-teal-100/90 flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300">
      {/* Header */}
      <div className="px-4 py-3 bg-gradient-to-r from-teal-800 via-teal-700 to-teal-800 text-white flex items-center justify-between shadow-subtle shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-white/15 backdrop-blur-md flex items-center justify-center border border-white/20 shadow-2xs">
            <Bot className="w-4.5 h-4.5 text-teal-100" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h3 className="font-extrabold text-xs tracking-tight text-white">
                Telemed AI Assistant
              </h3>
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            </div>
            <p className="text-[10px] text-teal-100/90 font-medium">
              Appointments, Doctors & Prescriptions
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {/* Voice Mode Audio Toggle */}
          <button
            type="button"
            onClick={onToggleVoiceMode}
            title={voiceMode ? "Voice Response: Active (Click to mute)" : "Voice Response: Muted (Click to enable)"}
            className={`tap-scale p-1.5 rounded-lg transition ${
              voiceMode
                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-400/30"
                : "text-teal-200/80 hover:text-white hover:bg-white/10"
            }`}
            aria-label="Toggle voice output"
          >
            {voiceMode ? <Volume2 className="w-4 h-4 animate-pulse" /> : <VolumeX className="w-4 h-4" />}
          </button>

          {messages.length > 0 && (
            <button
              type="button"
              onClick={onClearSession}
              title="Reset Conversation"
              className="tap-scale p-1.5 rounded-lg text-teal-100 hover:text-white hover:bg-white/10 transition"
              aria-label="Reset conversation"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            title="Minimize"
            className="tap-scale p-1.5 rounded-lg text-teal-100 hover:text-white hover:bg-white/10 transition"
            aria-label="Close chat"
          >
            <Minus className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Conversation Window */}
      <ChatWindow
        messages={messages}
        isLoading={isLoading}
        onSendMessage={onSendMessage}
        onSelectDoctor={onSelectDoctor}
        onSelectSlot={onSelectSlot}
        onConfirmBooking={onConfirmBooking}
        onCancelBooking={onCancelBooking}
      />

      {/* Input */}
      <ChatInput
        onSendMessage={onSendMessage}
        isLoading={isLoading}
        suggestions={suggestions}
        triggerListen={triggerListen}
        onActivateVoice={onActivateVoice}
      />
    </div>
  );
};
