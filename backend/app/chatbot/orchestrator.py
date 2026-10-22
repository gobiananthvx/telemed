import difflib
import json
import logging
import re
import uuid
from datetime import date, datetime, timedelta
from typing import Dict, Any, Optional, List, Tuple
from zoneinfo import ZoneInfo
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models.patient import PatientProfile
from app.models.user import User
from app.models.chat import ChatSession, ChatMessage
from app.chatbot.prompts import (
    get_system_prompt,
    OUT_OF_SCOPE_REFUSAL,
    MEDICAL_ADVICE_REFUSAL
)
from app.chatbot.schemas import (
    ChatResponse,
    ChatResponseType
)
from app.chatbot.tools import (
    tool_search_doctors,
    tool_get_doctor_details,
    tool_get_doctor_slots,
    tool_get_my_appointments,
    tool_get_upcoming_appointment,
    tool_get_appointment_details,
    tool_prepare_booking_preview,
    tool_book_appointment,
    tool_cancel_appointment,
    tool_get_my_prescriptions,
    tool_get_prescription_details,
    tool_get_medical_records,
    CHATBOT_TOOLS_SPEC
)
from app.chatbot.llm import call_llm

logger = logging.getLogger("telemed_chatbot")

# In-memory session context for multi-turn short-term state
# session_id -> { selected_doctor_id, selected_doctor_name, selected_date, displayed_slots, pending_booking, ... }
SESSION_CONTEXT: Dict[str, Dict[str, Any]] = {}

def get_current_ist_datetime() -> datetime:
    tz = ZoneInfo(settings.CHATBOT_TIMEZONE or "Asia/Kolkata")
    return datetime.now(tz)

# Clinical specialty and symptom mapping with typo tolerance
SPECIALTY_SYMPTOMS = {
    "Cardiologist": [
        "heart", "chest pain", "cardio", "cardiac", "blood pressure", "hypertension",
        "palpitations", "ecg", "heart attack", "angina", "cardiologst", "cardologist",
        "cardiologist", "cardiology", "heart doctor"
    ],
    "Dermatologist": [
        "skin", "rash", "acne", "pimple", "itching", "eczema", "psoriasis",
        "allergy", "hair loss", "scalp", "dermatolgy", "dermotologist",
        "dermatologist", "dermatologst", "skin doctor"
    ],
    "Pediatrician": [
        "child", "baby", "infant", "kid", "toddler", "pediatric", "pediatrics",
        "pediatritian", "pediatrician", "paediatrician", "child health", "baby doctor"
    ],
    "General Physician": [
        "fever", "cough", "cold", "flu", "headache", "stomach pain", "vomiting",
        "diarrhea", "body pain", "weakness", "infection", "physician", "general",
        "general physician", "gp", "doctor", "family doctor", "checkup", "ill", "sick"
    ],
    "Orthopedic": [
        "bone", "joint", "fracture", "knee", "back pain", "spine", "arthritis",
        "shoulder", "ligament", "ortho", "orthopedic", "orthopaedic", "bone doctor"
    ],
    "Neurologist": [
        "brain", "nerve", "headache", "migraine", "stroke", "dizziness",
        "seizure", "epilepsy", "neuro", "neurologist", "neurology", "nerve doctor"
    ],
    "Gynecologist": [
        "women", "pregnancy", "pregnant", "period", "menstrual", "pcod", "pcos",
        "uterus", "fertility", "gyno", "gynecologist", "gynaecologist", "gynecology"
    ],
    "Ophthalmologist": [
        "eye", "vision", "blur", "cataract", "glaucoma", "optometrist",
        "ophthalmologist", "opthalmologist", "eye doctor"
    ],
    "ENT Specialist": [
        "ear", "nose", "throat", "sinus", "tonsils", "hearing", "tinnitus",
        "snoring", "ent", "ent specialist"
    ],
    "Psychiatrist": [
        "mental", "anxiety", "depression", "stress", "sleep", "insomnia",
        "panic", "psychiatrist", "psychology", "mental health"
    ],
    "Oncologist": [
        "cancer", "tumor", "chemotherapy", "oncologist", "oncology"
    ],
    "Pulmonologist": [
        "lung", "breathing", "asthma", "breathless", "pneumonia", "pulmonologist",
        "pulmonology", "chest physician"
    ]
}

def detect_specialty_from_text(text: str) -> Optional[str]:
    """
    Detects clinical specialty by exact keywords, synonyms, and typo-tolerant fuzzy matching.
    """
    text_lower = text.lower()
    tokens = re.findall(r"\b[a-zA-Z]{3,}\b", text_lower)

    # 1. Direct substring search
    for spec, keywords in SPECIALTY_SYMPTOMS.items():
        for kw in keywords:
            if kw in text_lower:
                return spec

    # 2. Fuzzy matching on individual tokens to catch typos (e.g. 'cardilologist', 'dermatolgy')
    all_keywords_flat = []
    kw_to_spec = {}
    for spec, keywords in SPECIALTY_SYMPTOMS.items():
        for kw in keywords:
            all_keywords_flat.append(kw)
            kw_to_spec[kw] = spec

    for tok in tokens:
        matches = difflib.get_close_matches(tok, all_keywords_flat, n=1, cutoff=0.78)
        if matches:
            matched_kw = matches[0]
            return kw_to_spec[matched_kw]

    return None

def parse_relative_date(text: str) -> Optional[str]:
    """
    Parse relative date strings into YYYY-MM-DD with typo & slang resilience.
    """
    text_lower = text.lower()
    now = get_current_ist_datetime()
    today = now.date()

    if "day after tomorrow" in text_lower or "day after" in text_lower:
        return (today + timedelta(days=2)).isoformat()
    elif any(k in text_lower for k in ["tomorrow", "tomo", "tmrw", "tomorow", "tomrw"]):
        return (today + timedelta(days=1)).isoformat()
    elif any(k in text_lower for k in ["today", "this evening", "tonight", "now"]):
        return today.isoformat()

    # Day names: "next monday", "this friday", etc.
    days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
    days_short = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
    for idx, day_name in enumerate(days):
        if day_name in text_lower or days_short[idx] in text_lower:
            days_ahead = idx - today.weekday()
            if days_ahead <= 0:
                days_ahead += 7
            return (today + timedelta(days=days_ahead)).isoformat()

    # Check for ISO YYYY-MM-DD or DD-MM-YYYY
    match_iso = re.search(r"\b(\d{4}-\d{2}-\d{2})\b", text)
    if match_iso:
        return match_iso.group(1)

    match_dmy = re.search(r"\b(\d{1,2})[-/](\d{1,2})[-/](\d{4})\b", text)
    if match_dmy:
        d, m, y = match_dmy.groups()
        try:
            return date(int(y), int(m), int(d)).isoformat()
        except Exception:
            pass

    return None

def detect_time_period(text: str) -> Optional[str]:
    """
    Detects desired slot period (Morning, Afternoon, Evening).
    """
    text_lower = text.lower()
    if any(k in text_lower for k in ["morning", "mrng", "morn", "am slot"]):
        return "Morning"
    elif any(k in text_lower for k in ["afternoon", "noon", "lunch"]):
        return "Afternoon"
    elif any(k in text_lower for k in ["evening", "evng", "night", "late", "pm slot"]):
        return "Evening"
    return None

def extract_time_str(text: str) -> Optional[str]:
    """
    Extracts time like '10:30', '10am', '3:00 pm', 'after 3'.
    """
    # 1. 24h or 12h with colon (e.g., 10:30, 09:00, 14:00)
    match_colon = re.search(r"\b([01]?\d|2[0-3]):([0-5]\d)\b", text)
    if match_colon:
        h, m = match_colon.groups()
        return f"{int(h):02d}:{m}"

    # 2. 12h with am/pm (e.g. 10am, 10 am, 3pm, 3 pm)
    match_ampm = re.search(r"\b([1-9]|1[0-2])\s*(am|pm)\b", text, re.IGNORECASE)
    if match_ampm:
        h_str, meridian = match_ampm.groups()
        h = int(h_str)
        if meridian.lower() == "pm" and h != 12:
            h += 12
        elif meridian.lower() == "am" and h == 12:
            h = 0
        return f"{h:02d}:00"

    return None


def find_best_doctor_match(text: str, docs: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """
    Intelligently finds the best matching doctor from a list of doctor profiles,
    prioritizing full name matches, ID/number matches, and token overlap.
    """
    text_lower = text.lower()
    
    # 1. Exact full name or clean name match
    for d in docs:
        full = d["full_name"].lower()
        name_clean = re.sub(r"^dr\.?\s+", "", full, flags=re.IGNORECASE).strip()
        if full in text_lower or (len(name_clean) > 2 and name_clean in text_lower):
            return d

    # 2. Token overlap score
    best_doc = None
    best_score = 0.0
    for d in docs:
        full = d["full_name"].lower()
        name_clean = re.sub(r"^dr\.?\s+", "", full, flags=re.IGNORECASE).strip()
        parts = [p for p in name_clean.split() if len(p) >= 2]
        if parts:
            matched_parts = sum(1 for p in parts if p in text_lower)
            if matched_parts == len(parts):
                return d
            score = matched_parts / len(parts)
            if score > best_score and score >= 0.5:
                best_score = score
                best_doc = d

    return best_doc


def is_code_or_programming_request(text: str) -> bool:
    patterns = [
        r"\b(write|give|generate|show|create)\s+(me\s+)?(a\s+)?(python|javascript|typescript|java|c\+\+|sql|html|css|bash|shell|dockerfile|code|script)\b",
        r"\b(function|def|class|select\s+\*\s+from|drop\s+table|delete\s+from|insert\s+into)\b",
        r"\b(algorithm|sort\s+an?\s+array|binary\s+search|leetcode|fibonacci)\b",
        r"\bhow\s+to\s+(code|program|build\s+a\s+website)\b",
        r"\b(regex|regular\s+expression|git\s+commit|git\s+push)\b"
    ]
    text_lower = text.lower()
    return any(re.search(p, text_lower) for p in patterns)

def is_unrelated_general_query(text: str) -> bool:
    patterns = [
        r"\b(capital\s+of\s+[a-z]+|who\s+is\s+the\s+president|what\s+is\s+the\s+capital)\b",
        r"\b(tell\s+me\s+a\s+joke|make\s+me\s+laugh|funny\s+joke)\b",
        r"\b((write|tell|recite|give)\s+(me\s+)?(a\s+)?(story|poem|essay|song|rap|joke))\b",
        r"\b(quantum\s+physics|theory\s+of\s+relativity|explain\s+black\s+holes)\b",
        r"\b(what\s+is\s+the\s+meaning\s+of\s+life|who\s+won\s+the\s+world\s+cup)\b",
        r"\b(solve\s+math|calculate\s+\d+[\+\-\*\/])\b"
    ]
    text_lower = text.lower()
    return any(re.search(p, text_lower) for p in patterns)

def is_prompt_injection(text: str) -> bool:
    patterns = [
        r"\b(ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|rules|directions|prompts))\b",
        r"\b(system\s+prompt|prompt\s+injection)\b",
        r"\b(act\s+as\s+chatgpt|you\s+are\s+now\s+dan|jailbreak)\b",
        r"\b(reveal\s+your\s+(secret|instructions|prompt|api\s*key))\b",
        r"\b(give\s+me\s+the\s+database\s+password|show\s+me\s+the\s+connection\s+string|database\s+password)\b"
    ]

    text_lower = text.lower()
    return any(re.search(p, text_lower) for p in patterns)

def is_medical_advice_or_dosage_request(text: str) -> bool:
    patterns = [
        r"\b(should\s+i\s+(increase|decrease|stop|start|take\s+more|double)\s+(my\s+)?(dosage|dose|medicine|medication|tablet))\b",
        r"\b(can\s+i\s+(increase|decrease|stop|change)\s+(my\s+)?(dose|dosage|pills))\b",
        r"\b(do\s+i\s+have\s+(cancer|diabetes|heart\s+disease|asthma|covid))\b",
        r"\b(diagnose\s+me|diagnose\s+my\s+symptoms|what\s+disease\s+do\s+i\s+have)\b"
    ]
    text_lower = text.lower()
    return any(re.search(p, text_lower) for p in patterns)

def is_confirmation(text: str) -> bool:
    norm = text.strip().lower().rstrip("!.")
    affirmative = [
        "yes", "confirm", "book it", "yes book", "yes please", "sure",
        "confirm booking", "yes confirm", "proceed", "sure please", "ok book it", "please book", "yep", "yeah"
    ]
    return norm in affirmative or norm.startswith("yes,") or norm.startswith("yes ")

def is_cancellation(text: str) -> bool:
    norm = text.strip().lower().rstrip("!.")
    negative = [
        "no", "cancel", "not this one", "don't book", "dont book",
        "nevermind", "never mind", "stop", "no cancel", "nope"
    ]
    return norm in negative or norm.startswith("no,") or norm.startswith("no ")

class ChatbotOrchestrator:
    def __init__(self, db: AsyncSession, current_user: User, current_patient: PatientProfile):
        self.db = db
        self.current_user = current_user
        self.current_patient = current_patient

    async def get_or_create_session(self, session_id: Optional[str] = None) -> ChatSession:
        if session_id:
            stmt = select(ChatSession).where(
                ChatSession.id == session_id,
                ChatSession.patient_id == self.current_patient.id
            )
            res = await self.db.execute(stmt)
            session = res.scalar_one_or_none()
            if session:
                return session

        new_session = ChatSession(
            id=str(uuid.uuid4()),
            patient_id=self.current_patient.id
        )
        self.db.add(new_session)
        await self.db.commit()
        await self.db.refresh(new_session)
        return new_session

    async def load_session_messages(self, session_id: str, limit: int = 6) -> List[ChatMessage]:
        stmt = (
            select(ChatMessage)
            .where(ChatMessage.session_id == session_id)
            .order_by(ChatMessage.created_at.desc())
            .limit(limit)
        )
        res = await self.db.execute(stmt)
        messages = list(res.scalars().all())
        messages.reverse()
        return messages

    async def save_message(
        self,
        session_id: str,
        role: str,
        content: str,
        message_type: str = "text",
        data: Optional[Any] = None
    ) -> ChatMessage:
        msg = ChatMessage(
            session_id=session_id,
            role=role,
            content=content,
            message_type=message_type,
            data=data
        )
        self.db.add(msg)
        await self.db.commit()
        await self.db.refresh(msg)
        return msg

    async def process_message(self, user_message: str, session_id: Optional[str] = None) -> ChatResponse:
        session = await self.get_or_create_session(session_id)
        sess_id = session.id

        if sess_id not in SESSION_CONTEXT:
            SESSION_CONTEXT[sess_id] = {
                "selected_doctor_id": None,
                "selected_doctor_name": None,
                "selected_date": None,
                "displayed_slots": [],
                "displayed_doctors": [],
                "pending_booking": None
            }
        ctx = SESSION_CONTEXT[sess_id]

        cleaned_input = user_message.strip()
        text_lower = cleaned_input.lower()

        # 1. SECURITY & PROMPT INJECTION GUARDRAIL
        if is_prompt_injection(cleaned_input):
            refusal_text = OUT_OF_SCOPE_REFUSAL
            await self.save_message(sess_id, "user", cleaned_input)
            await self.save_message(sess_id, "assistant", refusal_text, "text")
            return ChatResponse(
                message=refusal_text,
                type=ChatResponseType.TEXT,
                session_id=sess_id,
                suggested_actions=["Find a doctor", "Show my appointments", "Show my prescriptions"]
            )

        # 2. MEDICAL ADVICE & DOSAGE SAFETY PROTOCOL
        if is_medical_advice_or_dosage_request(cleaned_input):
            advice_text = MEDICAL_ADVICE_REFUSAL
            await self.save_message(sess_id, "user", cleaned_input)
            await self.save_message(sess_id, "assistant", advice_text, "text")
            return ChatResponse(
                message=advice_text,
                type=ChatResponseType.TEXT,
                session_id=sess_id,
                suggested_actions=["Find a doctor", "Show my prescriptions"]
            )

        # 3. PURE CODE / PROGRAMMING REFUSAL (Allow telemed mixed requests)
        telemed_keywords = [
            "doctor", "cardiologist", "dermatologist", "pediatrician", "physician",
            "orthopedic", "neurologist", "gynecologist", "appointment", "prescription",
            "slot", "consultation", "dr ", "dr.", "medicines", "medicine"
        ]
        has_telemed = any(k in text_lower for k in telemed_keywords)

        if is_code_or_programming_request(cleaned_input) and not has_telemed:
            refusal_text = OUT_OF_SCOPE_REFUSAL
            await self.save_message(sess_id, "user", cleaned_input)
            await self.save_message(sess_id, "assistant", refusal_text, "text")
            return ChatResponse(
                message=refusal_text,
                type=ChatResponseType.TEXT,
                session_id=sess_id,
                suggested_actions=["Find a doctor", "Show my appointments", "Show my prescriptions"]
            )

        # 4. UNRELATED TRIVIA & ESSAY REFUSAL
        if is_unrelated_general_query(cleaned_input) and not has_telemed:
            refusal_text = OUT_OF_SCOPE_REFUSAL
            await self.save_message(sess_id, "user", cleaned_input)
            await self.save_message(sess_id, "assistant", refusal_text, "text")
            return ChatResponse(
                message=refusal_text,
                type=ChatResponseType.TEXT,
                session_id=sess_id,
                suggested_actions=["Find a doctor", "Show my appointments", "Show my prescriptions"]
            )

        # 5. PENDING BOOKING CONFIRMATION / CANCELLATION
        if ctx.get("pending_booking"):
            pb = ctx["pending_booking"]
            if is_confirmation(cleaned_input):
                res = await tool_book_appointment(
                    db=self.db,
                    current_patient=self.current_patient,
                    current_user=self.current_user,
                    doctor_id=pb["doctor_id"],
                    date_str=pb["date"],
                    start_time=pb["start_time"],
                    slot_id=pb.get("slot_id"),
                    reason=pb.get("reason", "General Consultation")
                )
                ctx["pending_booking"] = None

                if "error" in res:
                    msg = f"Sorry, I couldn't complete your booking: {res['error']}"
                    await self.save_message(sess_id, "user", cleaned_input)
                    await self.save_message(sess_id, "assistant", msg, "error", res)
                    return ChatResponse(
                        message=msg,
                        type=ChatResponseType.ERROR,
                        data=res,
                        session_id=sess_id,
                        suggested_actions=["Show available slots", "Find another doctor"]
                    )

                conf_msg = (
                    f"Your appointment is confirmed! Your booking number is **{res['appointment_number']}** with "
                    f"**{res['doctor_name']}** on **{res['date_formatted']}** at **{res['time_formatted']}**. "
                    f"I've also sent an email confirmation with all clinical details."
                )
                await self.save_message(sess_id, "user", cleaned_input)
                await self.save_message(sess_id, "assistant", conf_msg, "booking_confirmation", res)
                return ChatResponse(
                    message=conf_msg,
                    type=ChatResponseType.BOOKING_CONFIRMATION,
                    data=res,
                    session_id=sess_id,
                    suggested_actions=["Show my appointments", "When is my next appointment?"]
                )

            elif is_cancellation(cleaned_input):
                ctx["pending_booking"] = None
                cancel_msg = "Understood! I have cancelled that booking preview. What else can I assist you with?"
                await self.save_message(sess_id, "user", cleaned_input)
                await self.save_message(sess_id, "assistant", cancel_msg, "text")
                return ChatResponse(
                    message=cancel_msg,
                    type=ChatResponseType.TEXT,
                    session_id=sess_id,
                    suggested_actions=["Find a doctor", "Show my appointments"]
                )

        # 6. INTENT DISPATCH (Smart Resilient & Typo-Tolerant Engine)
        response = await self.dispatch_smart_intent(cleaned_input, sess_id, ctx)
        response.session_id = sess_id

        await self.save_message(sess_id, "user", cleaned_input)
        await self.save_message(
            sess_id,
            "assistant",
            response.message,
            response.type,
            response.data
        )
        return response

    async def dispatch_smart_intent(self, text: str, sess_id: str, ctx: Dict[str, Any]) -> ChatResponse:
        """
        High-precision intent router that handles casual phrasing, voice transcription errors,
        and spelling mistakes, mapping naturally to clinical actions or conversation.
        """
        text_lower = text.lower()
        now = get_current_ist_datetime()
        today = now.date()

        # Check for mixed request (e.g., "Find a cardiologist and write Python code")
        has_code_req = is_code_or_programming_request(text)
        mixed_prefix = ""
        if has_code_req:
            mixed_prefix = "I can certainly help with your Telemed healthcare request, but I cannot write software code. "

        # A. CONVERSATIONAL GREETINGS & EMPATHY
        greetings = ["hi", "hello", "hey", "good morning", "good evening", "good afternoon", "howdy", "heyy"]
        tokens = text_lower.split()
        if (len(tokens) <= 3 and any(g in tokens for g in greetings)) or text_lower in ["hello", "hi there", "hey telemed"]:
            greeting_msg = (
                f"Hello {self.current_patient.full_name or 'there'}! I'm your Telemed Health Assistant. "
                f"I can help you find specialists, view available time slots, book video consultations, "
                f"and check your prescriptions or appointments. How can I care for you today?"
            )
            return ChatResponse(
                message=greeting_msg,
                type=ChatResponseType.TEXT,
                session_id="",
                suggested_actions=[
                    "Find a doctor",
                    "Show my appointments",
                    "When is my next appointment?",
                    "Show my prescriptions",
                    "Morning slots tomorrow"
                ]
            )

        if any(k in text_lower for k in ["how are you", "how are u", "how r u"]):
            msg = (
                "I'm functioning very well and ready to assist you! How are you feeling today? "
                "Let me know if you need to consult a doctor, check your appointments, or review prescriptions."
            )
            return ChatResponse(
                message=msg,
                type=ChatResponseType.TEXT,
                session_id="",
                suggested_actions=["Find a doctor", "Show my appointments"]
            )

        if any(k in text_lower for k in ["thank you", "thanks", "thx", "thank u", "awesome thanks"]):
            msg = "You're very welcome! Your health and well-being are our highest priority. Let me know whenever you need clinical assistance."
            return ChatResponse(
                message=msg,
                type=ChatResponseType.TEXT,
                session_id="",
                suggested_actions=["Show my appointments", "Find a doctor"]
            )

        # B. CANCEL AN APPOINTMENT
        if "cancel" in text_lower and any(k in text_lower for k in ["appointment", "booking", "visit", "consultation", "#tlm-bok"]):
            # Extract appointment number if mentioned
            match_num = re.search(r"#?TLM-BOK-\d+", text, re.IGNORECASE)
            appt_identifier = match_num.group(0) if match_num else None

            if not appt_identifier:
                # Look up recent confirmed appointment
                appts = await tool_get_my_appointments(self.db, self.current_patient, status_filter="CONFIRMED")
                if appts:
                    appt_identifier = appts[0]["appointment_number"]

            if appt_identifier:
                cancel_res = await tool_cancel_appointment(self.db, self.current_patient, self.current_user, appt_identifier)
                if "error" in cancel_res:
                    return ChatResponse(
                        message=f"{mixed_prefix}{cancel_res['error']}",
                        type=ChatResponseType.ERROR,
                        session_id="",
                        suggested_actions=["Show my appointments", "Find a doctor"]
                    )
                msg = f"{mixed_prefix}Your appointment **{cancel_res['appointment_number']}** with **{cancel_res['doctor_name']}** has been successfully cancelled. The doctor's slot is now open."
                return ChatResponse(
                    message=msg,
                    type=ChatResponseType.TEXT,
                    data=cancel_res,
                    session_id="",
                    suggested_actions=["Show my appointments", "Book another appointment"]
                )
            else:
                return ChatResponse(
                    message=f"{mixed_prefix}You don't have any upcoming confirmed appointments to cancel.",
                    type=ChatResponseType.TEXT,
                    session_id="",
                    suggested_actions=["Show my appointments", "Find a doctor"]
                )

        # C. UPCOMING APPOINTMENT
        if any(k in text_lower for k in ["upcoming appointment", "next appointment", "when is my next", "my next appointment", "do i have an appointment", "next visit"]):
            appt = await tool_get_upcoming_appointment(self.db, self.current_patient)
            if appt:
                msg = f"{mixed_prefix}Your next appointment is with **{appt['doctor_name']}** ({appt.get('specialty', 'Specialist')}) on **{appt['date']}** at **{appt['start_time']}**."
                return ChatResponse(
                    message=msg,
                    type=ChatResponseType.APPOINTMENT,
                    data=appt,
                    session_id="",
                    suggested_actions=["View all appointments", "Show my prescriptions"]
                )
            else:
                return ChatResponse(
                    message=f"{mixed_prefix}You have no upcoming appointments scheduled right now. Would you like to find a doctor and book one?",
                    type=ChatResponseType.TEXT,
                    session_id="",
                    suggested_actions=["Find a doctor", "Show past appointments"]
                )

        # D. ALL APPOINTMENTS
        if any(k in text_lower for k in ["my appointments", "what appointments", "show my appointments", "all appointments", "list appointments", "apointments", "my visits"]):
            appts = await tool_get_my_appointments(self.db, self.current_patient)
            if appts:
                msg = f"{mixed_prefix}Here are your registered clinical appointments:"
            else:
                msg = f"{mixed_prefix}You don't have any appointments on record yet."
            return ChatResponse(
                message=msg,
                type=ChatResponseType.APPOINTMENT_LIST,
                data=appts,
                session_id="",
                suggested_actions=["When is my next appointment?", "Find a doctor"]
            )

        # E. PRESCRIPTIONS & MEDICINES
        if any(k in text_lower for k in ["prescription", "prescriptions", "precription", "medicine", "medicines", "meds", "my tablets", "drugs"]):
            rxs = await tool_get_my_prescriptions(self.db, self.current_patient)
            if rxs:
                msg = f"{mixed_prefix}Here are your digital prescriptions issued by your doctors:"
            else:
                msg = f"{mixed_prefix}You do not have any digital prescriptions on file yet."
            return ChatResponse(
                message=msg,
                type=ChatResponseType.PRESCRIPTION_LIST,
                data=rxs,
                session_id="",
                suggested_actions=["Show my appointments", "Find a doctor"]
            )

        # F. MEDICAL RECORDS & CONSULTATION SUMMARIES
        if any(k in text_lower for k in ["medical record", "medical records", "clinical notes", "past consultations", "health record"]):
            records = await tool_get_medical_records(self.db, self.current_patient)
            if records:
                msg = f"{mixed_prefix}I found **{len(records)}** medical record(s) on file:"
            else:
                msg = f"{mixed_prefix}You do not have any medical records or consultation notes archived yet."
            return ChatResponse(
                message=msg,
                type=ChatResponseType.TEXT,
                data=records,
                session_id="",
                suggested_actions=["Show my prescriptions", "Show my appointments"]
            )

        # G. BOOKING WITH EXPLICIT OR RELATIVE TIME (e.g. 'Book Dr Priya tomorrow at 10:30', 'Book 10am tomorrow', 'book slot')
        time_str = extract_time_str(text)
        is_booking_intent = any(k in text_lower for k in ["book", "schedule", "reserve", "take slot"])
        if is_booking_intent and (time_str or "slot" in text_lower or ":" in text_lower):
            extracted_time = time_str or "10:00"
            docs = await tool_search_doctors(self.db)
            matched_doc = find_best_doctor_match(text, docs)
            doc_id = matched_doc["id"] if matched_doc else None

            if not doc_id:
                doc_id = ctx.get("selected_doctor_id")
            if not doc_id and docs:
                doc_id = docs[0]["id"]


            rel_date = parse_relative_date(text) or ctx.get("selected_date") or (today + timedelta(days=1)).isoformat()

            preview = await tool_prepare_booking_preview(
                db=self.db,
                current_patient=self.current_patient,
                doctor_id=doc_id,
                date_str=rel_date,
                start_time=extracted_time,
                reason="General Clinical Consultation"
            )

            if "error" in preview:
                return ChatResponse(
                    message=f"{mixed_prefix}Unable to prepare that booking: {preview['error']}",
                    type=ChatResponseType.ERROR,
                    data=preview,
                    session_id="",
                    suggested_actions=["Show available slots", "Pick another time"]
                )

            ctx["pending_booking"] = preview
            ctx["selected_doctor_id"] = doc_id
            ctx["selected_date"] = rel_date
            msg = (
                f"{mixed_prefix}I found an available slot for **{preview['doctor_name']}** ({preview['specialty']}) on "
                f"**{preview['date_formatted']}** at **{preview['time_formatted']}**.\n\n"
                f"• **Consultation Mode:** {preview['consultation_mode']}\n"
                f"• **Consultation Fee:** ₹{preview['fee']}\n\n"
                f"Would you like me to confirm and book this appointment for you?"
            )
            return ChatResponse(
                message=msg,
                type=ChatResponseType.BOOKING_PREVIEW,
                data=preview,
                session_id="",
                suggested_actions=["Yes, confirm booking", "No, cancel"]
            )

        # H. SLOTS QUERY (e.g. 'show slots', 'morning slots tomorrow', 'what slots does dr priya have', 'any slots today')
        if any(k in text_lower for k in ["slot", "slots", "availability", "available", "timing", "timings"]):
            docs = await tool_search_doctors(self.db)
            matched_doc = find_best_doctor_match(text, docs)
            if matched_doc:
                doc_id = matched_doc["id"]
                ctx["selected_doctor_id"] = doc_id
                ctx["selected_doctor_name"] = matched_doc["full_name"]
            else:
                doc_id = None


            # Or detect specialty to pick doctor
            detected_spec = detect_specialty_from_text(text)
            if not doc_id and detected_spec:
                spec_docs = await tool_search_doctors(self.db, specialty=detected_spec)
                if spec_docs:
                    doc_id = spec_docs[0]["id"]
                    ctx["selected_doctor_id"] = doc_id
                    ctx["selected_doctor_name"] = spec_docs[0]["full_name"]

            if not doc_id:
                doc_id = ctx.get("selected_doctor_id")
            if not doc_id and docs:
                doc_id = docs[0]["id"]
                ctx["selected_doctor_id"] = doc_id
                ctx["selected_doctor_name"] = docs[0]["full_name"]

            rel_date = parse_relative_date(text) or ctx.get("selected_date") or (today + timedelta(days=1)).isoformat()
            res = await tool_get_doctor_slots(self.db, doc_id, rel_date)
            ctx["selected_date"] = rel_date

            all_slots = res.get("slots", [])
            period = detect_time_period(text)
            if period:
                filtered_slots = [s for s in all_slots if s.get("period", "").lower() == period.lower()]
            else:
                filtered_slots = all_slots

            ctx["displayed_slots"] = filtered_slots
            res["slots"] = filtered_slots
            res["count"] = len(filtered_slots)

            doc_name = res.get("doctor_name", "the doctor")
            period_str = f" {period.lower()}" if period else ""

            if filtered_slots:
                slot_strs = [s["formatted_time"] for s in filtered_slots]
                msg = f"{mixed_prefix}Available{period_str} slots for **{doc_name}** on **{res.get('day_name')}, {rel_date}**:\n{', '.join(slot_strs)}. Tap or say a time to book!"
            else:
                msg = f"{mixed_prefix}No available{period_str} slots found for **{doc_name}** on **{rel_date}**. Try checking another time period or date."

            return ChatResponse(
                message=msg,
                type=ChatResponseType.SLOT_LIST,
                data=res,
                session_id="",
                suggested_actions=[s["time"] for s in filtered_slots[:3]] + ["Check tomorrow", "Find another doctor"]
            )

        # I. DOCTOR SEARCH & SYMPTOM-TO-SPECIALTY ROUTING
        # Matches symptoms ("chest pain", "acne", "fever", "knee") or doctor queries ("cardiologist", "find doctor", "dr priya")
        detected_spec = detect_specialty_from_text(text)
        is_doctor_query = detected_spec is not None or any(
            k in text_lower for k in ["doctor", "docter", "specialist", "physician", "surgeon", "consultant", "dr ", "dr.", "find doc", "recommend"]
        )

        if is_doctor_query:
            # Extract doctor name query if any
            search_term = None
            for term in ["priya", "robert", "smith", "sharma", "rajesh", "kumar", "anand"]:
                if term in text_lower:
                    search_term = term
                    break

            docs = await tool_search_doctors(self.db, search=search_term, specialty=detected_spec)
            ctx["displayed_doctors"] = docs

            spec_desc = f" in **{detected_spec}**" if detected_spec else ""
            if docs:
                ctx["selected_doctor_id"] = docs[0]["id"]
                ctx["selected_doctor_name"] = docs[0]["full_name"]
                msg = f"{mixed_prefix}I found **{len(docs)}** verified doctor(s){spec_desc} matching your request:"
            else:
                # If no doctor in that specific specialty, provide friendly guidance
                msg = f"{mixed_prefix}I couldn't find any active doctors{spec_desc} right now. You can check all available doctors or try another specialty."
                docs = await tool_search_doctors(self.db)

            return ChatResponse(
                message=msg,
                type=ChatResponseType.DOCTOR_LIST,
                data=docs,
                session_id="",
                suggested_actions=["Show available slots", "Show my appointments"]
            )

        # J. ATTEMPT LLM FOR AMBIGUOUS OR CONVERSATIONAL INQUIRIES
        if not has_code_req:
            history_msgs = await self.load_session_messages(sess_id, limit=6)
            llm_messages = [{"role": "system", "content": get_system_prompt()}]
            for hm in history_msgs:
                llm_messages.append({"role": hm.role, "content": hm.content})
            llm_messages.append({"role": "user", "content": text})

            llm_resp = await call_llm(llm_messages, tools=CHATBOT_TOOLS_SPEC)
            if not llm_resp.get("error") and llm_resp.get("content"):
                return ChatResponse(
                    message=llm_resp["content"],
                    type=ChatResponseType.TEXT,
                    session_id="",
                    suggested_actions=["Find a doctor", "Show my appointments", "Show my prescriptions"]
                )

        # K. DEFAULT WARM HEALTHCARE GUIDANCE
        welcome = (
            f"{mixed_prefix}I'm your Telemed Clinical Assistant. I can help you find verified doctors, check available slots, "
            f"book appointments, view your prescriptions, and check past consultations. What can I do for you today?"
        )
        return ChatResponse(
            message=welcome,
            type=ChatResponseType.TEXT,
            session_id="",
            suggested_actions=[
                "Find a doctor",
                "Show my appointments",
                "When is my next appointment?",
                "Show my prescriptions",
                "Find a cardiologist"
            ]
        )
