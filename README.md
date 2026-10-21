# Telemed — Full-Stack Telemedicine & Clinical Healthcare Platform

A production-grade, full-stack telemedicine web application built according to the **Clinical Calm & Vitality** design system. Supports end-to-end patient care journeys, real-time WebRTC video consultations (strictly video-only), digital prescriptions, role-based access control (Patient, Doctor, Admin), and automated email notifications.

---

## 🏗️ System Architecture & Port Allocation

| Component | Technology Stack | Internal Port | Host Port | Purpose |
|---|---|:---:|:---:|---|
| **Database** | PostgreSQL 16 | 5432 | `5434` | Relational clinical data & audit store |
| **Backend API** | FastAPI + SQLAlchemy 2.0 (Async) | 8000 | `8000` | REST endpoints, WebRTC signaling hub, and native Python SMTP email delivery |
| **Frontend UI** | React 19 + Vite + Tailwind CSS | 5173 | `5173` | Patient portal & Admin/Doctor dashboard |

> **Note on Database Port**: Host port `5434` is used (`5434:5432`) to prevent port collision with other local database instances.

---

## 📋 Prerequisites

- **Docker** and **Docker Compose**
- **Node.js** v18.0+ and **npm** v9.0+
- **Python** 3.11+

---

## 🚀 Quick Start Setup Guide

### 1. Environment Setup

Ensure the root `.env` file exists with the following configuration (or copy from `.env.example`):

```env
# Database
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=telemed_db
POSTGRES_PORT=5434
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5434/telemed_db
SYNC_DATABASE_URL=postgresql://postgres:postgres@localhost:5434/telemed_db

# Security & JWT
JWT_SECRET=telemed_super_secret_jwt_key_clinical_calm_2026
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=1440

# Admin Credentials (Auto-verified and created on backend start if missing)
ADMIN_USERNAME=admin
ADMIN_EMAIL=admin@telemed.com
ADMIN_PASSWORD=admin

# Native Python Email Service (SMTP)
SMTP_HOST=smtp.ethereal.email
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_TLS=true
EMAIL_FROM=no-reply@telemed.com

CORS_ORIGINS=["http://localhost:5173","http://127.0.0.1:5173","http://localhost:8000","http://127.0.0.1:8000"]
```

---

### 2. Start PostgreSQL Database

Launch the PostgreSQL 16 container via Docker Compose:

```bash
docker compose up -d
```

Verify container status:
```bash
docker ps --filter "name=telemed-postgres"
```

---

### 3. Setup & Start Backend API

In a separate terminal window:

```bash
cd backend

# Create and activate Python virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Start FastAPI server with Uvicorn (Admin credentials and tables are auto-initialized on startup)
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```
*API documentation is available at `http://localhost:8000/docs`.*
*On startup, the backend automatically initializes database tables and verifies or creates default Administrator credentials (`admin` / `admin`).*


---

### 4. Setup & Start Frontend Application

In a separate terminal window:

```bash
cd frontend
npm install
npm run dev
```
*The web client will launch at `http://localhost:5173`.*

---

## 🔐 Default Test Credentials

| Role | Username / Identifier | Password | Access Portal |
|---|---|---|---|
| **Administrator** | `admin` or `admin@telemed.com` | `admin` | `http://localhost:5173/admin` |
| **Doctor** | `dr.priya@telemed.com` | `doctorpassword123` | `http://localhost:5173/admin` |
| **Doctor** | `dr.rajesh@telemed.com` | `doctorpassword123` | `http://localhost:5173/admin` |
| **Patient** | `arjun.kumar@telemed.com` | `patientpassword123` | `http://localhost:5173/signin` |

---

## 🧹 Database Reset Utility

To completely purge all data from all database tables and reset sequence counters:

```bash
./reset_db.sh
```

When the FastAPI server starts, only the default Administrator account (`admin` / `admin`) is provisioned. No sample doctors, patients, or appointments are created.

---

## 🧪 Running Automated End-to-End Tests

Execute the comprehensive test suite covering all 12 operational flows:

```bash
cd backend
source venv/bin/activate
PYTHONPATH=. python3 tests/test_e2e.py
```

The test suite validates:
1. System & microservice health checks
2. Admin & Doctor direct authentication (no OTP required)
3. Patient login and profile hydration (UHID assignment)
4. Patient registration with 6-digit email OTP verification
5. Doctor search, filtering, and 30-minute dynamic slot generation
6. Appointment scheduling and double-booking conflict rejection (HTTP 409)
7. WebRTC Video-Only peer signaling (SDP offer/answer, ICE trickling, in-call chat, live vitals)
8. Digital prescription generation and medical records linkage
9. Post-consultation 5-star feedback and dynamic doctor rating recalculation
10. Admin doctor onboarding without OTP
11. Admin analytics and platform statistics
12. Notification delivery and state management

---

## 💡 Key Architectural Details

- **Video-Only Consultations**: Audio tracks and microphone permissions are explicitly disabled across the WebRTC implementation (`getUserMedia({ video: true, audio: false })`), ensuring compliance with video-only clinical specifications. A fallback animated canvas stream is provided for camera-less testing environments.
- **Authentication Separation**:
  - **Patients**: Register via email, undergo mandatory 6-digit numeric OTP verification, and log in at `/signin`.
  - **Doctors & Admin**: Created directly by Admin with immediate verification; log in with email/password directly at `/admin` without OTP.
- **Conflict-Free Scheduling**: Slot engine detects existing appointments on a given date and rejects conflicting bookings with an HTTP 409 Conflict exception.
