import base64
import re
from datetime import datetime, timedelta, timezone
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class EmailMessage:
    id: str
    subject: str
    sender: str
    date: str
    body: str
    labels: list[str] = field(default_factory=list)
    category: Optional[str] = None
    summary: Optional[str] = None


def _decode_body(payload: dict) -> str:
    """メール本文をデコードして返す。"""
    body = ""

    def extract_parts(part: dict) -> str:
        mime = part.get("mimeType", "")
        if mime == "text/plain":
            data = part.get("body", {}).get("data", "")
            if data:
                return base64.urlsafe_b64decode(data).decode("utf-8", errors="replace")
        elif mime.startswith("multipart/"):
            for sub in part.get("parts", []):
                text = extract_parts(sub)
                if text:
                    return text
        return ""

    body = extract_parts(payload)
    # HTML フォールバック（plain text がない場合）
    if not body:
        def extract_html(part: dict) -> str:
            mime = part.get("mimeType", "")
            if mime == "text/html":
                data = part.get("body", {}).get("data", "")
                if data:
                    raw = base64.urlsafe_b64decode(data).decode("utf-8", errors="replace")
                    return re.sub(r"<[^>]+>", " ", raw)
            elif mime.startswith("multipart/"):
                for sub in part.get("parts", []):
                    text = extract_html(sub)
                    if text:
                        return text
            return ""
        body = extract_html(payload)

    return body.strip()


def _get_header(headers: list[dict], name: str) -> str:
    for h in headers:
        if h["name"].lower() == name.lower():
            return h["value"]
    return ""


def fetch_recent_emails(service, days: int = 1, max_results: int = 100) -> list[EmailMessage]:
    """直近 `days` 日分の受信メールを取得して返す。"""
    since = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y/%m/%d")
    query = f"in:inbox after:{since}"

    result = service.users().messages().list(
        userId="me",
        q=query,
        maxResults=max_results,
    ).execute()

    messages_meta = result.get("messages", [])
    emails: list[EmailMessage] = []

    for meta in messages_meta:
        msg = service.users().messages().get(
            userId="me",
            id=meta["id"],
            format="full",
        ).execute()

        payload = msg.get("payload", {})
        headers = payload.get("headers", [])

        email = EmailMessage(
            id=meta["id"],
            subject=_get_header(headers, "Subject") or "(件名なし)",
            sender=_get_header(headers, "From"),
            date=_get_header(headers, "Date"),
            body=_decode_body(payload),
            labels=msg.get("labelIds", []),
        )
        emails.append(email)

    return emails
