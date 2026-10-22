import random
import string
from datetime import datetime, timezone, timedelta
import os
import shutil
import subprocess
import uuid
import logging
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.database import get_async_db
from app.models.consultation import Consultation, ConsultationStatus
from app.models.appointment import Appointment, AppointmentStatus
from app.models.user import User, UserRole
from app.models.notification import NotificationType
from app.schemas.consultation import ConsultationResponse, ConsultationEnd
from app.services.notification_service import create_notification
from app.api.deps import get_current_verified_user, require_roles

logger = logging.getLogger("consultations_api")
router = APIRouter(prefix="/consultations", tags=["Consultations"])


def validate_time_window(
    appointment: Appointment,
    buffer_minutes_before: int = 10,
    buffer_minutes_after: int = 15
):
    """
    Validates that current server time is within the appointment's scheduled slot.
    Handles small clock differences with a reasonable buffer.
    """
    now_dt = datetime.now()
    start_dt = datetime.combine(appointment.date, appointment.start_time)
    end_dt = datetime.combine(appointment.date, appointment.end_time)

    if now_dt < start_dt - timedelta(minutes=buffer_minutes_before):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"Consultation not started yet. "
                f"Scheduled for {appointment.date.strftime('%d %b %Y')} "
                f"from {appointment.start_time.strftime('%H:%M')} "
                f"to {appointment.end_time.strftime('%H:%M')}."
            )
        )

    if now_dt > end_dt + timedelta(minutes=buffer_minutes_after):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"Consultation time slot has ended. "
                f"Scheduled was {appointment.start_time.strftime('%H:%M')} - "
                f"{appointment.end_time.strftime('%H:%M')}."
            )
        )


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

async def get_consultation_with_relationships(
    consultation_id: int,
    db: AsyncSession
) -> Consultation:
    """
    Always fetch a consultation with all relationships required by
    ConsultationResponse.

    This is important for AsyncSession because returning an ORM object with
    unloaded relationships can cause MissingGreenlet when FastAPI/Pydantic
    serializes the response.
    """
    stmt = (
        select(Consultation)
        .options(
            selectinload(Consultation.doctor),
            selectinload(Consultation.patient),
            selectinload(Consultation.appointment),
        )
        .where(Consultation.id == consultation_id)
    )

    result = await db.execute(stmt)
    consultation = result.scalar_one_or_none()

    if not consultation:
        raise HTTPException(
            status_code=404,
            detail="Consultation not found"
        )

    return consultation


# ---------------------------------------------------------------------------
# Start consultation
# ---------------------------------------------------------------------------

@router.post("/start/{appointment_id}", response_model=ConsultationResponse)
async def start_consultation_for_appointment(
    appointment_id: int,
    current_user: User = Depends(
        require_roles([UserRole.DOCTOR, UserRole.ADMIN])
    ),
    db: AsyncSession = Depends(get_async_db)
):
    """
    Doctor creates/starts the consultation record from the doctor panel.

    Patients CANNOT arbitrarily create consultation records.

    Enforces:
    - Time restriction
    - Doctor ownership
    - Existing consultation handling
    """

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
    appointment = res.scalar_one_or_none()

    if not appointment:
        raise HTTPException(
            status_code=404,
            detail="Appointment not found"
        )

    # Authorize: Only the assigned doctor or admin
    if current_user.role == UserRole.DOCTOR:
        if (
            not current_user.doctor_profile
            or appointment.doctor_id != current_user.doctor_profile.id
        ):
            raise HTTPException(
                status_code=403,
                detail="You are not the assigned doctor for this appointment"
            )

    # Validate time window
    validate_time_window(appointment)

    # -----------------------------------------------------------------------
    # IMPORTANT FIX:
    # If consultation already exists, DO NOT return appointment.consultation
    # directly. Reload it with all required relationships.
    # -----------------------------------------------------------------------

    if appointment.consultation:
        return await get_consultation_with_relationships(
            appointment.consultation.id,
            db
        )

    # -----------------------------------------------------------------------
    # Create new consultation
    # -----------------------------------------------------------------------

    room_id = (
        f"telemed-"
        f"{appointment.appointment_number.replace('#', '').lower()}"
    )

    consultation = Consultation(
        appointment_id=appointment.id,
        room_id=room_id,
        doctor_id=appointment.doctor_id,
        patient_id=appointment.patient_id,
        status=ConsultationStatus.WAITING,
        doctor_joined=True,
        doctor_joined_at=datetime.now(timezone.utc)
    )

    db.add(consultation)

    # Notify patient that consultation has been opened by doctor
    if appointment.patient and appointment.patient.user_id:
        doc_name = (
            appointment.doctor.full_name
            if appointment.doctor
            else "Doctor"
        )

        await create_notification(
            db=db,
            user_id=appointment.patient.user_id,
            title="Consultation Started",
            message=(
                f"Dr. {doc_name} has started your consultation room "
                f"({room_id}). You can join now."
            ),
            notification_type=NotificationType.CONSULTATION,
            link=f"/consultation/{room_id}"
        )

    await db.commit()

    # SQLAlchemy expires objects after commit in many configurations.
    # Therefore fetch a completely fresh instance with relationships.
    return await get_consultation_with_relationships(
        consultation.id,
        db
    )


# ---------------------------------------------------------------------------
# Get consultation by room
# ---------------------------------------------------------------------------

@router.get("/{room_id}", response_model=ConsultationResponse)
async def get_consultation_by_room(
    room_id: str,
    current_user: User = Depends(get_current_verified_user),
    db: AsyncSession = Depends(get_async_db)
):
    stmt = (
        select(Consultation)
        .options(
            selectinload(Consultation.doctor),
            selectinload(Consultation.patient),
            selectinload(Consultation.appointment)
        )
        .where(Consultation.room_id == room_id)
    )

    res = await db.execute(stmt)
    consultation = res.scalar_one_or_none()

    if not consultation:
        raise HTTPException(
            status_code=404,
            detail=(
                "Consultation room not found. "
                "Doctor must start the consultation first."
            )
        )

    # Verify authorization
    if current_user.role == UserRole.PATIENT:
        if (
            not current_user.patient_profile
            or consultation.patient_id != current_user.patient_profile.id
        ):
            raise HTTPException(
                status_code=403,
                detail="Not authorized to access this consultation room"
            )

    elif current_user.role == UserRole.DOCTOR:
        if (
            not current_user.doctor_profile
            or consultation.doctor_id != current_user.doctor_profile.id
        ):
            raise HTTPException(
                status_code=403,
                detail="Not authorized to access this consultation room"
            )

    # Enforce time restriction if appointment attached and not yet completed
    if (
        consultation.appointment
        and consultation.status != ConsultationStatus.COMPLETED
    ):
        validate_time_window(consultation.appointment)

    return consultation


# ---------------------------------------------------------------------------
# Join consultation
# ---------------------------------------------------------------------------

@router.post("/{room_id}/join", response_model=ConsultationResponse)
async def join_consultation(
    room_id: str,
    current_user: User = Depends(get_current_verified_user),
    db: AsyncSession = Depends(get_async_db)
):
    stmt = (
        select(Consultation)
        .options(
            selectinload(Consultation.doctor),
            selectinload(Consultation.patient),
            selectinload(Consultation.appointment)
        )
        .where(Consultation.room_id == room_id)
    )

    res = await db.execute(stmt)
    consultation = res.scalar_one_or_none()

    if not consultation:
        raise HTTPException(
            status_code=404,
            detail="Consultation room not found"
        )

    # Authorization Check
    if current_user.role == UserRole.PATIENT:
        if (
            not current_user.patient_profile
            or consultation.patient_id != current_user.patient_profile.id
        ):
            raise HTTPException(
                status_code=403,
                detail="Not authorized to join this consultation room"
            )

    elif current_user.role == UserRole.DOCTOR:
        if (
            not current_user.doctor_profile
            or consultation.doctor_id != current_user.doctor_profile.id
        ):
            raise HTTPException(
                status_code=403,
                detail="Not authorized to join this consultation room"
            )

    # Time window validation
    if (
        consultation.appointment
        and consultation.status != ConsultationStatus.COMPLETED
    ):
        validate_time_window(consultation.appointment)

    now = datetime.now(timezone.utc)

    if current_user.role == UserRole.DOCTOR:
        consultation.doctor_joined = True
        consultation.doctor_joined_at = now

    elif current_user.role == UserRole.PATIENT:
        consultation.patient_joined = True
        consultation.patient_joined_at = now

    if (
        consultation.doctor_joined_at
        and consultation.patient_joined_at
    ):
        consultation.status = ConsultationStatus.ACTIVE

        if not consultation.started_at:
            consultation.started_at = now

        if consultation.appointment:
            consultation.appointment.status = AppointmentStatus.IN_PROGRESS

    await db.commit()

    # IMPORTANT:
    # Do not use db.refresh(consultation) here because refresh() can leave
    # relationships unloaded and cause MissingGreenlet during serialization.
    return await get_consultation_with_relationships(
        consultation.id,
        db
    )


# ---------------------------------------------------------------------------
# End consultation
# ---------------------------------------------------------------------------

@router.post("/{room_id}/end", response_model=ConsultationResponse)
async def end_consultation(
    room_id: str,
    payload: ConsultationEnd = None,
    current_user: User = Depends(get_current_verified_user),
    db: AsyncSession = Depends(get_async_db)
):
    stmt = (
        select(Consultation)
        .options(
            selectinload(Consultation.doctor),
            selectinload(Consultation.patient),
            selectinload(Consultation.appointment)
        )
        .where(Consultation.room_id == room_id)
    )

    res = await db.execute(stmt)
    consultation = res.scalar_one_or_none()

    if not consultation:
        raise HTTPException(
            status_code=404,
            detail="Consultation room not found"
        )

    # Authorization Check
    if current_user.role == UserRole.PATIENT:
        if (
            not current_user.patient_profile
            or consultation.patient_id != current_user.patient_profile.id
        ):
            raise HTTPException(
                status_code=403,
                detail="Not authorized"
            )

    elif current_user.role == UserRole.DOCTOR:
        if (
            not current_user.doctor_profile
            or consultation.doctor_id != current_user.doctor_profile.id
        ):
            raise HTTPException(
                status_code=403,
                detail="Not authorized"
            )

    now = datetime.now(timezone.utc)

    consultation.ended_at = now
    consultation.status = ConsultationStatus.COMPLETED

    if consultation.started_at:
        duration = (
            now - consultation.started_at
        ).total_seconds()

        consultation.duration_seconds = max(
            int(duration),
            60
        )
    else:
        consultation.duration_seconds = 180

    if payload and payload.clinical_notes:
        consultation.clinical_notes = payload.clinical_notes

    if consultation.appointment:
        consultation.appointment.status = AppointmentStatus.COMPLETED

    # Notify patient that consultation has concluded
    if consultation.patient and consultation.patient.user_id:
        await create_notification(
            db=db,
            user_id=consultation.patient.user_id,
            title="Consultation Completed",
            message=(
                "Your video consultation has ended. "
                "Your doctor will issue your prescription shortly."
            ),
            notification_type=NotificationType.CONSULTATION,
            link="/records"
        )

    await db.commit()

    # IMPORTANT:
    # Reload relationships instead of db.refresh().
    return await get_consultation_with_relationships(
        consultation.id,
        db
    )


# ---------------------------------------------------------------------------
# Consultation Recording Upload & Secure Access (RBAC)
# ---------------------------------------------------------------------------

@router.post("/{room_id}/recording", response_model=ConsultationResponse)
async def upload_consultation_recording(
    room_id: str,
    file: UploadFile = File(...),
    duration_seconds: float = Form(0.0),
    current_user: User = Depends(get_current_verified_user),

    db: AsyncSession = Depends(get_async_db)
):
    """
    Uploads and stores the composite two-way audio + video recording of the consultation.
    Restricted to the assigned doctor, patient, or admin.
    """
    stmt = (
        select(Consultation)
        .options(
            selectinload(Consultation.doctor),
            selectinload(Consultation.patient),
            selectinload(Consultation.appointment)
        )
        .where(Consultation.room_id == room_id)
    )
    res = await db.execute(stmt)
    consultation = res.scalar_one_or_none()

    if not consultation:
        raise HTTPException(status_code=404, detail="Consultation not found")

    # Authorize: Only assigned patient, assigned doctor, or admin
    if current_user.role == UserRole.PATIENT:
        if not current_user.patient_profile or consultation.patient_id != current_user.patient_profile.id:
            raise HTTPException(status_code=403, detail="Not authorized to upload recording for this consultation")
    elif current_user.role == UserRole.DOCTOR:
        if not current_user.doctor_profile or consultation.doctor_id != current_user.doctor_profile.id:
            raise HTTPException(status_code=403, detail="Not authorized to upload recording for this consultation")
    elif current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Not authorized")

    # Prepare private secured storage directory
    backend_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    recordings_dir = os.path.join(backend_dir, "storage", "recordings")
    os.makedirs(recordings_dir, exist_ok=True)

    final_mp4_path = os.path.join(recordings_dir, f"recording_{consultation.id}_{room_id}.mp4")
    temp_file_path = os.path.join(recordings_dir, f"temp_{consultation.id}_{room_id}_{uuid.uuid4().hex[:6]}.webm")

    # Read and save incoming content to temporary file
    contents = await file.read()
    with open(temp_file_path, "wb") as f:
        f.write(contents)

    file_size = len(contents)

    # Transcode to universal MP4 (H.264 + AAC + faststart) using ffmpeg
    ffmpeg_bin = shutil.which("ffmpeg") or "/usr/bin/ffmpeg"
    if os.path.exists(ffmpeg_bin) and os.path.getsize(temp_file_path) > 0:
        try:
            ffmpeg_cmd = [
                ffmpeg_bin,
                "-y",
                "-i", temp_file_path,
                "-c:v", "libx264",
                "-preset", "veryfast",
                "-crf", "23",
                "-c:a", "aac",
                "-b:a", "128k",
                "-movflags", "+faststart",
                final_mp4_path
            ]
            proc = subprocess.run(ffmpeg_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)
            if proc.returncode == 0 and os.path.exists(final_mp4_path) and os.path.getsize(final_mp4_path) > 0:
                if os.path.exists(temp_file_path):
                    os.remove(temp_file_path)
                file_size = os.path.getsize(final_mp4_path)
                logger.info(f"[Recording] Transcoded consultation {consultation.id} recording to MP4 ({file_size} bytes)")
            else:
                logger.warning(f"[Recording] FFmpeg transcode non-zero exit ({proc.returncode}): {proc.stderr.decode('utf-8', errors='ignore')[:200]}")
                if os.path.exists(temp_file_path):
                    shutil.move(temp_file_path, final_mp4_path)
                    file_size = os.path.getsize(final_mp4_path)
        except Exception as fe:
            logger.error(f"[Recording] FFmpeg transcode exception: {fe}")
            if os.path.exists(temp_file_path):
                shutil.move(temp_file_path, final_mp4_path)
                file_size = os.path.getsize(final_mp4_path)
    else:
        if os.path.exists(temp_file_path):
            shutil.move(temp_file_path, final_mp4_path)
            file_size = os.path.getsize(final_mp4_path)

    consultation.recording_url = f"/api/consultations/{room_id}/recording"
    consultation.recording_duration_seconds = max(int(duration_seconds), consultation.duration_seconds)
    consultation.recording_size_bytes = file_size
    consultation.recorded_at = datetime.now(timezone.utc)

    await db.commit()
    return await get_consultation_with_relationships(consultation.id, db)


@router.get("/{room_id}/recording")
async def get_consultation_recording(
    room_id: str,
    current_user: User = Depends(get_current_verified_user),
    db: AsyncSession = Depends(get_async_db)
):
    """
    Securely streams/downloads the consultation recording.
    Enforces strict access control: accessible ONLY to the particular patient,
    particular doctor, and admin.
    """
    stmt = (
        select(Consultation)
        .where(Consultation.room_id == room_id)
    )
    res = await db.execute(stmt)
    consultation = res.scalar_one_or_none()

    if not consultation:
        raise HTTPException(status_code=404, detail="Consultation not found")

    # Strict Access Control Guard
    if current_user.role == UserRole.PATIENT:
        if not current_user.patient_profile or consultation.patient_id != current_user.patient_profile.id:
            raise HTTPException(
                status_code=403,
                detail="Access denied: You can only view recordings of your own consultations."
            )
    elif current_user.role == UserRole.DOCTOR:
        if not current_user.doctor_profile or consultation.doctor_id != current_user.doctor_profile.id:
            raise HTTPException(
                status_code=403,
                detail="Access denied: You can only view recordings of consultations you conducted."
            )
    elif current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=403,
            detail="Access denied: Administrative privileges required."
        )

    backend_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    search_dirs = [
        os.path.join(backend_dir, "storage", "recordings"),
        os.path.join(os.getcwd(), "uploads", "recordings"),
        os.path.join(backend_dir, "uploads", "recordings")
    ]
    file_path = None
    for s_dir in search_dirs:
        for ext in [".mp4", ".webm", ".ogg"]:
            candidate = os.path.join(s_dir, f"recording_{consultation.id}_{room_id}{ext}")
            if os.path.exists(candidate):
                file_path = candidate
                break
        if file_path:
            break

    if not file_path or not os.path.exists(file_path):
        raise HTTPException(
            status_code=404,
            detail="Recording video file not found on server storage."
        )

    media_type = "video/mp4" if file_path.endswith(".mp4") else ("video/webm" if file_path.endswith(".webm") else "application/octet-stream")
    return FileResponse(
        path=file_path,
        media_type=media_type,
        filename=f"telemed_consultation_{room_id}.mp4"
    )