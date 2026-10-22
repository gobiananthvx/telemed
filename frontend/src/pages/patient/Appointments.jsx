import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, Clock, Video, Star, ChevronRight, FileText, ArrowRight } from 'lucide-react';
import { apiClient } from '../../api/client';
import { TopHeader } from '../../components/TopHeader';
import { BottomNav } from '../../components/BottomNav';

export const Appointments = () => {
  const [appointments, setAppointments] = useState([]);
  const [activeTab, setActiveTab] = useState('ALL');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAppointments = async () => {
      setLoading(true);
      try {
        const data = await apiClient('/appointments');
        setAppointments(data || []);
      } catch (err) {
        console.error('Failed to load appointments:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchAppointments();
  }, []);

  const filteredAppointments = appointments.filter((appt) => {
    if (activeTab === 'ALL') return true;
    if (activeTab === 'UPCOMING') {
      return ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS'].includes(appt.status);
    }
    if (activeTab === 'COMPLETED') return appt.status === 'COMPLETED';
    if (activeTab === 'CANCELLED') return appt.status === 'CANCELLED';
    return true;
  });

  const getStatusBadge = (status) => {
    switch (status) {
      case 'CONFIRMED':
        return <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-teal-50 text-teal-700 border border-teal-200">Confirmed</span>;
      case 'IN_PROGRESS':
        return <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 animate-pulse">Live Now</span>;
      case 'COMPLETED':
        return <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">Completed</span>;
      case 'CANCELLED':
        return <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700">Cancelled</span>;
      default:
        return <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600">{status}</span>;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans antialiased text-slate-800">
      <TopHeader />

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-28 md:pb-12 space-y-6">
        {/* Header & Tabs */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">My Appointments</h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Track your upcoming consultations and review completed visit history.
              </p>
            </div>
            <span className="text-xs font-bold text-teal-700 bg-teal-50 px-3 py-1.5 rounded-xl border border-teal-100 self-start sm:self-auto">
              {filteredAppointments.length} Sessions
            </span>
          </div>

          {/* Segmented Filter Tabs */}
          <div className="flex items-center p-1 bg-slate-100 rounded-xl text-xs font-semibold max-w-md">
            {['ALL', 'UPCOMING', 'COMPLETED', 'CANCELLED'].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 py-2 rounded-lg transition text-xs capitalize ${
                  activeTab === tab
                    ? 'bg-white text-teal-800 font-bold shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.toLowerCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Appointments List */}
        {loading ? (
          <div className="py-20 flex justify-center">
            <div className="w-8 h-8 border-3 border-teal-700 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filteredAppointments.length === 0 ? (
          <div className="p-12 rounded-2xl bg-white border border-slate-200 text-center space-y-3 shadow-xs">
            <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
              <Calendar className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-bold text-slate-800">No appointments found</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Schedule your first consultation with a specialist doctor.
            </p>
            <Link
              to="/doctors"
              className="inline-flex items-center gap-1.5 bg-teal-700 hover:bg-teal-800 text-white font-bold text-xs px-4 py-2 rounded-xl shadow-xs transition mt-2"
            >
              <span>Find a Doctor</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredAppointments.map((appt) => (
              <div
                key={appt.id}
                className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs hover:border-teal-400 transition space-y-4 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center space-x-3">
                      <img
                        src={appt.doctor?.avatar_url || "https://images.unsplash.com/photo-1559839734-2b71ea197ec2?w=150&h=150&fit=crop&crop=face"}
                        alt={appt.doctor?.full_name}
                        className="w-13 h-13 rounded-2xl object-cover border border-slate-200"
                        style={{ width: '52px', height: '52px' }}
                      />
                      <div>
                        <h2 className="font-bold text-sm text-slate-900 leading-tight">
                          {appt.doctor?.full_name}
                        </h2>
                        <p className="text-xs text-teal-700 font-semibold">{appt.doctor?.specialty}</p>
                        <p className="text-[11px] text-slate-400 font-mono mt-0.5">{appt.appointment_number}</p>
                      </div>
                    </div>
                    {getStatusBadge(appt.status)}
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 grid grid-cols-2 gap-2 text-xs text-slate-600">
                    <div className="flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                      <span>{appt.date}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                      <span>{appt.start_time?.slice(0, 5)} – {appt.end_time?.slice(0, 5)}</span>
                    </div>
                  </div>
                </div>

                <div className="pt-2 flex items-center justify-between gap-2 border-t border-slate-100">
                  <Link
                    to={`/booking-confirmation/${appt.id}`}
                    className="text-xs font-bold text-slate-600 hover:text-slate-900 px-3 py-1.5 rounded-xl border border-slate-200 transition"
                  >
                    View Slip
                  </Link>

                  {appt.status === 'COMPLETED' ? (
                    <div className="flex items-center gap-1.5">
                      {appt.room_id && (
                        <Link
                          to="/records"
                          className="bg-teal-50 hover:bg-teal-100 text-teal-800 px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1 border border-teal-200"
                        >
                          <Video className="w-3.5 h-3.5 text-teal-700" />
                          <span>Recording</span>
                        </Link>
                      )}
                      <Link
                        to={`/feedback/${appt.id}`}
                        className="bg-amber-50 hover:bg-amber-100 text-amber-800 px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1 border border-amber-200"
                      >
                        <Star className="w-3.5 h-3.5 fill-amber-500 text-amber-500" />
                        <span>Review</span>
                      </Link>
                    </div>
                  ) : appt.room_id ? (
                    <Link
                      to={`/consultation/${appt.room_id}`}
                      className="bg-teal-700 hover:bg-teal-800 text-white px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1 shadow-xs"
                    >
                      <Video className="w-3.5 h-3.5" />
                      <span>Join Call</span>
                    </Link>
                  ) : (
                    <span className="text-[11px] font-semibold text-slate-400">Scheduled</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <BottomNav />
    </div>
  );
};
