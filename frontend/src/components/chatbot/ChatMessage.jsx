import React from 'react';
import { Bot, User, Sparkles, AlertCircle, CheckCircle } from 'lucide-react';
import { DoctorResultCard } from './DoctorResultCard';
import { SlotResultCard } from './SlotResultCard';
import { BookingConfirmationCard } from './BookingConfirmationCard';
import { AppointmentResultCard } from './AppointmentResultCard';
import { PrescriptionResultCard } from './PrescriptionResultCard';

export const ChatMessage = ({
  message,
  onSelectDoctor,
  onSelectSlot,
  onConfirmBooking,
  onCancelBooking
}) => {
  const isUser = message.role === 'user';

  // Basic markdown parser for bold, bullet points, and newlines
  const renderFormattedContent = (content) => {
    if (!content) return null;

    const lines = content.split('\n');
    return lines.map((line, lIdx) => {
      // Split on bold syntax **text**
      const parts = line.split(/(\*\*.*?\*\*)/g);
      const formattedLine = parts.map((part, pIdx) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return (
            <strong key={pIdx} className="font-bold text-slate-900">
              {part.slice(2, -2)}
            </strong>
          );
        }
        return part;
      });

      // Check if bullet point
      const isBullet = line.trim().startsWith('•') || line.trim().startsWith('-');

      return (
        <p
          key={lIdx}
          className={`${isBullet ? 'pl-2 text-slate-700' : ''} ${
            lIdx > 0 && line.trim() === '' ? 'h-2' : 'min-h-[1.25rem]'
          }`}
        >
          {formattedLine}
        </p>
      );
    });
  };

  if (isUser) {
    return (
      <div className="flex justify-end mb-3 animate-in fade-in slide-in-from-bottom-2 duration-200">
        <div className="max-w-[82%] bg-teal-700 text-white rounded-2xl rounded-tr-xs px-3.5 py-2.5 text-xs shadow-xs leading-relaxed font-medium">
          {message.content}
        </div>
      </div>
    );
  }

  // Assistant message
  const msgType = message.message_type || message.type || 'text';
  const data = message.data;

  return (
    <div className="flex items-start gap-2 mb-3 animate-in fade-in slide-in-from-bottom-2 duration-200">
      {/* Bot Avatar */}
      <div className="w-7 h-7 rounded-xl bg-gradient-to-tr from-teal-700 to-teal-600 text-white flex items-center justify-center shrink-0 shadow-2xs mt-0.5">
        <Bot className="w-4 h-4" />
      </div>

      <div className="flex-1 max-w-[88%]">
        {/* Main message bubble */}
        <div className="bg-white border border-teal-100/90 rounded-2xl rounded-tl-xs px-3.5 py-2.5 text-xs shadow-xs text-slate-800 leading-relaxed">
          {renderFormattedContent(message.content)}

          {/* Structured Cards Rendering */}
          {msgType === 'doctor_list' && Array.isArray(data) && (
            <div className="mt-2 space-y-1.5">
              {data.map((doc) => (
                <DoctorResultCard
                  key={doc.id}
                  doctor={doc}
                  onSelectDoctor={onSelectDoctor}
                />
              ))}
            </div>
          )}

          {msgType === 'doctor_details' && data && (
            <div className="mt-2">
              <DoctorResultCard
                doctor={data}
                onSelectDoctor={onSelectDoctor}
              />
            </div>
          )}

          {msgType === 'slot_list' && data && (
            <div className="mt-2">
              <SlotResultCard
                data={data}
                onSelectSlot={onSelectSlot}
              />
            </div>
          )}

          {msgType === 'booking_preview' && data && (
            <div className="mt-2">
              <BookingConfirmationCard
                data={data}
                onConfirm={onConfirmBooking}
                onCancel={onCancelBooking}
              />
            </div>
          )}

          {msgType === 'booking_confirmation' && data && (
            <div className="mt-2">
              <AppointmentResultCard appointment={data} />
            </div>
          )}

          {msgType === 'appointment_list' && Array.isArray(data) && (
            <div className="mt-2 space-y-1.5">
              {data.map((appt) => (
                <AppointmentResultCard key={appt.id} appointment={appt} />
              ))}
            </div>
          )}

          {msgType === 'appointment' && data && (
            <div className="mt-2">
              <AppointmentResultCard appointment={data} />
            </div>
          )}

          {msgType === 'prescription_list' && Array.isArray(data) && (
            <div className="mt-2 space-y-1.5">
              {data.map((rx) => (
                <PrescriptionResultCard key={rx.id} prescription={rx} />
              ))}
            </div>
          )}

          {msgType === 'prescription' && data && (
            <div className="mt-2">
              <PrescriptionResultCard prescription={data} />
            </div>
          )}

          {msgType === 'error' && (
            <div className="flex items-center gap-1.5 text-rose-600 font-semibold mt-1">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>Please try again or select another option.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
