import asyncio
import logging
import smtplib
import ssl
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional
from app.core.config import settings

logger = logging.getLogger("email_service")


def _send_smtp_sync(
    recipient: str,
    subject: str,
    html_content: str,
    text_content: str,
    from_address: str,
    smtp_host: str,
    smtp_port: int,
    smtp_user: Optional[str] = None,
    smtp_pass: Optional[str] = None,
    use_tls: bool = True,
    use_ssl: bool = False,
    timeout: float = 10.0
) -> dict:
    """Synchronous SMTP email delivery using Python standard library smtplib."""
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = from_address
    msg["To"] = recipient

    part_text = MIMEText(text_content, "plain", "utf-8")
    part_html = MIMEText(html_content, "html", "utf-8")
    msg.attach(part_text)
    msg.attach(part_html)

    if use_ssl or smtp_port == 465:
        context = ssl.create_default_context()
        with smtplib.SMTP_SSL(smtp_host, smtp_port, context=context, timeout=timeout) as server:
            if smtp_user and smtp_pass:
                server.login(smtp_user, smtp_pass)
            server.sendmail(from_address, [recipient], msg.as_string())
    else:
        with smtplib.SMTP(smtp_host, smtp_port, timeout=timeout) as server:
            if use_tls:
                context = ssl.create_default_context()
                server.starttls(context=context)
            if smtp_user and smtp_pass:
                server.login(smtp_user, smtp_pass)
            server.sendmail(from_address, [recipient], msg.as_string())

    return {"success": True, "delivered": True}


async def send_otp_email(
    email: str,
    otp: str,
    purpose: str = "REGISTRATION",
    name: str = "Patient"
) -> dict:
    """
    Sends a 6-digit verification code email with HTML template styling
    using native Python smtplib. Falls back to console output if SMTP credentials
    are absent or if the SMTP provider fails.
    """
    is_reset = purpose == "PASSWORD_RESET"
    subject = (
        f"Telemed — Your Password Reset Code: {otp}"
        if is_reset
        else f"Telemed — Your Verification Code: {otp}"
    )

    action_text = "reset your account password" if is_reset else "complete your Telemed patient registration"
    title_text = "Reset Your Password" if is_reset else "Verify Your Email"

    html_content = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #0f172a; }}
    .card {{ max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 20px; padding: 32px; border: 1px solid #e2e8f0; box-shadow: 0 4px 20px -2px rgba(15, 23, 42, 0.06); }}
    .logo-bar {{ display: flex; align-items: center; margin-bottom: 24px; }}
    .brand-icon {{ width: 36px; height: 36px; background-color: #0F766E; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; color: #ffffff; font-weight: bold; font-size: 18px; margin-right: 12px; }}
    .brand-name {{ font-size: 20px; font-weight: 800; color: #0f172a; letter-spacing: -0.5px; vertical-align: middle; }}
    .title {{ font-size: 22px; font-weight: 700; color: #0f172a; margin-top: 0; margin-bottom: 12px; }}
    .desc {{ font-size: 14px; line-height: 1.6; color: #475569; margin-bottom: 24px; }}
    .otp-box {{ background: #f0fdfa; border: 2px dashed #0F766E; border-radius: 16px; padding: 20px; text-align: center; margin-bottom: 24px; }}
    .otp-code {{ font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #0F766E; font-family: monospace; }}
    .expiry-notice {{ font-size: 12px; color: #64748b; margin-top: 8px; }}
    .footer {{ border-top: 1px solid #f1f5f9; padding-top: 16px; font-size: 12px; color: #94a3b8; text-align: center; }}
  </style>
</head>
<body>
  <div class="card">
    <div class="logo-bar">
      <span class="brand-icon">✚</span>
      <span class="brand-name">Telemed</span>
    </div>
    <h1 class="title">{title_text}</h1>
    <p class="desc">
      Hello <strong>{name}</strong>,<br>
      Please use the 6-digit verification code below to {action_text}.
    </p>
    <div class="otp-box">
      <div class="otp-code">{otp}</div>
      <div class="expiry-notice">⏱ This verification code expires in 10 minutes.</div>
    </div>
    <p class="desc" style="font-size: 13px;">
      If you did not request this verification code, please disregard this email or contact Telemed security immediately.
    </p>
    <div class="footer">
      © 2026 Telemed Healthcare Infrastructure. 256-bit encrypted clinical communications.
    </div>
  </div>
</body>
</html>"""

    text_content = f"Hello {name}, your Telemed verification code is: {otp}. It expires in 10 minutes."

    # Always log formatted OTP banner for local debugging & dev visibility
    print(f"\n======================================================")
    print(f"[EMAIL DISPATCH] Purpose: {purpose} | Recipient: {email}")
    print(f"[OTP CODE]: >>> {otp} <<<")
    print(f"======================================================\n")

    # If SMTP credentials are configured, attempt native dispatch
    if settings.SMTP_USER and settings.SMTP_PASS:
        try:
            result = await asyncio.to_thread(
                _send_smtp_sync,
                recipient=email,
                subject=subject,
                html_content=html_content,
                text_content=text_content,
                from_address=settings.EMAIL_FROM,
                smtp_host=settings.SMTP_HOST,
                smtp_port=settings.SMTP_PORT,
                smtp_user=settings.SMTP_USER,
                smtp_pass=settings.SMTP_PASS,
                use_tls=settings.SMTP_TLS,
                use_ssl=settings.SMTP_SSL
            )
            result["otp"] = otp
            return result
        except Exception as e:
            logger.warning(f"Native SMTP delivery failed: {e}. Falling back to console dispatch.")
            return {"success": True, "otp": otp, "fallback": True, "error": str(e)}

    # Development fallback
    return {"success": True, "otp": otp, "devFallback": True}


async def send_notification_email(
    email: str,
    title: str,
    message: str,
    name: str = "Valued User"
) -> dict:
    """
    Sends clinical notification emails (appointment confirmations, reminders)
    with HTML template styling using native Python smtplib.
    """
    subject = f"Telemed Alert: {title}"

    html_content = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #0f172a; }}
    .card {{ max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 20px; padding: 32px; border: 1px solid #e2e8f0; }}
    .brand-icon {{ width: 36px; height: 36px; background-color: #0F766E; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; color: #ffffff; font-weight: bold; font-size: 18px; margin-right: 12px; }}
    .brand-name {{ font-size: 20px; font-weight: 800; color: #0f172a; }}
    .title {{ font-size: 20px; font-weight: 700; color: #0f172a; margin: 20px 0 12px; }}
    .desc {{ font-size: 14px; line-height: 1.6; color: #475569; }}
    .footer {{ border-top: 1px solid #f1f5f9; margin-top: 24px; padding-top: 16px; font-size: 12px; color: #94a3b8; text-align: center; }}
  </style>
</head>
<body>
  <div class="card">
    <div style="display:flex;align-items:center;">
      <span class="brand-icon">✚</span>
      <span class="brand-name">Telemed</span>
    </div>
    <h2 class="title">{title}</h2>
    <p class="desc">Hello <strong>{name}</strong>,</p>
    <p class="desc">{message}</p>
    <div class="footer">
      © 2026 Telemed Healthcare Platform.
    </div>
  </div>
</body>
</html>"""

    text_content = f"{title}\n\nHello {name},\n{message}"

    print(f"[NOTIFICATION DISPATCH] Recipient: {email} | Title: {title}")

    if settings.SMTP_USER and settings.SMTP_PASS:
        try:
            return await asyncio.to_thread(
                _send_smtp_sync,
                recipient=email,
                subject=subject,
                html_content=html_content,
                text_content=text_content,
                from_address=settings.EMAIL_FROM,
                smtp_host=settings.SMTP_HOST,
                smtp_port=settings.SMTP_PORT,
                smtp_user=settings.SMTP_USER,
                smtp_pass=settings.SMTP_PASS,
                use_tls=settings.SMTP_TLS,
                use_ssl=settings.SMTP_SSL
            )
        except Exception as e:
            logger.warning(f"Notification email dispatch error: {e}. Falling back to console dispatch.")
            return {"success": True, "fallback": True, "error": str(e)}

    return {"success": True, "devFallback": True}
