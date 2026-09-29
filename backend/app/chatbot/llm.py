import os
import logging
from typing import List, Dict, Any, Optional
import litellm
from app.core.config import settings

logger = logging.getLogger("telemed_chatbot")

# Configure LiteLLM
litellm.drop_params = True
litellm.telemetry = False

def get_api_key_for_model(model_name: str) -> Optional[str]:
    if "gemini" in model_name.lower():
        return settings.GEMINI_API_KEY or os.getenv("GEMINI_API_KEY")
    elif "groq" in model_name.lower():
        return settings.GROQ_API_KEY or os.getenv("GROQ_API_KEY")
    return None

async def call_llm(
    messages: List[Dict[str, Any]],
    tools: Optional[List[Dict[str, Any]]] = None,
    temperature: float = 0.2
) -> Dict[str, Any]:
    """
    Call LiteLLM with primary provider (Gemini Flash) and optional fallback (Groq).
    """
    primary_model = settings.GEMINI_MODEL
    fallback_model = settings.GROQ_MODEL
    primary_key = get_api_key_for_model(primary_model)
    fallback_key = get_api_key_for_model(fallback_model)

    models_to_try = []
    if primary_key:
        models_to_try.append((primary_model, primary_key))
    if fallback_key:
        models_to_try.append((fallback_model, fallback_key))

    # If neither key is configured, check if default env vars are set
    if not models_to_try:
        if os.getenv("GEMINI_API_KEY"):
            models_to_try.append((primary_model, os.getenv("GEMINI_API_KEY")))
        elif os.getenv("GROQ_API_KEY"):
            models_to_try.append((fallback_model, os.getenv("GROQ_API_KEY")))

    if not models_to_try:
        logger.warning("[Chatbot LLM] No API keys configured for Gemini or Groq.")
        return {
            "role": "assistant",
            "content": None,
            "tool_calls": None,
            "error": "NO_API_KEY"
        }

    last_error = None
    for model_name, api_key in models_to_try:
        try:
            logger.info(f"[Chatbot LLM] Calling model: {model_name}")
            kwargs = {
                "model": model_name,
                "messages": messages,
                "api_key": api_key,
                "temperature": temperature,
            }
            if tools:
                kwargs["tools"] = tools
                kwargs["tool_choice"] = "auto"

            response = await litellm.acompletion(**kwargs)
            choice = response.choices[0]
            message = choice.message

            tool_calls = None
            if hasattr(message, "tool_calls") and message.tool_calls:
                tool_calls = [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments
                        }
                    }
                    for tc in message.tool_calls
                ]

            return {
                "role": "assistant",
                "content": message.content,
                "tool_calls": tool_calls,
                "error": None
            }
        except Exception as e:
            logger.warning(f"[Chatbot LLM] Model {model_name} failed: {e}")
            last_error = str(e)
            continue

    return {
        "role": "assistant",
        "content": None,
        "tool_calls": None,
        "error": last_error or "LLM_CALL_FAILED"
    }
