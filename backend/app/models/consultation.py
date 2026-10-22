from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, Enum as SAEnum, Text, Boolean
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
import enum
from app.database import Base

class ConsultationStatus(str, enum.Enum):
    WAITING = "WAITING"
    ACTIVE = "ACTIVE"
    COMPLETED = "COMPLETED"
    MISSED = "MISSED"
    CANCELLED = "CANCELLED"

class Consultation(Base):
    __tablename__ = "consultations"

    id = Column(Integer, primary_key=True, index=True)
    appointment_id = Column(Integer, ForeignKey("appointments.id", ondelete="CASCADE"), unique=True, nullable=False)
    room_id = Column(String, unique=True, index=True, nullable=False)
    doctor_id = Column(Integer, ForeignKey("doctor_profiles.id", ondelete="CASCADE"), nullable=False)
    patient_id = Column(Integer, ForeignKey("patient_profiles.id", ondelete="CASCADE"), nullable=False)
    status = Column(SAEnum(ConsultationStatus, name="consultation_statuses"), default=ConsultationStatus.WAITING, nullable=False)
    doctor_joined = Column(Boolean, default=False, nullable=False)
    patient_joined = Column(Boolean, default=False, nullable=False)
    doctor_joined_at = Column(DateTime(timezone=True), nullable=True)
    patient_joined_at = Column(DateTime(timezone=True), nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    ended_at = Column(DateTime(timezone=True), nullable=True)
    duration_seconds = Column(Integer, default=0, nullable=False)
    clinical_notes = Column(Text, nullable=True)
    recording_url = Column(String, nullable=True)
    recording_duration_seconds = Column(Integer, default=0, nullable=False)
    recording_size_bytes = Column(Integer, default=0, nullable=False)
    recorded_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    # Relationships
    appointment = relationship("Appointment", back_populates="consultation")
    doctor = relationship("DoctorProfile")
    patient = relationship("PatientProfile")
    prescription = relationship("Prescription", back_populates="consultation", uselist=False)
    feedback = relationship("Feedback", back_populates="consultation", uselist=False)
