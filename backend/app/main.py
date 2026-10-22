import logging
from contextlib import asynccontextmanager
from typing import Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, status
from fastapi.middleware.cors import CORSMiddleware
import json
from datetime import datetime, timedelta

from app.core.config import settings
from app.core.security import decode_access_token, get_password_hash
from app.database import Base, sync_engine, AsyncSessionLocal
from app.models import *
from app.models.consultation import Consultation, ConsultationStatus
from app.models.user import User, UserRole
from app.models.appointment import Appointment
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from app.api import (
    auth, doctors, appointments, consultations,
    prescriptions, records, feedback, notifications, admin
)
from app.chatbot import router as chatbot_router
from app.websocket.signaling import signaling_manager

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("telemed_app")

async def ensure_admin_user():
    """
    Checks if administrator credentials exist in the database on startup.
    If not, automatically provisions the default administrator account.
    """
    try:
        async with AsyncSessionLocal() as session:
            stmt = select(User).where(
                (User.role == UserRole.ADMIN) |
                (User.username == settings.ADMIN_USERNAME) |
                (User.email == settings.ADMIN_EMAIL)
            )
            res = await session.execute(stmt)
            admin_user = res.scalars().first()

            if not admin_user:
                logger.info(f"[Startup] No admin account detected. Provisioning default admin ({settings.ADMIN_USERNAME})...")
                new_admin = User(
                    email=settings.ADMIN_EMAIL,
                    username=settings.ADMIN_USERNAME,
                    hashed_password=get_password_hash(settings.ADMIN_PASSWORD),
                    role=UserRole.ADMIN,
                    is_active=True,
                    is_verified=True
                )
                session.add(new_admin)
                await session.commit()
                logger.info(f"[Startup] ✔ Admin account created: username={settings.ADMIN_USERNAME}, email={settings.ADMIN_EMAIL}")
            else:
                # Ensure existing matched admin account retains admin role and active status
                updated = False
                if admin_user.role != UserRole.ADMIN:
                    admin_user.role = UserRole.ADMIN
                    updated = True
                if not admin_user.is_active or not admin_user.is_verified:
                    admin_user.is_active = True
                    admin_user.is_verified = True
                    updated = True
                if updated:
                    await session.commit()
                logger.info(f"[Startup] ✔ Admin account verified in database: username={admin_user.username}, email={admin_user.email}")
    except Exception as e:
        logger.error(f"[Startup] Failed to check/provision admin credentials: {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing Telemed Database tables...")
    try:
        Base.metadata.create_all(bind=sync_engine)
        from sqlalchemy import text
        with sync_engine.connect() as conn:
            conn.execute(text("ALTER TABLE consultations ADD COLUMN IF NOT EXISTS recording_url VARCHAR;"))
            conn.execute(text("ALTER TABLE consultations ADD COLUMN IF NOT EXISTS recording_duration_seconds INTEGER DEFAULT 0;"))
            conn.execute(text("ALTER TABLE consultations ADD COLUMN IF NOT EXISTS recording_size_bytes INTEGER DEFAULT 0;"))
            conn.execute(text("ALTER TABLE consultations ADD COLUMN IF NOT EXISTS recorded_at TIMESTAMPTZ;"))
            conn.commit()
        logger.info("Database tables and columns verified successfully.")
    except Exception as e:
        logger.error(f"Error creating database tables: {e}")

    # Check and initialize admin credentials
    await ensure_admin_user()

    yield
    logger.info("Telemed API server shutting down.")

app = FastAPI(
    title="Telemed Telemedicine API",
    description="Full-stack clinical telemedicine backend infrastructure supporting WebRTC video+audio signaling, appointment booking, digital prescriptions, and RBAC.",
    version="1.0.0",
    lifespan=lifespan
)

# CORS Configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static uploads
import os
from fastapi.staticfiles import StaticFiles

uploads_dir = os.path.join(os.getcwd(), "uploads")
os.makedirs(os.path.join(uploads_dir, "doctors"), exist_ok=True)
os.makedirs(os.path.join(uploads_dir, "recordings"), exist_ok=True)
app.mount("/uploads", StaticFiles(directory=uploads_dir), name="uploads")

# Include REST Routers
app.include_router(auth.router, prefix=settings.API_V1_STR)
app.include_router(doctors.router, prefix=settings.API_V1_STR)
app.include_router(appointments.router, prefix=settings.API_V1_STR)
app.include_router(consultations.router, prefix=settings.API_V1_STR)
app.include_router(prescriptions.router, prefix=settings.API_V1_STR)
app.include_router(records.router, prefix=settings.API_V1_STR)
app.include_router(feedback.router, prefix=settings.API_V1_STR)
app.include_router(notifications.router, prefix=settings.API_V1_STR)
app.include_router(admin.router, prefix=settings.API_V1_STR)
app.include_router(chatbot_router, prefix=settings.API_V1_STR)

@app.get("/health")
@app.get(f"{settings.API_V1_STR}/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "telemed-backend",
        "database": "postgresql-connected",
        "video_mode": "video-audio"
    }

# Helper for WebSocket Signaling
async def _handle_consultation_signaling(
    websocket: WebSocket,
    room_id: str,
    peer_id: Optional[str] = None,
    query_peer_id: Optional[str] = None,
    role: str = "PATIENT",
    name: str = "User",
    token: Optional[str] = None
):
    actual_peer_id = peer_id or query_peer_id or f"peer-{uuid.uuid4().hex[:8]}"
    user_id = None
    user_role = (role or "PATIENT").upper()

    # Validate JWT if provided
    if token:
        payload = decode_access_token(token)
        if not payload:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
        user_id = int(payload.get("sub"))
        user_role = payload.get("role", user_role).upper()

    # Verify Consultation Room in Database
    async with AsyncSessionLocal() as db:
        stmt = (
            select(Consultation)
            .options(
                selectinload(Consultation.doctor),
                selectinload(Consultation.patient),
                selectinload(Consultation.appointment)
            )
            .where(Consultation.room_id == room_id)
        )
        consultation = (await db.execute(stmt)).scalar_one_or_none()

        if not consultation:
            logger.warning(f"[Signaling] Attempted connection to non-existent consultation room: {room_id}")
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        # Enforce Authorization: Check if user is assigned patient or doctor
        if user_id:
            u_stmt = (
                select(User)
                .options(selectinload(User.patient_profile), selectinload(User.doctor_profile))
                .where(User.id == user_id)
            )
            user = (await db.execute(u_stmt)).scalar_one_or_none()
            if user:
                if user.role == UserRole.PATIENT:
                    if not user.patient_profile or consultation.patient_id != user.patient_profile.id:
                        logger.warning(f"[Signaling] Unauthorized patient {user_id} for room {room_id}")
                        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                        return
                elif user.role == UserRole.DOCTOR:
                    if not user.doctor_profile or consultation.doctor_id != user.doctor_profile.id:
                        logger.warning(f"[Signaling] Unauthorized doctor {user_id} for room {room_id}")
                        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                        return

        # If consultation is already active/started by doctor, permit immediate communication
        if consultation.status not in [ConsultationStatus.WAITING, ConsultationStatus.IN_PROGRESS]:
            if consultation.appointment and consultation.status != ConsultationStatus.COMPLETED:
                now_dt = datetime.now()
                start_dt = datetime.combine(consultation.appointment.date, consultation.appointment.start_time)
                end_dt = datetime.combine(consultation.appointment.date, consultation.appointment.end_time)

                if now_dt < start_dt - timedelta(minutes=15) or now_dt > end_dt + timedelta(minutes=30):
                    logger.warning(f"[Signaling] Room {room_id} accessed outside valid time window.")
                    await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                    return

    await signaling_manager.connect(
        websocket=websocket,
        room_id=room_id,
        participant_id=actual_peer_id,
        role=user_role,
        name=name
    )

    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            msg_type = message.get("type")

            # Attach sender info
            message["sender"] = actual_peer_id
            message["role"] = user_role
            message["name"] = name

            # Two-way video + audio WebRTC signaling
            if msg_type in ["offer", "answer", "ice-candidate", "call-ended", "ready-for-negotiation"]:
                await signaling_manager.broadcast_to_peer(room_id, actual_peer_id, message)
            elif msg_type == "join":
                logger.debug(f"[Signaling] Participant joined acknowledgment: {actual_peer_id}")
            else:
                logger.debug(f"Received non-relay signaling message: {msg_type}")

    except WebSocketDisconnect:
        await signaling_manager.disconnect(room_id, actual_peer_id)
    except Exception as e:
        logger.error(f"Signaling WebSocket error: {e}")
        await signaling_manager.disconnect(room_id, actual_peer_id)


# WebSocket Signaling Endpoints (Support both path peer_id and query peer_id)
@app.websocket("/ws/consultation/{room_id}")
async def websocket_consultation_signaling(
    websocket: WebSocket,
    room_id: str,
    peer_id: Optional[str] = Query(None, description="Unique participant ID"),
    role: str = Query("PATIENT", description="User role (PATIENT or DOCTOR)"),
    name: str = Query("User", description="Display name of user"),
    token: Optional[str] = Query(None, description="JWT Authentication Token")
):
    await _handle_consultation_signaling(
        websocket=websocket,
        room_id=room_id,
        peer_id=None,
        query_peer_id=peer_id,
        role=role,
        name=name,
        token=token
    )

@app.websocket("/ws/consultation/{room_id}/{peer_id}")
async def websocket_consultation_signaling_with_peer_id(
    websocket: WebSocket,
    room_id: str,
    peer_id: str,
    role: str = Query("PATIENT", description="User role (PATIENT or DOCTOR)"),
    name: str = Query("User", description="Display name of user"),
    token: Optional[str] = Query(None, description="JWT Authentication Token")
):
    await _handle_consultation_signaling(
        websocket=websocket,
        room_id=room_id,
        peer_id=peer_id,
        query_peer_id=None,
        role=role,
        name=name,
        token=token
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
