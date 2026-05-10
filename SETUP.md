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

# LINE Notify（通知を使う場合）
LINE_NOTIFY_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

---

## Step 4: LINE Notify トークンの取得

1. [LINE Notify](https://notify-bot.line.me/my/) にアクセス（LINE アカウントでログイン）
2. 「トークンを発行する」をクリック
3. トークン名を入力（例: `Gmail分類システム`）
4. 通知を送るトーク（1:1 または任意のグループ）を選択
5. 「発行する」→ 表示されたトークンを `.env` の `LINE_NOTIFY_TOKEN` に設定

> **注意**: トークンは発行時にしか表示されません。必ずコピーして保存してください。

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

- [ ] `pip install -r requirements.txt` が成功する
- [ ] `credentials.json` がプロジェクトルートに存在する
- [ ] `.env` に `ANTHROPIC_API_KEY` が設定されている
- [ ] `python main.py` を初回実行してブラウザ認証が完了する
- [ ] `token.json` が生成される
- [ ] `reports/report_YYYY-MM-DD.json` が生成される
- [ ] （オプション）`python main.py --notify` で LINE 通知が届く
- [ ] crontab に設定が追加されている

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
# .env の LINE_NOTIFY_TOKEN を確認
grep LINE_NOTIFY_TOKEN .env

# ログでエラーを確認
tail -20 logs/cron.log
```

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
