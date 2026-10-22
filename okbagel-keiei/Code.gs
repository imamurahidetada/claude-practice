/**
 * OKBAGEL 経営管理 — 催事ごとの店舗ファイルへ報告文を自動入力し、年次まとめに吸い上げる
 *
 * 構成:
 *   年次まとめ（このスクリプトを入れるファイル）… 催事マスタ / 商品マスタ / 店舗データ / 催事別集計 / 取り込み / 取込ログ / 設定
 *   店舗ファイル（催事ごとに1つ。テンプレートのコピー）… 日次在庫 / 日次売上 / 人件費 / 使用経費 / 領収書 / 集計用
 *
 * 初回の使い方:
 *  1. 年次まとめ → 拡張機能 → Apps Script に、このファイルを貼り付けて保存
 *  2. シートを開き直すとメニュー「経営管理」が出る
 *  3. 「店舗ファイルを作成」→ 催事マスタの各催事のファイルがフォルダに作られる（初回は権限の承認が出る）
 *  4. 「取り込み」タブのA4に報告文を貼る → 経営管理 → 取り込み実行
 *  5. 共有URLで自動入力したい場合は「フォーム自動取込セットアップ」、毎日の吸い上げは「毎日自動吸い上げを設定」
 */

// 年次まとめ側のタブ
var SHEET = {
  IMPORT: '取り込み',
  EVENT: '催事マスタ',
  PRODUCT: '商品マスタ',
  LOG: '取込ログ',
  SETTINGS: '設定',
  STOREDATA: '店舗データ'
};

// 店舗ファイル側のタブ（元の「在庫管理表」と同じ形）
var STORE = {
  STOCK: '在庫管理表',          // 日ごとに8列ブロックが横に並ぶ（E列から）
  LABOR: '人件費',              // A日付 B氏名 C出勤 D退勤 E休憩 F労働時間(式) G時給 H交通費(証あり) I交通費(証なし) J総支給(式)
  EXPENSE: '使用経費',          // A日付 B経費項目 C内容 D入力金額 E税抜金額(式)
  RECEIPT: '領収書',            // A使用日 B使用者 C項目 D購入場所 E税抜 F税率 G消費税(式) H税込(式) I月(式)
  SUMMARY: '集計用'
};
var DAYS = 31;          // 在庫管理表にある日数ブロックの最大数（使う日数は D1 に入り、残りは非表示）
var FIRST_ROW = 7;      // 商品の1行目
var FIRST_COL = 5;      // 1日目ブロックの先頭列（E）

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

    var kw = line.match(/^(催事作成|売上|在庫|人件費|経費|領収書)\s*(.*)$/);

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

    if (type === '催事作成') {
      // 催事作成 催事名 開始日 [7日] [出店料率20%] [場所 xxx]
      var cname = tokens.shift();
      if (!cname) return err('催事作成: 催事名がありません');
      if (ctx.events.indexOf(cname) >= 0) return err('催事「' + cname + '」はすでに催事マスタにあります（店舗ファイルが未作成なら、メニュー「店舗ファイルを作成」で作れます）');
      var rest2 = tokens.join(' ');
      var dm = rest2.match(/(\d+)\s*日/);
      var rm = rest2.match(/出店料率\s*(\d+(?:\.\d+)?)\s*%?/);
      var pm = rest2.match(/場所\s*(\S+)/);
      ctx.events.push(cname);   // 同じ文の後続行（売上など）が通るように
      records.push({ type: 'create', event: cname, date: dateStr, days: dm ? Number(dm[1]) : null,
        rate: rm ? Number(rm[1]) / 100 : '', place: pm ? pm[1] : '', src: orig });
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
    .addItem('店舗ファイルを作成（催事マスタの新しい行）', 'createStoreFiles')
    .addItem('日数・出店料率を店舗ファイルに反映', 'updateDays')
    .addItem('店舗データを吸い上げ（全催事）', 'pullAll')
    .addSeparator()
    .addItem('フォーム自動取込セットアップ（初回のみ）', 'setupForm')
    .addItem('毎日自動吸い上げを設定（初回のみ）', 'setupDailyPull')
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
  var hq = SpreadsheetApp.getActive();
  var tz = hq.getSpreadsheetTimeZone();
  var props = PropertiesService.getDocumentProperties();
  var ctx = {
    year: Number(Utilities.formatDate(new Date(), tz, 'yyyy')),
    events: col_(hq, SHEET.EVENT, 1),
    products: col_(hq, SHEET.PRODUCT, 1),
    lastWage: JSON.parse(props.getProperty('lastWage') || '{}')
  };
  var res = parseReport(text, ctx);
  var parseErrors = res.errors.slice();
  props.setProperty('lastWage', JSON.stringify(ctx.lastWage));

  var log = [], now = new Date(), touched = [], ok = 0, ng = res.errors.length;
  var notes = [];

  // 「催事作成」を先に処理（催事マスタに行を足し、店舗ファイルを作る）
  res.records.filter(function (r) { return r.type === 'create'; }).forEach(function (r) {
    try {
      var days = createEvent_(hq, r);
      ok++;
      notes.push('催事「' + r.event + '」を登録し、店舗ファイルを作成しました（' + days + '日）');
      log.push([now, 'create', r.src, 'OK', r.event]);
    } catch (e) {
      ng++;
      res.errors.push({ line: r.src, msg: e.message });
      log.push([now, 'create', r.src, 'エラー', e.message]);
    }
  });

  // 催事ごとにまとめて、その店舗ファイルへ書き込む
  var byEvent = {};
  res.records.forEach(function (r) {
    if (r.type !== 'create') (byEvent[r.event] = byEvent[r.event] || []).push(r);
  });

  Object.keys(byEvent).forEach(function (event) {
    var recs = byEvent[event];
    try {
      var bad = writeToStore_(openStore_(hq, event), recs, tz);
      var badSrc = {};
      bad.forEach(function (x) { badSrc[x.src] = x.msg; res.errors.push({ line: x.src, msg: x.msg }); });
      touched.push(event);
      ng += bad.length;
      recs.forEach(function (r) {
        if (badSrc[r.src]) log.push([now, r.type, r.src, 'エラー', badSrc[r.src]]);
        else { ok++; log.push([now, r.type, r.src, 'OK', event]); }
      });
    } catch (e) {
      ng += recs.length;
      var m = '店舗ファイルへの書き込みに失敗: ' + e.message;
      res.errors.push({ line: event + ' の ' + recs.length + ' 行', msg: m });
      recs.forEach(function (r) { log.push([now, r.type, r.src, 'エラー', m]); });
    }
  });
  parseErrors.forEach(function (x) { log.push([now, '', x.line, 'エラー', x.msg]); });

  if (log.length) {
    var ls = hq.getSheetByName(SHEET.LOG);
    ls.getRange(ls.getLastRow() + 1, 1, log.length, 5).setValues(log);
  }
  if (touched.length) pullStoreData_(hq, touched);

  var msg = '取り込み完了: 成功 ' + ok + ' 行 / エラー ' + ng + ' 行';
  if (notes.length) msg += '\n' + notes.join('\n');
  if (res.errors.length) msg += '\n' + res.errors.map(function (x) { return '・' + x.line + ' → ' + x.msg; }).join('\n');
  return msg;
}

/** 1つの店舗ファイルに、その催事の記録を書き込む。書けなかった行は errors で返す */
function writeToStore_(store, recs, tz) {
  var by = { sales: [], stock: [], labor: [], expense: [], receipt: [] };
  recs.forEach(function (r) { by[r.type].push(r); });
  var errors = [];
  var fail = function (r, e) { errors.push({ src: r.src, msg: e.message }); };

  var sh = store.getSheetByName(STORE.STOCK);
  var layout = stockLayout_(sh);

  by.stock.forEach(function (r) { try { writeStock_(sh, layout, r); } catch (e) { fail(r, e); } });
  by.sales.forEach(function (r) { try { writeSales_(sh, layout, r); } catch (e) { fail(r, e); } });
  by.labor.forEach(function (r) { try { writeLabor_(store, r, tz); } catch (e) { fail(r, e); } });
  by.expense.forEach(function (r) {
    var s2 = store.getSheetByName(STORE.EXPENSE);
    var n = firstEmpty_(s2, 1, 2, 300);
    s2.getRange(n, 1, 1, 4).setValues([[toDate_(r.date), r.item, r.note, r.amount]]);
  });
  by.receipt.forEach(function (r) {
    var s3 = store.getSheetByName(STORE.RECEIPT);
    var n = firstEmpty_(s3, 1, 2, 300);
    s3.getRange(n, 1, 1, 6).setValues([[toDate_(r.date), r.user, r.item, r.place, r.amount, r.rate]]);
  });
  return errors;
}

/** 在庫管理表の行・日付の位置を調べる（商品行を増減しても追従） */
function stockLayout_(sh) {
  var names = sh.getRange(FIRST_ROW, 3, 60, 1).getValues().map(function (r) { return String(r[0]).trim(); });
  var end = names.indexOf('商品合計');
  if (end < 0) throw new Error('在庫管理表に「商品合計」行が見つかりません');
  var start = asDate_(sh.getRange('B2').getValue());
  if (!start) throw new Error('在庫管理表の開始日(B2)が読み取れません');
  var days = Number(sh.getRange('D1').getValue()) || DAYS;
  return { names: names, count: end, salesRow: FIRST_ROW + end + 2, start: start, days: days };
}

function dayBlock_(layout, dateStr) {
  var k = Math.round((toDate_(dateStr) - layout.start) / 86400000);
  if (isNaN(k) || k < 0 || k >= layout.days) {
    throw new Error(dateStr + ' は催事の期間(' + layout.days + '日)の範囲外です。日数を増やすには催事マスタの「日数」を直して「日数を反映」を押してください');
  }
  return FIRST_COL + 8 * k;
}

function writeStock_(sh, layout, r) {
  var i = layout.names.indexOf(r.product);
  if (i < 0 || i >= layout.count) throw new Error('商品「' + r.product + '」が在庫管理表にありません');
  var c = dayBlock_(layout, r.date), row = FIRST_ROW + i;
  var set = function (off, v) { if (v !== null) sh.getRange(row, c + off).setValue(v); };
  set(0, r.in); set(2, r.thaw); set(3, r.close); set(4, r.loss); set(5, r.other);
}

function writeSales_(sh, layout, r) {
  var c = dayBlock_(layout, r.date);
  if (r.ex !== null) sh.getRange(layout.salesRow, c + 1).setValue(r.ex);
  if (r.inc !== null) sh.getRange(layout.salesRow, c + 2).setValue(r.inc);
}

/** 同じ日・同じ人の行があれば上書き、なければ空き行に書く */
function writeLabor_(store, r, tz) {
  var sh = store.getSheetByName(STORE.LABOR);
  var vals = sh.getRange(2, 1, 300, 2).getValues();
  var row = 0, empty = 0;
  for (var i = 0; i < vals.length; i++) {
    if (!vals[i][0] && !empty) empty = i + 2;
    if (cellKey_(vals[i][0], tz) === r.date && String(vals[i][1]).trim() === r.name) { row = i + 2; break; }
  }
  row = row || empty;
  if (!row) throw new Error('人件費タブに空き行がありません');
  sh.getRange(row, 1, 1, 5).setValues([[toDate_(r.date), r.name, r.start, r.end, r.rest]]);
  sh.getRange(row, 7, 1, 3).setValues([[r.wage, r.transReceipt === null ? '' : r.transReceipt, r.transNone === null ? '' : r.transNone]]);
}

function firstEmpty_(sh, col, from, count) {
  var v = sh.getRange(from, col, count, 1).getValues();
  for (var i = 0; i < v.length; i++) if (!v[i][0]) return from + i;
  throw new Error(sh.getName() + ' に空き行がありません');
}

// ---------------------------------------------------------------- 店舗ファイルの作成・取得

/** 催事マスタの行（2始まり）を探す */
function eventRow_(hq, event) {
  var sh = hq.getSheetByName(SHEET.EVENT);
  var names = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 1).getValues();
  for (var i = 0; i < names.length; i++) if (String(names[i][0]).trim() === event) return i + 2;
  throw new Error('催事マスタに「' + event + '」がありません');
}

function openStore_(hq, event) {
  var row = eventRow_(hq, event);
  var id = hq.getSheetByName(SHEET.EVENT).getRange(row, 6).getValue();
  if (!id) id = createStoreFile_(hq, row);
  return SpreadsheetApp.openById(String(id));
}

/** 催事マスタの空き行を返す（足りなければ行を増やす） */
function nextEventRow_(sh) {
  var v = sh.getRange(2, 1, Math.max(sh.getMaxRows() - 1, 1), 1).getValues();
  for (var i = 0; i < v.length; i++) if (!v[i][0]) return i + 2;
  sh.insertRowsAfter(sh.getMaxRows(), 20);
  return v.length + 2;
}

/** 「催事作成」: 催事マスタに1行足して、店舗ファイルまで作る。使う日数を返す */
function createEvent_(hq, r) {
  var sh = hq.getSheetByName(SHEET.EVENT);
  var start = toDate_(r.date);
  var days = r.days && r.days >= 1 ? Math.min(r.days, DAYS) : null;
  var end = days ? new Date(start.getFullYear(), start.getMonth(), start.getDate() + days - 1) : '';
  var row = nextEventRow_(sh);
  sh.getRange(row, 1, 1, 5).setValues([[r.event, r.place, start, end, r.rate]]);
  if (days) sh.getRange(row, 8).setValue(days);
  createStoreFile_(hq, row);
  return days || eventDays_(sh.getRange(row, 1, 1, 8).getValues()[0]);
}

/** 催事マスタの1行から日数を決める（H列があればそれ、なければ 開始日〜終了日） */
function eventDays_(row) {
  var d = Number(row[7]);
  if (d >= 1) return Math.min(d, DAYS);
  var s = asDate_(row[2]), e = asDate_(row[3]);
  if (s && e) return Math.max(1, Math.min(DAYS, Math.round((e - s) / 86400000) + 1));
  return DAYS;
}

/** 使う日数ぶんのブロックだけ表示し、残りは非表示にする */
function applyDays_(store, days) {
  var sh = store.getSheetByName(STORE.STOCK);
  sh.getRange('D1').setValue(days);
  sh.showColumns(FIRST_COL, 8 * DAYS);
  if (days < DAYS) sh.hideColumns(FIRST_COL + 8 * days, 8 * (DAYS - days));
}

/** テンプレートをコピーして店舗ファイルを作り、催事マスタにIDを記録する */
function createStoreFile_(hq, row) {
  var settings = hq.getSheetByName(SHEET.SETTINGS);
  var templateId = settings.getRange('B1').getValue();
  var folderId = settings.getRange('B2').getValue();
  var ev = hq.getSheetByName(SHEET.EVENT);
  var v = ev.getRange(row, 1, 1, 8).getValues()[0];   // 催事名,場所,開始日,終了日,出店料率,(ID),(URL),日数
  var tz = hq.getSpreadsheetTimeZone();
  var startDate = asDate_(v[2]);
  var year = Utilities.formatDate(startDate || new Date(), tz, 'yyyy');
  var copy = DriveApp.getFileById(templateId).makeCopy(v[0] + ' ' + year, DriveApp.getFolderById(folderId));
  var store = SpreadsheetApp.openById(copy.getId());
  var st = store.getSheetByName(STORE.STOCK);
  st.getRange('B1').setValue(v[0]);
  st.getRange('B2').setValue(startDate || v[2]);
  st.getRange('D2').setValue(v[4]);                   // 出店料率
  applyDays_(store, eventDays_(v));
  ev.getRange(row, 6).setValue(copy.getId());
  return copy.getId();
}

/** メニュー: 催事マスタの「日数」「出店料率」「開始日」を、作成済みの店舗ファイルに反映する */
function updateDays() {
  var hq = SpreadsheetApp.getActive();
  var sh = hq.getSheetByName(SHEET.EVENT);
  var n = sh.getLastRow() - 1;
  if (n < 1) return;
  var done = [];
  sh.getRange(2, 1, n, 8).getValues().forEach(function (v) {
    if (!v[0] || !v[5]) return;
    try {
      var store = SpreadsheetApp.openById(String(v[5]));
      var st = store.getSheetByName(STORE.STOCK);
      st.getRange('D2').setValue(v[4]);
      applyDays_(store, eventDays_(v));
      done.push(v[0]);
    } catch (e) { /* 開けないファイルは飛ばす */ }
  });
  SpreadsheetApp.getUi().alert('反映しました: ' + (done.join('、') || 'なし'));
}

/** メニュー: 店舗ファイルが未作成の催事すべてに作る */
function createStoreFiles() {
  var hq = SpreadsheetApp.getActive();
  var sh = hq.getSheetByName(SHEET.EVENT);
  var n = sh.getLastRow() - 1;
  if (n < 1) return;
  var vals = sh.getRange(2, 1, n, 6).getValues();
  var made = [];
  vals.forEach(function (r, i) {
    if (r[0] && !r[5]) { createStoreFile_(hq, i + 2); made.push(r[0]); }
  });
  SpreadsheetApp.getUi().alert(made.length ? '店舗ファイルを作成しました:\n' + made.join('\n') : '作成が必要な催事はありません');
}

// ---------------------------------------------------------------- 年次まとめへの吸い上げ

function pullAll() {
  var n = pullStoreData_(SpreadsheetApp.getActive(), null);
  try { SpreadsheetApp.getUi().alert('吸い上げ完了: ' + n + ' 店舗'); } catch (e) { /* トリガー実行時は画面なし */ }
}

/** 各店舗ファイルの「集計用」1行を、店舗データに値として書く（events=null なら全催事） */
function pullStoreData_(hq, events) {
  var ev = hq.getSheetByName(SHEET.EVENT);
  var n = ev.getLastRow() - 1;
  if (n < 1) return 0;
  var master = ev.getRange(2, 1, n, 6).getValues();
  var data = hq.getSheetByName(SHEET.STOREDATA);
  var last = data.getLastRow();
  var existing = last > 1 ? data.getRange(2, 1, last - 1, 1).getValues() : [];
  var rowOf = {};
  existing.forEach(function (r, i) { rowOf[String(r[0])] = i + 2; });
  var now = new Date(), count = 0, nextRow = last + 1;

  master.forEach(function (m) {
    var name = String(m[0]).trim(), id = m[5];
    if (!name || !id) return;
    if (events && events.indexOf(name) < 0) return;
    var vals;
    try {
      vals = SpreadsheetApp.openById(String(id)).getSheetByName(STORE.SUMMARY).getRange('A2:K2').getValues()[0];
    } catch (e) { return; }
    vals[0] = name;
    var row = vals.concat([now]);
    var at = rowOf[name];
    if (!at) { at = nextRow++; rowOf[name] = at; }
    data.getRange(at, 1, 1, 12).setValues([row]);
    count++;
  });
  return count;
}

function setupDailyPull() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'pullAll') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('pullAll').timeBased().everyDays(1).atHour(3).create();
  SpreadsheetApp.getUi().alert('毎日午前3時ごろに全店舗を吸い上げる設定をしました');
}

// ---------------------------------------------------------------- 補助

function col_(ss, name, c) {
  var sh = ss.getSheetByName(name);
  var n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, c, n, 1).getValues().map(function (r) { return String(r[0]).trim(); }).filter(Boolean);
}

/** Date か 'yyyy-mm-dd' 文字列を Date にする（読めなければ null） */
function asDate_(v) {
  if (v instanceof Date) return v;
  var m = String(v).match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

function toDate_(s) { var p = s.split('-'); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); }
function cellKey_(v, tz) {
  return v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : String(v).trim();
}

// ---------------------------------------------------------------- 共有URL（Googleフォーム）で自動取り込み

function setupForm() {
  var ss = SpreadsheetApp.getActive();
  var form = FormApp.create('OKBAGEL 報告文の送信');
  form.setDescription('LINEなどで共有する報告文をそのまま貼り付けて送信してください。送信すると該当する催事の店舗ファイルに自動で入力されます。');
  form.addParagraphTextItem().setTitle('報告文').setRequired(true);
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  ScriptApp.newTrigger('onFormSubmit').forSpreadsheet(ss).onFormSubmit().create();
  var url = form.getPublishedUrl();
  ss.getSheetByName(SHEET.IMPORT).getRange('A29').setValue('共有用フォームURL: ' + url);
  SpreadsheetApp.getUi().alert('セットアップ完了。この共有用URLをスタッフに送ってください:\n' + url);
}

if (typeof module !== 'undefined') { module.exports = { parseReport: parseReport }; }
