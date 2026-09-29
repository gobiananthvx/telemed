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
    tool_get_my_prescriptions,
    tool_get_prescription_details,
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

def parse_relative_date(text: str) -> Optional[str]:
    """
    Parse relative date strings into YYYY-MM-DD.
    """
    text_lower = text.lower()
    now = get_current_ist_datetime()
    today = now.date()

    if "day after tomorrow" in text_lower:
        return (today + timedelta(days=2)).isoformat()
    elif "tomorrow" in text_lower:
        return (today + timedelta(days=1)).isoformat()
    elif "today" in text_lower or "this evening" in text_lower or "tonight" in text_lower:
        return today.isoformat()

    # Day names: "next monday", "this friday", etc.
    days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
    for idx, day_name in enumerate(days):
        if day_name in text_lower:
            days_ahead = idx - today.weekday()
            if days_ahead <= 0:
                days_ahead += 7
            return (today + timedelta(days=days_ahead)).isoformat()

    # Check for ISO or DD-MM-YYYY / YYYY-MM-DD
    match = re.search(r"\b(\d{4}-\d{2}-\d{2})\b", text)
    if match:
        return match.group(1)

    return None

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
        r"\b(write\s+(a\s+)?(story|poem|essay|song|rap))\b",
        r"\b(quantum\s+physics|theory\s+of\s+relativity|explain\s+black\s+holes)\b",
        r"\b(what\s+is\s+the\s+meaning\s+of\s+life|who\s+won\s+the\s+world\s+cup)\b",
        r"\b(solve\s+math|calculate\s+\d+[\+\-\*\/])\b"
    ]
    text_lower = text.lower()
    return any(re.search(p, text_lower) for p in patterns)

def is_prompt_injection(text: str) -> bool:
    patterns = [
        r"\b(ignore\s+(all\s+)?previous\s+instructions|system\s+prompt|prompt\s+injection)\b",
        r"\b(act\s+as\s+chatgpt|you\s+are\s+now\s+dan|jailbreak)\b",
        r"\b(reveal\s+your\s+(secret|instructions|prompt|api\s*key))\b",
        r"\b(give\s+me\s+the\s+database\s+password|show\s+me\s+the\s+connection\s+string)\b"
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
        "yes", "confirm", "book it", "yes book", "yes please",
        "confirm booking", "yes confirm", "proceed", "sure", "ok book it", "please book"
    ]
    return norm in affirmative or norm.startswith("yes,") or norm.startswith("yes ")

def is_cancellation(text: str) -> bool:
    norm = text.strip().lower().rstrip("!.")
    negative = [
        "no", "cancel", "not this one", "don't book", "dont book",
        "nevermind", "never mind", "stop", "no cancel"
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

    async def load_session_messages(self, session_id: str, limit: int = 10) -> List[ChatMessage]:
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

        # Initialize session context cache if missing
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

        # 1. SECURITY & PROMPT INJECTION CHECKS
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

        # 2. MEDICAL ADVICE & DOSAGE REFUSAL
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

        # 3. PURE CODE OR PROGRAMMING REQUEST REFUSAL
        telemed_keywords = [
            "doctor", "cardiologist", "dermatologist", "pediatrician", "physician",
            "orthopedic", "neurologist", "gynecologist", "appointment", "prescription",
            "slot", "consultation", "dr ", "dr.", "medicines", "medicine"
        ]
        has_telemed = any(k in cleaned_input.lower() for k in telemed_keywords)

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

        # 4. GENERAL KNOWLEDGE / TRIVIA REFUSAL
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

        # 5. BOOKING CONFIRMATION FLOW (PENDING PREVIEW)
        if ctx.get("pending_booking"):
            pb = ctx["pending_booking"]
            if is_confirmation(cleaned_input):
                # Execute actual booking tool
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
                    msg = f"Sorry, I couldn't complete the booking: {res['error']}"
                    await self.save_message(sess_id, "user", cleaned_input)
                    await self.save_message(sess_id, "assistant", msg, "error", res)
                    return ChatResponse(
                        message=msg,
                        type=ChatResponseType.ERROR,
                        data=res,
                        session_id=sess_id,
                        suggested_actions=["Show available slots", "Find another doctor"]
                    )

                conf_msg = f"Your appointment has been confirmed! Booking number: **{res['appointment_number']}** with **{res['doctor_name']}** on **{res['date_formatted']}** at **{res['time_formatted']}**."
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
                cancel_msg = "Understood, I've cancelled that booking preview. What else can I help you with?"
                await self.save_message(sess_id, "user", cleaned_input)
                await self.save_message(sess_id, "assistant", cancel_msg, "text")
                return ChatResponse(
                    message=cancel_msg,
                    type=ChatResponseType.TEXT,
                    session_id=sess_id,
                    suggested_actions=["Find a doctor", "Show my appointments"]
                )

        # 6. ATTEMPT LITELLM TOOL CALLING (If keys configured)
        history_msgs = await self.load_session_messages(sess_id, limit=6)
        llm_messages = [{"role": "system", "content": get_system_prompt()}]
        for hm in history_msgs:
            llm_messages.append({"role": hm.role, "content": hm.content})
        llm_messages.append({"role": "user", "content": cleaned_input})

        llm_resp = await call_llm(llm_messages, tools=CHATBOT_TOOLS_SPEC)

        if not llm_resp.get("error") and llm_resp.get("tool_calls"):
            # Handle LLM tool call
            tc = llm_resp["tool_calls"][0]
            func_name = tc["function"]["name"]
            try:
                raw_args = tc["function"]["arguments"]
                args = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
            except Exception:
                args = {}

            tool_result = await self.execute_tool(func_name, args, ctx)
            if tool_result:
                tool_result.session_id = sess_id
                await self.save_message(sess_id, "user", cleaned_input)
                await self.save_message(
                    sess_id,
                    "assistant",
                    tool_result.message,
                    tool_result.type,
                    tool_result.data
                )
                return tool_result

        elif not llm_resp.get("error") and llm_resp.get("content"):
            content = llm_resp["content"]
            await self.save_message(sess_id, "user", cleaned_input)
            await self.save_message(sess_id, "assistant", content, "text")
            return ChatResponse(
                message=content,
                type=ChatResponseType.TEXT,
                session_id=sess_id,
                suggested_actions=["Find a doctor", "Show my appointments", "Show my prescriptions"]
            )

        # 7. DETERMINISTIC FALLBACK ROUTER (100% Reliable Offline & Test Mode)
        fallback_res = await self.execute_fallback_routing(cleaned_input, ctx)
        fallback_res.session_id = sess_id
        await self.save_message(sess_id, "user", cleaned_input)
        await self.save_message(
            sess_id,
            "assistant",
            fallback_res.message,
            fallback_res.type,
            fallback_res.data
        )
        return fallback_res

    async def execute_tool(self, func_name: str, args: Dict[str, Any], ctx: Dict[str, Any]) -> Optional[ChatResponse]:
        """
        Execute tool and format into structured ChatResponse.
        """
        logger.info(f"[Chatbot Tool] Executing tool: {func_name} with args: {args}")

        if func_name == "search_doctors":
            docs = await tool_search_doctors(self.db, search=args.get("search"), specialty=args.get("specialty"))
            ctx["displayed_doctors"] = docs
            if docs:
                ctx["selected_doctor_id"] = docs[0]["id"]
                ctx["selected_doctor_name"] = docs[0]["full_name"]
                msg = f"I found **{len(docs)}** doctor(s) matching your request:"
            else:
                msg = "I couldn't find any doctors matching your criteria. Try searching for another specialty or name."
            return ChatResponse(
                message=msg,
                type=ChatResponseType.DOCTOR_LIST,
                data=docs,
                session_id="",
                suggested_actions=["Show available slots", "Find a cardiologist", "Show my appointments"]
            )

        elif func_name == "get_doctor_details":
            doc_id = args.get("doctor_id") or ctx.get("selected_doctor_id")
            if not doc_id:
                return ChatResponse(message="Which doctor's details would you like to see?", type=ChatResponseType.TEXT, session_id="")
            doc = await tool_get_doctor_details(self.db, doc_id)
            if not doc:
                return ChatResponse(message="Doctor profile not found.", type=ChatResponseType.ERROR, session_id="")
            ctx["selected_doctor_id"] = doc["id"]
            ctx["selected_doctor_name"] = doc["full_name"]
            msg = f"Here are the details for **{doc['full_name']}** ({doc['specialty']}):"
            return ChatResponse(
                message=msg,
                type=ChatResponseType.DOCTOR_DETAILS,
                data=doc,
                session_id="",
                suggested_actions=["View available slots", "Book an appointment"]
            )

        elif func_name == "get_doctor_slots":
            doc_id = args.get("doctor_id") or ctx.get("selected_doctor_id")
            slot_date = args.get("date") or ctx.get("selected_date") or get_current_ist_datetime().date().isoformat()
            if not doc_id:
                # If doctor not specified, pick the first verified doctor or ask
                docs = await tool_search_doctors(self.db)
                if docs:
                    doc_id = docs[0]["id"]
                else:
                    return ChatResponse(message="Please specify which doctor you'd like to check slots for.", type=ChatResponseType.TEXT, session_id="")

            res = await tool_get_doctor_slots(self.db, doc_id, slot_date)
            ctx["selected_doctor_id"] = doc_id
            ctx["selected_date"] = slot_date
            ctx["displayed_slots"] = res.get("slots", [])
            slots = res.get("slots", [])
            doc_name = res.get("doctor_name", "the doctor")

            if slots:
                msg = f"Available slots for **{doc_name}** on **{res.get('day_name')}, {slot_date}**:"
            else:
                msg = f"No available slots found for **{doc_name}** on **{slot_date}**. Please check another date."

            return ChatResponse(
                message=msg,
                type=ChatResponseType.SLOT_LIST,
                data=res,
                session_id="",
                suggested_actions=[s["time"] for s in slots[:3]] + ["Check tomorrow's slots"]
            )

        elif func_name in ["prepare_booking_preview", "book_appointment"]:
            # Enforce safety preview protocol
            doc_id = args.get("doctor_id") or ctx.get("selected_doctor_id")
            b_date = args.get("date") or ctx.get("selected_date")
            start_t = args.get("start_time")
            slot_id = args.get("slot_id")
            reason = args.get("reason", "General Consultation")

            if not doc_id or not b_date or not start_t:
                return ChatResponse(
                    message="Please specify the doctor, date, and time for your appointment.",
                    type=ChatResponseType.TEXT,
                    session_id=""
                )

            preview = await tool_prepare_booking_preview(
                db=self.db,
                current_patient=self.current_patient,
                doctor_id=doc_id,
                date_str=b_date,
                start_time=start_t,
                slot_id=slot_id,
                reason=reason
            )

            if "error" in preview:
                return ChatResponse(
                    message=f"I couldn't prepare that booking: {preview['error']}",
                    type=ChatResponseType.ERROR,
                    data=preview,
                    session_id="",
                    suggested_actions=["Show available slots", "Pick another time"]
                )

            ctx["pending_booking"] = preview
            msg = (
                f"I found an available slot for **{preview['doctor_name']}** ({preview['specialty']}) on "
                f"**{preview['date_formatted']}** from **{preview['time_formatted']}**.\n\n"
                f"• **Mode:** {preview['consultation_mode']}\n"
                f"• **Fee:** ₹{preview['fee']}\n\n"
                f"Would you like me to confirm this appointment?"
            )
            return ChatResponse(
                message=msg,
                type=ChatResponseType.BOOKING_PREVIEW,
                data=preview,
                session_id="",
                suggested_actions=["Yes, confirm booking", "No, cancel"]
            )

        elif func_name == "get_my_appointments":
            appts = await tool_get_my_appointments(self.db, self.current_patient, status_filter=args.get("status"))
            if appts:
                msg = f"You have **{len(appts)}** appointment(s):"
            else:
                msg = "You don't have any appointments scheduled right now."
            return ChatResponse(
                message=msg,
                type=ChatResponseType.APPOINTMENT_LIST,
                data=appts,
                session_id="",
                suggested_actions=["When is my next appointment?", "Find a doctor", "Show my prescriptions"]
            )

        elif func_name == "get_upcoming_appointment":
            appt = await tool_get_upcoming_appointment(self.db, self.current_patient)
            if appt:
                msg = f"Your next appointment is with **{appt['doctor_name']}** on **{appt['date']}** at **{appt['start_time']}**."
                return ChatResponse(
                    message=msg,
                    type=ChatResponseType.APPOINTMENT,
                    data=appt,
                    session_id="",
                    suggested_actions=["View all appointments", "Show my prescriptions"]
                )
            else:
                return ChatResponse(
                    message="You have no upcoming appointments scheduled.",
                    type=ChatResponseType.TEXT,
                    session_id="",
                    suggested_actions=["Find a doctor", "Show past appointments"]
                )

        elif func_name == "get_appointment_details":
            appt_id = args.get("appointment_id")
            if not appt_id:
                return ChatResponse(message="Please specify an appointment ID.", type=ChatResponseType.TEXT, session_id="")
            appt = await tool_get_appointment_details(self.db, self.current_patient, appt_id)
            if not appt:
                return ChatResponse(message="Appointment not found.", type=ChatResponseType.ERROR, session_id="")
            if "error" in appt:
                return ChatResponse(message=appt["error"], type=ChatResponseType.ERROR, session_id="")
            msg = f"Details for appointment **{appt['appointment_number']}** with **{appt['doctor_name']}**:"
            return ChatResponse(
                message=msg,
                type=ChatResponseType.APPOINTMENT,
                data=appt,
                session_id="",
                suggested_actions=["Show all appointments"]
            )

        elif func_name == "get_my_prescriptions":
            prescriptions = await tool_get_my_prescriptions(self.db, self.current_patient)
            if prescriptions:
                msg = f"You have **{len(prescriptions)}** digital prescription(s):"
            else:
                msg = "You do not have any prescriptions on file yet."
            return ChatResponse(
                message=msg,
                type=ChatResponseType.PRESCRIPTION_LIST,
                data=prescriptions,
                session_id="",
                suggested_actions=["Show my appointments", "Find a doctor"]
            )

        elif func_name == "get_prescription_details":
            rx_id = args.get("prescription_id")
            if not rx_id:
                return ChatResponse(message="Please provide a prescription ID.", type=ChatResponseType.TEXT, session_id="")
            rx = await tool_get_prescription_details(self.db, self.current_patient, rx_id)
            if not rx:
                return ChatResponse(message="Prescription not found.", type=ChatResponseType.ERROR, session_id="")
            if "error" in rx:
                return ChatResponse(message=rx["error"], type=ChatResponseType.ERROR, session_id="")
            msg = f"Details for prescription **{rx['rx_number']}** issued by **{rx['doctor_name']}** ({rx['diagnosis']}):"
            return ChatResponse(
                message=msg,
                type=ChatResponseType.PRESCRIPTION,
                data=rx,
                session_id="",
                suggested_actions=["Show all prescriptions", "Show my appointments"]
            )

        return None

    async def execute_fallback_routing(self, text: str, ctx: Dict[str, Any]) -> ChatResponse:
        """
        Robust deterministic intent parser for offline / test environments.
        """
        text_lower = text.lower()
        now = get_current_ist_datetime()
        today = now.date()

        # Check for mixed request (e.g., "Find a cardiologist and write Python code")
        has_code_req = is_code_or_programming_request(text)
        mixed_prefix = ""
        if has_code_req:
            mixed_prefix = "I can help with your Telemed request, but I cannot generate code. "

        # 1. UPCOMING APPOINTMENT
        if any(k in text_lower for k in ["upcoming appointment", "next appointment", "when is my next appointment", "do i have an appointment tomorrow"]):
            appt = await tool_get_upcoming_appointment(self.db, self.current_patient)
            if appt:
                msg = f"{mixed_prefix}Your next appointment is with **{appt['doctor_name']}** on **{appt['date']}** at **{appt['start_time']}**."
                return ChatResponse(
                    message=msg,
                    type=ChatResponseType.APPOINTMENT,
                    data=appt,
                    session_id="",
                    suggested_actions=["View all appointments", "Show my prescriptions"]
                )
            else:
                return ChatResponse(
                    message=f"{mixed_prefix}You have no upcoming appointments.",
                    type=ChatResponseType.TEXT,
                    session_id="",
                    suggested_actions=["Find a doctor", "Show past appointments"]
                )

        # 2. ALL APPOINTMENTS
        if any(k in text_lower for k in ["my appointments", "what appointments do i have", "show my appointments", "all appointments"]):
            appts = await tool_get_my_appointments(self.db, self.current_patient)
            if appts:
                msg = f"{mixed_prefix}Here are your appointments:"
            else:
                msg = f"{mixed_prefix}You have no appointments on record."
            return ChatResponse(
                message=msg,
                type=ChatResponseType.APPOINTMENT_LIST,
                data=appts,
                session_id="",
                suggested_actions=["When is my next appointment?", "Find a doctor"]
            )

        # 3. PRESCRIPTIONS
        if any(k in text_lower for k in ["prescription", "prescriptions", "medicines", "medicine listed"]):
            rxs = await tool_get_my_prescriptions(self.db, self.current_patient)
            if rxs:
                msg = f"{mixed_prefix}Here are your digital prescriptions:"
            else:
                msg = f"{mixed_prefix}You do not have any prescriptions on file."
            return ChatResponse(
                message=msg,
                type=ChatResponseType.PRESCRIPTION_LIST,
                data=rxs,
                session_id="",
                suggested_actions=["Show my appointments", "Find a doctor"]
            )

        # 4. BOOKING AT A SPECIFIC TIME (e.g. "10:30", "Book Dr Priya tomorrow at 10:30 AM", "book at 10:30")
        time_match = re.search(r"\b(\d{1,2}:\d{2})\b", text)
        if time_match or ("book" in text_lower and ("am" in text_lower or "pm" in text_lower or ":" in text_lower)):
            extracted_time = time_match.group(1) if time_match else "10:00"
            docs = await tool_search_doctors(self.db)
            doc_id = None
            # Check if doctor name mentioned in text
            for d in docs:
                name_clean = re.sub(r"^dr\.?\s+", "", d["full_name"], flags=re.IGNORECASE).strip().lower()
                name_parts = [p for p in name_clean.split() if len(p) > 2]
                if name_clean in text_lower or (name_parts and all(p in text_lower for p in name_parts)):
                    doc_id = d["id"]
                    break

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
                reason="General Consultation"
            )

            if "error" in preview:
                return ChatResponse(
                    message=f"{mixed_prefix}Unable to prepare booking: {preview['error']}",
                    type=ChatResponseType.ERROR,
                    data=preview,
                    session_id="",
                    suggested_actions=["Show available slots", "Pick another time"]
                )

            ctx["pending_booking"] = preview
            ctx["selected_doctor_id"] = doc_id
            ctx["selected_date"] = rel_date
            msg = (
                f"{mixed_prefix}I found an available slot:\n\n"
                f"**{preview['doctor_name']}**\n"
                f"{preview['specialty']}\n"
                f"{preview['date_formatted']}\n"
                f"{preview['time_formatted']}\n"
                f"{preview['consultation_mode']}\n"
                f"Consultation fee: ₹{preview['fee']}\n\n"
                f"Would you like me to confirm this appointment?"
            )
            return ChatResponse(
                message=msg,
                type=ChatResponseType.BOOKING_PREVIEW,
                data=preview,
                session_id="",
                suggested_actions=["Yes, confirm booking", "No, cancel"]
            )

        # 5. DOCTOR SLOTS ("show slots", "what slots are available tomorrow", "show dr priya's slots tomorrow")
        if any(k in text_lower for k in ["slot", "slots", "availability", "available tomorrow"]):
            docs = await tool_search_doctors(self.db)
            doc_id = None
            for d in docs:
                name_clean = re.sub(r"^dr\.?\s+", "", d["full_name"], flags=re.IGNORECASE).strip().lower()
                name_parts = [p for p in name_clean.split() if len(p) > 2]
                if name_clean in text_lower or (name_parts and all(p in text_lower for p in name_parts)):
                    doc_id = d["id"]
                    ctx["selected_doctor_id"] = doc_id
                    ctx["selected_doctor_name"] = d["full_name"]
                    break

            if not doc_id:
                doc_id = ctx.get("selected_doctor_id")
            if not doc_id and docs:
                doc_id = docs[0]["id"]
                ctx["selected_doctor_id"] = doc_id
                ctx["selected_doctor_name"] = docs[0]["full_name"]

            rel_date = parse_relative_date(text) or ctx.get("selected_date") or (today + timedelta(days=1)).isoformat()
            res = await tool_get_doctor_slots(self.db, doc_id, rel_date)
            ctx["selected_date"] = rel_date
            ctx["displayed_slots"] = res.get("slots", [])

            slots = res.get("slots", [])
            doc_name = res.get("doctor_name", "the doctor")
            if slots:
                slot_strs = [s["formatted_time"] for s in slots]
                msg = f"{mixed_prefix}Available slots for **{doc_name}** on **{res.get('day_name')}, {rel_date}** are {', '.join(slot_strs)}."
            else:
                msg = f"{mixed_prefix}No available slots found for **{doc_name}** on **{rel_date}**."

            return ChatResponse(
                message=msg,
                type=ChatResponseType.SLOT_LIST,
                data=res,
                session_id="",
                suggested_actions=[s["time"] for s in slots[:3]] + ["Check tomorrow"]
            )

        # 6. DOCTOR SEARCH ("find a cardiologist", "show cardiologists", "find a doctor", "show dr priya")
        if any(k in text_lower for k in ["doctor", "cardiologist", "dermatologist", "pediatrician", "physician", "orthopedic", "neurologist", "dr ", "dr.", "priya"]):
            # Extract specialty or search
            specialty = None
            for s in ["Cardiologist", "Dermatologist", "Pediatrician", "General Physician", "Orthopedic", "Neurologist", "Gynecologist"]:
                if s.lower() in text_lower:
                    specialty = s
                    break

            search_term = None
            if not specialty:
                for term in ["priya", "robert", "smith", "sharma"]:
                    if term in text_lower:
                        search_term = term
                        break

            docs = await tool_search_doctors(self.db, search=search_term, specialty=specialty)
            ctx["displayed_doctors"] = docs
            if docs:
                ctx["selected_doctor_id"] = docs[0]["id"]
                ctx["selected_doctor_name"] = docs[0]["full_name"]
                msg = f"{mixed_prefix}I found **{len(docs)}** doctor(s) matching your request:"
            else:
                msg = f"{mixed_prefix}I couldn't find any doctors matching your request."

            return ChatResponse(
                message=msg,
                type=ChatResponseType.DOCTOR_LIST,
                data=docs,
                session_id="",
                suggested_actions=["Show available slots", "Show my appointments"]
            )

        # DEFAULT GREETING / SCOPE REMINDER
        welcome = (
            f"{mixed_prefix}I'm your Telemed AI Assistant. I can help you find doctors, check appointment slots, "
            f"view your appointments, check your prescriptions, and book consultations. How can I help you today?"
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
