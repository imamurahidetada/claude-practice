import json
import logging
import os
import requests

LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push"
LINE_MULTICAST_URL = "https://api.line.me/v2/bot/message/multicast"
LINE_TEXT_LIMIT = 5000

logger = logging.getLogger(__name__)


class LineMessagingNotifier:
    """LINE Messaging API (Push Message) を使った通知クライアント。"""

    def __init__(self, channel_access_token: str, recipient_id: str):
        """
        Args:
            channel_access_token: LINE Developers で発行した Channel Access Token
            recipient_id: 送信先の User ID（Uxxxxxxx）または Group ID（Cxxxxxxx）
        """
        self._token = channel_access_token
        self._recipient_id = recipient_id
        self._headers = {
            "Authorization": f"Bearer {channel_access_token}",
            "Content-Type": "application/json",
        }

    def send(self, text: str) -> bool:
        """テキストメッセージを送信する。5000文字を超える場合は分割して送る。成功で True を返す。"""
        chunks = _split_text(text, LINE_TEXT_LIMIT)
        messages = [{"type": "text", "text": chunk} for chunk in chunks]

        # Messaging API は1回に最大5メッセージ
        for i in range(0, len(messages), 5):
            batch = messages[i:i + 5]
            payload = {"to": self._recipient_id, "messages": batch}
            try:
                resp = requests.post(
                    LINE_PUSH_URL,
                    headers=self._headers,
                    json=payload,
                    timeout=10,
                )
                resp.raise_for_status()
            except requests.RequestException as exc:
                logger.error("LINE Messaging API 送信失敗: %s — レスポンス: %s", exc,
                             getattr(exc.response, "text", "") if hasattr(exc, "response") else "")
                return False

        logger.info("LINE Messaging API 送信成功（%d メッセージ）", len(messages))
        return True

    def send_daily_report(self, report_path: str) -> bool:
        """JSON レポートを読み込んで日次サマリーを送信する。"""
        try:
            with open(report_path, encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, json.JSONDecodeError) as exc:
            logger.error("レポートファイル読み込み失敗: %s", exc)
            return False

        date = data.get("date", "不明")
        total = data.get("total_count", 0)
        classified: dict = data.get("classified", {})

        lines = [
            f"📧 メール日次レポート ({date})",
            f"受信件数: {total} 件",
            "",
            "【カテゴリ別】",
        ]

        for cat, info in sorted(classified.items(), key=lambda x: -x[1].get("importance", 0)):
            count = info.get("count", 0)
            imp = info.get("importance", 0)
            star = "★" * imp + "☆" * (5 - imp)
            lines.append(f"  {cat}: {count}件  {star}")

        # 重要度 4〜5 のメールを優先表示
        high_emails = [
            email
            for info in classified.values()
            for email in info.get("emails", [])
            if email.get("importance", 0) >= 4
        ]

        if high_emails:
            high_emails.sort(key=lambda x: -x.get("importance", 0))
            lines += ["", "【要対応メール】"]
            for email in high_emails[:5]:
                imp = email.get("importance", 0)
                prefix = "🔴" if imp == 5 else "🟠"
                subject = email.get("subject", "")[:30]
                summary = email.get("summary", "")[:60]
                lines.append(f"{prefix} {subject}")
                if summary:
                    lines.append(f"   → {summary}")

        return self.send("\n".join(lines))


def _split_text(text: str, limit: int) -> list[str]:
    """テキストを limit 文字以内のチャンクに分割する。"""
    if len(text) <= limit:
        return [text]
    chunks = []
    while text:
        chunks.append(text[:limit])
        text = text[limit:]
    return chunks


def build_notifier_from_env() -> "LineMessagingNotifier | None":
    """環境変数から LineMessagingNotifier を構築する。未設定なら None を返す。"""
    token = os.getenv("LINE_CHANNEL_ACCESS_TOKEN", "").strip()
    recipient_id = os.getenv("LINE_RECIPIENT_ID", "").strip()

    if not token:
        logger.warning("LINE_CHANNEL_ACCESS_TOKEN が未設定です。")
        return None
    if not recipient_id:
        logger.warning("LINE_RECIPIENT_ID が未設定です。")
        return None

    return LineMessagingNotifier(channel_access_token=token, recipient_id=recipient_id)
