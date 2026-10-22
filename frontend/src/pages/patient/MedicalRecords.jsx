import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Pill, Calendar, ChevronRight, FolderOpen, ArrowRight, Video, X, Clock, Play, Download } from 'lucide-react';
import { apiClient } from '../../api/client';
import { TopHeader } from '../../components/TopHeader';
import { BottomNav } from '../../components/BottomNav';

export const MedicalRecords = () => {
  const [activeTab, setActiveTab] = useState('PRESCRIPTIONS'); // PRESCRIPTIONS, RECORDS, RECORDINGS
  const [prescriptions, setPrescriptions] = useState([]);
  const [records, setRecords] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [playingRecording, setPlayingRecording] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [rxData, recData, apptData] = await Promise.all([
          apiClient('/prescriptions'),
          apiClient('/medical-records'),
          apiClient('/appointments')
        ]);
        setPrescriptions(rxData || []);
        setRecords(recData || []);
        setAppointments(apptData || []);
      } catch (err) {
        console.error('Failed to load medical records:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // Filter consultations with recorded sessions
  const recordedConsultations = appointments.filter(
    (a) => a.recording_url || (a.status === 'COMPLETED' && a.room_id)
  );

  const getRecordingUrlWithAuth = (url) => {
    const token = localStorage.getItem('token');
    return token ? `${url}?token=${token}` : url;
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans antialiased text-slate-800">
      <TopHeader />

      {/* Video Player Modal */}
      {playingRecording && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-4xl w-full overflow-hidden shadow-2xl flex flex-col">
            <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between text-white bg-slate-950">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-teal-500/20 text-teal-400 flex items-center justify-center">
                  <Video className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-white">
                    Consultation Recording: {playingRecording.doctor?.full_name || 'Doctor'}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Room: <span className="font-mono text-teal-400">{playingRecording.room_id}</span> • {playingRecording.date}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPlayingRecording(null)}
                className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition"
                aria-label="Close video player"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="aspect-video bg-black flex items-center justify-center relative">
              <video
                src={getRecordingUrlWithAuth(playingRecording.recording_url || `/api/consultations/${playingRecording.room_id}/recording`)}
                controls
                autoPlay
                className="w-full h-full object-contain"
              >
                Your browser does not support the video tag.
              </video>
            </div>

            <div className="p-4 bg-slate-950 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
              <span className="flex items-center gap-1.5 text-slate-400">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span>Protected Consultation Archive (Authorized to Patient, Attending Doctor & Admin)</span>
              </span>
              <a
                href={getRecordingUrlWithAuth(playingRecording.recording_url || `/api/consultations/${playingRecording.room_id}/recording`)}
                download={`consultation_${playingRecording.room_id}.mp4`}
                className="inline-flex items-center gap-1.5 text-teal-400 hover:text-teal-300 font-semibold transition"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Video (.mp4)</span>
              </a>
            </div>
          </div>
        </div>
      )}

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-28 md:pb-12 space-y-6">
        {/* Header & Tabs */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">Health Records &amp; Consultations</h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Access your digital prescriptions, clinical notes, and recorded video consultations.
              </p>
            </div>
          </div>

          {/* Segmented Switcher Tabs */}
          <div className="flex items-center p-1 bg-slate-100 rounded-xl text-xs font-semibold max-w-lg">
            <button
              type="button"
              onClick={() => setActiveTab('PRESCRIPTIONS')}
              className={`flex-1 py-2 rounded-lg transition text-xs flex items-center justify-center gap-1.5 ${
                activeTab === 'PRESCRIPTIONS'
                  ? 'bg-white text-teal-800 font-bold shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Pill className="w-3.5 h-3.5" />
              <span>Prescriptions ({prescriptions.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('RECORDS')}
              className={`flex-1 py-2 rounded-lg transition text-xs flex items-center justify-center gap-1.5 ${
                activeTab === 'RECORDS'
                  ? 'bg-white text-teal-800 font-bold shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Clinical Notes ({records.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('RECORDINGS')}
              className={`flex-1 py-2 rounded-lg transition text-xs flex items-center justify-center gap-1.5 ${
                activeTab === 'RECORDINGS'
                  ? 'bg-white text-teal-800 font-bold shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Video className="w-3.5 h-3.5" />
              <span>Recordings ({recordedConsultations.length})</span>
            </button>
          </div>
        </div>

        {/* Content List */}
        {loading ? (
          <div className="py-20 flex justify-center">
            <div className="w-8 h-8 border-3 border-teal-700 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : activeTab === 'PRESCRIPTIONS' ? (
          prescriptions.length === 0 ? (
            <div className="p-12 rounded-2xl bg-white border border-slate-200 text-center space-y-3 shadow-xs">
              <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
                <Pill className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-bold text-slate-800">No prescriptions yet</h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Your digital prescriptions issued by doctors following video consultations will appear here.
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
              {prescriptions.map((rx) => (
                <div
                  key={rx.id}
                  className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs hover:border-teal-400 transition space-y-4 flex flex-col justify-between"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center shrink-0">
                          <Pill className="w-5 h-5" />
                        </div>
                        <div>
                          <span className="text-xs font-mono font-bold text-teal-700">{rx.rx_number}</span>
                          <h3 className="font-bold text-sm text-slate-900">{rx.diagnosis}</h3>
                          <p className="text-xs text-slate-500 font-medium">
                            Dr. {rx.doctor?.full_name || 'Medical Doctor'}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Medicines preview */}
                    <div className="space-y-1.5 pt-2 border-t border-slate-100">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Prescribed Medicines ({rx.medicines?.length || 0})
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {rx.medicines?.map((med) => (
                          <span
                            key={med.id}
                            className="px-2.5 py-0.5 rounded-lg text-[11px] font-semibold bg-slate-50 text-slate-700 border border-slate-200"
                          >
                            {med.medicine_name} • {med.dosage}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-[11px] text-slate-400 flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5" />
                      <span>{new Date(rx.created_at).toLocaleDateString()}</span>
                    </span>

                    <Link
                      to={`/prescriptions/${rx.id}`}
                      className="bg-teal-700 hover:bg-teal-800 text-white font-bold text-xs px-3.5 py-1.5 rounded-xl shadow-xs transition flex items-center gap-1"
                    >
                      <span>View Full Rx</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : activeTab === 'RECORDS' ? (
          records.length === 0 ? (
            <div className="p-12 rounded-2xl bg-white border border-slate-200 text-center space-y-3 shadow-xs">
              <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
                <FolderOpen className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-bold text-slate-800">No clinical notes recorded</h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Clinical notes documented by attending physicians will appear here.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {records.map((rec) => (
                <div
                  key={rec.id}
                  className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-3"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="inline-block text-[10px] font-bold uppercase tracking-wider text-teal-700 bg-teal-50 px-2 py-0.5 rounded-md mb-1">
                        {rec.record_type}
                      </span>
                      <h3 className="font-bold text-sm text-slate-900">{rec.title}</h3>
                      <p className="text-xs text-slate-500 font-medium">Attending: {rec.doctor_name || 'Medical Doctor'}</p>
                    </div>
                    <span className="text-[11px] text-slate-400">{new Date(rec.created_at).toLocaleDateString()}</span>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-100 text-xs text-slate-700 leading-relaxed">
                    {rec.clinical_notes}
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          /* Consultation Recordings Tab */
          recordedConsultations.length === 0 ? (
            <div className="p-12 rounded-2xl bg-white border border-slate-200 text-center space-y-3 shadow-xs">
              <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
                <Video className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-bold text-slate-800">No Consultation Recordings Yet</h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                When you complete video consultations, the two-way Google Meet style recorded video with audio will be archived here for your review.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {recordedConsultations.map((c) => (
                <div
                  key={c.id}
                  className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs hover:border-teal-400 transition space-y-4 flex flex-col justify-between"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="w-11 h-11 rounded-xl bg-teal-50 border border-teal-200 text-teal-700 flex items-center justify-center shrink-0">
                          <Video className="w-5 h-5" />
                        </div>
                        <div>
                          <span className="text-xs font-mono font-bold text-teal-700">{c.appointment_number}</span>
                          <h3 className="font-bold text-sm text-slate-900">
                            {c.doctor?.full_name || 'Attending Doctor'}
                          </h3>
                          <p className="text-xs text-slate-500 font-medium">
                            {c.doctor?.specialty || 'Clinical Specialist'}
                          </p>
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        Recorded
                      </span>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 grid grid-cols-2 gap-2 text-xs text-slate-600">
                      <div className="flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-teal-600" />
                        <span>{c.date}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-teal-600" />
                        <span>{c.start_time?.slice(0, 5)} - {c.end_time?.slice(0, 5)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-[11px] text-slate-400 font-mono">
                      Room: {c.room_id || 'telemed-session'}
                    </span>

                    <button
                      type="button"
                      onClick={() => setPlayingRecording(c)}
                      className="tap-scale bg-teal-700 hover:bg-teal-800 text-white font-bold text-xs px-4 py-2 rounded-xl shadow-xs transition flex items-center gap-1.5"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>Watch Recording</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </main>

      <BottomNav />
    </div>
  );
};
