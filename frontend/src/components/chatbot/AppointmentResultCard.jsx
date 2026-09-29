import React from 'react';
import { Link } from 'react-router-dom';
import { Calendar, Clock, Video, User, CheckCircle2, AlertCircle } from 'lucide-react';

export const AppointmentResultCard = ({ appointment }) => {
  if (!appointment) return null;

  const isCompleted = appointment.status === 'COMPLETED';
  const isCancelled = appointment.status === 'CANCELLED' || appointment.status === 'MISSED';
  const isActionable = appointment.status === 'CONFIRMED' || appointment.status === 'SCHEDULED' || appointment.status === 'IN_PROGRESS';

  const getStatusBadge = (status) => {
    switch (status) {
      case 'CONFIRMED':
        return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      case 'IN_PROGRESS':
        return 'bg-teal-100 text-teal-800 border-teal-200 animate-pulse';
      case 'COMPLETED':
        return 'bg-slate-100 text-slate-700 border-slate-200';
      case 'CANCELLED':
      case 'MISSED':
        return 'bg-rose-100 text-rose-800 border-rose-200';
      default:
        return 'bg-blue-100 text-blue-800 border-blue-200';
    }
  };

  return (
    <div className="bg-white rounded-xl border border-teal-100/90 p-3 shadow-xs my-2 hover:border-teal-400 transition-all duration-200">
      <div className="flex items-center justify-between pb-2 border-b border-slate-100">
        <div>
          <span className="text-[10px] font-bold text-slate-400 block tracking-wider">
            {appointment.appointment_number}
          </span>
          <h4 className="font-bold text-xs text-slate-900 mt-0.5">
            {appointment.doctor_name}
          </h4>
        </div>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${getStatusBadge(appointment.status)}`}>
          {appointment.status}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 mt-2 text-[11px]">
        <div className="flex items-center gap-1.5 text-slate-600">
          <Calendar className="w-3.5 h-3.5 text-teal-600 shrink-0" />
          <span>{appointment.date}</span>
        </div>
        <div className="flex items-center gap-1.5 text-slate-600">
          <Clock className="w-3.5 h-3.5 text-teal-600 shrink-0" />
          <span>{appointment.start_time} - {appointment.end_time}</span>
        </div>
      </div>

      <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
        <span className="text-slate-500 flex items-center gap-1">
          <Video className="w-3.5 h-3.5 text-teal-600" />
          {appointment.consultation_mode || "Video"} • ₹{appointment.fee}
        </span>

        {isActionable && appointment.room_id ? (
          <Link
            to={`/consultation/${appointment.room_id}`}
            className="bg-teal-700 hover:bg-teal-800 text-white text-[10px] font-bold px-2.5 py-1 rounded-lg shadow-xs transition tap-scale flex items-center gap-1"
          >
            <Video className="w-3 h-3" />
            Join Call
          </Link>
        ) : (
          <Link
            to="/appointments"
            className="text-teal-700 hover:text-teal-900 text-[10px] font-semibold underline"
          >
            View in Appointments
          </Link>
        )}
      </div>
    </div>
  );
};
