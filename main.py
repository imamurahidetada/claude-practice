#!/usr/bin/env python3
"""
Gmail 自動分類・要約システム

使い方:
  python main.py                   # 今日のメールを処理
  python main.py --days 1          # 過去 24 時間分（デフォルト）
  python main.py --max 50          # 最大 50 件を処理
  python main.py --notify          # 処理後に LINE Notify で通知
  python main.py --output ./out    # 出力先を変更
"""

import argparse
import logging
import os
import sys
from collections import Counter
from datetime import datetime

from dotenv import load_dotenv


def _setup_logging(log_dir: str) -> logging.Logger:
    os.makedirs(log_dir, exist_ok=True)
    log_file = os.path.join(log_dir, "cron.log")

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=[
            logging.FileHandler(log_file, encoding="utf-8"),
            logging.StreamHandler(sys.stdout),
        ],
    )
    return logging.getLogger(__name__)


def _check_env(key: str, logger: logging.Logger) -> str:
    value = os.getenv(key, "").strip()
    if not value:
        logger.error("環境変数 %s が設定されていません。", key)
        sys.exit(1)
    return value


def main() -> None:
    load_dotenv()

    parser = argparse.ArgumentParser(description="Gmail 自動分類・要約システム")
    parser.add_argument("--days", type=int, default=int(os.getenv("FETCH_DAYS", "1")),
                        help="取得する日数 (デフォルト: 1)")
    parser.add_argument("--max", type=int, default=100, dest="max_results",
                        help="最大取得件数 (デフォルト: 100)")
    parser.add_argument("--output", type=str, default=os.getenv("REPORT_OUTPUT_DIR", "reports"),
                        help="レポート出力ディレクトリ")
    parser.add_argument("--notify", action="store_true",
                        help="処理後に LINE Notify で通知する")
    parser.add_argument("--log-dir", type=str, default="logs",
                        help="ログディレクトリ (デフォルト: logs)")
    args = parser.parse_args()

    logger = _setup_logging(args.log_dir)

    logger.info("=" * 50)
    logger.info("Gmail 自動分類・要約システム 開始")
    logger.info("対象期間: 過去 %d 日間 / 最大 %d 件", args.days, args.max_results)

    # 必須環境変数
    api_key = _check_env("ANTHROPIC_API_KEY", logger)

    credentials_file = os.getenv("GMAIL_CREDENTIALS_FILE", "credentials.json")
    if not os.path.exists(credentials_file):
        logger.error("Gmail 認証ファイル '%s' が見つかりません。SETUP.md を参照してください。", credentials_file)
        sys.exit(1)

    token_file = os.getenv("GMAIL_TOKEN_FILE", "token.json")
    model = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6")
    categories_env = os.getenv("EMAIL_CATEGORIES", "")
    categories = [c.strip() for c in categories_env.split(",") if c.strip()] or None

    # ---- Phase 1: Gmail 取得 ----
    from gmail_classifier.auth import get_gmail_service
    from gmail_classifier.fetcher import fetch_recent_emails

    logger.info("Gmail に接続中...")
    try:
        service = get_gmail_service(credentials_file, token_file)
        logger.info("Gmail 接続完了。")
    except Exception as exc:
        logger.error("Gmail 接続失敗: %s", exc)
        sys.exit(1)

    logger.info("メールを取得中...")
    try:
        emails = fetch_recent_emails(service, days=args.days, max_results=args.max_results)
        logger.info("%d 件のメールを取得しました。", len(emails))
    except Exception as exc:
        logger.error("メール取得失敗: %s", exc)
        sys.exit(1)

    if not emails:
        logger.info("処理するメールがありません。終了します。")
        return

    # ---- Phase 2: Claude で分類・要約 ----
    from gmail_classifier.classifier import EmailClassifier

    logger.info("Claude API でメールを分類・要約中... (モデル: %s)", model)
    classifier = EmailClassifier(api_key=api_key, model=model, categories=categories)
    classifier.process_all(emails, logger=logger)

    cat_counts = Counter(e.category for e in emails)
    logger.info("分類完了: %s", dict(cat_counts))

    # ---- Phase 3: レポート生成 ----
    from gmail_classifier.reporter import ReportGenerator

    logger.info("レポートを生成中...")
    reporter = ReportGenerator(output_dir=args.output)
    json_path = reporter.generate(emails, date=datetime.now())
    logger.info("レポートを保存しました: %s", json_path)

    # ---- Phase 4: LINE Notify ----
    if args.notify:
        from gmail_classifier.notifier import build_notifier_from_env

        notifier = build_notifier_from_env()
        if notifier:
            logger.info("LINE Notify に通知中...")
            success = notifier.send_daily_report(json_path)
            if success:
                logger.info("LINE Notify 送信完了。")
            else:
                logger.error("LINE Notify 送信失敗。logs/cron.log を確認してください。")
        else:
            logger.warning("LINE_NOTIFY_TOKEN が未設定のため通知をスキップしました。")

    # ---- サマリー表示 ----
    print()
    print("=" * 50)
    print("=== 分類結果サマリー ===")
    for cat, count in sorted(cat_counts.items(), key=lambda x: -x[1]):
        high = sum(1 for e in emails if e.category == cat and e.importance >= 4)
        suffix = f"  (要対応: {high} 件)" if high else ""
        print(f"  {cat}: {count} 件{suffix}")
    print(f"\nレポート: {json_path}")
    print("=" * 50)
    logger.info("処理完了。")


if __name__ == "__main__":
    main()
