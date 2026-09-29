import React from 'react';
import { Calendar, Clock, Video, Check, X, ShieldCheck } from 'lucide-react';

export const BookingConfirmationCard = ({ data, onConfirm, onCancel }) => {
  if (!data) return null;

  return (
    <div className="bg-gradient-to-br from-teal-50/60 to-white rounded-xl border-2 border-teal-600/60 p-3.5 shadow-card my-2 animate-in fade-in zoom-in-95 duration-200">
      <div className="flex items-center justify-between pb-2.5 border-b border-teal-100">
        <div className="flex items-center gap-1.5 text-xs font-extrabold text-teal-800">
          <ShieldCheck className="w-4 h-4 text-teal-600" />
          <span>Appointment Summary</span>
        </div>
        <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md">
          Confirmation Required
        </span>
      </div>

      <div className="mt-2.5 space-y-1.5 text-xs">
        <div>
          <span className="text-slate-400 text-[10px] block">Doctor</span>
          <span className="font-bold text-slate-900">{data.doctor_name}</span>
          <span className="text-teal-700 text-[11px] ml-1 font-semibold">({data.specialty})</span>
        </div>

        <div className="grid grid-cols-2 gap-2 pt-1">
          <div className="bg-white/80 p-2 rounded-lg border border-teal-100/80">
            <span className="text-slate-400 text-[10px] flex items-center gap-1">
              <Calendar className="w-3 h-3 text-teal-600" /> Date
            </span>
            <span className="font-bold text-slate-800 text-[11px] block mt-0.5">
              {data.date_formatted || data.date}
            </span>
          </div>

          <div className="bg-white/80 p-2 rounded-lg border border-teal-100/80">
            <span className="text-slate-400 text-[10px] flex items-center gap-1">
              <Clock className="w-3 h-3 text-teal-600" /> Time
            </span>
            <span className="font-bold text-slate-800 text-[11px] block mt-0.5">
              {data.time_formatted || data.start_time}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between pt-1.5 text-[11px]">
          <span className="flex items-center gap-1 text-slate-600 font-medium">
            <Video className="w-3.5 h-3.5 text-teal-600" />
            {data.consultation_mode || "Video consultation"}
          </span>
          <span className="font-extrabold text-teal-800 text-xs">
            Fee: ₹{data.fee}
          </span>
        </div>
      </div>

      <div className="mt-3 pt-2.5 border-t border-teal-100 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onCancel && onCancel()}
          className="flex-1 py-1.5 px-3 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 text-xs font-semibold transition tap-scale flex items-center justify-center gap-1"
        >
          <X className="w-3.5 h-3.5" />
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onConfirm && onConfirm()}
          className="flex-1 py-1.5 px-3 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold shadow-xs transition tap-scale flex items-center justify-center gap-1"
        >
          <Check className="w-3.5 h-3.5" />
          Confirm Booking
        </button>
      </div>
    </div>
  );
};
