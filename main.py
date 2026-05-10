#!/usr/bin/env python3
"""
Gmail 自動分類・要約システム

使い方:
  python main.py               # 今日のメールを処理
  python main.py --days 3      # 過去3日分を処理
  python main.py --max 50      # 最大50件を処理
  python main.py --output ./out  # 出力先を変更
"""

import argparse
import os
import sys
from datetime import datetime
from dotenv import load_dotenv

from gmail_classifier.auth import get_gmail_service
from gmail_classifier.fetcher import fetch_recent_emails
from gmail_classifier.classifier import EmailClassifier
from gmail_classifier.reporter import ReportGenerator


def main() -> None:
    load_dotenv()

    parser = argparse.ArgumentParser(description="Gmail 自動分類・要約システム")
    parser.add_argument("--days", type=int, default=int(os.getenv("FETCH_DAYS", "1")),
                        help="取得する日数 (デフォルト: 1)")
    parser.add_argument("--max", type=int, default=100, dest="max_results",
                        help="最大取得件数 (デフォルト: 100)")
    parser.add_argument("--output", type=str, default=os.getenv("REPORT_OUTPUT_DIR", "reports"),
                        help="レポート出力ディレクトリ")
    args = parser.parse_args()

    # 必須環境変数チェック
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        print("エラー: ANTHROPIC_API_KEY が設定されていません。", file=sys.stderr)
        sys.exit(1)

    credentials_file = os.getenv("GMAIL_CREDENTIALS_FILE", "credentials.json")
    if not os.path.exists(credentials_file):
        print(f"エラー: Gmail 認証ファイル '{credentials_file}' が見つかりません。", file=sys.stderr)
        print("SETUP.md を参照して Google Cloud Console から認証情報を取得してください。", file=sys.stderr)
        sys.exit(1)

    token_file = os.getenv("GMAIL_TOKEN_FILE", "token.json")
    model = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6")
    categories_env = os.getenv("EMAIL_CATEGORIES", "")
    categories = [c.strip() for c in categories_env.split(",") if c.strip()] or None

    print("=" * 60)
    print("Gmail 自動分類・要約システム")
    print("=" * 60)
    print(f"対象期間: 過去 {args.days} 日間")
    print(f"使用モデル: {model}")
    print()

    # Gmail 認証
    print("Gmail に接続中...")
    service = get_gmail_service(credentials_file, token_file)
    print("接続完了。")
    print()

    # メール取得
    print(f"メールを取得中（最大 {args.max_results} 件）...")
    emails = fetch_recent_emails(service, days=args.days, max_results=args.max_results)
    print(f"{len(emails)} 件のメールを取得しました。")
    print()

    if not emails:
        print("処理するメールがありません。")
        return

    # 分類・要約
    print("Claude API でメールを分類・要約中...")
    classifier = EmailClassifier(api_key=api_key, model=model, categories=categories)
    classifier.process_all(emails)
    print()

    # レポート生成
    print("レポートを生成中...")
    reporter = ReportGenerator(output_dir=args.output)
    report_path = reporter.generate(emails, date=datetime.now())
    print(f"レポートを保存しました: {report_path}")
    print()

    # サマリー表示
    from collections import Counter
    cat_counts = Counter(e.category for e in emails)
    print("=== 分類結果 ===")
    for cat, count in sorted(cat_counts.items(), key=lambda x: -x[1]):
        print(f"  {cat}: {count} 件")
    print()
    print("完了。")


if __name__ == "__main__":
    main()
