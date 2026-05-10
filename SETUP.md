# Gmail 自動分類・要約システム セットアップガイド

## 概要

このシステムは Gmail の受信メールを毎日自動で取得し、Claude AI を使って
カテゴリ分類と要約を行い、Markdown/JSON レポートとして保存します。

## システム構成

```
claude-practice/
├── main.py                      # エントリーポイント
├── requirements.txt             # Python 依存ライブラリ
├── .env                         # 環境変数（要作成）
├── .env.example                 # 環境変数テンプレート
├── credentials.json             # Gmail OAuth2 認証ファイル（要取得）
├── token.json                   # Gmail トークン（初回実行時に自動生成）
├── reports/                     # 生成されたレポート
│   ├── report_2026-05-10.md
│   └── report_2026-05-10.json
└── gmail_classifier/
    ├── auth.py                  # Gmail 認証
    ├── fetcher.py               # メール取得
    ├── classifier.py            # Claude による分類・要約
    └── reporter.py              # レポート生成
```

## セットアップ手順

### 1. Python 依存ライブラリのインストール

```bash
pip install -r requirements.txt
```

### 2. Google Cloud Console で Gmail API を有効化

1. [Google Cloud Console](https://console.cloud.google.com/) にアクセス
2. プロジェクトを作成（または既存のものを選択）
3. **APIs & Services** → **Enable APIs** → "Gmail API" を検索して有効化
4. **APIs & Services** → **Credentials** → **Create Credentials** → **OAuth client ID**
5. アプリケーションの種類: **Desktop app** を選択
6. 作成後、`credentials.json` としてダウンロードしてプロジェクトルートに配置
7. **OAuth consent screen** で自分のアカウントを「テストユーザー」に追加

### 3. 環境変数の設定

```bash
cp .env.example .env
```

`.env` を編集して以下を設定:

```env
ANTHROPIC_API_KEY=sk-ant-...          # Anthropic API キー
GMAIL_CREDENTIALS_FILE=credentials.json
GMAIL_TOKEN_FILE=token.json
EMAIL_CATEGORIES=仕事,プロジェクト,請求・支払い,ニュースレター,個人,スパム・広告,その他
REPORT_OUTPUT_DIR=reports
FETCH_DAYS=1
CLAUDE_MODEL=claude-sonnet-4-6
```

### 4. 初回実行（Gmail 認証）

```bash
python main.py
```

初回はブラウザが開き、Google アカウントでの認証を求められます。
認証後 `token.json` が自動生成され、次回以降は自動認証されます。

## 使い方

```bash
# 今日のメールを処理（デフォルト）
python main.py

# 過去3日分を処理
python main.py --days 3

# 最大50件に絞る
python main.py --max 50

# 出力先を変更
python main.py --output /path/to/reports
```

## 毎日自動実行（cron）

```bash
# crontab を編集
crontab -e
```

以下を追加（毎朝8時に実行）:

```cron
0 8 * * * cd /path/to/claude-practice && /usr/bin/python3 main.py >> logs/cron.log 2>&1
```

ログディレクトリを事前に作成:

```bash
mkdir -p logs
```

## 出力例

### Markdown レポート (`reports/report_2026-05-10.md`)

```markdown
# メール日次レポート - 2026-05-10

**取得件数:** 12 件
**生成日時:** 2026-05-10 08:00:15

---

## カテゴリ別サマリー

| カテゴリ | 件数 |
|---|---|
| 仕事 | 5 件 |
| ニュースレター | 4 件 |
| 個人 | 2 件 |
| スパム・広告 | 1 件 |

---

## 仕事 (5 件)

### 来週のミーティング日程調整
- **送信者:** boss@company.com
- **受信日:** Sat, 10 May 2026 07:30:00 +0900
- **要約:** 来週月曜日の全社ミーティングの日程調整依頼です。...
```

### JSON データ (`reports/report_2026-05-10.json`)

機械処理やデータ分析に利用できる構造化データです。

## カテゴリのカスタマイズ

`.env` の `EMAIL_CATEGORIES` を編集してカテゴリを変更できます:

```env
EMAIL_CATEGORIES=緊急,要対応,FYI,ニュースレター,個人,スパム,その他
```

## トラブルシューティング

### `credentials.json が見つかりません`
Google Cloud Console から認証ファイルをダウンロードし、プロジェクトルートに配置してください。

### `ANTHROPIC_API_KEY が設定されていません`
`.env` ファイルに正しい API キーを設定してください。

### Gmail 認証エラー
`token.json` を削除して再認証してください:
```bash
rm token.json && python main.py
```
