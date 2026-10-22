from pydantic import BaseModel
from typing import Optional
from datetime import date, time, datetime
from app.models.appointment import AppointmentStatus, ConsultationMode
from app.schemas.user import DoctorProfileResponse, PatientProfileResponse

class AppointmentCreate(BaseModel):
    doctor_id: int
    slot_id: Optional[int] = None
    date: date
    start_time: str # "10:30"
    reason: Optional[str] = "General Consultation"
    consultation_mode: ConsultationMode = ConsultationMode.VIDEO

class AppointmentStatusUpdate(BaseModel):
    status: AppointmentStatus

class AppointmentResponse(BaseModel):
    id: int
    appointment_number: str
    patient_id: int
    doctor_id: int
    slot_id: Optional[int] = None
    date: date
    start_time: time
    end_time: time
    status: AppointmentStatus
    consultation_mode: ConsultationMode
    reason: Optional[str] = None
    fee: float
    payment_status: str
    created_at: datetime
    room_id: Optional[str] = None
    recording_url: Optional[str] = None
    recording_duration_seconds: Optional[int] = None
    doctor: Optional[DoctorProfileResponse] = None

    patient: Optional[PatientProfileResponse] = None

    class Config:
        from_attributes = True
