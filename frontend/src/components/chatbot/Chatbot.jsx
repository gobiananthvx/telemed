import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { apiClient } from '../../api/client';
import { ChatbotButton } from './ChatbotButton';
import { ChatbotPopup } from './ChatbotPopup';

export const Chatbot = () => {
  const { isAuthenticated, isPatient } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState(() => localStorage.getItem('telemed_chat_session_id'));
  const [suggestions, setSuggestions] = useState([
    'Find a doctor',
    'Show my appointments',
    'When is my next appointment?',
    'Show my prescriptions'
  ]);
  const [hasUnread, setHasUnread] = useState(false);

  // If not authenticated patient, do not render chatbot
  if (!isAuthenticated || !isPatient) {
    return null;
  }

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
        // If session expired or invalid, reset
        localStorage.removeItem('telemed_chat_session_id');
        setSessionId(null);
      }
    };

    loadSession();
  }, [sessionId]);

  const handleSendMessage = async (text) => {
    if (!text || isLoading) return;

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
    }
    setIsOpen(!isOpen);
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
        onClose={() => setIsOpen(false)}
        onClearSession={handleClearSession}
        messages={messages}
        isLoading={isLoading}
        suggestions={suggestions}
        onSendMessage={handleSendMessage}
        onSelectDoctor={handleSelectDoctor}
        onSelectSlot={handleSelectSlot}
        onConfirmBooking={handleConfirmBooking}
        onCancelBooking={handleCancelBooking}
      />
    </>
  );
};
