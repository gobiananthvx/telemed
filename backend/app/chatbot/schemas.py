from pydantic import BaseModel, Field
from typing import Optional, List, Any, Dict
from datetime import date, datetime
from enum import Enum

class ChatResponseType(str, Enum):
    TEXT = "text"
    DOCTOR_LIST = "doctor_list"
    DOCTOR_DETAILS = "doctor_details"
    SLOT_LIST = "slot_list"
    APPOINTMENT = "appointment"
    APPOINTMENT_LIST = "appointment_list"
    PRESCRIPTION = "prescription"
    PRESCRIPTION_LIST = "prescription_list"
    BOOKING_PREVIEW = "booking_preview"
    BOOKING_CONFIRMATION = "booking_confirmation"
    ERROR = "error"

class ChatMessageRequest(BaseModel):
    message: str = Field(..., description="User message to the assistant")
    session_id: Optional[str] = Field(None, description="Optional existing session ID")

class ChatResponse(BaseModel):
    message: str
    type: str = "text"
    data: Optional[Any] = None
    session_id: str
    suggested_actions: Optional[List[str]] = None

class ChatMessageResponse(BaseModel):
    id: int
    session_id: str
    role: str
    content: str
    message_type: str
    data: Optional[Any] = None
    created_at: datetime

    class Config:
        from_attributes = True

class ChatSessionResponse(BaseModel):
    id: str
    patient_id: int
    created_at: datetime
    updated_at: datetime
    messages: List[ChatMessageResponse] = []

    class Config:
        from_attributes = True

# Tool Input Schemas
class SearchDoctorsArgs(BaseModel):
    search: Optional[str] = Field(None, description="Search term for doctor name, hospital, or specialty")
    specialty: Optional[str] = Field(None, description="Specific specialty filter (e.g. Cardiologist, Dermatologist)")

class GetDoctorDetailsArgs(BaseModel):
    doctor_id: int = Field(..., description="ID of the doctor to retrieve details for")

class GetDoctorSlotsArgs(BaseModel):
    doctor_id: int = Field(..., description="ID of the doctor")
    date: str = Field(..., description="Date in YYYY-MM-DD format")

class GetMyAppointmentsArgs(BaseModel):
    status: Optional[str] = Field(None, description="Optional status filter (e.g. CONFIRMED, SCHEDULED, COMPLETED)")

class GetAppointmentDetailsArgs(BaseModel):
    appointment_id: int = Field(..., description="ID of the appointment to retrieve")

class PrepareBookingPreviewArgs(BaseModel):
    doctor_id: int = Field(..., description="ID of the doctor")
    date: str = Field(..., description="Date of the appointment in YYYY-MM-DD format")
    start_time: str = Field(..., description="Start time in HH:MM format (e.g. 10:30)")
    slot_id: Optional[int] = Field(None, description="Optional slot ID if known")
    reason: Optional[str] = Field("General Consultation", description="Reason for consultation")

class BookAppointmentArgs(BaseModel):
    doctor_id: int = Field(..., description="ID of the doctor")
    date: str = Field(..., description="Date in YYYY-MM-DD format")
    start_time: str = Field(..., description="Start time in HH:MM format")
    slot_id: Optional[int] = Field(None, description="Optional slot ID")
    reason: Optional[str] = Field("General Consultation", description="Reason for appointment")

class GetPrescriptionDetailsArgs(BaseModel):
    prescription_id: int = Field(..., description="ID of the prescription to view")
