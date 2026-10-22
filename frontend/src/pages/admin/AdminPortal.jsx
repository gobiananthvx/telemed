import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, UserCheck, Users, Calendar, Video, FileText,
  Pill, Clock, Settings, LogOut, Plus, Search, Check,
  AlertCircle, ChevronRight, CheckCircle2, Shield, Edit3, Trash2,
  Upload, X, Eye, Activity, Play, Download
} from 'lucide-react';

import { apiClient } from '../../api/client';
import { useAuth } from '../../context/AuthContext';

const MEDICAL_SPECIALTIES = [
  'General Physician',
  'Cardiologist',
  'Dermatologist',
  'Pediatrician',
  'Neurologist',
  'Orthopedic Surgeon',
  'Gynecologist',
  'ENT Specialist',
  'Psychiatrist',
  'Ophthalmologist',
];

export const AdminPortal = () => {
  const { user, role, token, adminLogin, logout, isAuthenticated, isAdmin, isDoctor } = useAuth();
  const navigate = useNavigate();

  // Login form state (if unauthenticated at /admin)
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState(null);
  const [loginLoading, setLoginLoading] = useState(false);
  const [startingConsultationId, setStartingConsultationId] = useState(null);
  const [playingRecording, setPlayingRecording] = useState(null);

  // Portal Navigation State

  const [activeTab, setActiveTab] = useState('DASHBOARD');

  // Admin Data States
  const [stats, setStats] = useState(null);
  const [doctors, setDoctors] = useState([]);
  const [patients, setPatients] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [prescriptions, setPrescriptions] = useState([]);
  const [doctorSlots, setDoctorSlots] = useState([]);
  const [doctorPatients, setDoctorPatients] = useState([]);
  const [loadingData, setLoadingData] = useState(false);

  // Modals
  const [showDoctorModal, setShowDoctorModal] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [doctorForm, setDoctorForm] = useState({
    full_name: '',
    email: '',
    phone: '',
    password: '',
    qualification: 'MBBS, MD',
    specialty: 'General Physician',
    experience_years: 5,
    hospital_name: 'Apollo Telemed Speciality Hospital',
    consultation_fee: 500,
    bio: '',
    avatar_url: '',
  });

  // Calculate dynamic slot end time
  const calculateEndTime = (startTime, durationMinutes) => {
    if (!startTime) return '';
    const parts = startTime.split(':');
    if (parts.length < 2) return '';
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (isNaN(h) || isNaN(m)) return '';
    const totalMinutes = h * 60 + m + parseInt(durationMinutes || 30, 10);
    const endH = Math.floor((totalMinutes % (24 * 60)) / 60);
    const endM = totalMinutes % 60;
    return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
  };

  const formatTime12h = (timeStr) => {
    if (!timeStr) return '';
    const parts = timeStr.split(':');
    if (parts.length < 2) return timeStr;
    let h = parseInt(parts[0], 10);
    const m = parts[1];
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    if (h === 0) h = 12;
    return `${h}:${m} ${ampm}`;
  };

  // Doctor Slot Creator State (End time dynamically calculated)
  const [slotForm, setSlotForm] = useState({
    date: '',
    start_time: '09:00',
    duration_minutes: 30,
  });
  const [slotSubmitting, setSlotSubmitting] = useState(false);

  // Doctor Prescription Builder State
  const [showRxModal, setShowRxModal] = useState(false);
  const [rxForm, setRxForm] = useState({
    patient_id: '',
    appointment_id: '',
    diagnosis: '',
    notes: '',
    medicines: [
      { medicine_name: 'Paracetamol 650mg', dosage: '1 Tablet', frequency: 'Thrice a day', duration: '3 Days', timing: 'After Food', instructions: 'Take after meals' }
    ]
  });

  // Clinical History Modal State (Doctor View)
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [selectedPatientHistory, setSelectedPatientHistory] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Set default active tab based on role
  useEffect(() => {
    if (isAuthenticated) {
      if (isDoctor && activeTab === 'DASHBOARD') {
        setActiveTab('APPOINTMENTS');
      }
    }
  }, [isAuthenticated, isDoctor]);

  // Handle Login at /admin
  const handleAdminLogin = async (e) => {
    e.preventDefault();
    setLoginError(null);
    setLoginLoading(true);

    try {
      await adminLogin(identifier, password);
    } catch (err) {
      setLoginError(err.message || 'Invalid administrative credentials.');
    } finally {
      setLoginLoading(false);
    }
  };

  // Load Data based on Role
  const loadPortalData = async () => {
    if (!isAuthenticated || (!isAdmin && !isDoctor)) return;
    setLoadingData(true);

    try {
      if (isAdmin) {
        const [statsData, docData, apptData, patData] = await Promise.allSettled([
          apiClient('/admin/stats'),
          apiClient('/admin/doctors'),
          apiClient('/appointments'),
          apiClient('/admin/patients'),
        ]);

        if (statsData.status === 'fulfilled') setStats(statsData.value);
        if (docData.status === 'fulfilled') setDoctors(docData.value || []);
        if (apptData.status === 'fulfilled') setAppointments(apptData.value || []);
        if (patData.status === 'fulfilled') setPatients(patData.value || []);
      } else if (isDoctor) {
        const [apptData, patData, rxData, slotsData] = await Promise.allSettled([
          apiClient('/appointments'),
          apiClient('/doctors/me/patients'),
          apiClient('/prescriptions'),
          apiClient('/doctors/me/slots'),
        ]);

        if (apptData.status === 'fulfilled') setAppointments(apptData.value || []);
        if (patData.status === 'fulfilled') setDoctorPatients(patData.value || []);
        if (rxData.status === 'fulfilled') setPrescriptions(rxData.value || []);
        if (slotsData.status === 'fulfilled') setDoctorSlots(slotsData.value || []);
      }
    } catch (err) {
      console.error('Failed to load portal data:', err);
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated && (isAdmin || isDoctor)) {
      loadPortalData();
    }
  }, [isAuthenticated, isAdmin, isDoctor]);

  // Doctor Starts Consultation Session
  const handleStartConsultation = async (appointmentId) => {
    setStartingConsultationId(appointmentId);
    try {
      const res = await apiClient(`/consultations/start/${appointmentId}`, { method: 'POST' });
      navigate(`/consultation/${res.room_id}`);
    } catch (err) {
      alert(err.message || 'Unable to start consultation. Please ensure you are within the scheduled appointment time window.');
    } finally {
      setStartingConsultationId(null);
    }
  };

  // Open Prescription Modal for Appointment
  const handleOpenRxForAppt = (appt) => {
    setRxForm({
      patient_id: appt.patient_id ? String(appt.patient_id) : '',
      appointment_id: String(appt.id),
      diagnosis: '',
      notes: '',
      medicines: [
        { medicine_name: 'Paracetamol 650mg', dosage: '1 Tablet', frequency: 'Thrice a day', duration: '3 Days', timing: 'After Food', instructions: 'Take after meals' }
      ]
    });
    setShowRxModal(true);
  };

  // Photo Upload Handler for Admin
  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      alert('Photo file size must be less than 5MB.');
      return;
    }

    setUploadingPhoto(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const data = await apiClient('/admin/upload-photo', {
        method: 'POST',
        body: formData,
      });
      setDoctorForm(prev => ({ ...prev, avatar_url: data.avatar_url }));
    } catch (err) {
      alert(err.message || 'Failed to upload photo.');
    } finally {
      setUploadingPhoto(false);
    }
  };

  // Create Doctor by Admin
  const handleCreateDoctor = async (e) => {
    e.preventDefault();
    try {
      await apiClient('/admin/doctors', {
        method: 'POST',
        body: JSON.stringify(doctorForm),
      });
      setShowDoctorModal(false);
      setDoctorForm({
        full_name: '',
        email: '',
        phone: '',
        password: '',
        qualification: 'MBBS, MD',
        specialty: 'General Physician',
        experience_years: 5,
        hospital_name: 'Apollo Telemed Speciality Hospital',
        consultation_fee: 500,
        bio: '',
        avatar_url: '',
      });
      loadPortalData();
      alert('Doctor registered successfully with zero initial slots.');
    } catch (err) {
      alert(err.message || 'Failed to create doctor account.');
    }
  };

  // Delete Doctor by Admin
  const handleDeleteDoctor = async (doctorId, doctorName) => {
    if (!window.confirm(`Are you sure you want to delete Dr. ${doctorName}? This will permanently delete the doctor's profile, user account, and related records.`)) {
      return;
    }

    try {
      await apiClient(`/admin/doctors/${doctorId}`, { method: 'DELETE' });
      alert(`Dr. ${doctorName} has been deleted successfully.`);
      loadPortalData();
    } catch (err) {
      alert(err.message || 'Failed to delete doctor.');
    }
  };

  // Delete Patient by Admin
  const handleDeletePatient = async (patientId, patientName) => {
    if (!window.confirm(`Are you sure you want to delete patient ${patientName}? This will permanently delete the patient's profile, user account, and related records.`)) {
      return;
    }

    try {
      await apiClient(`/admin/patients/${patientId}`, { method: 'DELETE' });
      alert(`Patient ${patientName} has been deleted successfully.`);
      loadPortalData();
    } catch (err) {
      alert(err.message || 'Failed to delete patient.');
    }
  };

  // Doctor Slot Batch Creation (End time dynamically calculated from duration)
  const handleCreateSlots = async (e) => {
    e.preventDefault();
    setSlotSubmitting(true);
    try {
      const computedEndTime = calculateEndTime(slotForm.start_time, slotForm.duration_minutes);
      const res = await apiClient('/doctors/me/slots', {
        method: 'POST',
        body: JSON.stringify({
          date: slotForm.date,
          start_time: slotForm.start_time,
          end_time: computedEndTime,
          duration_minutes: parseInt(slotForm.duration_minutes, 10),
          slot_duration_minutes: parseInt(slotForm.duration_minutes, 10),
        }),
      });
      alert(res.message || 'Slot created successfully!');
      setSlotForm(prev => ({ ...prev, date: '' }));
      loadPortalData();
    } catch (err) {
      alert(err.message || 'Failed to create slots. Check for past time or overlapping intervals.');
    } finally {
      setSlotSubmitting(false);
    }
  };

  // Doctor Slot Deletion
  const handleDeleteSlot = async (slotId) => {
    if (!window.confirm('Are you sure you want to delete this available consultation slot?')) return;
    try {
      await apiClient(`/doctors/me/slots/${slotId}`, { method: 'DELETE' });
      loadPortalData();
    } catch (err) {
      alert(err.message || 'Failed to delete slot.');
    }
  };

  // View Patient Clinical History (Doctor only)
  const handleViewPatientHistory = async (patient) => {
    setShowHistoryModal(true);
    setHistoryLoading(true);
    setSelectedPatientHistory({ patient, consultations: [], prescriptions: [] });

    try {
      const data = await apiClient(`/doctors/me/patients/${patient.id}/history`);
      setSelectedPatientHistory(data);
    } catch (err) {
      alert(err.message || 'Failed to load patient clinical history.');
    } finally {
      setHistoryLoading(false);
    }
  };

  // Doctor Issues Prescription
  const handleCreateRx = async (e) => {
    e.preventDefault();
    try {
      await apiClient('/prescriptions', {
        method: 'POST',
        body: JSON.stringify({
          patient_id: parseInt(rxForm.patient_id),
          appointment_id: rxForm.appointment_id ? parseInt(rxForm.appointment_id) : null,
          diagnosis: rxForm.diagnosis,
          notes: rxForm.notes,
          medicines: rxForm.medicines,
        }),
      });
      setShowRxModal(false);
      alert('Prescription created and emailed to patient successfully!');
      loadPortalData();
    } catch (err) {
      alert(err.message || 'Failed to create prescription.');
    }
  };

  const addMedicineRow = () => {
    setRxForm({
      ...rxForm,
      medicines: [
        ...rxForm.medicines,
        { medicine_name: '', dosage: '1 Tablet', frequency: 'Twice a day', duration: '5 Days', timing: 'After Food', instructions: '' }
      ]
    });
  };

  const updateMedicine = (index, field, value) => {
    const updated = [...rxForm.medicines];
    updated[index][field] = value;
    setRxForm({ ...rxForm, medicines: updated });
  };

  // If Not Authenticated as Doctor or Admin: Show /admin Login
  if (!isAuthenticated || (!isAdmin && !isDoctor)) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 font-sans antialiased text-slate-800">
        <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl p-8 space-y-6">
          <div className="text-center space-y-2">
            <div className="w-12 h-12 rounded-2xl bg-teal-700 flex items-center justify-center text-white mx-auto shadow-md">
              <Shield className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-extrabold text-slate-900">Telemed Administrative Portal</h1>
            <p className="text-xs text-slate-500">
              Authorized access for Doctors &amp; Hospital Administrators
            </p>
          </div>

          {loginError && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{loginError}</span>
            </div>
          )}

          <form onSubmit={handleAdminLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Admin Username or Doctor Email
              </label>
              <input
                type="text"
                required
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-700/20"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-700/20"
              />
            </div>

            <button
              type="submit"
              disabled={loginLoading}
              className="w-full bg-teal-700 hover:bg-teal-800 text-white font-bold py-3.5 rounded-xl shadow-teal-glow text-xs tracking-wide transition cursor-pointer"
            >
              {loginLoading ? 'Authenticating...' : 'Sign In to Portal'}
            </button>
          </form>

          {/* Quick Admin Demo Fill */}
          <div className="pt-2 border-t border-slate-100 text-xs space-y-2">
            <button
              type="button"
              onClick={() => { setIdentifier('admin'); setPassword('admin'); }}
              className="w-full p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-xs text-center cursor-pointer transition"
            >
              Fill Default Administrator (admin / admin)
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Authenticated Portal View
  return (
    <div className="min-h-screen bg-slate-100 flex font-sans text-slate-800">
      
      {/* Sidebar Navigation */}
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col justify-between shrink-0">
        <div>
          {/* Logo & Role Badge */}
          <div className="p-6 border-b border-slate-100 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-700 flex items-center justify-center text-white font-extrabold shadow-sm">
              <svg viewBox="0 0 44 44" fill="none" className="w-6 h-6">
                <path d="M14 23H18L20 17L24 29L26 21L28 23H30" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div>
              <h2 className="font-extrabold text-base tracking-tight text-slate-900">Telemed</h2>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-teal-50 text-teal-700 border border-teal-200">
                {isAdmin ? 'Admin Console' : 'Doctor Portal'}
              </span>
            </div>
          </div>

          {/* Navigation Items */}
          <nav className="p-4 space-y-1 text-xs font-semibold">
            {isAdmin && (
              <button
                onClick={() => setActiveTab('DASHBOARD')}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl transition cursor-pointer ${
                  activeTab === 'DASHBOARD' ? 'bg-teal-700 text-white shadow-sm font-bold' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <LayoutDashboard className="w-4 h-4" />
                <span>Dashboard</span>
              </button>
            )}

            {isAdmin && (
              <button
                onClick={() => setActiveTab('DOCTORS')}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl transition cursor-pointer ${
                  activeTab === 'DOCTORS' ? 'bg-teal-700 text-white shadow-sm font-bold' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <UserCheck className="w-4 h-4" />
                <span>Doctors Directory</span>
              </button>
            )}

            {isAdmin && (
              <button
                onClick={() => setActiveTab('ADMIN_PATIENTS')}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl transition cursor-pointer ${
                  activeTab === 'ADMIN_PATIENTS' ? 'bg-teal-700 text-white shadow-sm font-bold' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Users className="w-4 h-4" />
                <span>Patients Directory</span>
              </button>
            )}

            <button
              onClick={() => setActiveTab('APPOINTMENTS')}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl transition cursor-pointer ${
                activeTab === 'APPOINTMENTS' ? 'bg-teal-700 text-white shadow-sm font-bold' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Calendar className="w-4 h-4" />
              <span>{isAdmin ? 'All Appointments' : 'My Schedule'}</span>
            </button>

            {isDoctor && (
              <button
                onClick={() => setActiveTab('SLOTS')}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl transition cursor-pointer ${
                  activeTab === 'SLOTS' ? 'bg-teal-700 text-white shadow-sm font-bold' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Clock className="w-4 h-4" />
                <span>Manage Slots</span>
              </button>
            )}

            {isDoctor && (
              <button
                onClick={() => setActiveTab('PATIENTS')}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl transition cursor-pointer ${
                  activeTab === 'PATIENTS' ? 'bg-teal-700 text-white shadow-sm font-bold' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Users className="w-4 h-4" />
                <span>My Patients</span>
              </button>
            )}

            {isDoctor && (
              <button
                onClick={() => setActiveTab('PRESCRIPTIONS')}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl transition cursor-pointer ${
                  activeTab === 'PRESCRIPTIONS' ? 'bg-teal-700 text-white shadow-sm font-bold' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Pill className="w-4 h-4" />
                <span>Prescriptions</span>
              </button>
            )}
          </nav>
        </div>

        {/* User Info & Logout */}
        <div className="p-4 border-t border-slate-100 space-y-3">
          <div className="flex items-center gap-3 px-2">
            <div className="w-9 h-9 rounded-xl bg-teal-100 text-teal-800 font-bold flex items-center justify-center text-xs">
              {isAdmin ? 'AD' : 'DR'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-xs text-slate-900 truncate">{user?.name || user?.email}</p>
              <p className="text-[10px] text-slate-400 capitalize">{role}</p>
            </div>
          </div>

          <button
            onClick={() => { logout(); navigate('/admin'); }}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-100 hover:bg-rose-50 hover:text-rose-700 text-slate-600 text-xs font-bold transition cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Workspace */}
      <main className="flex-1 p-8 overflow-y-auto max-h-screen">
        
        {/* Top Action Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-slate-900 capitalize">
              {activeTab.toLowerCase().replace('_', ' ')}
            </h1>
            <p className="text-xs text-slate-500">
              {isAdmin ? 'Centralized Telemed Hospital Infrastructure' : `Welcome, ${user?.name}`}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {isAdmin && activeTab === 'DOCTORS' && (
              <button
                onClick={() => setShowDoctorModal(true)}
                className="bg-teal-700 hover:bg-teal-800 text-white font-bold text-xs px-4 py-2.5 rounded-xl shadow-sm flex items-center gap-2 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Add Doctor</span>
              </button>
            )}

            {isDoctor && (
              <button
                onClick={() => setShowRxModal(true)}
                className="bg-teal-700 hover:bg-teal-800 text-white font-bold text-xs px-4 py-2.5 rounded-xl shadow-sm flex items-center gap-2 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Issue Prescription</span>
              </button>
            )}
          </div>
        </div>

        {/* Tab: DASHBOARD (Admin Only) */}
        {activeTab === 'DASHBOARD' && isAdmin && (
          <div className="space-y-6">
            {/* Metric Cards Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-subtle space-y-1">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Total Patients</span>
                <p className="text-2xl font-black text-slate-900 tnum">{stats?.total_patients || 0}</p>
                <span className="text-[10px] text-emerald-600 font-semibold">Registered UHIDs</span>
              </div>

              <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-subtle space-y-1">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Active Doctors</span>
                <p className="text-2xl font-black text-teal-700 tnum">{stats?.total_doctors || doctors.length}</p>
                <span className="text-[10px] text-teal-600 font-semibold">Clinical Specialists</span>
              </div>

              <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-subtle space-y-1">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Appointments</span>
                <p className="text-2xl font-black text-slate-900 tnum">{stats?.total_appointments || appointments.length}</p>
                <span className="text-[10px] text-indigo-600 font-semibold">Video Consultations</span>
              </div>
            </div>

            {/* Upcoming / Recent Appointments Table */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-subtle overflow-hidden">
              <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                <h2 className="text-sm font-bold text-slate-900">Recent Platform Consultations</h2>
                <span className="text-xs text-slate-400 font-medium">Real-time DB sync</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-[10px] tracking-wider border-b border-slate-100">
                    <tr>
                      <th className="p-3.5">Booking #</th>
                      <th className="p-3.5">Patient</th>
                      <th className="p-3.5">Doctor</th>
                      <th className="p-3.5">Date &amp; Time</th>
                      <th className="p-3.5">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {appointments.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="text-center py-12 text-slate-400">
                          <Calendar className="w-8 h-8 mx-auto mb-2 text-slate-300 stroke-1" />
                          <p className="font-semibold text-xs text-slate-600">No appointments scheduled</p>
                        </td>
                      </tr>
                    ) : (
                      appointments.slice(0, 6).map((appt) => (
                        <tr key={appt.id} className="hover:bg-slate-50/80">
                          <td className="p-3.5 font-mono font-bold text-teal-700">{appt.appointment_number}</td>
                          <td className="p-3.5 font-semibold text-slate-800">{appt.patient?.full_name || 'Patient'}</td>
                          <td className="p-3.5 text-slate-600">{appt.doctor?.full_name || 'Doctor'}</td>
                          <td className="p-3.5 text-slate-600">{appt.date} • {appt.start_time?.slice(0, 5)}</td>
                          <td className="p-3.5">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              appt.status === 'CONFIRMED' ? 'bg-teal-50 text-teal-700' :
                              appt.status === 'COMPLETED' ? 'bg-slate-100 text-slate-700' :
                              appt.status === 'MISSED' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-800'
                            }`}>
                              {appt.status}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Tab: DOCTORS (Admin only) */}
        {activeTab === 'DOCTORS' && isAdmin && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-subtle overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-slate-900">Registered Medical Doctors ({doctors.length})</h2>
                <span className="text-xs text-slate-400">Onboarded clinical specialists (No OTP required)</span>
              </div>
              <button
                onClick={() => setShowDoctorModal(true)}
                className="bg-teal-700 hover:bg-teal-800 text-white font-bold text-xs px-3.5 py-2 rounded-xl shadow-xs flex items-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Doctor</span>
              </button>
            </div>

            {doctors.length === 0 ? (
              <div className="text-center py-16 text-slate-400">
                <UserCheck className="w-12 h-12 mx-auto mb-3 text-slate-300 stroke-1" />
                <p className="font-semibold text-sm text-slate-700">No doctors registered yet</p>
                <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                  Click "Add Doctor" above to register doctors with custom specialties, qualifications, and profile photos.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {doctors.map((doc) => (
                  <div key={doc.id} className="p-4 flex items-center justify-between hover:bg-slate-50 transition">
                    <div className="flex items-center gap-3.5">
                      <img
                        src={doc.avatar_url || "/default-doctor.png"}
                        alt={doc.full_name}
                        onError={(e) => { e.currentTarget.src = "/default-doctor.png"; }}
                        className="w-12 h-12 rounded-xl object-cover border border-slate-200 bg-slate-100"
                      />
                      <div>
                        <h3 className="font-bold text-sm text-slate-900">{doc.full_name}</h3>
                        <p className="text-xs text-teal-700 font-semibold">{doc.specialty} • {doc.qualification}</p>
                        <p className="text-[11px] text-slate-400">{doc.hospital_name} • Fee: ₹{doc.consultation_fee} • {doc.experience_years} yrs exp</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold">
                        Active Doctor
                      </span>
                      <button
                        type="button"
                        onClick={() => handleDeleteDoctor(doc.id, doc.full_name)}
                        title="Delete Doctor"
                        className="p-2 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab: ADMIN_PATIENTS (Admin only - Patient Directory & Deletion) */}
        {activeTab === 'ADMIN_PATIENTS' && isAdmin && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-subtle overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-slate-900">Registered Platform Patients ({patients.length})</h2>
                <span className="text-xs text-slate-400">All registered patient accounts and clinical profiles</span>
              </div>
            </div>

            {patients.length === 0 ? (
              <div className="text-center py-16 text-slate-400">
                <Users className="w-12 h-12 mx-auto mb-3 text-slate-300 stroke-1" />
                <p className="font-semibold text-sm text-slate-700">No patients registered yet</p>
                <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                  Patients will appear here as they register on the platform.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-[10px] tracking-wider border-b border-slate-100">
                    <tr>
                      <th className="p-3.5">UHID</th>
                      <th className="p-3.5">Patient Name</th>
                      <th className="p-3.5">Contact Details</th>
                      <th className="p-3.5">Location &amp; Blood</th>
                      <th className="p-3.5">Registered On</th>
                      <th className="p-3.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {patients.map((pat) => (
                      <tr key={pat.id} className="hover:bg-slate-50/80">
                        <td className="p-3.5 font-mono font-bold text-teal-700">{pat.uhid}</td>
                        <td className="p-3.5 font-bold text-slate-900">{pat.full_name}</td>
                        <td className="p-3.5 text-slate-600">
                          <p className="font-semibold text-slate-700">{pat.email || 'No email'}</p>
                          <p className="text-[11px] text-slate-400">{pat.phone || 'No phone'}</p>
                        </td>
                        <td className="p-3.5 text-slate-600">
                          <p>{pat.city || 'Not specified'}</p>
                          <p className="text-[11px] font-semibold text-teal-700">Blood: {pat.blood_group || 'N/A'}</p>
                        </td>
                        <td className="p-3.5 text-slate-500">
                          {pat.created_at ? new Date(pat.created_at).toLocaleDateString() : 'N/A'}
                        </td>
                        <td className="p-3.5 text-right">
                          <button
                            type="button"
                            onClick={() => handleDeletePatient(pat.id, pat.full_name)}
                            title="Delete Patient"
                            className="p-2 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Tab: APPOINTMENTS (Admin & Doctor View) */}
        {activeTab === 'APPOINTMENTS' && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-subtle overflow-hidden">
            <div className="p-5 border-b border-slate-100">
              <h2 className="text-sm font-bold text-slate-900">
                {isAdmin ? 'All Platform Appointments' : 'My Scheduled Consultations'} ({appointments.length})
              </h2>
            </div>

            {/* Doctor Quick Next Consultation Banner */}
            {isDoctor && appointments.find(a => a.status !== 'COMPLETED' && a.status !== 'MISSED') && (() => {
              const nextAppt = appointments.find(a => a.status !== 'COMPLETED' && a.status !== 'MISSED');
              return (
                <div className="m-5 p-4 bg-teal-50 border border-teal-200 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-teal-700 flex items-center justify-center text-white shadow-xs shrink-0">
                      <Video className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider bg-teal-200/70 text-teal-900 px-2 py-0.5 rounded-md">
                          Scheduled Consultation
                        </span>
                        <span className="text-xs font-mono font-bold text-teal-800">{nextAppt.appointment_number}</span>
                      </div>
                      <p className="text-xs font-bold text-slate-900 mt-1">
                        Patient: {nextAppt.patient?.full_name || 'Patient'} • {nextAppt.date} at {nextAppt.start_time?.slice(0, 5)}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={startingConsultationId === nextAppt.id}
                    onClick={() => nextAppt.room_id ? navigate(`/consultation/${nextAppt.room_id}`) : handleStartConsultation(nextAppt.id)}
                    className="bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white font-bold text-xs px-4 py-2.5 rounded-xl shadow-xs inline-flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
                  >
                    <Video className="w-4 h-4" />
                    <span>{startingConsultationId === nextAppt.id ? 'Connecting...' : 'Join Consultation'}</span>
                  </button>
                </div>
              );
            })()}

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-[10px] tracking-wider border-b border-slate-100">
                  <tr>
                    <th className="p-3.5">Appointment #</th>
                    <th className="p-3.5">Patient Name</th>
                    {isAdmin && <th className="p-3.5">Doctor</th>}
                    <th className="p-3.5">Date &amp; Time</th>
                    <th className="p-3.5">Reason</th>
                    <th className="p-3.5">Status</th>
                    <th className="p-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {appointments.length === 0 ? (
                    <tr>
                      <td colSpan={isAdmin ? 7 : 6} className="text-center py-16 text-slate-400">
                        <Calendar className="w-12 h-12 mx-auto mb-3 text-slate-300 stroke-1" />
                        <p className="font-semibold text-sm text-slate-700">No appointments scheduled</p>
                        <p className="text-xs text-slate-400 mt-1">Bookings will appear here when patients schedule consultation slots.</p>
                      </td>
                    </tr>
                  ) : (
                    appointments.map((appt) => (
                      <tr key={appt.id} className="hover:bg-slate-50">
                        <td className="p-3.5 font-mono font-bold text-teal-700">{appt.appointment_number}</td>
                        <td className="p-3.5 font-semibold text-slate-800">{appt.patient?.full_name || 'Patient'}</td>
                        {isAdmin && <td className="p-3.5 text-slate-600">{appt.doctor?.full_name || 'Doctor'}</td>}
                        <td className="p-3.5 text-slate-600">{appt.date} • {appt.start_time?.slice(0, 5)}</td>
                        <td className="p-3.5 text-slate-500 max-w-xs truncate">{appt.reason || 'General Consultation'}</td>
                        <td className="p-3.5">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            appt.status === 'CONFIRMED' ? 'bg-teal-50 text-teal-700' :
                            appt.status === 'COMPLETED' ? 'bg-slate-100 text-slate-700' :
                            appt.status === 'MISSED' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-800'
                          }`}>
                            {appt.status}
                          </span>
                        </td>
                        <td className="p-3.5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {isDoctor && appt.status !== 'COMPLETED' && appt.status !== 'MISSED' && (
                              appt.room_id ? (
                                <button
                                  type="button"
                                  onClick={() => navigate(`/consultation/${appt.room_id}`)}
                                  className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-xl font-bold text-[11px] inline-flex items-center gap-1.5 cursor-pointer shadow-xs"
                                >
                                  <Video className="w-3.5 h-3.5" />
                                  <span>Join Consultation</span>
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  disabled={startingConsultationId === appt.id}
                                  onClick={() => handleStartConsultation(appt.id)}
                                  className="bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white px-3 py-1.5 rounded-xl font-bold text-[11px] inline-flex items-center gap-1.5 cursor-pointer shadow-xs"
                                >
                                  <Video className="w-3.5 h-3.5" />
                                  <span>{startingConsultationId === appt.id ? 'Connecting...' : 'Join Consultation'}</span>
                                </button>
                              )
                            )}
                            {isDoctor && (
                              <button
                                type="button"
                                onClick={() => handleOpenRxForAppt(appt)}
                                className="bg-slate-100 hover:bg-slate-200 text-slate-800 px-3 py-1.5 rounded-xl font-bold text-[11px] inline-flex items-center gap-1 cursor-pointer"
                              >
                                <Pill className="w-3.5 h-3.5 text-teal-700" />
                                <span>Prescribe</span>
                              </button>
                            )}
                            {isAdmin && (
                              <Link
                                to={`/consultation/${appt.room_id || `telemed-${appt.appointment_number.replace('#', '').toLowerCase()}`}`}
                                className="bg-teal-50 hover:bg-teal-100 text-teal-800 px-3 py-1.5 rounded-xl font-bold text-[11px] inline-flex items-center gap-1"
                              >
                                <Video className="w-3.5 h-3.5" />
                                <span>View Room</span>
                              </Link>
                            )}
                            {(appt.recording_url || (appt.status === 'COMPLETED' && appt.room_id)) && (
                              <button
                                type="button"
                                onClick={() => setPlayingRecording(appt)}
                                className="bg-teal-50 hover:bg-teal-100 text-teal-800 px-3 py-1.5 rounded-xl font-bold text-[11px] inline-flex items-center gap-1 border border-teal-200 cursor-pointer shadow-2xs"
                                title="Watch Consultation Recording"
                              >
                                <Play className="w-3 h-3 fill-current text-teal-700" />
                                <span>Recording</span>
                              </button>
                            )}
                          </div>

                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab: SLOTS (Doctor Slot Management) */}
        {activeTab === 'SLOTS' && isDoctor && (
          <div className="space-y-6">
            {/* Create Slots Card */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-subtle p-6 space-y-4">
              <div>
                <h2 className="text-base font-bold text-slate-900">Generate Consultation Slots</h2>
                <p className="text-xs text-slate-500">
                  Select your slot date, start time, and duration. The slot end time is calculated automatically based on your chosen duration.
                </p>
              </div>

              <form onSubmit={handleCreateSlots} className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-end text-xs">
                <div>
                  <label className="font-bold text-slate-700 block mb-1.5">Date</label>
                  <input
                    type="date"
                    required
                    min={new Date().toISOString().split('T')[0]}
                    value={slotForm.date}
                    onChange={(e) => setSlotForm({ ...slotForm, date: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1.5">Start Time</label>
                  <input
                    type="time"
                    required
                    value={slotForm.start_time}
                    onChange={(e) => setSlotForm({ ...slotForm, start_time: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1.5">Duration</label>
                  <select
                    value={slotForm.duration_minutes}
                    onChange={(e) => setSlotForm({ ...slotForm, duration_minutes: parseInt(e.target.value, 10) })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800"
                  >
                    <option value={15}>15 Minutes</option>
                    <option value={30}>30 Minutes</option>
                    <option value={45}>45 Minutes</option>
                    <option value={60}>60 Minutes</option>
                  </select>
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="font-bold text-slate-700">Calculated End Time</span>
                    <span className="text-[11px] font-bold text-teal-700 bg-teal-50 px-2.5 py-0.5 rounded-md border border-teal-200">
                      {formatTime12h(calculateEndTime(slotForm.start_time, slotForm.duration_minutes)) || '09:30 AM'}
                    </span>
                  </div>
                  <button
                    type="submit"
                    disabled={slotSubmitting}
                    className="w-full bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white font-bold px-4 py-2.5 rounded-xl text-xs whitespace-nowrap cursor-pointer shadow-xs transition"
                  >
                    {slotSubmitting ? 'Creating...' : '+ Add Slot'}
                  </button>
                </div>
              </form>
            </div>

            {/* List of Doctor's Slots */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-subtle overflow-hidden">
              <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900">Your Active Slots ({doctorSlots.length})</h3>
                <span className="text-xs text-slate-400">Available slots can be booked by patients</span>
              </div>

              {doctorSlots.length === 0 ? (
                <div className="text-center py-16 text-slate-400">
                  <Clock className="w-12 h-12 mx-auto mb-3 text-slate-300 stroke-1" />
                  <p className="font-semibold text-sm text-slate-700">No consultation slots created yet</p>
                  <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                    Doctors start with zero slots. Use the form above to add your available consultation intervals.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100 max-h-[600px] overflow-y-auto">
                  {doctorSlots.map((slot) => (
                    <div key={slot.id} className="p-4 flex items-center justify-between hover:bg-slate-50 text-xs">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center font-bold">
                          <Clock className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="font-bold text-slate-900">{slot.date}</p>
                          <p className="text-slate-500 font-mono text-[11px]">{slot.start_time?.slice(0, 5)} – {slot.end_time?.slice(0, 5)}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className={`px-2.5 py-0.5 rounded-full font-bold text-[10px] ${
                          slot.is_available ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                        }`}>
                          {slot.is_available ? 'Available' : 'Booked'}
                        </span>

                        {slot.is_available && (
                          <button
                            type="button"
                            onClick={() => handleDeleteSlot(slot.id)}
                            title="Delete Slot"
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab: PATIENTS (Doctor Assigned Patients Only) */}
        {activeTab === 'PATIENTS' && isDoctor && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-subtle overflow-hidden">
            <div className="p-5 border-b border-slate-100">
              <h2 className="text-sm font-bold text-slate-900">My Consultation Patients ({doctorPatients.length})</h2>
              <span className="text-xs text-slate-400">Patients who have booked or completed consultations with you</span>
            </div>

            {doctorPatients.length === 0 ? (
              <div className="text-center py-16 text-slate-400">
                <Users className="w-12 h-12 mx-auto mb-3 text-slate-300 stroke-1" />
                <p className="font-semibold text-sm text-slate-700">No assigned patients yet</p>
                <p className="text-xs text-slate-400 mt-1">Patients will appear here once they book appointments with you.</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {doctorPatients.map((p) => (
                  <div key={p.id} className="p-4 flex items-center justify-between hover:bg-slate-50 text-xs">
                    <div>
                      <h3 className="font-bold text-sm text-slate-900">{p.full_name}</h3>
                      <p className="text-slate-500 text-[11px] mt-0.5">
                        UHID: <span className="font-mono font-bold text-teal-700">{p.uhid}</span> • Blood: {p.blood_group || 'N/A'} • City: {p.city || 'N/A'} • Phone: {p.phone || 'N/A'}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleViewPatientHistory(p)}
                      className="bg-teal-50 hover:bg-teal-100 text-teal-800 font-bold px-3.5 py-2 rounded-xl text-xs flex items-center gap-1.5 cursor-pointer transition"
                    >
                      <FileText className="w-3.5 h-3.5 text-teal-700" />
                      <span>View Clinical History</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab: PRESCRIPTIONS (Doctor View) */}
        {activeTab === 'PRESCRIPTIONS' && isDoctor && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-subtle p-5 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-slate-900">Issued Prescriptions ({prescriptions.length})</h2>
                <p className="text-xs text-slate-500">Digital itemized prescriptions issued post-consultation</p>
              </div>
              <button
                onClick={() => setShowRxModal(true)}
                className="bg-teal-700 hover:bg-teal-800 text-white font-bold text-xs px-4 py-2 rounded-xl cursor-pointer"
              >
                + New Prescription
              </button>
            </div>

            {prescriptions.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-16 text-center text-slate-400">
                <Pill className="w-12 h-12 mx-auto mb-3 text-slate-300 stroke-1" />
                <p className="font-semibold text-sm text-slate-700">No prescriptions issued yet</p>
                <p className="text-xs text-slate-400 mt-1">Prescriptions are created after completing consultations with patients.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {prescriptions.map((rx) => (
                  <div key={rx.id} className="p-4 rounded-2xl bg-white border border-slate-200 shadow-subtle space-y-2 text-xs">
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="font-mono font-bold text-teal-700">{rx.rx_number}</span>
                        <h3 className="font-bold text-slate-900 mt-0.5">{rx.diagnosis}</h3>
                      </div>
                      <span className="text-[10px] text-slate-400">{new Date(rx.created_at).toLocaleDateString()}</span>
                    </div>
                    <p className="text-slate-500">Patient: <strong>{rx.patient?.full_name}</strong></p>
                    <div className="space-y-1 pt-1 border-t border-slate-100">
                      {rx.medicines?.map((m) => (
                        <div key={m.id || m.medicine_name} className="flex justify-between text-slate-600 text-[11px]">
                          <span>{m.medicine_name} ({m.dosage})</span>
                          <span className="font-semibold text-teal-700">{m.frequency}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Modal: Create Doctor (Admin) */}
      {showDoctorModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-xl shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-base text-slate-900">Add Clinical Doctor Account</h3>
              <button onClick={() => setShowDoctorModal(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">✕</button>
            </div>

            <form onSubmit={handleCreateDoctor} className="space-y-3.5 text-xs">
              {/* Doctor Photo Upload */}
              <div className="flex items-center gap-4 p-3 bg-slate-50 rounded-2xl border border-slate-100">
                <img
                  src={doctorForm.avatar_url || "/default-doctor.png"}
                  alt="Doctor Preview"
                  className="w-16 h-16 rounded-2xl object-cover border border-slate-200 bg-white shrink-0"
                />
                <div className="flex-1">
                  <label className="font-bold text-slate-700 block mb-1">Doctor Profile Photo</label>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handlePhotoUpload}
                    disabled={uploadingPhoto}
                    className="block w-full text-xs text-slate-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-teal-50 file:text-teal-700 hover:file:bg-teal-100 cursor-pointer"
                  />
                  <span className="text-[10px] text-slate-400 block mt-1">JPEG, PNG, or WEBP up to 5MB. Defaults to standard avatar.</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Doctor Full Name</label>
                  <input
                    type="text"
                    required
                    value={doctorForm.full_name}
                    onChange={(e) => setDoctorForm({ ...doctorForm, full_name: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">Specialty</label>
                  <select
                    required
                    value={doctorForm.specialty}
                    onChange={(e) => setDoctorForm({ ...doctorForm, specialty: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-semibold"
                  >
                    {MEDICAL_SPECIALTIES.map((spec) => (
                      <option key={spec} value={spec}>{spec}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Email (Login ID)</label>
                  <input
                    type="email"
                    required
                    value={doctorForm.email}
                    onChange={(e) => setDoctorForm({ ...doctorForm, email: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">Phone</label>
                  <input
                    type="tel"
                    value={doctorForm.phone}
                    onChange={(e) => setDoctorForm({ ...doctorForm, phone: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">Password</label>
                  <input
                    type="password"
                    required
                    value={doctorForm.password}
                    onChange={(e) => setDoctorForm({ ...doctorForm, password: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Qualification</label>
                  <input
                    type="text"
                    required
                    value={doctorForm.qualification}
                    onChange={(e) => setDoctorForm({ ...doctorForm, qualification: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">Experience (Years)</label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={doctorForm.experience_years}
                    onChange={(e) => setDoctorForm({ ...doctorForm, experience_years: parseInt(e.target.value) || 0 })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">Fee (₹)</label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={doctorForm.consultation_fee}
                    onChange={(e) => setDoctorForm({ ...doctorForm, consultation_fee: parseFloat(e.target.value) || 0 })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Hospital / Clinic Affiliation</label>
                <input
                  type="text"
                  required
                  value={doctorForm.hospital_name}
                  onChange={(e) => setDoctorForm({ ...doctorForm, hospital_name: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Professional Bio</label>
                <textarea
                  rows={2}
                  value={doctorForm.bio}
                  onChange={(e) => setDoctorForm({ ...doctorForm, bio: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <button
                type="submit"
                className="w-full bg-teal-700 hover:bg-teal-800 text-white font-bold py-3 rounded-xl shadow-sm text-xs mt-3 cursor-pointer"
              >
                Register Doctor (Zero Initial Slots)
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal: View Patient Clinical History (Doctor) */}
      {showHistoryModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-2xl shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto text-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-bold text-base text-slate-900">Patient Longitudinal Clinical History</h3>
                <p className="text-[11px] text-slate-400">Complete medical consultations and prescription timeline</p>
              </div>
              <button onClick={() => setShowHistoryModal(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">✕</button>
            </div>

            {historyLoading ? (
              <div className="py-12 text-center text-slate-400">
                <Activity className="w-8 h-8 mx-auto animate-spin mb-2 text-teal-600" />
                <p className="font-semibold">Loading clinical history...</p>
              </div>
            ) : selectedPatientHistory && (
              <div className="space-y-4">
                {/* Demographics Card */}
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <span className="text-[10px] font-bold uppercase text-slate-400 block">Patient Name</span>
                    <span className="font-bold text-slate-900">{selectedPatientHistory.patient?.full_name}</span>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold uppercase text-slate-400 block">UHID</span>
                    <span className="font-mono font-bold text-teal-700">{selectedPatientHistory.patient?.uhid}</span>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold uppercase text-slate-400 block">Blood Group</span>
                    <span className="font-bold text-rose-700">{selectedPatientHistory.patient?.blood_group || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold uppercase text-slate-400 block">City</span>
                    <span className="font-bold text-slate-700">{selectedPatientHistory.patient?.city || 'N/A'}</span>
                  </div>
                </div>

                {/* Consultations History */}
                <div>
                  <h4 className="font-bold text-slate-900 mb-2 flex items-center gap-1.5">
                    <Video className="w-4 h-4 text-teal-700" />
                    <span>Previous Consultations ({selectedPatientHistory.consultations?.length || 0})</span>
                  </h4>
                  {selectedPatientHistory.consultations?.length === 0 ? (
                    <p className="text-slate-400 italic p-3 bg-slate-50 rounded-xl">No prior consultations recorded.</p>
                  ) : (
                    <div className="space-y-2">
                      {selectedPatientHistory.consultations.map((c) => (
                        <div key={c.id} className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex justify-between items-center">
                          <div>
                            <p className="font-bold text-slate-800">
                              Dr. {c.doctor_name} <span className="text-slate-400 font-normal">({c.doctor_specialty})</span>
                            </p>
                            <p className="text-[11px] text-slate-500">
                              {c.appointment_date} • Status: <span className="font-semibold">{c.status}</span>
                            </p>
                            {c.clinical_notes && (
                              <p className="text-[11px] text-slate-600 mt-1 italic">"{c.clinical_notes}"</p>
                            )}
                          </div>
                          <span className="text-[10px] font-mono font-bold px-2 py-1 bg-white rounded-lg border border-slate-200">
                            {c.room_id}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Prescriptions History */}
                <div>
                  <h4 className="font-bold text-slate-900 mb-2 flex items-center gap-1.5">
                    <Pill className="w-4 h-4 text-teal-700" />
                    <span>Previous Prescriptions ({selectedPatientHistory.prescriptions?.length || 0})</span>
                  </h4>
                  {selectedPatientHistory.prescriptions?.length === 0 ? (
                    <p className="text-slate-400 italic p-3 bg-slate-50 rounded-xl">No prior prescriptions issued.</p>
                  ) : (
                    <div className="space-y-2">
                      {selectedPatientHistory.prescriptions.map((rx) => (
                        <div key={rx.id} className="p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-2">
                          <div className="flex justify-between items-start">
                            <div>
                              <span className="font-mono font-bold text-teal-700">{rx.rx_number}</span>
                              <p className="font-bold text-slate-800 mt-0.5">{rx.diagnosis}</p>
                              <p className="text-[10px] text-slate-400">Prescribed by Dr. {rx.doctor_name} on {new Date(rx.created_at).toLocaleDateString()}</p>
                            </div>
                          </div>

                          <div className="space-y-1 pt-1 border-t border-slate-200/60">
                            {rx.medicines?.map((m, idx) => (
                              <div key={idx} className="flex justify-between text-slate-700 text-[11px]">
                                <span><strong>{m.medicine_name}</strong> - {m.dosage} ({m.timing})</span>
                                <span className="font-semibold text-teal-700">{m.frequency} for {m.duration}</span>
                              </div>
                            ))}
                          </div>

                          {rx.notes && (
                            <p className="text-[10px] text-slate-500 italic">Instructions: {rx.notes}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal: Create Prescription (Doctor) */}
      {showRxModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-xl shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-base text-slate-900">Issue Post-Consultation Prescription</h3>
              <button onClick={() => setShowRxModal(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">✕</button>
            </div>

            <form onSubmit={handleCreateRx} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Select Patient</label>
                  <select
                    required
                    value={rxForm.patient_id}
                    onChange={(e) => setRxForm({ ...rxForm, patient_id: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-semibold"
                  >
                    <option value="">-- Choose Assigned Patient --</option>
                    {doctorPatients.map((p) => (
                      <option key={p.id} value={p.id}>{p.full_name} ({p.uhid})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">Diagnosis</label>
                  <input
                    type="text"
                    required
                    value={rxForm.diagnosis}
                    onChange={(e) => setRxForm({ ...rxForm, diagnosis: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>
              </div>

              {/* Medicines Builder */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-slate-700 uppercase">Medications</span>
                  <button type="button" onClick={addMedicineRow} className="text-teal-700 font-bold text-xs hover:underline cursor-pointer">
                    + Add Medicine
                  </button>
                </div>

                {rxForm.medicines.map((med, idx) => (
                  <div key={idx} className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                    <div className="grid grid-cols-3 gap-2">
                      <div className="col-span-2">
                        <label className="text-[10px] font-semibold text-slate-500 block mb-0.5">Medicine Name</label>
                        <input
                          type="text"
                          required
                          value={med.medicine_name}
                          onChange={(e) => updateMedicine(idx, 'medicine_name', e.target.value)}
                          className="w-full p-2 border rounded-lg bg-white"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold text-slate-500 block mb-0.5">Dosage</label>
                        <input
                          type="text"
                          value={med.dosage}
                          onChange={(e) => updateMedicine(idx, 'dosage', e.target.value)}
                          className="w-full p-2 border rounded-lg bg-white"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="text-[10px] font-semibold text-slate-500 block mb-0.5">Frequency</label>
                        <input
                          type="text"
                          value={med.frequency}
                          onChange={(e) => updateMedicine(idx, 'frequency', e.target.value)}
                          className="w-full p-2 border rounded-lg bg-white"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold text-slate-500 block mb-0.5">Duration</label>
                        <input
                          type="text"
                          value={med.duration}
                          onChange={(e) => updateMedicine(idx, 'duration', e.target.value)}
                          className="w-full p-2 border rounded-lg bg-white"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold text-slate-500 block mb-0.5">Timing</label>
                        <select
                          value={med.timing}
                          onChange={(e) => updateMedicine(idx, 'timing', e.target.value)}
                          className="w-full p-2 border rounded-lg bg-white"
                        >
                          <option value="After Food">After Food</option>
                          <option value="Before Food">Before Food</option>
                          <option value="With Food">With Food</option>
                        </select>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Clinical Instructions &amp; Lifestyle Advice</label>
                <textarea
                  rows={2}
                  value={rxForm.notes}
                  onChange={(e) => setRxForm({ ...rxForm, notes: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <button
                type="submit"
                className="w-full bg-teal-700 hover:bg-teal-800 text-white font-bold py-3 rounded-xl shadow-sm text-xs cursor-pointer"
              >
                Sign &amp; Dispatch Digital Prescription
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Video Recording Playback Modal */}
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
                    Consultation Recording: {playingRecording.appointment_number || playingRecording.room_id}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Room: <span className="font-mono text-teal-400">{playingRecording.room_id}</span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPlayingRecording(null)}
                className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition cursor-pointer"
                aria-label="Close video player"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="aspect-video bg-black flex items-center justify-center relative">
              <video
                src={token ? `/api/consultations/${playingRecording.room_id}/recording?token=${token}` : `/api/consultations/${playingRecording.room_id}/recording`}
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
                <span>Encrypted 2-way Google Meet composite recording archive</span>
              </span>
              <a
                href={token ? `/api/consultations/${playingRecording.room_id}/recording?token=${token}` : `/api/consultations/${playingRecording.room_id}/recording`}
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
    </div>
  );
};

