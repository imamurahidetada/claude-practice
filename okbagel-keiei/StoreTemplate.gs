/**
 * 店舗ファイル（テンプレート）用スクリプト
 *
 * 在庫管理表の D1 に日数を入れると、その日数ぶんの日付ブロック（8列ずつ）だけを表示し、
 * 残りの列を自動で非表示にする。
 *
 * 設置（テンプレートに1回だけ）:
 *   【テンプレート】店舗ファイル → 拡張機能 → Apps Script → このファイルを貼り付けて保存
 *   → ここから作った店舗ファイルには、スクリプトごとコピーされる（ファイルごとの設定は不要）
 */

var STOCK_SHEET = '在庫管理表';
var FIRST_COL = 5;     // 1日目ブロックの先頭列（E）
var MAX_DAYS = 31;     // 用意してある日数ブロックの数

/** セルを手で編集したときに自動で呼ばれる（シンプルトリガー） */
function onEdit(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet();
  if (sh.getName() !== STOCK_SHEET || e.range.getA1Notation() !== 'D1') return;
  applyDays(sh);
}

/** D1 の日数に合わせて列の表示・非表示を切り替える */
function applyDays(sh) {
  sh = sh || SpreadsheetApp.getActive().getSheetByName(STOCK_SHEET);
  var raw = sh.getRange('D1').getValue();
  var days = Math.floor(Number(raw));
  if (raw === '' || isNaN(days) || days < 1 || days > MAX_DAYS) {
    // 空欄・不正な値は「全部表示」に戻す
    sh.showColumns(FIRST_COL, 8 * MAX_DAYS);
    if (raw !== '') {
      SpreadsheetApp.getActive().toast('日数は 1〜' + MAX_DAYS + ' の数字で入力してください', '日数', 5);
    }
    return;
  }
  sh.showColumns(FIRST_COL, 8 * MAX_DAYS);
  if (days < MAX_DAYS) sh.hideColumns(FIRST_COL + 8 * days, 8 * (MAX_DAYS - days));
}
