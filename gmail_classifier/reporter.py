import json
import os
from collections import defaultdict
from datetime import datetime
from .fetcher import EmailMessage


class ReportGenerator:
    def __init__(self, output_dir: str = "reports"):
        self._output_dir = output_dir
        os.makedirs(output_dir, exist_ok=True)

    def generate(self, emails: list[EmailMessage], date: datetime | None = None) -> str:
        """分類済みメールから JSON + Markdown レポートを生成し、JSON パスを返す。"""
        date = date or datetime.now()
        date_str = date.strftime("%Y-%m-%d")

        by_category: dict[str, list[EmailMessage]] = defaultdict(list)
        for email in emails:
            by_category[email.category or "その他"].append(email)

        # 指定フォーマットの JSON
        classified: dict[str, dict] = {}
        for cat, mails in by_category.items():
            max_importance = max(m.importance for m in mails)
            classified[cat] = {
                "count": len(mails),
                "importance": max_importance,
                "emails": [
                    {
                        "id": m.id,
                        "subject": m.subject,
                        "sender": m.sender,
                        "date": m.date,
                        "importance": m.importance,
                        "summary": m.summary or "",
                    }
                    for m in sorted(mails, key=lambda x: -x.importance)
                ],
            }

        json_data = {
            "date": date_str,
            "total_count": len(emails),
            "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "classified": classified,
        }

        json_path = os.path.join(self._output_dir, f"report_{date_str}.json")
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(json_data, f, ensure_ascii=False, indent=2)

        # Markdown レポートも並行して生成
        self._write_markdown(emails, by_category, date_str)

        return json_path

    def _write_markdown(
        self,
        emails: list[EmailMessage],
        by_category: dict[str, list[EmailMessage]],
        date_str: str,
    ) -> None:
        importance_labels = {5: "🔴 緊急", 4: "🟠 高", 3: "🟡 中", 2: "🟢 低", 1: "⚪ 最低"}

        lines = [
            f"# メール日次レポート — {date_str}",
            "",
            f"**取得件数:** {len(emails)} 件  ",
            f"**生成日時:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
            "",
            "---",
            "",
            "## カテゴリ別サマリー",
            "",
            "| カテゴリ | 件数 | 最高重要度 |",
            "|---|:---:|:---:|",
        ]

        for cat in sorted(by_category.keys()):
            mails = by_category[cat]
            max_imp = max(m.importance for m in mails)
            label = importance_labels.get(max_imp, str(max_imp))
            lines.append(f"| {cat} | {len(mails)} | {label} |")

        lines += ["", "---", ""]

        # 重要度の高いカテゴリから順に出力
        for cat in sorted(by_category.keys(), key=lambda c: -max(m.importance for m in by_category[c])):
            mails = sorted(by_category[cat], key=lambda m: -m.importance)
            max_imp = max(m.importance for m in mails)
            label = importance_labels.get(max_imp, str(max_imp))
            lines.append(f"## {cat} — {label} ({len(mails)} 件)")
            lines.append("")
            for mail in mails:
                imp_label = importance_labels.get(mail.importance, str(mail.importance))
                lines.append(f"### {mail.subject}")
                lines.append(f"- **送信者:** {mail.sender}")
                lines.append(f"- **受信日:** {mail.date}")
                lines.append(f"- **重要度:** {imp_label}")
                lines.append(f"- **要約:** {mail.summary or '（要約なし）'}")
                lines.append("")

        md_path = os.path.join(self._output_dir, f"report_{date_str}.md")
        with open(md_path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))
