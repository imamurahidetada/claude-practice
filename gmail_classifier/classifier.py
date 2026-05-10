import json
import re
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
あなたはメール分類の専門家です。与えられたメール情報をもとに以下を判断してください。

1. カテゴリ: 候補から1つ選ぶ
2. 重要度: 1〜5 の整数（5 が最重要）
   - 5: 即対応必須（締め切り・緊急連絡・重要契約）
   - 4: 近日中に対応（会議設定・重要依頼）
   - 3: 確認推奨（一般業務・返信が必要な個人連絡）
   - 2: 参考程度（FYI・ニュースレター）
   - 1: 対応不要（広告・スパム・自動通知）
3. 要約: 100文字以内の日本語

必ず以下の JSON 形式のみで返してください（他のテキストは不要）:
{"category": "<カテゴリ>", "importance": <1-5の整数>, "summary": "<100文字以内の要約>"}
"""


def _extract_json(raw: str) -> dict:
    """Claude レスポンスから JSON を抽出してパースする。"""
    text = raw.strip()
    # ```json ... ``` ブロックを除去
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # 最初の { ... } を探す
        m = re.search(r"\{[^{}]+\}", text)
        if m:
            return json.loads(m.group())
        return {}


class EmailClassifier:
    def __init__(self, api_key: str, model: str, categories: list[str] | None = None):
        self._client = anthropic.Anthropic(api_key=api_key)
        self._model = model
        self._categories = categories or DEFAULT_CATEGORIES

    def process(self, email: EmailMessage) -> EmailMessage:
        """メールを分類・要約・重要度判定して in-place で更新し返す。"""
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

カテゴリ、重要度（1〜5）、100文字以内の要約を JSON で返してください。"""

        response = self._client.messages.create(
            model=self._model,
            max_tokens=512,
            system=_CLASSIFY_SYSTEM,
            messages=[{"role": "user", "content": prompt}],
        )

        raw = response.content[0].text
        data = _extract_json(raw)

        email.category = data.get("category", "その他")
        email.importance = int(data.get("importance", 3))
        summary = data.get("summary", "")
        email.summary = summary[:100] if summary else ""

        return email

    def process_all(self, emails: list[EmailMessage], logger=None) -> list[EmailMessage]:
        """メールリストをまとめて処理する。"""
        for i, email in enumerate(emails, 1):
            label = f"[{i}/{len(emails)}] {email.subject[:50]}"
            try:
                self.process(email)
                print(f"  ✓ {label}")
            except Exception as exc:
                print(f"  ✗ {label} — {exc}")
                if logger:
                    logger.error("分類失敗: %s — %s", email.subject, exc)
                email.category = "その他"
                email.importance = 3
                email.summary = ""
        return emails
