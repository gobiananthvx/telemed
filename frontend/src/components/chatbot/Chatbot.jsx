import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { apiClient } from '../../api/client';
import { ChatbotButton } from './ChatbotButton';
import { ChatbotPopup } from './ChatbotPopup';

// Helper: Clean markdown and system formatting for natural voice playback
export const cleanTextForSpeech = (text) => {
  if (!text) return '';
  return text
    // Replace markdown links [label](url) -> label
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove markdown bold/italic asterisks and underscores
    .replace(/[*_~`]/g, '')
    // Replace list bullets and numbers
    .replace(/^[•\-\*]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    // Replace markdown headings
    .replace(/^#+\s+/gm, '')
    // Rephrase booking / reference IDs nicely for speech
    .replace(/#?TLM-BOK-(\d+)/gi, 'Booking number $1')
    .replace(/#?MED-(\d+)-TX/gi, 'Prescription number $1')
    .replace(/₹\s*(\d+)/g, '$1 rupees')
    // Clean up extra whitespace & line breaks
    .replace(/\n+/g, '. ')
    .replace(/\s+/g, ' ')
    .trim();
};

// Web Speech Synthesis Helper
export const speakAssistantText = (text) => {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel(); // Cancel any ongoing speech
    const clean = cleanTextForSpeech(text);
    if (!clean) return;

    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.lang = 'en-US';
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    const voices = window.speechSynthesis.getVoices();
    const enVoice =
      voices.find(v => v.lang.startsWith('en') && (v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Samantha') || v.name.includes('Alex'))) ||
      voices.find(v => v.lang.startsWith('en'));
    if (enVoice) {
      utterance.voice = enVoice;
    }

    window.speechSynthesis.speak(utterance);
  } catch (err) {
    console.warn('[WebAudio] SpeechSynthesis error:', err);
  }
};

export const stopAssistantSpeech = () => {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
};

export const Chatbot = () => {
  const { isAuthenticated, isPatient } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState(() => localStorage.getItem('telemed_chat_session_id'));
  const [voiceMode, setVoiceMode] = useState(() => localStorage.getItem('telemed_voice_mode') === 'true');
  const [suggestions, setSuggestions] = useState([
    'Find a doctor',
    'Show my appointments',
    'When is my next appointment?',
    'Show my prescriptions'
  ]);
  const [hasUnread, setHasUnread] = useState(false);
  const voiceModeRef = useRef(voiceMode);
  voiceModeRef.current = voiceMode;

  // Toggle Voice Mode
  const toggleVoiceMode = () => {
    const next = !voiceMode;
    setVoiceMode(next);
    localStorage.setItem('telemed_voice_mode', String(next));
    if (!next) {
      stopAssistantSpeech();
    }
  };

  // If not authenticated patient, do not render chatbot
  if (!isAuthenticated || !isPatient) {
    return null;
  }

  // 15-Second Inactivity Detector for Authenticated Patients
  useEffect(() => {
    if (!isAuthenticated || !isPatient) return;

    // Check if user was already greeted automatically in this browser session
    const alreadyGreeted = sessionStorage.getItem('telemed_inactivity_greeted');
    if (alreadyGreeted) return;

    let inactivityTimer = null;

    const resetTimer = () => {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => {
        const greeted = sessionStorage.getItem('telemed_inactivity_greeted');
        if (!greeted) {
          sessionStorage.setItem('telemed_inactivity_greeted', 'true');
          setIsOpen(true);
          setVoiceMode(true);
          localStorage.setItem('telemed_voice_mode', 'true');

          const greetingContent = "Hello! I noticed you might need assistance. How can I help you today? You can search for doctors, book appointments, or check your prescriptions.";
          const greetingMsg = {
            id: Date.now(),
            role: 'assistant',
            content: greetingContent,
            message_type: 'text',
            data: null,
            created_at: new Date().toISOString()
          };
          setMessages((prev) => [...prev, greetingMsg]);

          // Low-latency voice greeting
          speakAssistantText("Hello! I noticed you might need assistance. How can I help you today?");
        }
      }, 15000); // 15 seconds
    };

    const activityEvents = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
    activityEvents.forEach((ev) => window.addEventListener(ev, resetTimer, { passive: true }));

    // Start timer on initial mount
    resetTimer();

    return () => {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      activityEvents.forEach((ev) => window.removeEventListener(ev, resetTimer));
    };
  }, [isAuthenticated, isPatient]);

  // Load existing session history on initial mount
  useEffect(() => {
    const loadSession = async () => {
      if (!sessionId) return;
      try {
        const data = await apiClient(`/chat/sessions/${sessionId}`);
        if (data && data.messages) {
          setMessages(data.messages);
        }
      } catch (err) {
        localStorage.removeItem('telemed_chat_session_id');
        setSessionId(null);
      }
    };

    loadSession();
  }, [sessionId]);

  const handleSendMessage = async (text) => {
    if (!text || isLoading) return;

    // Stop ongoing speech before user speaks/types new request
    stopAssistantSpeech();

    // Optimistic user message
    const tempUserMsg = {
      id: Date.now(),
      role: 'user',
      content: text,
      created_at: new Date().toISOString()
    };

    setMessages((prev) => [...prev, tempUserMsg]);
    setIsLoading(true);

    try {
      const resp = await apiClient('/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: text,
          session_id: sessionId
        })
      });

      if (resp) {
        if (resp.session_id && resp.session_id !== sessionId) {
          setSessionId(resp.session_id);
          localStorage.setItem('telemed_chat_session_id', resp.session_id);
        }

        const assistantMsg = {
          id: Date.now() + 1,
          role: 'assistant',
          content: resp.message,
          message_type: resp.type,
          data: resp.data,
          created_at: new Date().toISOString()
        };

        setMessages((prev) => [...prev, assistantMsg]);

        // Speak response if voice mode enabled
        if (voiceModeRef.current) {
          speakAssistantText(resp.message);
        }

        if (resp.suggested_actions && resp.suggested_actions.length > 0) {
          setSuggestions(resp.suggested_actions);
        }

        if (!isOpen) {
          setHasUnread(true);
        }
      }
    } catch (err) {
      const errorMsg = {
        id: Date.now() + 1,
        role: 'assistant',
        content: err.message || "Sorry, I'm having trouble connecting right now. Please try again.",
        message_type: 'error',
        data: null,
        created_at: new Date().toISOString()
      };
      setMessages((prev) => [...prev, errorMsg]);
      if (voiceModeRef.current) {
        speakAssistantText("Sorry, I'm having trouble connecting right now. Please try again.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectDoctor = (doctor) => {
    handleSendMessage(`Show available slots for ${doctor.full_name} tomorrow`);
  };

  const handleSelectSlot = (slot, slotData) => {
    const docName = slotData?.doctor_name ? ` with ${slotData.doctor_name}` : '';
    const dateStr = slotData?.date ? ` on ${slotData.date}` : ' tomorrow';
    handleSendMessage(`Book${docName}${dateStr} at ${slot.time}`);
  };

  const handleConfirmBooking = () => {
    handleSendMessage('Confirm');
  };

  const handleCancelBooking = () => {
    handleSendMessage('Cancel');
  };

  const handleClearSession = async () => {
    stopAssistantSpeech();
    if (sessionId) {
      try {
        await apiClient(`/chat/sessions/${sessionId}`, { method: 'DELETE' });
      } catch (err) {
        console.warn('Could not delete session on server:', err);
      }
    }
    localStorage.removeItem('telemed_chat_session_id');
    setSessionId(null);
    setMessages([]);
    setSuggestions([
      'Find a doctor',
      'Show my appointments',
      'When is my next appointment?',
      'Show my prescriptions'
    ]);
  };

  const toggleOpen = () => {
    if (!isOpen) {
      setHasUnread(false);
    } else {
      stopAssistantSpeech();
    }
    setIsOpen(!isOpen);
  };

  const handleClose = () => {
    stopAssistantSpeech();
    setIsOpen(false);
  };

  return (
    <>
      <ChatbotButton
        isOpen={isOpen}
        onClick={toggleOpen}
        hasUnread={hasUnread}
      />

      <ChatbotPopup
        isOpen={isOpen}
        onClose={handleClose}
        onClearSession={handleClearSession}
        messages={messages}
        isLoading={isLoading}
        suggestions={suggestions}
        onSendMessage={handleSendMessage}
        onSelectDoctor={handleSelectDoctor}
        onSelectSlot={handleSelectSlot}
        onConfirmBooking={handleConfirmBooking}
        onCancelBooking={handleCancelBooking}
        voiceMode={voiceMode}
        onToggleVoiceMode={toggleVoiceMode}
      />
    </>
  );
};
