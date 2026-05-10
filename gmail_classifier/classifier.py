import json
import anthropic
from .fetcher import EmailMessage

DEFAULT_CATEGORIES = [
    "仕事",
    "プロジェクト",
    "請求・支払い",
    "ニュースレター",
    "個人",
    "スパム・広告",
    "その他",
]

_CLASSIFY_SYSTEM = """\
あなたはメール分類の専門家です。与えられたメール情報をもとに、
カテゴリを1つ選び、3〜5文の日本語要約を作成してください。
必ず以下の JSON 形式のみで返してください（他のテキストは不要）:
{"category": "<カテゴリ>", "summary": "<要約>"}
"""


class EmailClassifier:
    def __init__(self, api_key: str, model: str, categories: list[str] | None = None):
        self._client = anthropic.Anthropic(api_key=api_key)
        self._model = model
        self._categories = categories or DEFAULT_CATEGORIES

    def process(self, email: EmailMessage) -> EmailMessage:
        """メールを分類・要約して in-place で更新し返す。"""
        body_preview = email.body[:2000] if email.body else "(本文なし)"
        categories_str = "、".join(self._categories)

        prompt = f"""\
以下のメールを分析してください。

件名: {email.subject}
送信者: {email.sender}
受信日: {email.date}
本文（抜粋）:
{body_preview}

選択可能なカテゴリ: {categories_str}

カテゴリを1つ選び、3〜5文の日本語要約を JSON で返してください。"""

        response = self._client.messages.create(
            model=self._model,
            max_tokens=512,
            system=_CLASSIFY_SYSTEM,
            messages=[{"role": "user", "content": prompt}],
        )

        raw = response.content[0].text.strip()
        # JSON ブロックを抽出（```json ... ``` 形式にも対応）
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        try:
            data = json.loads(raw)
            email.category = data.get("category", "その他")
            email.summary = data.get("summary", "")
        except json.JSONDecodeError:
            email.category = "その他"
            email.summary = raw[:300]

        return email

    def process_all(self, emails: list[EmailMessage]) -> list[EmailMessage]:
        """メールリストをまとめて処理する。"""
        for i, email in enumerate(emails, 1):
            print(f"  [{i}/{len(emails)}] 処理中: {email.subject[:50]}")
            self.process(email)
        return emails
