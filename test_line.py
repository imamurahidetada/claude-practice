#!/usr/bin/env python3
"""
LINE Messaging API 接続テストスクリプト

使い方:
  python test_line.py          # .env からトークンを読み込んでテスト送信
  python test_line.py --dry    # 送信せず設定確認だけ行う

事前に .env に以下を設定しておいてください:
  LINE_CHANNEL_ACCESS_TOKEN=...
  LINE_RECIPIENT_ID=...
"""

import argparse
import os
import sys
from datetime import datetime

from dotenv import load_dotenv


def main() -> None:
    load_dotenv()

    parser = argparse.ArgumentParser(description="LINE Messaging API 接続テスト")
    parser.add_argument("--dry", action="store_true", help="送信せずに設定確認のみ行う")
    args = parser.parse_args()

    token = os.getenv("LINE_CHANNEL_ACCESS_TOKEN", "").strip()
    recipient_id = os.getenv("LINE_RECIPIENT_ID", "").strip()

    print("=" * 50)
    print("LINE Messaging API 接続テスト")
    print("=" * 50)

    # 設定確認
    ok = True
    if not token:
        print("  NG  LINE_CHANNEL_ACCESS_TOKEN が未設定です。")
        ok = False
    else:
        masked = token[:8] + "..." + token[-4:]
        print(f"  OK  LINE_CHANNEL_ACCESS_TOKEN = {masked}")

    if not recipient_id:
        print("  NG  LINE_RECIPIENT_ID が未設定です。")
        ok = False
    elif not (recipient_id.startswith("U") or recipient_id.startswith("C") or recipient_id.startswith("R")):
        print(f"  ??  LINE_RECIPIENT_ID = {recipient_id}  (User ID は U、Group ID は C から始まります)")
    else:
        print(f"  OK  LINE_RECIPIENT_ID = {recipient_id[:4]}...{recipient_id[-4:]}")

    if not ok:
        print()
        print("エラー: .env を確認して再実行してください。")
        print("設定方法は SETUP.md の Step 4 を参照してください。")
        sys.exit(1)

    if args.dry:
        print()
        print("--dry モード: 送信をスキップしました。設定に問題はありません。")
        return

    print()
    print("テストメッセージを送信中...")

    from gmail_classifier.notifier import LineMessagingNotifier
    notifier = LineMessagingNotifier(
        channel_access_token=token,
        recipient_id=recipient_id,
    )

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    test_message = (
        f"✅ Gmail 自動分類システム — 接続テスト成功\n"
        f"送信日時: {now}\n"
        f"\n"
        f"このメッセージが届いていれば LINE Messaging API の設定は完了です。\n"
        f"あとは cron を設定すれば毎朝自動通知が届きます。"
    )

    success = notifier.send(test_message)

    if success:
        print("  送信成功！LINE を確認してください。")
        print()
        print("次のステップ: cron を設定して自動実行を有効化する")
        print("  crontab -e")
        print("  0 9 * * * cd $(pwd) && python3 main.py --notify >> logs/cron.log 2>&1")
    else:
        print("  送信失敗。エラーの詳細は上記ログを確認してください。")
        print()
        print("よくある原因:")
        print("  - Bot をまだ友だち追加していない")
        print("  - LINE_RECIPIENT_ID が間違っている")
        print("  - Channel Access Token が無効または期限切れ")
        sys.exit(1)


if __name__ == "__main__":
    main()
