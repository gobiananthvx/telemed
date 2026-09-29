import React from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle, Clock, Calendar, Hospital, Award } from 'lucide-react';

export const DoctorResultCard = ({ doctor, onSelectDoctor }) => {
  return (
    <div className="bg-white rounded-xl border border-teal-100/90 p-3 shadow-xs hover:border-teal-400 hover:shadow-subtle transition-all duration-200 my-2">
      <div className="flex items-start gap-3">
        {/* Doctor Avatar */}
        <div className="relative shrink-0">
          <img
            src={doctor.avatar_url || "/default-doctor.png"}
            alt={doctor.full_name}
            className="w-12 h-12 rounded-xl object-cover border border-teal-100 shadow-xs"
            onError={(e) => {
              e.target.src = "/default-doctor.png";
            }}
          />
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 absolute bottom-0 right-0 border-2 border-white" />
        </div>

        {/* Doctor Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <h4 className="font-bold text-xs text-slate-900 truncate">
              {doctor.full_name}
            </h4>
            <CheckCircle className="w-3 h-3 text-teal-600 shrink-0" />
          </div>

          <p className="text-[11px] text-teal-700 font-semibold truncate mt-0.5">
            {doctor.specialty} • <span className="text-slate-500 font-normal">{doctor.qualification}</span>
          </p>

          <div className="flex items-center gap-2 text-[10px] text-slate-500 mt-1">
            <span className="flex items-center gap-0.5">
              <Award className="w-3 h-3 text-amber-500" />
              {doctor.experience_years}+ yrs exp
            </span>
            <span>•</span>
            <span className="truncate">{doctor.hospital_name}</span>
          </div>

          <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100">
            <span className="text-xs font-bold text-teal-800">
              ₹{doctor.consultation_fee}{' '}
              <span className="text-[9px] text-slate-400 font-normal">/ consult</span>
            </span>

            <div className="flex items-center gap-1.5">
              <Link
                to={`/doctors/${doctor.id}`}
                className="text-[10px] font-semibold text-slate-600 hover:text-slate-900 px-2 py-1 rounded-lg border border-slate-200 transition"
              >
                Profile
              </Link>
              <button
                type="button"
                onClick={() => onSelectDoctor && onSelectDoctor(doctor)}
                className="bg-teal-700 hover:bg-teal-800 text-white text-[10px] font-bold px-2.5 py-1 rounded-lg shadow-xs transition flex items-center gap-1 tap-scale"
              >
                <Calendar className="w-3 h-3" />
                Slots
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
