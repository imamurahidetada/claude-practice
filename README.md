# Gmail 自動分類・要約システム

Gmail の受信メールを毎日自動で取得し、Claude AI がカテゴリ分類・重要度判定・要約を行い、LINE Messaging API でプッシュ通知するシステムです。

## 機能

| フェーズ | 内容 |
|---|---|
| Phase 1 | Gmail API (OAuth2) でメール取得・本文デコード |
| Phase 2 | Claude API で分類（カテゴリ）・重要度（1〜5）・要約（100文字） |
| Phase 3 | JSON / Markdown レポートをローカル保存 |
| Phase 4 | LINE Messaging API で朝 9:00 に日次サマリー通知 |

## ディレクトリ構成

```
claude-practice/
├── main.py                        # CLI エントリーポイント
├── requirements.txt               # Python 依存ライブラリ
├── .env.example                   # 環境変数テンプレート
├── .env                           # 実際の設定（要作成・git 除外）
├── credentials.json               # Gmail OAuth2 認証（要取得・git 除外）
├── token.json                     # Gmail トークン（自動生成・git 除外）
├── gmail_classifier/
│   ├── auth.py                    # Gmail OAuth2 認証
│   ├── fetcher.py                 # メール取得・本文デコード
│   ├── classifier.py              # Claude による分類・要約・重要度判定
│   ├── reporter.py                # JSON / Markdown レポート生成
│   └── notifier.py                # LINE Messaging API 送信
├── reports/                       # 生成されたレポート（git 除外）
│   ├── report_2026-05-10.json
│   └── report_2026-05-10.md
└── logs/                          # 実行ログ（git 除外）
    └── cron.log
```

## クイックスタート

### 1. インストール

```bash
git clone https://github.com/imamurahidetada/claude-practice.git
cd claude-practice
pip install -r requirements.txt
```

### 2. 環境変数の設定

```bash
cp .env.example .env
# .env を編集して API キーを設定
```

### 3. Gmail API 認証ファイルの取得

→ [SETUP.md](./SETUP.md) を参照してください。

### 4. 実行

```bash
# 基本実行（過去 24 時間のメールを処理）
python main.py

# LINE Notify 通知つき
python main.py --notify

# 過去 3 日分・最大 50 件
python main.py --days 3 --max 50
```

## コマンドライン オプション

| オプション | デフォルト | 説明 |
|---|---|---|
| `--days N` | 1 | 取得する日数（過去 N 日分） |
| `--max N` | 100 | 最大取得件数 |
| `--output DIR` | reports | レポート出力ディレクトリ |
| `--notify` | false | LINE Messaging API で結果を送信 |
| `--log-dir DIR` | logs | ログ出力ディレクトリ |

## 出力フォーマット

### JSON レポート（`reports/report_YYYY-MM-DD.json`）

```json
{
  "date": "2026-05-10",
  "total_count": 15,
  "generated_at": "2026-05-10 09:00:12",
  "classified": {
    "仕事": {
      "count": 5,
      "importance": 5,
      "emails": [
        {
          "id": "...",
          "subject": "来週のミーティング",
          "sender": "boss@company.com",
          "date": "...",
          "importance": 5,
          "summary": "来週月曜の全社会議について確認と出欠連絡を求める緊急メール。"
        }
      ]
    },
    "ニュースレター": { "count": 4, "importance": 2, "emails": [] }
  }
}
```

### LINE Messaging API 通知例

```
📧 メール日次レポート (2026-05-10)
受信件数: 15 件

【カテゴリ別】
  仕事: 5件  ★★★★★
  個人: 3件  ★★☆☆☆
  ニュースレター: 4件  ★★☆☆☆

【要対応メール】
  🔴 来週のミーティング
      → 来週月曜の全社会議について確認...
  🟠 請求書の確認依頼
      → 先月分の請求書確認と...
```

## 毎日自動実行（cron）

```bash
crontab -e
```

```cron
# 毎朝 9:00 に実行してログ記録・LINE 通知
0 9 * * * cd /path/to/claude-practice && python3 main.py --notify >> logs/cron.log 2>&1
```

## 重要度スケール

| レベル | 意味 | 表示 |
|:---:|---|---|
| 5 | 即対応必須（締め切り・緊急連絡） | 🔴 緊急 |
| 4 | 近日中に対応（会議・重要依頼） | 🟠 高 |
| 3 | 確認推奨（一般業務・返信が必要な連絡） | 🟡 中 |
| 2 | 参考程度（FYI・ニュースレター） | 🟢 低 |
| 1 | 対応不要（広告・スパム） | ⚪ 最低 |

## トラブルシューティング

**Gmail 認証エラー**
```bash
rm token.json && python main.py
```

**LINE 通知が届かない**
```bash
# .env の LINE_NOTIFY_TOKEN を確認
# logs/cron.log でエラーを確認
```

詳細は [SETUP.md](./SETUP.md) を参照してください。
