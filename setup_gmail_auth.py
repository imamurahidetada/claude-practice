#!/usr/bin/env python3
"""
Gmail 認証トークン生成スクリプト（ヘッドレス環境用）

【Step 1】認証 URL を生成:
  python setup_gmail_auth.py

【Step 2】認証コードを貼り付けてトークンを生成:
  python setup_gmail_auth.py --code "4/0AXxxxxxx..."
  または
  python setup_gmail_auth.py --code "http://localhost/?code=4/0AXxxxxxx..."
"""

import argparse
import os
import re
import sys

from dotenv import load_dotenv
from google_auth_oauthlib.flow import InstalledAppFlow

load_dotenv()

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]


def main() -> None:
    parser = argparse.ArgumentParser(description="Gmail OAuth トークン生成")
    parser.add_argument("--code", help="認証後にブラウザの URL バーに表示されるコード")
    parser.add_argument(
        "--credentials",
        default=os.getenv("GMAIL_CREDENTIALS_FILE", "credentials.json"),
    )
    parser.add_argument(
        "--token",
        default=os.getenv("GMAIL_TOKEN_FILE", "token.json"),
    )
    args = parser.parse_args()

    if not os.path.exists(args.credentials):
        print(f"エラー: {args.credentials} が見つかりません。")
        sys.exit(1)

    flow = InstalledAppFlow.from_client_secrets_file(
        args.credentials,
        SCOPES,
        redirect_uri="http://localhost",
    )

    if not args.code:
        # ---- Step 1: 認証 URL を生成して表示 ----
        auth_url, _ = flow.authorization_url(
            access_type="offline",
            prompt="consent",
        )
        print("=" * 60)
        print("【Step 1】以下の URL をブラウザで開いてください")
        print("=" * 60)
        print()
        print(auth_url)
        print()
        print("=" * 60)
        print("認証後、ブラウザのアドレスバーに表示される URL をコピーしてください。")
        print("（http://localhost/?code=4/0AX... のような URL です）")
        print()
        print("コピーしたら以下のコマンドを実行:")
        print('  python setup_gmail_auth.py --code "ここにURLまたはコードを貼り付け"')
        print("=" * 60)
        return

    # ---- Step 2: コードをトークンに交換 ----
    code = args.code.strip()

    # URL 全体が貼り付けられた場合、code= パラメータを抽出
    if code.startswith("http"):
        m = re.search(r"[?&]code=([^&]+)", code)
        if not m:
            print("エラー: URL から認証コードを抽出できませんでした。")
            sys.exit(1)
        code = m.group(1)

    print(f"認証コードを受け取りました。トークンを取得中...")
    try:
        flow.fetch_token(code=code)
    except Exception as exc:
        print(f"エラー: トークン取得に失敗しました — {exc}")
        print("認証コードの有効期限が切れている場合は Step 1 からやり直してください。")
        sys.exit(1)

    creds = flow.credentials
    with open(args.token, "w") as f:
        f.write(creds.to_json())

    print(f"✅ {args.token} を生成しました。")
    print()
    print("次のコマンドで Gmail 分類を実行できます:")
    print("  python main.py --days 7 --max 50")


if __name__ == "__main__":
    main()
