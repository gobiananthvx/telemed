from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from app.models.consultation import ConsultationStatus
from app.schemas.user import DoctorProfileResponse, PatientProfileResponse

class ConsultationStart(BaseModel):
    appointment_id: int

class ConsultationEnd(BaseModel):
    clinical_notes: Optional[str] = None

class ConsultationResponse(BaseModel):
    id: int
    appointment_id: int
    room_id: str
    doctor_id: int
    patient_id: int
    status: ConsultationStatus
    doctor_joined_at: Optional[datetime] = None
    patient_joined_at: Optional[datetime] = None
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
    duration_seconds: int
    clinical_notes: Optional[str] = None
    recording_url: Optional[str] = None
    recording_duration_seconds: int = 0
    recording_size_bytes: int = 0
    recorded_at: Optional[datetime] = None
    created_at: datetime
    doctor: Optional[DoctorProfileResponse] = None
    patient: Optional[PatientProfileResponse] = None

    class Config:
        from_attributes = True
