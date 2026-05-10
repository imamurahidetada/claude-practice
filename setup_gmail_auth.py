#!/usr/bin/env python3
"""
Gmail 認証トークン生成スクリプト（ヘッドレス環境用・PKCE なし）

【Step 1】認証 URL を生成:
  python setup_gmail_auth.py

【Step 2】認証後の URL またはコードを貼り付け:
  python setup_gmail_auth.py --code "http://localhost/?code=4/0AX..."
  または
  python setup_gmail_auth.py --code "4/0AX..."
"""

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone

import requests
from dotenv import load_dotenv

load_dotenv()

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]
AUTH_URL = "https://accounts.google.com/o/oauth2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
REDIRECT_URI = "http://localhost"
STATE_FILE = ".oauth_state.json"


def load_client(credentials_file: str) -> dict:
    with open(credentials_file) as f:
        data = json.load(f)
    return data.get("installed") or data.get("web")


def step1_generate_url(credentials_file: str) -> None:
    client = load_client(credentials_file)
    params = {
        "response_type": "code",
        "client_id": client["client_id"],
        "redirect_uri": REDIRECT_URI,
        "scope": " ".join(SCOPES),
        "access_type": "offline",
        "prompt": "consent",
    }
    auth_url = AUTH_URL + "?" + "&".join(f"{k}={v}" for k, v in params.items())

    with open(STATE_FILE, "w") as f:
        json.dump({"client_id": client["client_id"], "client_secret": client["client_secret"]}, f)

    print("=" * 60)
    print("【Step 1】以下の URL をブラウザで開いてください")
    print("=" * 60)
    print()
    print(auth_url)
    print()
    print("=" * 60)
    print("Google アカウントでログイン → 「許可」をクリック")
    print()
    print("ブラウザが http://localhost/?code=... に遷移します。")
    print("（ページが開かなくてもOK）")
    print()
    print("アドレスバーの URL 全体をコピーして以下を実行:")
    print('  python setup_gmail_auth.py --code "コピーした URL"')
    print("=" * 60)


def step2_exchange_code(code_or_url: str, token_file: str) -> None:
    if not os.path.exists(STATE_FILE):
        print("エラー: .oauth_state.json が見つかりません。先に Step 1 を実行してください。")
        sys.exit(1)

    with open(STATE_FILE) as f:
        state = json.load(f)

    # URL 全体から code= を抽出
    text = code_or_url.strip()
    if text.startswith("http"):
        m = re.search(r"[?&]code=([^&]+)", text)
        if not m:
            print("エラー: URL から認証コードを抽出できませんでした。")
            sys.exit(1)
        code = m.group(1)
    else:
        code = text

    print("認証コードを受け取りました。トークンを取得中...")

    resp = requests.post(
        TOKEN_URL,
        data={
            "code": code,
            "client_id": state["client_id"],
            "client_secret": state["client_secret"],
            "redirect_uri": REDIRECT_URI,
            "grant_type": "authorization_code",
        },
        timeout=15,
    )

    if not resp.ok:
        print(f"エラー: {resp.status_code} — {resp.text}")
        print("認証コードの有効期限が切れている場合は Step 1 からやり直してください。")
        sys.exit(1)

    token_data = resp.json()

    # google-auth が読める token.json 形式で保存
    expiry = datetime.now(timezone.utc).isoformat()
    token_json = {
        "token": token_data["access_token"],
        "refresh_token": token_data.get("refresh_token", ""),
        "token_uri": TOKEN_URL,
        "client_id": state["client_id"],
        "client_secret": state["client_secret"],
        "scopes": SCOPES,
        "expiry": expiry,
    }
    with open(token_file, "w") as f:
        json.dump(token_json, f, indent=2)

    os.remove(STATE_FILE)
    print(f"✅ {token_file} を生成しました。")
    print()
    print("次のコマンドで Gmail 分類を実行できます:")
    print("  python main.py --days 7 --max 50")


def main() -> None:
    parser = argparse.ArgumentParser(description="Gmail OAuth トークン生成（PKCE なし）")
    parser.add_argument("--code", help="認証後の URL またはコード")
    parser.add_argument("--credentials", default=os.getenv("GMAIL_CREDENTIALS_FILE", "credentials.json"))
    parser.add_argument("--token", default=os.getenv("GMAIL_TOKEN_FILE", "token.json"))
    args = parser.parse_args()

    if not os.path.exists(args.credentials):
        print(f"エラー: {args.credentials} が見つかりません。")
        sys.exit(1)

    if args.code:
        step2_exchange_code(args.code, args.token)
    else:
        step1_generate_url(args.credentials)


if __name__ == "__main__":
    main()
