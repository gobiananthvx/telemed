import random
import string
from datetime import datetime, time, timedelta, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, desc
from sqlalchemy.orm import selectinload
from datetime import date

from app.database import get_async_db
from app.models.appointment import Appointment, AppointmentStatus, ConsultationMode
from app.models.consultation import Consultation, ConsultationStatus
from app.models.doctor import DoctorProfile, DoctorSlot
from app.models.patient import PatientProfile
from app.models.user import User, UserRole
from app.models.notification import NotificationType
from app.schemas.appointment import AppointmentCreate, AppointmentResponse, AppointmentStatusUpdate
from app.services.notification_service import create_notification
from app.services.email_client import send_notification_email
from app.api.deps import get_current_user, get_current_verified_user, require_roles

router = APIRouter(prefix="/appointments", tags=["Appointments"])

def generate_booking_number() -> str:
    digits = "".join(random.choices(string.digits, k=4))
    return f"#TLM-BOK-{digits}"

@router.post("", response_model=AppointmentResponse)
@router.post("/book", response_model=AppointmentResponse)
async def book_appointment(
    payload: AppointmentCreate,
    current_user: User = Depends(get_current_verified_user),
    db: AsyncSession = Depends(get_async_db)
):
    # Determine patient profile
    if current_user.role == UserRole.PATIENT:
        if not current_user.patient_profile:
            raise HTTPException(status_code=400, detail="Patient profile not found. Please complete profile.")
        patient_id = current_user.patient_profile.id
    elif current_user.role == UserRole.ADMIN:
        # Admin booking on behalf of first patient or error
        p_stmt = select(PatientProfile).limit(1)
        p = (await db.execute(p_stmt)).scalar_one_or_none()
        if not p:
            raise HTTPException(status_code=400, detail="No patient found in system to assign booking.")
        patient_id = p.id
    else:
        raise HTTPException(status_code=403, detail="Only patients and administrators can book appointments.")

    # Validate Doctor
    doc_stmt = select(DoctorProfile).where(DoctorProfile.id == payload.doctor_id)
    doctor = (await db.execute(doc_stmt)).scalar_one_or_none()
    if not doctor:
        raise HTTPException(status_code=404, detail="Doctor not found")

    # Parse start time and compute end time
    try:
        parts = [int(p) for p in payload.start_time.split(":")]
        start_t = time(parts[0], parts[1])
        start_dt = datetime.combine(payload.date, start_t)
        end_dt = start_dt + timedelta(minutes=30)
        end_t = end_dt.time()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid start_time format. Use HH:MM")

    slot = None
    if payload.slot_id:
        slot_stmt = select(DoctorSlot).where(
            DoctorSlot.id == payload.slot_id,
            DoctorSlot.doctor_id == payload.doctor_id
        )
        slot = (await db.execute(slot_stmt)).scalar_one_or_none()
        if not slot or not slot.is_available:
            raise HTTPException(status_code=400, detail="The selected time slot is no longer available.")
        if slot.date < datetime.now().date() or (slot.date == datetime.now().date() and slot.start_time <= datetime.now().time()):
            raise HTTPException(status_code=400, detail="Cannot book an appointment for a past time slot.")
        start_t = slot.start_time
        end_t = slot.end_time
        payload.date = slot.date
    else:
        slot_stmt = select(DoctorSlot).where(
            DoctorSlot.doctor_id == payload.doctor_id,
            DoctorSlot.date == payload.date,
            DoctorSlot.start_time == start_t
        )
        slot = (await db.execute(slot_stmt)).scalar_one_or_none()
        if slot:
            if not slot.is_available:
                raise HTTPException(status_code=409, detail=f"This time slot ({payload.start_time}) is already booked.")
            end_t = slot.end_time

    # DOUBLE BOOKING PREVENTION
    conflict_stmt = (
        select(Appointment)
        .where(
            Appointment.doctor_id == payload.doctor_id,
            Appointment.date == payload.date,
            Appointment.start_time == start_t,
            Appointment.status.notin_([AppointmentStatus.CANCELLED, AppointmentStatus.MISSED])
        )
    )
    conflict = (await db.execute(conflict_stmt)).scalar_one_or_none()
    if conflict:
        raise HTTPException(
            status_code=409,
            detail=f"This time slot ({payload.start_time}) with {doctor.full_name} is already booked. Please select another slot."
        )

    if slot:
        slot.is_available = False

    # Generate unique appointment number
    booking_num = generate_booking_number()
    while (await db.execute(select(Appointment).where(Appointment.appointment_number == booking_num))).scalar_one_or_none():
        booking_num = generate_booking_number()

    appointment = Appointment(
        appointment_number=booking_num,
        patient_id=patient_id,
        doctor_id=payload.doctor_id,
        slot_id=slot.id if slot else None,
        date=payload.date,
        start_time=start_t,
        end_time=end_t,
        status=AppointmentStatus.CONFIRMED, # Confirmed upon booking
        consultation_mode=payload.consultation_mode,
        reason=payload.reason,
        fee=doctor.consultation_fee,
        payment_status="PAID"
    )
    db.add(appointment)
    await db.flush()

    # Create in-app notifications
    patient_name = current_user.patient_profile.full_name if current_user.patient_profile else "Patient"

    # Notification for patient
    await create_notification(
        db=db,
        user_id=current_user.id,
        title="Appointment Confirmed",
        message=f"Your video consultation with Dr. {doctor.full_name} is confirmed for {payload.date.strftime('%d %b %Y')} at {payload.start_time}.",
        notification_type=NotificationType.APPOINTMENT,
        link=f"/booking-confirmation/{appointment.id}",
        send_email=False # We send direct custom appointment email below
    )

    # Notification for doctor user
    doc_user_stmt = select(User).where(User.id == doctor.user_id)
    doc_user = (await db.execute(doc_user_stmt)).scalar_one_or_none()
    if doc_user:
        await create_notification(
            db=db,
            user_id=doc_user.id,
            title="New Appointment Scheduled",
            message=f"New appointment {booking_num} booked by {patient_name} for {payload.date.strftime('%d %b %Y')} at {payload.start_time}.",
            notification_type=NotificationType.APPOINTMENT,
            link=f"/admin",
            send_email=False # We send direct custom doctor email below
        )

    await db.commit()

    # Reload with relationships
    stmt = (
        select(Appointment)
        .options(
            selectinload(Appointment.doctor),
            selectinload(Appointment.patient),
            selectinload(Appointment.consultation)
        )
        .where(Appointment.id == appointment.id)
    )
    res = await db.execute(stmt)
    full_appt = res.scalar_one()

    # Dispatch email notifications to patient and doctor (Section 14)
    await send_notification_email(
        email=current_user.email,
        title="Appointment Confirmation",
        message=f"Your appointment {booking_num} with Dr. {doctor.full_name} is confirmed for {payload.date.strftime('%A, %d %B %Y')} at {payload.start_time}.",
        name=patient_name
    )

    if doc_user and doc_user.email:
        await send_notification_email(
            email=doc_user.email,
            title="New Appointment Booked",
            message=f"New appointment {booking_num} has been booked by {patient_name} for {payload.date.strftime('%A, %d %B %Y')} at {payload.start_time}. Status: Confirmed.",
            name=f"Dr. {doctor.full_name}"
        )

    response_data = AppointmentResponse.model_validate(full_appt)
    if full_appt.consultation:
        response_data.room_id = full_appt.consultation.room_id
    return response_data

async def update_missed_appointments(appointments: List[Appointment], db: AsyncSession):
    now_dt = datetime.now()
    changed = False
    for a in appointments:
        if a.status in [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED]:
            appt_end = datetime.combine(a.date, a.end_time)
            if now_dt > appt_end + timedelta(minutes=15):
                a.status = AppointmentStatus.MISSED
                if a.consultation and a.consultation.status in [ConsultationStatus.WAITING, ConsultationStatus.SCHEDULED]:
                    a.consultation.status = ConsultationStatus.MISSED
                changed = True
    if changed:
        await db.commit()

@router.get("", response_model=List[AppointmentResponse])
async def list_appointments(
    status_filter: Optional[AppointmentStatus] = Query(None, alias="status"),
    current_user: User = Depends(get_current_verified_user),
    db: AsyncSession = Depends(get_async_db)
):
    stmt = (
        select(Appointment)
        .options(
            selectinload(Appointment.doctor),
            selectinload(Appointment.patient),
            selectinload(Appointment.consultation)
        )
    )

    if current_user.role == UserRole.PATIENT:
        if not current_user.patient_profile:
            return []
        stmt = stmt.where(Appointment.patient_id == current_user.patient_profile.id)
    elif current_user.role == UserRole.DOCTOR:
        if not current_user.doctor_profile:
            return []
        stmt = stmt.where(Appointment.doctor_id == current_user.doctor_profile.id)
    # Admin sees all appointments

    if status_filter:
        stmt = stmt.where(Appointment.status == status_filter)

    stmt = stmt.order_by(desc(Appointment.date), desc(Appointment.start_time))
    res = await db.execute(stmt)
    appointments = res.scalars().all()
    await update_missed_appointments(appointments, db)

    result = []
    for appt in appointments:
        data = AppointmentResponse.model_validate(appt)
        if appt.consultation:
            data.room_id = appt.consultation.room_id
        result.append(data)
    return result

@router.get("/upcoming", response_model=Optional[AppointmentResponse])
async def get_next_upcoming_appointment(
    current_user: User = Depends(get_current_verified_user),
    db: AsyncSession = Depends(get_async_db)
):
    today = date.today()
    stmt = (
        select(Appointment)
        .options(
            selectinload(Appointment.doctor),
            selectinload(Appointment.patient),
            selectinload(Appointment.consultation)
        )
        .where(
            Appointment.status.in_([AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED, AppointmentStatus.IN_PROGRESS]),
            Appointment.date >= today
        )
    )

    if current_user.role == UserRole.PATIENT:
        if not current_user.patient_profile:
            return None
        stmt = stmt.where(Appointment.patient_id == current_user.patient_profile.id)
    elif current_user.role == UserRole.DOCTOR:
        if not current_user.doctor_profile:
            return None
        stmt = stmt.where(Appointment.doctor_id == current_user.doctor_profile.id)

    stmt = stmt.order_by(Appointment.date.asc(), Appointment.start_time.asc()).limit(1)
    res = await db.execute(stmt)
    appt = res.scalar_one_or_none()

    if not appt:
        return None

    data = AppointmentResponse.model_validate(appt)
    if appt.consultation:
        data.room_id = appt.consultation.room_id
    return data

@router.get("/{appointment_id}", response_model=AppointmentResponse)
async def get_appointment(
    appointment_id: int,
    current_user: User = Depends(get_current_verified_user),
    db: AsyncSession = Depends(get_async_db)
):
    stmt = (
        select(Appointment)
        .options(
            selectinload(Appointment.doctor),
            selectinload(Appointment.patient),
            selectinload(Appointment.consultation)
        )
        .where(Appointment.id == appointment_id)
    )
    res = await db.execute(stmt)
    appt = res.scalar_one_or_none()

    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found")

    # Access check: patient can only view their own, doctor can only view theirs, admin views all
    if current_user.role == UserRole.PATIENT:
        if not current_user.patient_profile or appt.patient_id != current_user.patient_profile.id:
            raise HTTPException(status_code=403, detail="Access forbidden")
    elif current_user.role == UserRole.DOCTOR:
        if not current_user.doctor_profile or appt.doctor_id != current_user.doctor_profile.id:
            raise HTTPException(status_code=403, detail="Access forbidden")

    data = AppointmentResponse.model_validate(appt)
    if appt.consultation:
        data.room_id = appt.consultation.room_id
    return data

@router.patch("/{appointment_id}/status", response_model=AppointmentResponse)
async def update_appointment_status(
    appointment_id: int,
    payload: AppointmentStatusUpdate,
    current_user: User = Depends(get_current_verified_user),
    db: AsyncSession = Depends(get_async_db)
):
    stmt = (
        select(Appointment)
        .options(
            selectinload(Appointment.doctor),
            selectinload(Appointment.patient),
            selectinload(Appointment.consultation)
        )
        .where(Appointment.id == appointment_id)
    )
    res = await db.execute(stmt)
    appt = res.scalar_one_or_none()

    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found")

    appt.status = payload.status
    if payload.status == AppointmentStatus.COMPLETED and appt.consultation:
        appt.consultation.status = ConsultationStatus.COMPLETED
        if not appt.consultation.ended_at:
            appt.consultation.ended_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(appt)

    data = AppointmentResponse.model_validate(appt)
    if appt.consultation:
        data.room_id = appt.consultation.room_id
    return data
