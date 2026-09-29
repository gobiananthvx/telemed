import React from 'react';
import { Sun, CloudSun, Moon, Calendar, Clock } from 'lucide-react';

export const SlotResultCard = ({ data, onSelectSlot }) => {
  if (!data || !data.slots || data.slots.length === 0) {
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-center my-2 text-xs text-slate-500">
        No available slots found for this date.
      </div>
    );
  }

  const { slots, date, day_name, doctor_name } = data;

  const morningSlots = slots.filter((s) => s.period === 'Morning');
  const afternoonSlots = slots.filter((s) => s.period === 'Afternoon');
  const eveningSlots = slots.filter((s) => s.period === 'Evening');

  const renderSlotGroup = (title, items, icon) => {
    if (items.length === 0) return null;
    const Icon = icon;

    return (
      <div className="mt-2.5 first:mt-1">
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-700 mb-1.5">
          <Icon className="w-3.5 h-3.5 text-teal-600" />
          <span>{title} ({items.length})</span>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {items.map((slot) => (
            <button
              key={slot.id || slot.time}
              type="button"
              onClick={() => onSelectSlot && onSelectSlot(slot, data)}
              className="tap-scale px-2 py-1.5 rounded-lg border border-teal-200/80 bg-teal-50/50 hover:bg-teal-700 hover:text-white hover:border-teal-700 text-teal-900 font-bold text-[11px] text-center transition-all duration-150 shadow-2xs group flex flex-col items-center justify-center"
            >
              <span>{slot.formatted_time || slot.time}</span>
              <span className="text-[9px] text-teal-600 font-normal group-hover:text-teal-100">
                Available
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="bg-white rounded-xl border border-teal-100 p-3 shadow-xs my-2">
      <div className="flex items-center justify-between pb-2 border-b border-slate-100">
        <div>
          <h4 className="font-bold text-xs text-slate-900">{doctor_name}</h4>
          <p className="text-[10px] text-slate-500 flex items-center gap-1 mt-0.5">
            <Calendar className="w-3 h-3 text-teal-600" />
            <span>{day_name}, {date}</span>
          </p>
        </div>
        <span className="text-[10px] font-bold text-teal-700 bg-teal-50 border border-teal-100 px-2 py-0.5 rounded-md">
          {slots.length} Slots
        </span>
      </div>

      <div className="pt-1">
        {renderSlotGroup('Morning', morningSlots, Sun)}
        {renderSlotGroup('Afternoon', afternoonSlots, CloudSun)}
        {renderSlotGroup('Evening', eveningSlots, Moon)}
      </div>

      <p className="text-[10px] text-slate-400 text-center mt-2.5 italic">
        Click any available time slot to preview and confirm your booking.
      </p>
    </div>
  );
};
