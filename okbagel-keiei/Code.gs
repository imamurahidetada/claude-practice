/**
 * OKBAGEL 経営管理 運用版 — 報告文の自動取り込み
 *
 * 使い方:
 *  1. 運用版スプレッドシート → 拡張機能 → Apps Script に、このファイルを貼り付けて保存
 *  2. スプレッドシートを開き直すとメニュー「経営管理」が出る
 *  3. 「取り込み」タブのA4に報告文を貼る → 経営管理 → 取り込み実行
 *  4. 共有URLで自動入力したい場合は 経営管理 → フォーム自動取込セットアップ（初回のみ）
 */

var SHEET = {
  IMPORT: '取り込み',
  EVENT: '催事マスタ',
  PRODUCT: '商品マスタ',
  STOCK: '日次在庫',
  SALES: '日次売上',
  LABOR: '人件費',
  EXPENSE: '使用経費',
  RECEIPT: '領収書',
  LOG: '取込ログ'
};

// ---------------------------------------------------------------- 文章の解析（純粋関数）

function normalize_(s) {
  return String(s)
    .replace(/[０-９Ａ-Ｚａ-ｚ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
    .replace(/[：]/g, ':')
    .replace(/[，、]/g, ',')
    .replace(/[％]/g, '%')
    .replace(/[　\t]/g, ' ')
    .replace(/(\d)\s*[〜～−–ー]\s*(\d)/g, '$1-$2')
    .replace(/[【】\[\]]/g, ' ')
    .trim();
}

function parseDate_(s, year) {
  var m = s.match(/(?:(\d{4})[\/.-])?(\d{1,2})[\/.月](\d{1,2})日?/);
  if (!m) return null;
  return { y: m[1] ? Number(m[1]) : year, m: Number(m[2]), d: Number(m[3]), text: m[0] };
}

function num_(s) { return Number(String(s).replace(/,/g, '')); }

function pick_(line, label) {
  var m = line.match(new RegExp(label + '\\s*(-?[\\d,]+(?:\\.\\d+)?)'));
  return m ? num_(m[1]) : null;
}

/**
 * ctx = { year, events:[名前], products:[名前], lastWage:{氏名:時給} }
 * 戻り値 = { records:[...], errors:[{line, msg}] }
 */
function parseReport(text, ctx) {
  var records = [], errors = [];
  var stockCtx = null; // 直近の「在庫 催事 日付」
  var lines = String(text).split(/\r?\n/);

  lines.forEach(function (raw) {
    var orig = raw.trim();
    var line = normalize_(raw);
    if (!line) return;
    var err = function (msg) { errors.push({ line: orig, msg: msg }); };

    var kw = line.match(/^(売上|在庫|人件費|経費|領収書)\s*(.*)$/);

    // 在庫ブロックの商品行
    if (!kw) {
      var first = line.split(/\s+/)[0];
      if (ctx.products.indexOf(first) >= 0) {
        if (!stockCtx) return err('「在庫 催事名 日付」の行が先にありません');
        var rec = {
          type: 'stock', event: stockCtx.event, date: stockCtx.date, product: first,
          in: pick_(line, '納品'), thaw: pick_(line, '解凍'), close: pick_(line, '閉店'),
          loss: pick_(line, 'ロス'), other: pick_(line, '他'), src: orig
        };
        records.push(rec);
        return;
      }
      return err('行頭が 売上/在庫/人件費/経費/領収書 でも商品名でもありません');
    }

    var type = kw[1], rest = kw[2];
    var dt = parseDate_(rest, ctx.year);
    if (!dt) return err('日付(10/21 など)が読み取れません');
    var dateStr = dt.y + '-' + ('0' + dt.m).slice(-2) + '-' + ('0' + dt.d).slice(-2);
    var tokens = rest.replace(dt.text, ' ').split(/\s+/).filter(Boolean);

    if (type === '領収書') {
      // 領収書 日付 使用者 催事 項目 購入場所 金額 税率
      if (tokens.length < 6) return err('領収書: 使用者 催事 項目 購入場所 金額 [税率] の順で書いてください');
      var rate = 0.1;
      var last = tokens[tokens.length - 1];
      if (/%$/.test(last)) { rate = num_(last.replace('%', '')) / 100; tokens.pop(); }
      var amt = num_(tokens[tokens.length - 1]);
      if (isNaN(amt)) return err('領収書: 金額が読み取れません');
      tokens.pop();
      var ev = tokens[1];
      if (ctx.events.indexOf(ev) < 0) return err('催事名「' + ev + '」が催事マスタにありません');
      records.push({ type: 'receipt', date: dateStr, user: tokens[0], event: ev, item: tokens[2],
        place: tokens.slice(3).join(' '), amount: amt, rate: rate, src: orig });
      return;
    }

    // 以降は先頭トークンが催事名
    var event = tokens.shift();
    if (!event) return err('催事名がありません');
    if (ctx.events.indexOf(event) < 0) return err('催事名「' + event + '」が催事マスタにありません');
    var after = tokens.join(' ');

    if (type === '売上') {
      var ex = pick_(after, '税抜');
      var inc = pick_(after, '税込');
      if (ex === null && inc === null && /^\d[\d,]*$/.test(after)) ex = num_(after);
      if (ex === null && inc === null) return err('売上: 「税抜 123456」のように金額を書いてください');
      records.push({ type: 'sales', event: event, date: dateStr, ex: ex, inc: inc, src: orig });
    } else if (type === '在庫') {
      stockCtx = { event: event, date: dateStr };
      // 同じ行に商品が続く場合は無視（次行以降に書く）
    } else if (type === '人件費') {
      var tm = after.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
      if (!tm) return err('人件費: 勤務時間(8:30-19:30)が読み取れません');
      var name = after.replace(tm[0], ' ').split(/\s+/).filter(Boolean)[0];
      if (!name || /^(休憩|時給|交通)/.test(name)) return err('人件費: 氏名が読み取れません');
      var wage = pick_(after, '時給');
      if (wage === null) wage = ctx.lastWage[name] || null;
      if (wage === null) return err('人件費: 時給が不明です（初回は「時給1100」を書いてください）');
      var tReceipt = pick_(after, '交通費証');
      var tNone = (after.replace(/交通費証\s*[\d,]+/, ' ').match(/交通費\s*([\d,]+)/) || [])[1];
      records.push({ type: 'labor', event: event, date: dateStr, name: name,
        start: Number(tm[1]) / 24 + Number(tm[2]) / 1440, end: Number(tm[3]) / 24 + Number(tm[4]) / 1440,
        rest: pick_(after, '休憩') || 0, wage: wage,
        transReceipt: tReceipt, transNone: tNone ? num_(tNone) : null, src: orig });
      ctx.lastWage[name] = wage;
    } else if (type === '経費') {
      // 経費 催事 日付 項目 [内容...] 金額
      var parts = after.split(/\s+/).filter(Boolean);
      var money = num_(parts[parts.length - 1]);
      if (parts.length < 2 || isNaN(money)) return err('経費: 項目 内容 金額 の順で書いてください');
      records.push({ type: 'expense', event: event, date: dateStr, item: parts[0],
        note: parts.slice(1, -1).join(' '), amount: money, src: orig });
    }
  });

  return { records: records, errors: errors };
}

// ---------------------------------------------------------------- シートへの書き込み

function onOpen() {
  SpreadsheetApp.getUi().createMenu('経営管理')
    .addItem('取り込み実行', 'runImport')
    .addItem('フォーム自動取込セットアップ（初回のみ）', 'setupForm')
    .addToUi();
}

function runImport() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(SHEET.IMPORT);
  var text = sh.getRange('A4').getValue();
  if (!String(text).trim()) { SpreadsheetApp.getUi().alert('A4 に報告文を貼ってください'); return; }
  var summary = importText(text);
  sh.getRange('A4').clearContent();
  sh.getRange('A28').setValue(summary);
  SpreadsheetApp.getUi().alert(summary);
}

/** フォーム送信（トリガー）。質問「報告文」の回答を取り込む。 */
function onFormSubmit(e) {
  var v = e.namedValues && e.namedValues['報告文'];
  if (!v || !v[0]) return;
  importText(v[0]);
}

function importText(text) {
  var ss = SpreadsheetApp.getActive();
  var tz = ss.getSpreadsheetTimeZone();
  var ctx = {
    year: Number(Utilities.formatDate(new Date(), tz, 'yyyy')),
    events: col_(ss, SHEET.EVENT, 1),
    products: col_(ss, SHEET.PRODUCT, 1),
    lastWage: lastWages_(ss)
  };
  var res = parseReport(text, ctx);
  var ok = res.records.length, ng = res.errors.length;
  var log = [];
  var now = new Date();

  var by = { sales: [], stock: [], labor: [], expense: [], receipt: [] };
  res.records.forEach(function (r) { by[r.type].push(r); });

  upsert_(ss, SHEET.SALES, by.sales, 5, [0, 1], function (r) {
    return [dateKey_(r.date), r.event];
  }, function (r, row) {
    return [toDate_(r.date), r.event,
      r.ex !== null ? r.ex : (row ? row[2] : ''), r.inc !== null ? r.inc : (row ? row[3] : ''), (row ? row[4] : '')];
  }, tz);

  upsert_(ss, SHEET.STOCK, by.stock, 12, [0, 1, 2], function (r) {
    return [dateKey_(r.date), r.event, r.product];
  }, function (r, row, n) {
    var o = row || [];
    var pick = function (v, i) { return v !== null ? v : (o[i] !== undefined ? o[i] : ''); };
    return [toDate_(r.date), r.event, r.product, pick(r.in, 3), pick(r.thaw, 4), pick(r.close, 5),
      pick(r.loss, 6), pick(r.other, 7),
      '=IF(E' + n + '="","",E' + n + '-N(F' + n + ')-N(G' + n + ')-N(H' + n + '))',
      '=IFERROR(VLOOKUP(C' + n + ',' + SHEET.PRODUCT + '!$A:$B,2,FALSE),"")',
      '=IF(OR(I' + n + '="",J' + n + '=""),"",I' + n + '*J' + n + ')',
      '=IF(OR(G' + n + '="",J' + n + '=""),"",G' + n + '*J' + n + ')'];
  }, tz);

  upsert_(ss, SHEET.LABOR, by.labor, 11, [0, 1, 2], function (r) {
    return [dateKey_(r.date), r.name, r.event];
  }, function (r, row, n) {
    return [toDate_(r.date), r.name, r.event, r.start, r.end, r.rest,
      '=IF(OR(D' + n + '="",E' + n + '=""),"",MOD(E' + n + '-D' + n + ',1)*24-F' + n + '/60)',
      r.wage, r.transReceipt === null ? '' : r.transReceipt, r.transNone === null ? '' : r.transNone,
      '=IF(OR(G' + n + '="",H' + n + '=""),"",G' + n + '*H' + n + '+N(I' + n + ')+N(J' + n + '))'];
  }, tz);

  append_(ss, SHEET.EXPENSE, by.expense.map(function (r) {
    return function (n) {
      return [toDate_(r.date), r.event, r.item, r.note, r.amount,
        '=IF(OR(C' + n + '="宿泊費",C' + n + '="交通費"),ROUND(E' + n + '/1.1,0),E' + n + ')'];
    };
  }));

  append_(ss, SHEET.RECEIPT, by.receipt.map(function (r) {
    return function (n) {
      return [toDate_(r.date), r.user, r.item, r.place, r.amount, r.rate,
        '=IF(OR(E' + n + '="",F' + n + '=""),"",E' + n + '*F' + n + ')',
        '=IF(E' + n + '="","",E' + n + '+N(G' + n + '))', r.event,
        '=IF(A' + n + '="","",MONTH(A' + n + '))'];
    };
  }));

  // ログ
  res.records.forEach(function (r) { log.push([now, r.type, r.src, 'OK', '']); });
  res.errors.forEach(function (x) { log.push([now, '', x.line, 'エラー', x.msg]); });
  if (log.length) {
    var ls = ss.getSheetByName(SHEET.LOG);
    ls.getRange(ls.getLastRow() + 1, 1, log.length, 5).setValues(log);
  }

  var msg = '取り込み完了: 成功 ' + ok + ' 行 / エラー ' + ng + ' 行';
  if (ng) msg += '\n' + res.errors.map(function (x) { return '・' + x.line + ' → ' + x.msg; }).join('\n');
  return msg;
}

// ---------------------------------------------------------------- 補助

function col_(ss, name, c) {
  var sh = ss.getSheetByName(name);
  var n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, c, n, 1).getValues().map(function (r) { return String(r[0]).trim(); }).filter(Boolean);
}

function lastWages_(ss) {
  var sh = ss.getSheetByName(SHEET.LABOR);
  var n = sh.getLastRow() - 1, out = {};
  if (n < 1) return out;
  sh.getRange(2, 1, n, 8).getValues().forEach(function (r) { if (r[1] && r[7]) out[r[1]] = r[7]; });
  return out;
}

function toDate_(s) { var p = s.split('-'); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); }
function dateKey_(s) { return s; }
function cellKey_(v, tz) {
  return v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : String(v).trim();
}

/**
 * キーが同じ行があれば上書き、無ければ末尾に追加（二重に貼っても重複しない）
 * keyCols: 既存行の中でキーになる列番号(0始まり)。日付は 'yyyy-MM-dd' で比較
 * keyFn(r) -> キー配列 / rowFn(r, 既存行 or null, シート行番号) -> 書き込む1行
 */
function upsert_(ss, name, recs, width, keyCols, keyFn, rowFn, tz) {
  if (!recs.length) return;
  var sh = ss.getSheetByName(name);
  var last = sh.getLastRow();
  var existing = last > 1 ? sh.getRange(2, 1, last - 1, width).getValues() : [];
  var rowOf = {};   // キー -> シート行番号
  existing.forEach(function (row, i) {
    rowOf[keyCols.map(function (c) { return cellKey_(row[c], tz); }).join('|')] = i + 2;
  });
  var added = [];   // 今回追加する行
  recs.forEach(function (r) {
    var key = keyFn(r).join('|');
    var n = rowOf[key];
    if (n && n <= last) {
      sh.getRange(n, 1, 1, width).setValues([rowFn(r, existing[n - 2], n)]);
    } else if (n) {                       // 同じ貼り付け内の重複 → 追加分を上書き
      added[n - last - 1] = rowFn(r, added[n - last - 1], n);
    } else {
      n = last + 1 + added.length;
      rowOf[key] = n;
      added.push(rowFn(r, null, n));
    }
  });
  if (added.length) sh.getRange(last + 1, 1, added.length, width).setValues(added);
}

function append_(ss, name, rowFns) {
  if (!rowFns.length) return;
  var sh = ss.getSheetByName(name);
  var start = sh.getLastRow() + 1;
  var rows = rowFns.map(function (f, i) { return f(start + i); });
  sh.getRange(start, 1, rows.length, rows[0].length).setValues(rows);
}

// ---------------------------------------------------------------- 共有URL（Googleフォーム）で自動取り込み

function setupForm() {
  var ss = SpreadsheetApp.getActive();
  var form = FormApp.create('OKBAGEL 報告文の送信');
  form.setDescription('LINEなどで共有する報告文をそのまま貼り付けて送信してください。送信すると経営管理シートに自動で入力されます。');
  form.addParagraphTextItem().setTitle('報告文').setRequired(true);
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  ScriptApp.newTrigger('onFormSubmit').forSpreadsheet(ss).onFormSubmit().create();
  var url = form.getPublishedUrl();
  ss.getSheetByName(SHEET.IMPORT).getRange('A29').setValue('共有用フォームURL: ' + url);
  SpreadsheetApp.getUi().alert('セットアップ完了。この共有用URLをスタッフに送ってください:\n' + url);
}

if (typeof module !== 'undefined') { module.exports = { parseReport: parseReport }; }
