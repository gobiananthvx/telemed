import React, { useState, useRef, useEffect } from 'react';
import { Send, Sparkles, Mic, MicOff } from 'lucide-react';

export const ChatInput = ({ onSendMessage, isLoading, suggestions = [] }) => {
  const [input, setInput] = useState('');
  const [isListening, setIsListening] = useState(false);
  const inputRef = useRef(null);
  const recognitionRef = useRef(null);
  const [speechSupported, setSpeechSupported] = useState(true);

  // Initialize Speech Recognition
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSpeechSupported(false);
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }

        const currentText = (finalTranscript || interimTranscript).trim();
        if (currentText) {
          setInput(currentText);
        }

        // When speech recognition produces final transcript, submit immediately
        if (finalTranscript && finalTranscript.trim()) {
          onSendMessage(finalTranscript.trim());
          setInput('');
          recognition.stop();
        }
      };

      recognition.onerror = (event) => {
        console.warn('[WebAudio] SpeechRecognition error:', event.error);
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    } catch (err) {
      console.warn('SpeechRecognition initialization error:', err);
      setSpeechSupported(false);
    }

    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch (_) {}
      }
    };
  }, [onSendMessage]);

  useEffect(() => {
    if (!isLoading && !isListening && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isLoading, isListening]);

  const toggleListening = () => {
    if (!recognitionRef.current) {
      alert('Speech recognition is not supported in this browser. Please type your message.');
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      setInput('');
      try {
        recognitionRef.current.start();
      } catch (e) {
        console.warn('Speech start error:', e);
      }
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
    }
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
      {suggestions && suggestions.length > 0 && !isListening && (
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

      {/* Listening Banner */}
      {isListening && (
        <div className="flex items-center gap-2 pb-2 mb-1 text-xs text-rose-600 font-semibold animate-pulse">
          <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping" />
          <span>Listening... Speak clearly to Telemed Assistant</span>
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
          placeholder={
            isLoading
              ? "Thinking..."
              : isListening
              ? "Listening to your voice..."
              : "Ask Telemed Assistant..."
          }
          disabled={isLoading}
          className={`flex-1 bg-slate-50 border rounded-xl px-3.5 py-2 text-xs text-slate-800 placeholder-slate-400 outline-none transition disabled:opacity-60 ${
            isListening ? "border-rose-400 ring-2 ring-rose-100 bg-rose-50/40" : "border-slate-200 focus:border-teal-500 focus:bg-white"
          }`}
        />

        {/* Audio Mic Button */}
        {speechSupported && (
          <button
            type="button"
            onClick={toggleListening}
            disabled={isLoading}
            title={isListening ? "Stop listening" : "Speak to Telemed Assistant"}
            className={`tap-scale w-8 h-8 rounded-xl flex items-center justify-center transition shadow-xs shrink-0 ${
              isListening
                ? "bg-rose-600 text-white animate-pulse ring-2 ring-rose-300"
                : "bg-teal-50 hover:bg-teal-100 text-teal-700 border border-teal-200"
            }`}
            aria-label="Microphone"
          >
            {isListening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
          </button>
        )}

        {/* Text Send Button */}
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
