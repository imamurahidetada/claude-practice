# セットアップガイド

## 前提条件

- Python 3.11 以上
- Google アカウント
- Anthropic API アカウント
- LINE アカウント（通知機能を使う場合）

---

## Step 1: Python 依存ライブラリのインストール

```bash
pip install -r requirements.txt
```

---

## Step 2: Gmail API の設定

### 2-1. Google Cloud Console でプロジェクト作成

1. [Google Cloud Console](https://console.cloud.google.com/) にアクセス
2. 画面上部の「プロジェクトを選択」→「新しいプロジェクト」をクリック
3. プロジェクト名を入力して「作成」

### 2-2. Gmail API を有効化

1. 左メニュー「APIs & Services」→「Enable APIs and Services」
2. "Gmail API" を検索して「有効にする」

### 2-3. OAuth 同意画面の設定

1. 「APIs & Services」→「OAuth consent screen」
2. User Type: **外部** を選択して「作成」
3. アプリ名・サポートメールを入力して「保存して次へ」
4. スコープは追加不要→「保存して次へ」
5. テストユーザーに **自分の Gmail アドレス** を追加

### 2-4. OAuth 認証情報の作成

1. 「APIs & Services」→「Credentials」→「CREATE CREDENTIALS」→「OAuth client ID」
2. アプリケーションの種類: **Desktop app**
3. 名前を入力して「作成」
4. 「JSON をダウンロード」→ `credentials.json` としてプロジェクトルートに保存

---

## Step 3: 環境変数の設定

```bash
cp .env.example .env
```

`.env` を開いて編集:

```env
# 必須
ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxx

# Gmail（credentials.json の場所）
GMAIL_CREDENTIALS_FILE=credentials.json
GMAIL_TOKEN_FILE=token.json

# 分類カテゴリ（カスタマイズ可）
EMAIL_CATEGORIES=仕事,プロジェクト,請求・支払い,ニュースレター,個人,スパム・広告,その他

# LINE Messaging API（通知を使う場合）
LINE_CHANNEL_ACCESS_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
LINE_RECIPIENT_ID=Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

---

## Step 4: LINE Messaging API の設定

> LINE Notify は 2025 年 3 月にサービス終了したため、LINE Messaging API を使用します。

### 4-1. LINE Developers でチャネルを作成

1. [LINE Developers コンソール](https://developers.line.biz/console/) にアクセス（LINE アカウントでログイン）
2. 「プロバイダー」→「作成」→ プロバイダー名を入力
3. 「チャネルを作成する」→「Messaging API」を選択
4. 各項目を入力して「作成」

### 4-2. Channel Access Token を取得

1. 作成したチャネルを開く
2. 「Messaging API 設定」タブ → 一番下の **「Channel access token」**
3. 「発行」ボタンをクリック
4. 表示されたトークンを `.env` の `LINE_CHANNEL_ACCESS_TOKEN` に設定

### 4-3. Bot を友だち追加

1. 「Messaging API 設定」タブの QR コードを LINE アプリでスキャン
2. Bot を友だち追加する

### 4-4. 送信先 ID（LINE_RECIPIENT_ID）を確認

Bot に何かメッセージを送ったあと、以下のいずれかで User ID を取得します。

**方法 A: Webhook で確認（推奨）**

チャネルの「Messaging API 設定」→ Webhook URL に任意のサーバーを設定し、
Bot へのメッセージイベントに含まれる `source.userId` を確認する。

**方法 B: curl で確認（簡単）**

```bash
# Bot に "hello" とメッセージを送ってから実行
curl -H "Authorization: Bearer YOUR_CHANNEL_ACCESS_TOKEN" \
  https://api.line.me/v2/bot/followers/ids
```

返却される `userIds` の最初の値が自分の User ID（`Uxxxxxxxx`）です。

```bash
# 取得できたら .env に設定
LINE_RECIPIENT_ID=Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

> **グループに送る場合**: Group ID（`Cxxxxxxxx`）を `LINE_RECIPIENT_ID` に設定してください。

> **注意**: Channel Access Token は再発行のたびに旧トークンが無効になります。

---

## Step 5: 初回実行と Gmail 認証

```bash
python main.py
```

初回実行時:
1. ブラウザが自動で開きます
2. Google アカウントでログイン
3. 「このアプリは確認されていません」→「詳細」→「（アプリ名）に移動」
4. 「許可」をクリック
5. `token.json` が自動生成されます（次回以降は自動認証）

---

## Step 5-b: LINE Messaging API の接続テスト

`.env` に `LINE_CHANNEL_ACCESS_TOKEN` と `LINE_RECIPIENT_ID` を設定したら、
以下のテストスクリプトで動作確認できます。

```bash
# 設定確認のみ（送信しない）
python test_line.py --dry

# テストメッセージを実際に送信
python test_line.py
```

成功すると LINE に以下のようなメッセージが届きます:

```
✅ Gmail 自動分類システム — 接続テスト成功
送信日時: 2026-05-10 09:00:00

このメッセージが届いていれば LINE Messaging API の設定は完了です。
```

---

## Step 6: cron で毎日自動実行

```bash
# ログディレクトリを作成
mkdir -p logs

# crontab を編集
crontab -e
```

以下を追加（毎朝 9:00 に実行）:

```cron
0 9 * * * cd /absolute/path/to/claude-practice && /usr/bin/python3 main.py --notify >> logs/cron.log 2>&1
```

> `/absolute/path/to/claude-practice` は実際のパスに変更してください。
> `which python3` でPythonのパスを確認できます。

### cron の動作確認

```bash
# 手動テスト（notify なしで実行）
python main.py --days 1 --max 10

# ログを確認
tail -f logs/cron.log
```

---

## 動作確認チェックリスト

**Gmail / Claude**
- [ ] `pip install -r requirements.txt` が成功する
- [ ] `credentials.json` がプロジェクトルートに存在する
- [ ] `.env` に `ANTHROPIC_API_KEY` が設定されている
- [ ] `python main.py` を初回実行してブラウザ認証が完了する
- [ ] `token.json` が生成される
- [ ] `reports/report_YYYY-MM-DD.json` が生成される

**LINE Messaging API**
- [ ] LINE Developers でチャネルを作成した
- [ ] Channel Access Token を発行して `.env` に設定した
- [ ] Bot を友だち追加した
- [ ] `LINE_RECIPIENT_ID` を取得して `.env` に設定した
- [ ] `python test_line.py --dry` でエラーが出ない
- [ ] `python test_line.py` で LINE にテストメッセージが届く
- [ ] `python main.py --notify` で分類結果が LINE に届く

**自動実行**
- [ ] crontab に設定が追加されている
- [ ] `tail -f logs/cron.log` でログが記録されている

---

## トラブルシューティング

### `credentials.json が見つかりません`

Google Cloud Console から認証情報をダウンロードして `credentials.json` としてプロジェクトルートに配置してください。

### Gmail 認証エラー（`invalid_grant` など）

```bash
rm token.json
python main.py  # 再認証
```

### LINE 通知が届かない

```bash
# .env の設定を確認
grep LINE_ .env

# ログでエラーを確認
tail -20 logs/cron.log
```

よくある原因:
- Bot を友だち追加していない → LINE アプリで QR コードをスキャン
- `LINE_RECIPIENT_ID` が間違っている → User ID は `U` から始まる 33 文字
- Channel Access Token が失効している → LINE Developers コンソールで再発行

### `ANTHROPIC_API_KEY が設定されていません`

`.env` ファイルに正しいキーを設定してください。[Anthropic Console](https://console.anthropic.com/) で API キーを取得できます。

### cron が動かない

```bash
# cron サービスの状態を確認
systemctl status cron

# crontab の設定を確認
crontab -l

# 絶対パスで手動実行して確認
/usr/bin/python3 /absolute/path/to/claude-practice/main.py
```
