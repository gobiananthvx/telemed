import asyncio
import io
import os
import random
import sys
from datetime import date, datetime, timedelta, time

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import httpx
from sqlalchemy import select
from app.main import app
from app.database import AsyncSessionLocal, sync_engine, Base
from app.models import (
    User, UserRole, DoctorProfile, PatientProfile, DoctorSlot,
    Appointment, AppointmentStatus, ConsultationMode,
    Consultation, ConsultationStatus
)
from app.core.security import create_access_token

async def test_recording_and_security():
    print("=" * 70)
    print("🎥 TESTING CONSULTATION RECORDING & ACCESS CONTROL SUITE")
    print("=" * 70)

    Base.metadata.create_all(bind=sync_engine)

    unique_id = random.randint(100000, 999999)

    async with AsyncSessionLocal() as db:
        # Create Doctor 1 (Assigned)
        doc_user = User(
            email=f"assigned.doctor.{unique_id}@telemed.com",
            hashed_password="hashed_pass",
            role=UserRole.DOCTOR,
            is_active=True,
            is_verified=True
        )
        db.add(doc_user)
        await db.flush()

        doctor = DoctorProfile(
            user_id=doc_user.id,
            full_name=f"Dr. Assigned {unique_id}",
            qualification="MBBS, MD",
            specialty="General Physician",
            experience_years=8,
            hospital_name="Apollo Hospital",
            consultation_fee=400.0,
            bio="Experienced general physician",
            is_verified=True,
            city="Chennai"
        )
        db.add(doctor)
        await db.flush()

        # Create Doctor 2 (Unassigned / Other doctor)
        doc2_user = User(
            email=f"other.doctor.{unique_id}@telemed.com",
            hashed_password="hashed_pass",
            role=UserRole.DOCTOR,
            is_active=True,
            is_verified=True
        )
        db.add(doc2_user)
        await db.flush()

        doctor2 = DoctorProfile(
            user_id=doc2_user.id,
            full_name=f"Dr. Other {unique_id}",
            qualification="MBBS",
            specialty="Dermatologist",
            experience_years=5,
            hospital_name="Fortis Hospital",
            consultation_fee=350.0,
            bio="Dermatologist",
            is_verified=True,
            city="Chennai"
        )
        db.add(doctor2)
        await db.flush()

        # Create Patient 1 (Assigned)
        p1_user = User(
            email=f"assigned.patient.{unique_id}@telemed.com",
            hashed_password="hashed_pass",
            role=UserRole.PATIENT,
            is_active=True,
            is_verified=True
        )
        db.add(p1_user)
        await db.flush()

        patient1 = PatientProfile(
            user_id=p1_user.id,
            full_name=f"Assigned Patient {unique_id}",
            phone="9876543220",
            uhid=f"#TLM-REC-{unique_id}",
            city="Chennai"
        )
        db.add(patient1)
        await db.flush()

        # Create Patient 2 (Unassigned / Other patient)
        p2_user = User(
            email=f"other.patient.{unique_id}@telemed.com",
            hashed_password="hashed_pass",
            role=UserRole.PATIENT,
            is_active=True,
            is_verified=True
        )
        db.add(p2_user)
        await db.flush()

        patient2 = PatientProfile(
            user_id=p2_user.id,
            full_name=f"Other Patient {unique_id}",
            phone="9876543221",
            uhid=f"#TLM-REC-{unique_id+1}",
            city="Chennai"
        )
        db.add(patient2)
        await db.flush()

        # Create Admin
        admin_user = (await db.execute(select(User).where(User.role == UserRole.ADMIN))).scalars().first()
        if not admin_user:
            admin_user = User(
                email=f"admin.{unique_id}@telemed.com",
                hashed_password="hashed_pass",
                role=UserRole.ADMIN,
                is_active=True,
                is_verified=True
            )
            db.add(admin_user)
            await db.flush()

        # Create Appointment & Consultation
        tomorrow = date.today() + timedelta(days=1)
        appt = Appointment(
            appointment_number=f"#TLM-BOK-REC-{unique_id}",
            patient_id=patient1.id,
            doctor_id=doctor.id,
            date=tomorrow,
            start_time=time(11, 0),
            end_time=time(11, 30),
            status=AppointmentStatus.CONFIRMED,
            consultation_mode=ConsultationMode.VIDEO,
            fee=400.0,
            payment_status="PAID"
        )
        db.add(appt)
        await db.flush()

        room_id = f"room-rec-{unique_id}"
        consultation = Consultation(
            room_id=room_id,
            appointment_id=appt.id,
            patient_id=patient1.id,
            doctor_id=doctor.id,
            status=ConsultationStatus.COMPLETED
        )
        db.add(consultation)
        await db.commit()

        # Create JWT Tokens
        token_patient1 = create_access_token(subject=str(p1_user.id), role="PATIENT")
        token_patient2 = create_access_token(subject=str(p2_user.id), role="PATIENT")
        token_doctor1 = create_access_token(subject=str(doc_user.id), role="DOCTOR")
        token_doctor2 = create_access_token(subject=str(doc2_user.id), role="DOCTOR")
        token_admin = create_access_token(subject=str(admin_user.id), role="ADMIN")

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        # TEST A: Upload Consultation Recording (Simulating Doctor / Meet-Recorder Upload)
        print("\n[TEST A] Uploading Two-Way Consultation Recording...")
        fake_video_bytes = b"\x1a\x45\xdf\xa3" + b"TelemedVideoRecordingStreamPayloadData" * 100
        files = {
            "file": ("consultation_recording.webm", io.BytesIO(fake_video_bytes), "video/webm")
        }
        data = {
            "duration_seconds": "185.5"
        }
        r_upload = await client.post(
            f"/api/consultations/{room_id}/recording",
            data=data,
            files=files,
            headers={"Authorization": f"Bearer {token_doctor1}"}
        )
        assert r_upload.status_code == 200, f"Upload failed: {r_upload.text}"
        res_json = r_upload.json()
        assert res_json["recording_url"] == f"/api/consultations/{room_id}/recording"
        assert res_json["recording_duration_seconds"] >= 185
        assert res_json["recording_size_bytes"] == len(fake_video_bytes)
        print("✅ Recording upload verified: metadata saved in DB and file stored securely")

        # TEST B: Assigned Patient Access
        print("\n[TEST B] Testing Access Control for Assigned Patient...")
        r_p1 = await client.get(
            f"/api/consultations/{room_id}/recording",
            headers={"Authorization": f"Bearer {token_patient1}"}
        )
        assert r_p1.status_code == 200
        assert r_p1.content == fake_video_bytes
        print("✅ Assigned patient successfully accessed their consultation recording")

        # TEST C: Assigned Doctor Access
        print("\n[TEST C] Testing Access Control for Assigned Doctor...")
        r_doc1 = await client.get(
            f"/api/consultations/{room_id}/recording",
            headers={"Authorization": f"Bearer {token_doctor1}"}
        )
        assert r_doc1.status_code == 200
        assert r_doc1.content == fake_video_bytes
        print("✅ Assigned doctor successfully accessed the consultation recording")

        # TEST D: Admin Access
        print("\n[TEST D] Testing Access Control for System Administrator...")
        r_admin = await client.get(
            f"/api/consultations/{room_id}/recording",
            headers={"Authorization": f"Bearer {token_admin}"}
        )
        assert r_admin.status_code == 200
        assert r_admin.content == fake_video_bytes
        print("✅ Administrator successfully accessed the consultation recording")

        # TEST E: Unauthorized Patient Access Blocked (RBAC)
        print("\n[TEST E] Testing Security Guardrail: Other Patient Access Attempt...")
        r_p2 = await client.get(
            f"/api/consultations/{room_id}/recording",
            headers={"Authorization": f"Bearer {token_patient2}"}
        )
        assert r_p2.status_code == 403
        assert "Access denied" in r_p2.json()["detail"] or "only view recordings of your own" in r_p2.json()["detail"]
        print("✅ Cross-patient unauthorized recording access blocked (403 Forbidden)")

        # TEST F: Unauthorized Doctor Access Blocked (RBAC)
        print("\n[TEST F] Testing Security Guardrail: Other Doctor Access Attempt...")
        r_doc2 = await client.get(
            f"/api/consultations/{room_id}/recording",
            headers={"Authorization": f"Bearer {token_doctor2}"}
        )
        assert r_doc2.status_code == 403
        assert "Access denied" in r_doc2.json()["detail"] or "only view recordings of consultations you conducted" in r_doc2.json()["detail"]
        print("✅ Cross-doctor unauthorized recording access blocked (403 Forbidden)")

        # TEST G: Unauthenticated Access Blocked
        print("\n[TEST G] Testing Security Guardrail: Unauthenticated Request...")
        r_anon = await client.get(f"/api/consultations/{room_id}/recording")
        assert r_anon.status_code == 401
        print("✅ Anonymous recording access blocked (401 Unauthorized)")

        # TEST H: Query Token Access (for HTML5 <video src="...?token=...">)
        print("\n[TEST H] Testing Media Streaming via Query Token Authentication...")
        r_query = await client.get(f"/api/consultations/{room_id}/recording?token={token_patient1}")
        assert r_query.status_code == 200
        assert r_query.content == fake_video_bytes
        print("✅ HTML5 media query token streaming passed (200 OK with correct stream content)")

        # TEST I: Appointment Response Includes Recording Metadata
        print("\n[TEST I] Testing Appointment List Serialization with Recording URL...")
        r_appts = await client.get("/api/appointments", headers={"Authorization": f"Bearer {token_patient1}"})
        assert r_appts.status_code == 200
        appts_data = r_appts.json()
        target_appt = next((a for a in appts_data if a["appointment_number"] == appt.appointment_number), None)
        assert target_appt is not None
        assert target_appt["recording_url"] == f"/api/consultations/{room_id}/recording"
        assert target_appt["recording_duration_seconds"] >= 185
        print("✅ Appointments API returns recording metadata for patient UI playback")

    print("\n🎉 ALL RECORDING & ACCESS CONTROL TESTS PASSED WITH 100% SUCCESS!")

if __name__ == "__main__":
    asyncio.run(test_recording_and_security())
