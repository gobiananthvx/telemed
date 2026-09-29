import random
import string
from datetime import date, datetime, timedelta, time as dt_time, timezone
from typing import List, Optional, Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, func, desc, and_
from sqlalchemy.orm import selectinload

from app.models.doctor import DoctorProfile, DoctorSlot
from app.models.patient import PatientProfile
from app.models.appointment import Appointment, AppointmentStatus, ConsultationMode
from app.models.consultation import Consultation, ConsultationStatus
from app.models.prescription import Prescription, PrescriptionMedicine
from app.models.user import User
from app.models.notification import NotificationType
from app.services.notification_service import create_notification
from app.services.email_client import send_notification_email
from app.api.doctors import get_slot_period

def generate_booking_number() -> str:
    digits = "".join(random.choices(string.digits, k=4))
    return f"#TLM-BOK-{digits}"

async def tool_search_doctors(
    db: AsyncSession,
    search: Optional[str] = None,
    specialty: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Search and filter verified doctors by name, specialty, or hospital.
    """
    stmt = select(DoctorProfile).where(DoctorProfile.is_verified == True)

    if specialty and specialty.lower() != "all":
        stmt = stmt.where(func.lower(DoctorProfile.specialty) == specialty.lower())

    if search:
        search_term = f"%{search.lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(DoctorProfile.full_name).like(search_term),
                func.lower(DoctorProfile.specialty).like(search_term),
                func.lower(DoctorProfile.hospital_name).like(search_term)
            )
        )

    stmt = stmt.order_by(DoctorProfile.experience_years.desc(), DoctorProfile.id.asc())
    res = await db.execute(stmt)
    doctors = res.scalars().all()

    return [
        {
            "id": d.id,
            "full_name": d.full_name,
            "qualification": d.qualification,
            "specialty": d.specialty,
            "experience_years": d.experience_years,
            "hospital_name": d.hospital_name,
            "consultation_fee": d.consultation_fee,
            "bio": d.bio,
            "rating": d.rating,
            "reviews_count": d.reviews_count,
            "avatar_url": d.avatar_url,
            "city": d.city,
            "is_verified": d.is_verified
        }
        for d in doctors
    ]

async def tool_get_doctor_details(
    db: AsyncSession,
    doctor_id: int
) -> Optional[Dict[str, Any]]:
    """
    Retrieve full profile details for a specific doctor by ID.
    """
    stmt = select(DoctorProfile).where(DoctorProfile.id == doctor_id)
    res = await db.execute(stmt)
    doctor = res.scalar_one_or_none()
    if not doctor:
        return None

    return {
        "id": doctor.id,
        "full_name": doctor.full_name,
        "qualification": doctor.qualification,
        "specialty": doctor.specialty,
        "experience_years": doctor.experience_years,
        "hospital_name": doctor.hospital_name,
        "consultation_fee": doctor.consultation_fee,
        "bio": doctor.bio,
        "rating": doctor.rating,
        "reviews_count": doctor.reviews_count,
        "avatar_url": doctor.avatar_url,
        "city": doctor.city,
        "is_verified": doctor.is_verified
    }

async def tool_get_doctor_slots(
    db: AsyncSession,
    doctor_id: int,
    date_str: str
) -> Dict[str, Any]:
    """
    Retrieve available appointment slots for a specific doctor on a given date.
    Filters out past slots for the current day.
    """
    try:
        chosen_date = datetime.strptime(date_str, "%Y-%m-%d").date()
    except Exception:
        return {"error": "Invalid date format. Expected YYYY-MM-DD", "slots": []}

    doc_stmt = select(DoctorProfile).where(DoctorProfile.id == doctor_id)
    doctor = (await db.execute(doc_stmt)).scalar_one_or_none()
    if not doctor:
        return {"error": f"Doctor with ID {doctor_id} not found", "slots": []}

    stmt = (
        select(DoctorSlot)
        .where(
            DoctorSlot.doctor_id == doctor_id,
            DoctorSlot.date == chosen_date,
            DoctorSlot.is_available == True
        )
        .order_by(DoctorSlot.start_time.asc())
    )
    res = await db.execute(stmt)
    db_slots = res.scalars().all()

    now_dt = datetime.now()
    slots = []
    for s in db_slots:
        # Filter out past slots for today
        if chosen_date == now_dt.date() and s.start_time <= now_dt.time():
            continue
        slots.append({
            "id": s.id,
            "time": s.start_time.strftime("%H:%M"),
            "end_time": s.end_time.strftime("%H:%M"),
            "formatted_time": s.start_time.strftime("%I:%M %p").lstrip("0"),
            "is_available": s.is_available,
            "period": get_slot_period(s.start_time)
        })

    return {
        "doctor_id": doctor.id,
        "doctor_name": doctor.full_name,
        "specialty": doctor.specialty,
        "consultation_fee": doctor.consultation_fee,
        "date": chosen_date.isoformat(),
        "day_name": chosen_date.strftime("%A"),
        "slots": slots,
        "count": len(slots)
    }

async def tool_get_my_appointments(
    db: AsyncSession,
    current_patient: PatientProfile,
    status_filter: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Retrieve appointments for the authenticated patient.
    Patient ID is derived strictly from the backend session.
    """
    stmt = (
        select(Appointment)
        .options(
            selectinload(Appointment.doctor),
            selectinload(Appointment.consultation)
        )
        .where(Appointment.patient_id == current_patient.id)
    )

    if status_filter:
        try:
            status_enum = AppointmentStatus(status_filter.upper())
            stmt = stmt.where(Appointment.status == status_enum)
        except Exception:
            pass

    stmt = stmt.order_by(desc(Appointment.date), desc(Appointment.start_time))
    res = await db.execute(stmt)
    appts = res.scalars().all()

    return [
        {
            "id": a.id,
            "appointment_number": a.appointment_number,
            "doctor_id": a.doctor_id,
            "doctor_name": a.doctor.full_name if a.doctor else "Doctor",
            "doctor_specialty": a.doctor.specialty if a.doctor else "",
            "date": a.date.isoformat(),
            "start_time": a.start_time.strftime("%H:%M"),
            "end_time": a.end_time.strftime("%H:%M"),
            "status": a.status.value,
            "consultation_mode": a.consultation_mode.value,
            "reason": a.reason,
            "fee": a.fee,
            "payment_status": a.payment_status,
            "room_id": a.consultation.room_id if a.consultation else None
        }
        for a in appts
    ]

async def tool_get_upcoming_appointment(
    db: AsyncSession,
    current_patient: PatientProfile
) -> Optional[Dict[str, Any]]:
    """
    Retrieve the next upcoming appointment for the authenticated patient.
    """
    today = date.today()
    stmt = (
        select(Appointment)
        .options(
            selectinload(Appointment.doctor),
            selectinload(Appointment.consultation)
        )
        .where(
            Appointment.patient_id == current_patient.id,
            Appointment.status.in_([AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED, AppointmentStatus.IN_PROGRESS]),
            Appointment.date >= today
        )
        .order_by(Appointment.date.asc(), Appointment.start_time.asc())
        .limit(1)
    )
    res = await db.execute(stmt)
    appt = res.scalar_one_or_none()

    if not appt:
        return None

    return {
        "id": appt.id,
        "appointment_number": appt.appointment_number,
        "doctor_id": appt.doctor_id,
        "doctor_name": appt.doctor.full_name if appt.doctor else "Doctor",
        "doctor_specialty": appt.doctor.specialty if appt.doctor else "",
        "date": appt.date.isoformat(),
        "start_time": appt.start_time.strftime("%H:%M"),
        "end_time": appt.end_time.strftime("%H:%M"),
        "status": appt.status.value,
        "consultation_mode": appt.consultation_mode.value,
        "reason": appt.reason,
        "fee": appt.fee,
        "payment_status": appt.payment_status,
        "room_id": appt.consultation.room_id if appt.consultation else None
    }

async def tool_get_appointment_details(
    db: AsyncSession,
    current_patient: PatientProfile,
    appointment_id: int
) -> Optional[Dict[str, Any]]:
    """
    Retrieve details for a specific appointment.
    Enforces authorization: patient can only view their own appointment.
    """
    stmt = (
        select(Appointment)
        .options(
            selectinload(Appointment.doctor),
            selectinload(Appointment.consultation)
        )
        .where(Appointment.id == appointment_id)
    )
    res = await db.execute(stmt)
    appt = res.scalar_one_or_none()

    if not appt:
        return None

    if appt.patient_id != current_patient.id:
        # Cross-patient access prohibited
        return {"error": "Unauthorized access to this appointment"}

    return {
        "id": appt.id,
        "appointment_number": appt.appointment_number,
        "doctor_id": appt.doctor_id,
        "doctor_name": appt.doctor.full_name if appt.doctor else "Doctor",
        "doctor_specialty": appt.doctor.specialty if appt.doctor else "",
        "date": appt.date.isoformat(),
        "start_time": appt.start_time.strftime("%H:%M"),
        "end_time": appt.end_time.strftime("%H:%M"),
        "status": appt.status.value,
        "consultation_mode": appt.consultation_mode.value,
        "reason": appt.reason,
        "fee": appt.fee,
        "payment_status": appt.payment_status,
        "room_id": appt.consultation.room_id if appt.consultation else None
    }

async def tool_prepare_booking_preview(
    db: AsyncSession,
    current_patient: PatientProfile,
    doctor_id: int,
    date_str: str,
    start_time: str,
    slot_id: Optional[int] = None,
    reason: Optional[str] = "General Consultation"
) -> Dict[str, Any]:
    """
    Validate slot and doctor, check double-booking, and generate booking preview.
    Does NOT execute the booking until confirmed.
    """
    try:
        booking_date = datetime.strptime(date_str, "%Y-%m-%d").date()
    except Exception:
        return {"error": "Invalid date format. Expected YYYY-MM-DD"}

    # Doctor check
    doc_stmt = select(DoctorProfile).where(DoctorProfile.id == doctor_id)
    doctor = (await db.execute(doc_stmt)).scalar_one_or_none()
    if not doctor:
        return {"error": "Doctor not found"}

    # Time check
    try:
        parts = [int(p) for p in start_time.split(":")]
        start_t = dt_time(parts[0], parts[1])
        end_dt = datetime.combine(booking_date, start_t) + timedelta(minutes=30)
        end_t = end_dt.time()
    except Exception:
        return {"error": "Invalid time format. Expected HH:MM"}

    # Past time check
    now = datetime.now()
    if booking_date < now.date() or (booking_date == now.date() and start_t <= now.time()):
        return {"error": "Cannot book an appointment for a past date or time slot."}

    # Verify slot availability if slot_id given or by doctor_id, date, start_time
    slot = None
    if slot_id:
        slot_stmt = select(DoctorSlot).where(
            DoctorSlot.id == slot_id,
            DoctorSlot.doctor_id == doctor_id
        )
        slot = (await db.execute(slot_stmt)).scalar_one_or_none()
        if not slot or not slot.is_available:
            return {"error": "The selected time slot is no longer available."}
        start_t = slot.start_time
        end_t = slot.end_time
    else:
        slot_stmt = select(DoctorSlot).where(
            DoctorSlot.doctor_id == doctor_id,
            DoctorSlot.date == booking_date,
            DoctorSlot.start_time == start_t
        )
        slot = (await db.execute(slot_stmt)).scalar_one_or_none()
        if slot and not slot.is_available:
            return {"error": f"The time slot {start_time} is already booked."}

    # Double booking prevention
    conflict_stmt = (
        select(Appointment)
        .where(
            Appointment.doctor_id == doctor_id,
            Appointment.date == booking_date,
            Appointment.start_time == start_t,
            Appointment.status.notin_([AppointmentStatus.CANCELLED, AppointmentStatus.MISSED])
        )
    )
    conflict = (await db.execute(conflict_stmt)).scalar_one_or_none()
    if conflict:
        return {"error": f"This slot with {doctor.full_name} is already booked."}

    return {
        "doctor_id": doctor.id,
        "doctor_name": doctor.full_name,
        "specialty": doctor.specialty,
        "slot_id": slot.id if slot else None,
        "date": booking_date.isoformat(),
        "date_formatted": booking_date.strftime("%A, %d %B %Y"),
        "start_time": start_t.strftime("%H:%M"),
        "end_time": end_t.strftime("%H:%M"),
        "time_formatted": f"{start_t.strftime('%I:%M %p').lstrip('0')} - {end_t.strftime('%I:%M %p').lstrip('0')}",
        "consultation_mode": "Video consultation",
        "fee": doctor.consultation_fee,
        "reason": reason or "General Consultation",
        "requires_confirmation": True
    }

async def tool_book_appointment(
    db: AsyncSession,
    current_patient: PatientProfile,
    current_user: User,
    doctor_id: int,
    date_str: str,
    start_time: str,
    slot_id: Optional[int] = None,
    reason: Optional[str] = "General Consultation"
) -> Dict[str, Any]:
    """
    Execute appointment booking after user confirmation.
    Reuses all backend validation and notifications.
    """
    try:
        booking_date = datetime.strptime(date_str, "%Y-%m-%d").date()
    except Exception:
        return {"error": "Invalid date format. Expected YYYY-MM-DD"}

    doc_stmt = select(DoctorProfile).where(DoctorProfile.id == doctor_id)
    doctor = (await db.execute(doc_stmt)).scalar_one_or_none()
    if not doctor:
        return {"error": "Doctor not found"}

    try:
        parts = [int(p) for p in start_time.split(":")]
        start_t = dt_time(parts[0], parts[1])
        end_dt = datetime.combine(booking_date, start_t) + timedelta(minutes=30)
        end_t = end_dt.time()
    except Exception:
        return {"error": "Invalid time format. Expected HH:MM"}

    now = datetime.now()
    if booking_date < now.date() or (booking_date == now.date() and start_t <= now.time()):
        return {"error": "Cannot book an appointment for a past date or time slot."}

    slot = None
    if slot_id:
        slot_stmt = select(DoctorSlot).where(
            DoctorSlot.id == slot_id,
            DoctorSlot.doctor_id == doctor_id
        )
        slot = (await db.execute(slot_stmt)).scalar_one_or_none()
        if not slot or not slot.is_available:
            return {"error": "The selected time slot is no longer available. Please select another slot."}
        start_t = slot.start_time
        end_t = slot.end_time
    else:
        slot_stmt = select(DoctorSlot).where(
            DoctorSlot.doctor_id == doctor_id,
            DoctorSlot.date == booking_date,
            DoctorSlot.start_time == start_t
        )
        slot = (await db.execute(slot_stmt)).scalar_one_or_none()
        if slot and not slot.is_available:
            return {"error": f"The time slot {start_time} is already booked. Please select another slot."}

    # Double-booking check
    conflict_stmt = (
        select(Appointment)
        .where(
            Appointment.doctor_id == doctor_id,
            Appointment.date == booking_date,
            Appointment.start_time == start_t,
            Appointment.status.notin_([AppointmentStatus.CANCELLED, AppointmentStatus.MISSED])
        )
    )
    conflict = (await db.execute(conflict_stmt)).scalar_one_or_none()
    if conflict:
        return {"error": f"This slot with {doctor.full_name} is already booked. Please select another slot."}

    if slot:
        slot.is_available = False

    booking_num = generate_booking_number()
    while (await db.execute(select(Appointment).where(Appointment.appointment_number == booking_num))).scalar_one_or_none():
        booking_num = generate_booking_number()

    appointment = Appointment(
        appointment_number=booking_num,
        patient_id=current_patient.id,
        doctor_id=doctor_id,
        slot_id=slot.id if slot else None,
        date=booking_date,
        start_time=start_t,
        end_time=end_t,
        status=AppointmentStatus.CONFIRMED,
        consultation_mode=ConsultationMode.VIDEO,
        reason=reason,
        fee=doctor.consultation_fee,
        payment_status="PAID"
    )
    db.add(appointment)
    await db.flush()

    patient_name = current_patient.full_name or "Patient"

    # Notifications
    await create_notification(
        db=db,
        user_id=current_user.id,
        title="Appointment Confirmed",
        message=f"Your video consultation with Dr. {doctor.full_name} is confirmed for {booking_date.strftime('%d %b %Y')} at {start_time}.",
        notification_type=NotificationType.APPOINTMENT,
        link=f"/booking-confirmation/{appointment.id}",
        send_email=False
    )

    doc_user_stmt = select(User).where(User.id == doctor.user_id)
    doc_user = (await db.execute(doc_user_stmt)).scalar_one_or_none()
    if doc_user:
        await create_notification(
            db=db,
            user_id=doc_user.id,
            title="New Appointment Scheduled",
            message=f"New appointment {booking_num} booked by {patient_name} for {booking_date.strftime('%d %b %Y')} at {start_time}.",
            notification_type=NotificationType.APPOINTMENT,
            link=f"/admin",
            send_email=False
        )

    await db.commit()

    # Dispatch email
    await send_notification_email(
        email=current_user.email,
        title="Appointment Confirmation",
        message=f"Your appointment {booking_num} with Dr. {doctor.full_name} is confirmed for {booking_date.strftime('%A, %d %B %Y')} at {start_time}.",
        name=patient_name
    )

    return {
        "id": appointment.id,
        "appointment_number": booking_num,
        "doctor_id": doctor.id,
        "doctor_name": doctor.full_name,
        "specialty": doctor.specialty,
        "date": booking_date.isoformat(),
        "date_formatted": booking_date.strftime("%A, %d %B %Y"),
        "start_time": start_t.strftime("%H:%M"),
        "end_time": end_t.strftime("%H:%M"),
        "time_formatted": f"{start_t.strftime('%I:%M %p').lstrip('0')} - {end_t.strftime('%I:%M %p').lstrip('0')}",
        "status": "CONFIRMED",
        "consultation_mode": "Video consultation",
        "fee": doctor.consultation_fee,
        "reason": reason,
        "message": f"Appointment successfully confirmed with {doctor.full_name} for {booking_date.strftime('%A, %d %B %Y')} at {start_time}."
    }

async def tool_get_my_prescriptions(
    db: AsyncSession,
    current_patient: PatientProfile
) -> List[Dict[str, Any]]:
    """
    Retrieve all prescriptions for the authenticated patient.
    """
    stmt = (
        select(Prescription)
        .options(
            selectinload(Prescription.doctor),
            selectinload(Prescription.medicines)
        )
        .where(Prescription.patient_id == current_patient.id)
        .order_by(desc(Prescription.created_at))
    )
    res = await db.execute(stmt)
    prescriptions = res.scalars().all()

    return [
        {
            "id": p.id,
            "rx_number": p.rx_number,
            "doctor_id": p.doctor_id,
            "doctor_name": p.doctor.full_name if p.doctor else "Doctor",
            "doctor_specialty": p.doctor.specialty if p.doctor else "",
            "diagnosis": p.diagnosis,
            "notes": p.notes,
            "follow_up_date": p.follow_up_date.isoformat() if p.follow_up_date else None,
            "created_at": p.created_at.isoformat() if p.created_at else None,
            "medicines_count": len(p.medicines),
            "medicines": [
                {
                    "name": m.medicine_name,
                    "dosage": m.dosage,
                    "frequency": m.frequency,
                    "duration": m.duration,
                    "timing": m.timing.value if hasattr(m.timing, "value") else str(m.timing),
                    "instructions": m.instructions
                }
                for m in p.medicines
            ]
        }
        for p in prescriptions
    ]

async def tool_get_prescription_details(
    db: AsyncSession,
    current_patient: PatientProfile,
    prescription_id: int
) -> Optional[Dict[str, Any]]:
    """
    Retrieve details for a specific prescription.
    Enforces authorization: patient can only view their own prescription.
    """
    stmt = (
        select(Prescription)
        .options(
            selectinload(Prescription.doctor),
            selectinload(Prescription.medicines)
        )
        .where(Prescription.id == prescription_id)
    )
    res = await db.execute(stmt)
    p = res.scalar_one_or_none()

    if not p:
        return None

    if p.patient_id != current_patient.id:
        return {"error": "Unauthorized access to this prescription"}

    return {
        "id": p.id,
        "rx_number": p.rx_number,
        "doctor_id": p.doctor_id,
        "doctor_name": p.doctor.full_name if p.doctor else "Doctor",
        "doctor_specialty": p.doctor.specialty if p.doctor else "",
        "diagnosis": p.diagnosis,
        "notes": p.notes,
        "follow_up_date": p.follow_up_date.isoformat() if p.follow_up_date else None,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "medicines": [
            {
                "name": m.medicine_name,
                "dosage": m.dosage,
                "frequency": m.frequency,
                "duration": m.duration,
                "timing": m.timing.value if hasattr(m.timing, "value") else str(m.timing),
                "instructions": m.instructions
            }
            for m in p.medicines
        ]
    }

# Tool definitions for LiteLLM
CHATBOT_TOOLS_SPEC = [
    {
        "type": "function",
        "function": {
            "name": "search_doctors",
            "description": "Search for doctors by name, specialty, or hospital, or list all verified doctors.",
            "parameters": {
                "type": "object",
                "properties": {
                    "search": {"type": "string", "description": "Search query for doctor name or hospital"},
                    "specialty": {"type": "string", "description": "Filter by medical specialty (e.g. Cardiologist, Dermatologist)"}
                },
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_doctor_details",
            "description": "Get complete profile details and qualification for a specific doctor by doctor_id.",
            "parameters": {
                "type": "object",
                "properties": {
                    "doctor_id": {"type": "integer", "description": "ID of the doctor"}
                },
                "required": ["doctor_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_doctor_slots",
            "description": "Get available appointment slots for a doctor on a specific date (YYYY-MM-DD).",
            "parameters": {
                "type": "object",
                "properties": {
                    "doctor_id": {"type": "integer", "description": "ID of the doctor"},
                    "date": {"type": "string", "description": "Target date in YYYY-MM-DD format"}
                },
                "required": ["doctor_id", "date"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_my_appointments",
            "description": "Get all appointments for the currently logged-in patient.",
            "parameters": {
                "type": "object",
                "properties": {
                    "status": {"type": "string", "description": "Optional status filter (e.g. CONFIRMED, SCHEDULED, COMPLETED, CANCELLED)"}
                },
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_upcoming_appointment",
            "description": "Get the next upcoming appointment for the logged-in patient.",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_appointment_details",
            "description": "Get full details of a specific appointment by appointment_id.",
            "parameters": {
                "type": "object",
                "properties": {
                    "appointment_id": {"type": "integer", "description": "ID of the appointment"}
                },
                "required": ["appointment_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "prepare_booking_preview",
            "description": "Check availability and prepare an appointment booking preview for patient review before confirmation. Does not book immediately.",
            "parameters": {
                "type": "object",
                "properties": {
                    "doctor_id": {"type": "integer", "description": "ID of the doctor"},
                    "date": {"type": "string", "description": "Appointment date in YYYY-MM-DD format"},
                    "start_time": {"type": "string", "description": "Slot start time in HH:MM format (e.g. 10:30)"},
                    "slot_id": {"type": "integer", "description": "Optional slot ID"},
                    "reason": {"type": "string", "description": "Reason for appointment"}
                },
                "required": ["doctor_id", "date", "start_time"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "book_appointment",
            "description": "Confirm and book an appointment after the patient has explicitly confirmed the booking preview.",
            "parameters": {
                "type": "object",
                "properties": {
                    "doctor_id": {"type": "integer", "description": "ID of the doctor"},
                    "date": {"type": "string", "description": "Appointment date in YYYY-MM-DD format"},
                    "start_time": {"type": "string", "description": "Slot start time in HH:MM format"},
                    "slot_id": {"type": "integer", "description": "Optional slot ID"},
                    "reason": {"type": "string", "description": "Reason for appointment"}
                },
                "required": ["doctor_id", "date", "start_time"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_my_prescriptions",
            "description": "Get all digital prescriptions issued to the logged-in patient.",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_prescription_details",
            "description": "Get details and medicines of a specific digital prescription by prescription_id.",
            "parameters": {
                "type": "object",
                "properties": {
                    "prescription_id": {"type": "integer", "description": "ID of the prescription"}
                },
                "required": ["prescription_id"]
            }
        }
    }
]
