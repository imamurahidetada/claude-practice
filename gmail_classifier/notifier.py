import json
import logging
import os
import requests

LINE_NOTIFY_URL = "https://notify-api.line.me/api/notify"

logger = logging.getLogger(__name__)


class LineNotifier:
    def __init__(self, token: str):
        self._token = token
        self._headers = {"Authorization": f"Bearer {token}"}

    def send(self, message: str) -> bool:
        """LINE Notify にメッセージを送信する。成功で True を返す。"""
        try:
            resp = requests.post(
                LINE_NOTIFY_URL,
                headers=self._headers,
                data={"message": message},
                timeout=10,
            )
            resp.raise_for_status()
            logger.info("LINE Notify 送信成功")
            return True
        except requests.RequestException as exc:
            logger.error("LINE Notify 送信失敗: %s", exc)
            return False

    def send_daily_report(self, report_path: str) -> bool:
        """JSON レポートを読み込んで日次通知メッセージを送信する。"""
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
            "",
            f"📧 メール日次レポート ({date})",
            f"受信件数: {total} 件",
            "",
            "【カテゴリ別】",
        ]

        # 重要度の高いカテゴリから順に表示
        for cat, info in sorted(classified.items(), key=lambda x: -x[1].get("importance", 0)):
            count = info.get("count", 0)
            imp = info.get("importance", 0)
            star = "★" * imp + "☆" * (5 - imp)
            lines.append(f"  {cat}: {count}件  {star}")

        # 重要度 4〜5 のメールを優先表示
        high_emails = []
        for cat, info in classified.items():
            for email in info.get("emails", []):
                if email.get("importance", 0) >= 4:
                    high_emails.append(email)

        if high_emails:
            high_emails.sort(key=lambda x: -x.get("importance", 0))
            lines += ["", "【要対応メール】"]
            for email in high_emails[:5]:  # 最大5件
                imp = email.get("importance", 0)
                prefix = "🔴" if imp == 5 else "🟠"
                subject = email.get("subject", "")[:30]
                summary = email.get("summary", "")[:50]
                lines.append(f"  {prefix} {subject}")
                if summary:
                    lines.append(f"      → {summary}")

        message = "\n".join(lines)
        # LINE Notify は 1000 文字制限
        if len(message) > 1000:
            message = message[:997] + "..."

        return self.send(message)


def build_notifier_from_env() -> "LineNotifier | None":
    """環境変数から LineNotifier を構築する。トークン未設定なら None を返す。"""
    token = os.getenv("LINE_NOTIFY_TOKEN", "").strip()
    if not token:
        return None
    return LineNotifier(token)
