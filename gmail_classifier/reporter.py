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
        """分類済みメールから Markdown レポートを生成し、ファイルパスを返す。"""
        date = date or datetime.now()
        date_str = date.strftime("%Y-%m-%d")

        by_category: dict[str, list[EmailMessage]] = defaultdict(list)
        for email in emails:
            by_category[email.category or "その他"].append(email)

        lines = [
            f"# メール日次レポート - {date_str}",
            "",
            f"**取得件数:** {len(emails)} 件",
            f"**生成日時:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
            "",
            "---",
            "",
            "## カテゴリ別サマリー",
            "",
            "| カテゴリ | 件数 |",
            "|---|---|",
        ]

        for cat in sorted(by_category.keys()):
            lines.append(f"| {cat} | {len(by_category[cat])} 件 |")

        lines += ["", "---", ""]

        for cat in sorted(by_category.keys()):
            mails = by_category[cat]
            lines.append(f"## {cat} ({len(mails)} 件)")
            lines.append("")
            for mail in mails:
                lines.append(f"### {mail.subject}")
                lines.append(f"- **送信者:** {mail.sender}")
                lines.append(f"- **受信日:** {mail.date}")
                lines.append(f"- **要約:** {mail.summary or '（要約なし）'}")
                lines.append("")

        report_md = "\n".join(lines)

        md_path = os.path.join(self._output_dir, f"report_{date_str}.md")
        with open(md_path, "w", encoding="utf-8") as f:
            f.write(report_md)

        json_path = os.path.join(self._output_dir, f"report_{date_str}.json")
        json_data = {
            "date": date_str,
            "total": len(emails),
            "emails": [
                {
                    "id": e.id,
                    "subject": e.subject,
                    "sender": e.sender,
                    "date": e.date,
                    "category": e.category,
                    "summary": e.summary,
                }
                for e in emails
            ],
        }
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(json_data, f, ensure_ascii=False, indent=2)

        return md_path
