from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from sqlalchemy.orm import selectinload

from app.database import get_async_db
from app.api.deps import get_current_verified_user
from app.models.user import User, UserRole
from app.models.chat import ChatSession, ChatMessage
from app.chatbot.schemas import (
    ChatMessageRequest,
    ChatResponse,
    ChatSessionResponse,
    ChatMessageResponse
)
from app.chatbot.orchestrator import ChatbotOrchestrator

router = APIRouter(prefix="/chat", tags=["Telemed AI Assistant Chatbot"])

def require_patient_profile(current_user: User = Depends(get_current_verified_user)):
    if current_user.role != UserRole.PATIENT:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="The Telemed AI Assistant is exclusively available for patient accounts."
        )
    if not current_user.patient_profile:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Patient profile not found. Please complete your profile before using the assistant."
        )
    return current_user

@router.post("", response_model=ChatResponse)
async def chat_with_assistant(
    payload: ChatMessageRequest,
    current_user: User = Depends(require_patient_profile),
    db: AsyncSession = Depends(get_async_db)
):
    """
    Primary conversational endpoint for the Telemed AI Assistant.
    Accepts patient natural language queries, enforces domain restrictions and safety,
    and returns structured clinical card payloads or conversational text.
    """
    orchestrator = ChatbotOrchestrator(
        db=db,
        current_user=current_user,
        current_patient=current_user.patient_profile
    )

    response = await orchestrator.process_message(
        user_message=payload.message,
        session_id=payload.session_id
    )
    return response

@router.get("/sessions", response_model=List[ChatSessionResponse])
async def list_chat_sessions(
    current_user: User = Depends(require_patient_profile),
    db: AsyncSession = Depends(get_async_db)
):
    """
    Retrieve all conversation sessions for the authenticated patient.
    """
    stmt = (
        select(ChatSession)
        .options(selectinload(ChatSession.messages))
        .where(ChatSession.patient_id == current_user.patient_profile.id)
        .order_by(desc(ChatSession.updated_at))
    )
    res = await db.execute(stmt)
    sessions = res.scalars().all()
    return sessions

@router.get("/sessions/{session_id}", response_model=ChatSessionResponse)
async def get_chat_session(
    session_id: str,
    current_user: User = Depends(require_patient_profile),
    db: AsyncSession = Depends(get_async_db)
):
    """
    Retrieve message history for a specific chat session.
    Enforces authorization: patient can only view their own sessions.
    """
    stmt = (
        select(ChatSession)
        .options(selectinload(ChatSession.messages))
        .where(ChatSession.id == session_id)
    )
    res = await db.execute(stmt)
    session = res.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="Chat session not found")

    if session.patient_id != current_user.patient_profile.id:
        raise HTTPException(status_code=403, detail="Unauthorized access to chat session")

    return session

@router.delete("/sessions/{session_id}")
async def delete_chat_session(
    session_id: str,
    current_user: User = Depends(require_patient_profile),
    db: AsyncSession = Depends(get_async_db)
):
    """
    Delete a chat session and its associated messages.
    """
    stmt = select(ChatSession).where(ChatSession.id == session_id)
    res = await db.execute(stmt)
    session = res.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="Chat session not found")

    if session.patient_id != current_user.patient_profile.id:
        raise HTTPException(status_code=403, detail="Unauthorized access to chat session")

    await db.delete(session)
    await db.commit()
    return {"success": True, "message": "Chat session cleared successfully"}
