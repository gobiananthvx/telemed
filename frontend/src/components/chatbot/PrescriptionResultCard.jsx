import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Pill, FileText, Calendar, ChevronDown, ChevronUp, User } from 'lucide-react';

export const PrescriptionResultCard = ({ prescription }) => {
  const [expanded, setExpanded] = useState(true);

  if (!prescription) return null;

  const medicines = prescription.medicines || [];

  return (
    <div className="bg-white rounded-xl border border-teal-100/90 p-3 shadow-xs my-2 hover:border-teal-400 transition-all duration-200">
      <div className="flex items-center justify-between pb-2 border-b border-slate-100">
        <div>
          <span className="text-[10px] font-bold text-teal-700 block tracking-wider">
            {prescription.rx_number}
          </span>
          <h4 className="font-bold text-xs text-slate-900 mt-0.5">
            {prescription.diagnosis}
          </h4>
          <p className="text-[10px] text-slate-500 mt-0.5">
            Prescribed by {prescription.doctor_name}
          </p>
        </div>
        <Link
          to={`/prescriptions/${prescription.id}`}
          className="text-[10px] font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 border border-teal-200 px-2 py-1 rounded-lg transition"
        >
          View Full Rx
        </Link>
      </div>

      {/* Medicines list */}
      <div className="mt-2.5">
        <div className="flex items-center justify-between text-[11px] font-bold text-slate-700 mb-1.5">
          <span className="flex items-center gap-1">
            <Pill className="w-3.5 h-3.5 text-teal-600" />
            Medicines ({medicines.length})
          </span>
          {medicines.length > 2 && (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="text-[10px] text-slate-400 hover:text-slate-600 flex items-center gap-0.5 font-normal"
            >
              {expanded ? 'Collapse' : 'Expand'}
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          )}
        </div>

        {expanded && (
          <div className="space-y-1.5 mt-1">
            {medicines.map((med, idx) => (
              <div
                key={idx}
                className="bg-teal-50/40 rounded-lg p-2 border border-teal-100/60 text-[11px]"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800">{med.name || med.medicine_name}</span>
                  <span className="text-[10px] font-semibold text-teal-700 bg-teal-100/60 px-1.5 py-0.5 rounded">
                    {med.dosage}
                  </span>
                </div>
                <div className="text-[10px] text-slate-500 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                  <span>Freq: {med.frequency}</span>
                  <span>Dur: {med.duration}</span>
                  {med.timing && <span>• {med.timing}</span>}
                </div>
                {med.instructions && (
                  <p className="text-[9px] text-slate-400 mt-0.5 italic">
                    Note: {med.instructions}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer details */}
      <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400">
        <span>Issued: {prescription.created_at ? prescription.created_at.split('T')[0] : 'Recent'}</span>
        {prescription.follow_up_date && (
          <span className="text-teal-700 font-medium">Follow-up: {prescription.follow_up_date}</span>
        )}
      </div>
    </div>
  );
};
