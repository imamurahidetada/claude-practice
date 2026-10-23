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
  EQUIP: '備品原価',            // A品名 B原価単価 C事前持込み数 D途中購入(式:備品購入の合計) E持ち帰り数 F使用数(式) G金額(式)
  EQUIP_BUY: '備品購入',        // A日付 B品名 C数量 D単価(式) E金額(式)  ← 備品の買い足しを日ごとに残す
  SUMMARY: '集計用'
};
var DAYS = 31;          // 在庫管理表にある日数ブロックの最大数（使う日数は D1 に入り、残りは非表示）
var FIRST_ROW = 7;      // 商品の1行目
var FIRST_COL = 5;      // 1日目ブロックの先頭列（E）

// 催事マスタの列（左から。0始まり）
//   店舗名(年-月-日_店名) / 催事名(イベント名がある場合のみ) / 場所 / 開始日 / 終了日 / 出店料率 / 店舗ファイルID / リンク / 日数
var EV = { KEY: 0, EVENT: 1, PLACE: 2, START: 3, END: 4, RATE: 5, ID: 6, LINK: 7, DAYS: 8, COLS: 9 };

/** 「2026-10-21_浜屋」→「浜屋」 */
function shopOfKey_(key) { return String(key).replace(/^\d{4}-\d{2}-\d{2}_/, ''); }

/**
 * 報告文の「店名」から、催事マスタのどの催事かを決める（純粋関数）。
 *  - ref が「2026-10-21_浜屋」そのものなら、その行
 *  - 店名（浜屋）かイベント名で探し、同じ店が年に複数あるときは、
 *    日付が期間内の催事 → これから始まる催事 → 過去の催事（新しい順）の順で選ぶ
 * events = [{ key, shop, event, start(Date|null), end(Date|null) }]
 */
function findEvent_(events, ref, dateStr, today) {
  ref = String(ref || '').trim();
  if (!ref) return null;
  for (var i = 0; i < events.length; i++) if (events[i].key === ref) return ref;
  var cands = events.filter(function (e) { return e.shop === ref || (e.event && e.event === ref); });
  var t = (dateStr ? toDate_(dateStr) : today).getTime();
  var inPeriod = function (e) {
    var st = e.start ? e.start.getTime() : 0, en = e.end ? e.end.getTime() : st;
    return t >= st && t <= en;
  };
  // 店名の一部だけ書かれた場合（「木の葉モール」→「木の葉モール橋本」）は、その日が期間内の催事に限って候補に加える
  if (!cands.some(inPeriod)) {
    var near = events.filter(function (e) {
      return inPeriod(e) && (e.shop.indexOf(ref) === 0 || ref.indexOf(e.shop) === 0 || (e.event && e.event.indexOf(ref) === 0));
    });
    if (near.length) cands = near;
  }
  if (!cands.length) return null;
  if (cands.length === 1) return cands[0].key;
  var score = function (e) {
    var s = e.start ? e.start.getTime() : 0, en = e.end ? e.end.getTime() : s;
    var dist = t < s ? s - t : (t > en ? t - en : 0);
    var rank = dist === 0 ? 0 : (t < s ? 1 : 2);
    return [rank, dist, -s];
  };
  var best = null, bestScore = null;
  cands.forEach(function (e) {
    var sc = score(e);
    if (!best || sc[0] < bestScore[0] || (sc[0] === bestScore[0] && (sc[1] < bestScore[1] || (sc[1] === bestScore[1] && sc[2] < bestScore[2])))) {
      best = e; bestScore = sc;
    }
  });
  return best.key;
}

// ---------------------------------------------------------------- 文章の解析（純粋関数）

function normalize_(s) {
  return String(s)
    .replace(/[０-９Ａ-Ｚａ-ｚ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
    .replace(/[：]/g, ':')
    .replace(/[，、]/g, ',')
    .replace(/[％]/g, '%')
    .replace(/[＋]/g, '+')
    .replace(/[　\t]/g, ' ')
    .replace(/(\d)\s*[〜～−–ー]\s*(\d)/g, '$1-$2')
    .replace(/[【】\[\]]/g, ' ')
    .trim()
    .replace(/^["“”]+|["“”]+$/g, '')     // スプレッドシートのセルをコピーすると文の前後に付く引用符
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

// ---------------------------------------------------------------- 報告テンプレ（ラベル形式）を1行形式に展開する

var EXPENSE_ALIAS = { '送料': '配送料', '返送料': '返送費', 'その他経費': 'その他' };   // 報告文での呼び方 → 使用経費の経費項目
var EXPENSE_LABELS = ['什器代', '宿泊費', '交通費', '配送料', '協賛費', '返送費', '支払手数料', 'その他', '送料', '返送料', 'その他経費'];
var TAX_IN_ITEMS = ['宿泊費', '交通費'];   // 使用経費タブは、この2項目だけ入力額を税込とみなして税抜に直す

function ymd_(d) { return d.y + '/' + d.m + '/' + d.d; }

/** 「税抜20,000円」「税込 8570」「1000円」から金額と税区分を取り出す */
function parseMoney_(s) {
  var m = s.match(/(税抜|税込)\s*(-?[\d,]+)/);
  if (m) {
    return { amt: num_(m[2]), tax: m[1] === '税抜' ? 'ex' : 'in',
      rest: s.replace(m[0], ' ').replace(/円/g, ' ').replace(/\s+/g, ' ').replace(/[,\s]+$/, '').trim() };
  }
  m = s.match(/(-?[\d,]+)\s*円?\s*$/);
  if (m) return { amt: num_(m[1]), tax: null, rest: s.slice(0, m.index).replace(/\s+/g, ' ').replace(/[,\s]+$/, '').trim() };
  return null;
}

/**
 * 「催事作成」「日次報告」「持込備品」の見出し行から始まるラベル形式の文を、
 * 従来の1行形式（売上 浜屋 10/21 税抜 … など）に展開する。
 * 戻り値: [{ t: 展開後の1行, src: 元の行 } または { err, src }]
 */
function expandBlocks_(text, ctx) {
  var out = [], cur = null;
  var emit = function (t, src) { out.push({ t: t, src: src }); };
  var fail = function (src, msg) { out.push({ err: msg, src: src }); };

  function needCtx(src) {
    if (!cur.event) { fail(src, '先に「店名：浜屋」の行が必要です'); return false; }
    if (!cur.date && cur.expenseOnly && ctx.today) {
      cur.date = { y: ctx.today.getFullYear(), m: ctx.today.getMonth() + 1, d: ctx.today.getDate() };   // 日付を省いた経費報告は今日の日付
    }
    if (!cur.date) { fail(src, '先に「日付：10/21」の行が必要です'); return false; }
    return true;
  }

  function flush() {
    if (!cur) return;
    var c = cur; cur = null;
    if (c.kind === '日次報告') {
      if (c.salesEx !== null || c.salesInc !== null) {
        if (c.salesEx === null) { fail(c.salesSrc, '売上(税抜)が必要です（レシートの税抜小計を書いてください）'); return; }
        if (!c.event || !c.date) { fail(c.salesSrc, '売上: 催事名・日付の行が必要です'); return; }
        emit('売上 ' + c.event + ' ' + ymd_(c.date) + ' 税抜 ' + c.salesEx + (c.salesInc !== null ? ' 税込 ' + c.salesInc : ''), c.salesSrc);
      }
    } else if (c.kind === '催事作成') {
      var shopName = (c.shop || c.event || '').replace(/\s+/g, '');
      var eventName = c.shop ? (c.event || '').replace(/\s+/g, '') : '';   // 店名があるときだけ、催事名はイベント名
      if (!shopName) { fail(c.src, '店名：浜屋 の行が必要です（ファイル名・フォルダ名に使います）'); return; }
      if (!c.period) { fail(c.src, '期間：10/21〜7日間 の行が必要です'); return; }
      var pd = parseDate_(c.period, ctx.year);
      if (!pd) { fail(c.src, '期間の開始日が読み取れません'); return; }
      var restP = c.period.replace(pd.text, ' ');
      var days = null, dm = restP.match(/^\s*-\s*(\d+)\s*日/);
      if (dm) days = Number(dm[1]);
      else {
        var pd2 = parseDate_(restP, pd.y);
        if (pd2) days = Math.round((new Date(pd2.y, pd2.m - 1, pd2.d) - new Date(pd.y, pd.m - 1, pd.d)) / 86400000) + 1;
      }
      var rate = c.rate ? c.rate.replace(/[^\d.]/g, '') : '';
      emit('催事作成 ' + shopName + ' ' + ymd_(pd) + (days ? ' ' + days + '日' : '') +
        (rate ? ' 出店料率' + rate + '%' : '') + (eventName ? ' イベント名 ' + eventName : '') +
        (c.place ? ' 場所 ' + c.place : ''), c.src);
      c.exps.forEach(function (x) { expandExpense_(x.label, x.value, shopName, pd, '', x.src, emit, fail); });
    }
  }

  String(text).split(/\r?\n/).forEach(function (raw) {
    var src = raw.trim(), line = normalize_(raw);
    if (!line) return;

    // 見出し行
    var h = line.match(/^(催事作成|日次報告|経費報告|持込備品|持ち込み備品|期首在庫)(?:\s*(.+))?$/);
    if (h && (h[1] !== '催事作成' || !h[2])) {
      flush();
      // 見出しの後ろは「店名」「店名 日付」「店名日付」（スペースなしでもよい）のどれでも読む
      var headRef = h[2] ? h[2].trim() : '', headDate = null;
      var hdm = headRef.match(/^(.*?)\s*((?:\d{4}[\/-])?\d{1,2}[\/月]\d{1,2}日?)$/);
      if (hdm) {
        headDate = parseDate_(hdm[2], ctx.year);
        if (headDate) headRef = hdm[1].trim();
      }
      var kind = h[1] === '持ち込み備品' ? '持込備品' : (h[1] === '経費報告' ? '日次報告' : h[1]);   // 経費報告は日次報告の経費だけ版（日付を省くと今日）
      cur = { kind: kind, expenseOnly: h[1] === '経費報告', event: headRef || null, date: headDate, user: null, src: src,
        place: '', shop: '', period: '', rate: '', exps: [], salesEx: null, salesInc: null, salesSrc: src, stockHeader: false };
      return;
    }
    if (!cur) { emit(line, src); return; }

    // ラベル行
    var lm = line.match(/^([^:\s]+)\s*:\s*(.*)$/);
    if (lm) {
      var label = lm[1].replace(/[()（）]/g, ''), val = lm[2].trim();
      if (!val) return;   // 未記入のラベル行（テンプレートのまま）は読み飛ばす
      if (label === '催事名') { cur.event = val; return; }      // 催事作成ではイベント名、ほかのブロックでは対象の店
      if (label === '店名') { if (cur.kind === '催事作成') cur.shop = val; else cur.event = val; return; }
      if (label === '日付') {
        var d = parseDate_(val, ctx.year);
        if (!d) return fail(src, '日付が読み取れません（10/21 の形で）');
        cur.date = d; return;
      }
      if (label === '報告者') { cur.user = val; return; }
      if (cur.kind === '催事作成') {
        if (label === '場所') { cur.place = val; return; }
        if (label === '期間') { cur.period = val; return; }
        if (label === '出店料' || label === '出店料率') { cur.rate = val; return; }
        if (EXPENSE_LABELS.indexOf(label) >= 0) { cur.exps.push({ label: label, value: val, src: src }); return; }
        return fail(src, '催事作成の中では「' + lm[1] + '」は使えません');
      }
      if (cur.kind === '日次報告') {
        if (label === '売上税抜' || label === '売上') { cur.salesEx = num_(val.replace(/[^\d,.-]/g, '')); cur.salesSrc = src; return; }
        if (label === '売上税込') { cur.salesInc = num_(val.replace(/[^\d,.-]/g, '')); cur.salesSrc = src; return; }
        if (!needCtx(src)) return;
        if (label === '人件費') { emit('人件費 ' + cur.event + ' ' + ymd_(cur.date) + ' ' + val, src); return; }
        if (label === '消耗品') {
          var rm = val.match(/(\d+(?:\.\d+)?)\s*%/), r = rm ? Number(rm[1]) : 10;
          var mm = parseMoney_(rm ? val.replace(rm[0], ' ') : val);
          if (!mm) return fail(src, '消耗品: 品名 購入場所 税抜金額 税率 の順で書いてください');
          var amt = mm.tax === 'in' ? Math.round(mm.amt / (1 + r / 100)) : mm.amt;
          var parts = mm.rest.split(/\s+/).filter(Boolean);
          if (!parts.length) return fail(src, '消耗品: 品名がありません');
          emit('領収書 ' + ymd_(cur.date) + ' ' + (cur.user || '本部') + ' ' + cur.event + ' ' + parts[0] + ' ' +
            (parts.slice(1).join(' ') || '-') + ' ' + amt + ' ' + r + '%', src);
          return;
        }
        if (EXPENSE_LABELS.indexOf(label) >= 0) { expandExpense_(label, val, cur.event, cur.date, '', src, emit, fail); return; }
        return fail(src, '日次報告の中では「' + lm[1] + '」は使えません');
      }
      return fail(src, cur.kind + 'の中では「' + lm[1] + '」は使えません');
    }

    // 従来形式の行が続いた場合は、ブロックを閉じてそのまま渡す
    if (/^(売上|在庫|人件費|経費|領収書|催事作成|備品|期首)\s+\S/.test(line)) { flush(); emit(line, src); return; }

    // 中身の行
    if (cur.kind === '日次報告') {
      var first = line.split(/\s+/)[0];
      if (ctx.products.indexOf(first) >= 0) {
        if (!needCtx(src)) return;
        if (!cur.stockHeader) { emit('在庫 ' + cur.event + ' ' + ymd_(cur.date), src); cur.stockHeader = true; }
        emit(line, src); return;
      }
      return fail(src, '商品名が商品マスタにありません、または書き方が読み取れません');
    }
    if (cur.kind === '期首在庫') {
      if (!cur.event) return fail(src, '先に「店名：浜屋」の行が必要です');
      emit('期首 ' + cur.event + ' ' + line + (cur.date ? ' 基準日 ' + ymd_(cur.date) : ''), src); return;
    }
    if (cur.kind === '持込備品') {
      if (!cur.event) return fail(src, '先に「店名：浜屋」の行が必要です');
      emit('備品 ' + cur.event + ' ' + line + (cur.date ? ' 基準日 ' + ymd_(cur.date) : ''), src); return;
    }
    fail(src, '読み取れない行です');
  });
  flush();
  return out;
}

/** 経費ラベル（什器代・交通費など）の1行を「経費 催事 日付 項目 内容 金額」に展開 */
function expandExpense_(label, val, event, date, unused, src, emit, fail) {
  var item = EXPENSE_ALIAS[label] || label;
  var amt, note, tax = null;
  var tm = val.match(/(税抜|税込)/);
  if (tm) tax = tm[1] === '税抜' ? 'ex' : 'in';

  // 「佐川 10ケース 単価1,220円」「佐川 10cs 1220」のように 数量 × 単価 で書かれたら、掛け算して合計にする
  var qm = val.match(/(\d+(?:\.\d+)?)\s*(ケース|cs|CS|個|台|箱|枚|本)\s*[×xX*]?\s*(?:単価)?\s*([\d,]+)\s*円?/);
  if (qm) {
    var qty = Number(qm[1]), unit = num_(qm[3]);
    amt = Math.round(qty * unit);
    var rest = val.replace(qm[0], ' ').replace(/税抜|税込/g, ' ').replace(/\s+/g, '');
    var uname = /ケース|cs|CS/.test(qm[2]) ? 'cs' : qm[2];
    note = rest + qm[1] + uname + '/' + unit;           // 例: 佐川10cs/1220
  } else {
    var mm = parseMoney_(val);
    if (!mm) return fail(src, label + ': 内容と金額（例: 税抜20,000円 / 佐川 10ケース 単価1,220円）を書いてください');
    amt = mm.amt; note = mm.rest || '-'; tax = mm.tax || tax;
  }
  var taxIn = TAX_IN_ITEMS.indexOf(item) >= 0;
  if (taxIn && tax === 'ex') amt = Math.round(amt * 1.1);
  if (!taxIn && tax === 'in') amt = Math.round(amt / 1.1);
  emit('経費 ' + event + ' ' + ymd_(date) + ' ' + item + ' ' + note + ' ' + amt, src);
}

/**
 * ctx = { year, events:[名前], products:[名前], lastWage:{氏名:時給} }
 * 戻り値 = { records:[...], errors:[{line, msg}] }
 */
function parseReport(text, ctx) {
  var records = [], errors = [];
  var stockCtx = null; // 直近の「在庫 催事 日付」
  var lines = expandBlocks_(text, ctx);

  lines.forEach(function (item) {
    var orig = item.src;
    if (item.err) { errors.push({ line: orig, msg: item.err }); return; }
    var line = normalize_(item.t);
    if (!line) return;
    var err = function (msg) { errors.push({ line: orig, msg: msg }); };

    var kw = line.match(/^(催事作成|売上|在庫|人件費|経費|領収書|備品|期首)\s*(.*)$/);

    // 在庫ブロックの商品行
    if (!kw) {
      var first = line.split(/\s+/)[0];
      if (ctx.products.indexOf(first) >= 0) {
        if (!stockCtx) return err('「在庫 催事名 日付」の行が先にありません');
        var rec = {
          type: 'stock', event: stockCtx.event, date: stockCtx.date, product: first,
          open: pick_(line, '期首'), in: pick_(line, '納品'), thaw: pick_(line, '解凍'), close: pick_(line, '閉店'),
          loss: pick_(line, 'ロス'), other: pick_(line, '他'), src: orig
        };
        records.push(rec);
        return;
      }
      return err('行頭が 売上/在庫/人件費/経費/領収書/催事作成/日次報告/持込備品 でも商品名でもありません');
    }

    var type = kw[1], rest = kw[2];

    // 日付のない報告（期首・備品）は「基準日 2026/09/09」があれば、その日が期間内の催事に振り分ける
    var hintDate = null;
    var hm = rest.match(/基準日\s*(\S+)/);
    if (hm) {
      rest = rest.replace(hm[0], ' ');
      var hd = parseDate_(hm[1], ctx.year);
      if (hd) hintDate = hd.y + '-' + ('0' + hd.m).slice(-2) + '-' + ('0' + hd.d).slice(-2);
    }

    if (type === '期首') {
      // 期首 催事 商品名 個数   （初日より前から冷凍庫にある数）
      var ot = rest.split(/\s+/).filter(Boolean);
      var oev = ot.shift(), oprod = ot.shift(), oqty = ot.length ? num_(ot[ot.length - 1].replace(/[^\d,.-]/g, '')) : NaN;
      if (!oev || !oprod || isNaN(oqty)) return err('期首: 「商品名 個数」の形で書いてください（例: プレーン 48）');
      var okey = findEvent_(ctx.events, oev, hintDate, ctx.today);
      if (!okey) return err('店名「' + oev + '」が催事マスタにありません');
      if (ctx.products.indexOf(oprod) < 0) return err('商品名「' + oprod + '」が商品マスタにありません');
      records.push({ type: 'open', event: okey, product: oprod, qty: oqty, src: orig });
      return;
    }

    if (type === '備品') {
      // 備品 催事 品名 単価N 持込N 購入N 持帰N
      var et = rest.split(/\s+/).filter(Boolean);
      var eev = et.shift(), ename = et.shift();
      if (!eev || !ename) return err('備品: 催事名と品名が必要です');
      var ekey = findEvent_(ctx.events, eev, hintDate, ctx.today);
      if (!ekey) return err('店名「' + eev + '」が催事マスタにありません');
      var eafter = et.join(' ');
      // 「購入+3」のように+を付けると、今ある数に足す（買い足しが何回あっても累計になる）。+なしは、その数に置き換える
      var qty = function (label) {
        var qm = eafter.match(new RegExp(label + '\\s*(\\+)?\\s*(-?[\\d,]+(?:\\.\\d+)?)'));
        return qm ? { v: num_(qm[2]), add: !!qm[1] } : null;
      };
      var qb = qty('持込'), qp = qty('購入'), qk = qty('持帰');
      var buyDate = hintDate;
      if (!buyDate && ctx.today) buyDate = ctx.today.getFullYear() + '-' + ('0' + (ctx.today.getMonth() + 1)).slice(-2) + '-' + ('0' + ctx.today.getDate()).slice(-2);
      records.push({ type: 'equip', event: ekey, name: ename, buyDate: buyDate, cost: pick_(eafter, '単価'),
        bring: qb ? qb.v : null, buy: qp ? qp.v : null, back: qk ? qk.v : null,
        addBring: !!(qb && qb.add), addBuy: !!(qp && qp.add), addBack: !!(qk && qk.add), src: orig });
      return;
    }

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
      var rkey = findEvent_(ctx.events, ev, dateStr, ctx.today);
      if (!rkey) return err('店名「' + ev + '」が催事マスタにありません');
      records.push({ type: 'receipt', date: dateStr, user: tokens[0], event: rkey, item: tokens[2],
        place: tokens.slice(3).join(' '), amount: amt, rate: rate, src: orig });
      return;
    }

    if (type === '催事作成') {
      // 催事作成 店名 開始日 [7日] [出店料率20%] [イベント名 xxx] [場所 xxx]
      var shop = tokens.shift();
      if (!shop) return err('催事作成: 店名がありません');
      var ckey = dateStr + '_' + shop;
      if (ctx.events.some(function (e) { return e.key === ckey; })) {
        return err('「' + ckey + '」はすでに催事マスタにあります（店舗ファイルが未作成なら、メニュー「店舗ファイルを作成」で作れます）');
      }
      var rest2 = tokens.join(' ');
      var pm = rest2.match(/場所\s*(.+)$/);        // 場所は行末まで（スペースを含んでよい）
      if (pm) rest2 = rest2.slice(0, pm.index);
      var em = rest2.match(/イベント名\s*(\S+)/);
      if (em) rest2 = rest2.replace(em[0], ' ');
      var dm = rest2.match(/(\d+)\s*日/);
      var rm = rest2.match(/出店料率\s*(\d+(?:\.\d+)?)\s*%?/);
      var cdays = dm ? Number(dm[1]) : null;
      var cstart = toDate_(dateStr);
      ctx.events.push({ key: ckey, shop: shop, event: em ? em[1] : '', start: cstart,
        end: cdays ? new Date(cstart.getFullYear(), cstart.getMonth(), cstart.getDate() + cdays - 1) : null });   // 同じ文の後続行が通るように
      records.push({ type: 'create', event: ckey, shop: shop, eventName: em ? em[1] : '', date: dateStr, days: cdays,
        rate: rm ? Number(rm[1]) / 100 : '', place: pm ? pm[1].trim() : '', src: orig });
      return;
    }

    // 以降は先頭トークンが催事名
    var eventRef = tokens.shift();
    if (!eventRef) return err('店名がありません');
    var event = findEvent_(ctx.events, eventRef, dateStr, ctx.today);
    if (!event) return err('店名「' + eventRef + '」が催事マスタにありません');
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
    .addItem('過去データを移行（催事マスタで○を付けた催事）', 'migratePast')
    .addItem('レシートを読み取る（レシート受付フォルダ）', 'processReceipts')
    .addItem('レシート読み取りの設定（APIキー）', 'setReceiptKey')
    .addItem('レシート自動読み取り（1時間ごと）を設定', 'setupReceiptTrigger')
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
    events: readMaster_(hq),
    today: new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()),
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
      notes.push('「' + r.event + '」を登録し、店舗ファイルを作成しました（' + days + '日）');
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
  var by = { sales: [], stock: [], labor: [], expense: [], receipt: [], equip: [], open: [] };
  recs.forEach(function (r) { by[r.type].push(r); });
  var errors = [];
  var fail = function (r, e) { errors.push({ src: r.src, msg: e.message }); };

  var sh = store.getSheetByName(STORE.STOCK);
  var layout = stockLayout_(sh);

  by.open.forEach(function (r) { try { writeOpen_(sh, layout, r); } catch (e) { fail(r, e); } });
  writeStockBatch_(sh, layout, by.stock, fail);
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
  by.equip.forEach(function (r) { try { writeEquip_(store, r, tz); } catch (e) { fail(r, e); } });
  return errors;
}

/**
 * 備品購入タブ（買い足しの日ごとの履歴）が無い店舗ファイルには作り、備品原価の「途中購入」を、その合計を出す式にする。
 * すでに入っていた「途中購入」の数は、開始日付の1行として履歴に移す。
 */
function ensureEquipBuy_(store) {
  var buy = store.getSheetByName(STORE.EQUIP_BUY);
  if (buy) return buy;
  var eq = store.getSheetByName(STORE.EQUIP);
  var start = asDate_(store.getSheetByName(STORE.STOCK).getRange('B2').getValue()) || new Date();
  buy = store.insertSheet(STORE.EQUIP_BUY);
  buy.getRange(1, 1, 1, 5).setValues([['日付', '品名', '数量', '単価(自動)', '金額(自動)']])
    .setBackground('#333333').setFontColor('#ffffff').setFontWeight('bold');
  buy.setFrozenRows(1);
  var carry = [];
  eq.getRange(2, 1, 150, 4).getValues().forEach(function (r) {
    if (r[0] && Number(r[3]) > 0) carry.push([start, r[0], Number(r[3])]);
  });
  if (carry.length) buy.getRange(2, 1, carry.length, 3).setValues(carry);
  var f = [];
  for (var i = 2; i <= 300; i++) {
    f.push(['=IF(B' + i + '="","",IFERROR(INDEX(' + STORE.EQUIP + '!$B$2:$B$151,MATCH(B' + i + ',' + STORE.EQUIP + '!$A$2:$A$151,0)),""))',
            '=IF(OR(C' + i + '="",D' + i + '=""),"",C' + i + '*D' + i + ')']);
  }
  buy.getRange(2, 4, 299, 2).setFormulas(f);
  buy.getRange(2, 1, 299, 1).setNumberFormat('yyyy/mm/dd');
  var df = [];
  for (var j = 2; j <= 151; j++) {
    df.push(['=IF(A' + j + '="",0,SUMIFS(' + STORE.EQUIP_BUY + '!$C$2:$C$300,' + STORE.EQUIP_BUY + '!$B$2:$B$300,A' + j + '))']);
  }
  eq.getRange(2, 4, 150, 1).setFormulas(df).setNumberFormat('0.##;-0.##;;@');
  return buy;
}

/**
 * 備品原価タブ: 品名が同じ行は更新（空欄の項目は今の値を残す）、なければ空き行に追加。
 * 買い足し（購入）は備品購入タブに日付つきで記録する（同じ日・同じ品名は置き換え、「購入+N」なら足す）。
 */
function writeEquip_(store, r, tz) {
  var buySh = ensureEquipBuy_(store);
  var sh = store.getSheetByName(STORE.EQUIP);
  var vals = sh.getRange(2, 1, 150, 5).getValues();
  var row = 0, empty = 0;
  for (var i = 0; i < vals.length; i++) {
    if (!vals[i][0] && !empty) empty = i + 2;
    if (String(vals[i][0]).trim() === r.name) { row = i + 2; break; }
  }
  var old = row ? vals[row - 2] : ['', '', '', '', ''];
  row = row || empty;
  if (!row) throw new Error('備品原価タブに空き行がありません');
  var pick = function (v, o, add) {
    if (v === null) return o;
    return add ? (Number(o) || 0) + v : v;            // +付きなら今の数に足す
  };
  sh.getRange(row, 1, 1, 3).setValues([[r.name, pick(r.cost, old[1], false), pick(r.bring, old[2], r.addBring)]]);
  sh.getRange(row, 5).setValue(pick(r.back, old[4], r.addBack));      // D列（途中購入）は式なので触らない

  if (r.buy !== null && r.buy !== undefined) {
    var date = r.buyDate;
    var rows = buySh.getRange(2, 1, 299, 3).getValues();
    var at = 0, free = 0;
    for (var k = 0; k < rows.length; k++) {
      if (!rows[k][1] && !rows[k][0] && !free) free = k + 2;
      if (cellKey_(rows[k][0], tz) === date && String(rows[k][1]).trim() === r.name) { at = k + 2; break; }
    }
    if (at) {
      var cur = Number(buySh.getRange(at, 3).getValue()) || 0;
      buySh.getRange(at, 3).setValue(r.addBuy ? cur + r.buy : r.buy);
    } else if (r.buy !== 0) {
      if (!free) throw new Error('備品購入タブに空き行がありません');
      buySh.getRange(free, 1, 1, 3).setValues([[toDate_(date), r.name, r.buy]]);
    }
  }
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

/** 期首冷凍在庫（D列）に書く */
function writeOpen_(sh, layout, r) {
  var i = layout.names.indexOf(r.product);
  if (i < 0 || i >= layout.count) throw new Error('商品「' + r.product + '」が在庫管理表にありません');
  sh.getRange(FIRST_ROW + i, 4).setValue(r.qty);
}

/** 在庫の入力を、日ごとにまとめて読み書きする（1セルずつ書くより速く、数日分を一度に貼っても時間切れになりにくい） */
function writeStockBatch_(sh, layout, recs, fail) {
  var byDate = {};
  recs.forEach(function (r) { (byDate[r.date] = byDate[r.date] || []).push(r); });
  Object.keys(byDate).forEach(function (d) {
    var c;
    try { c = dayBlock_(layout, d); } catch (e) { byDate[d].forEach(function (r) { fail(r, e); }); return; }
    var a = sh.getRange(FIRST_ROW, c, layout.count, 1);        // 納品
    var b = sh.getRange(FIRST_ROW, c + 2, layout.count, 4);    // 解凍, 閉店冷蔵, ロス, 他
    var av = a.getValues(), bv = b.getValues();
    byDate[d].forEach(function (r) {
      var i = layout.names.indexOf(r.product);
      if (i < 0 || i >= layout.count) return fail(r, new Error('商品「' + r.product + '」が在庫管理表にありません'));
      if (r.open !== null && r.open !== undefined) sh.getRange(FIRST_ROW + i, 4).setValue(r.open);   // 期首冷凍在庫
      if (r.in !== null) av[i][0] = r.in;
      if (r.thaw !== null) bv[i][0] = r.thaw;
      if (r.close !== null) bv[i][1] = r.close;
      if (r.loss !== null) bv[i][2] = r.loss;
      if (r.other !== null) bv[i][3] = r.other;
    });
    a.setValues(av); b.setValues(bv);
  });
}

function writeStock_(sh, layout, r) {
  var i = layout.names.indexOf(r.product);
  if (i < 0 || i >= layout.count) throw new Error('商品「' + r.product + '」が在庫管理表にありません');
  if (r.open !== null && r.open !== undefined) writeOpen_(sh, layout, { product: r.product, qty: r.open });
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

/** 催事マスタを読む。終了日が空欄なら、開始日と日数から求める */
function readMaster_(hq) {
  var sh = hq.getSheetByName(SHEET.EVENT);
  var n = sh.getLastRow() - 1;
  if (n < 1) return [];
  var out = [];
  sh.getRange(2, 1, n, EV.COLS).getValues().forEach(function (v, i) {
    var key = String(v[EV.KEY]).trim();
    if (!key) return;
    var start = asDate_(v[EV.START]), end = asDate_(v[EV.END]), days = Number(v[EV.DAYS]);
    if (!end && start && days >= 1) end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + days - 1);
    out.push({ row: i + 2, v: v, key: key, shop: shopOfKey_(key), event: String(v[EV.EVENT]).trim(), start: start, end: end });
  });
  return out;
}

/** 催事マスタの行（2始まり）を探す */
function eventRow_(hq, event) {
  var sh = hq.getSheetByName(SHEET.EVENT);
  var names = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 1).getValues();
  for (var i = 0; i < names.length; i++) if (String(names[i][0]).trim() === event) return i + 2;
  throw new Error('催事マスタに「' + event + '」がありません');
}

function openStore_(hq, event) {
  var row = eventRow_(hq, event);
  var id = hq.getSheetByName(SHEET.EVENT).getRange(row, EV.ID + 1).getValue();
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
  sh.getRange(row, 1, 1, 6).setValues([[r.event, r.eventName, r.place, start, end, r.rate]]);   // r.event は「年-月-日_店名」
  if (days) sh.getRange(row, EV.DAYS + 1).setValue(days);
  createStoreFile_(hq, row);
  return days || eventDays_(sh.getRange(row, 1, 1, EV.COLS).getValues()[0]);
}

/** 催事マスタの1行から日数を決める（H列があればそれ、なければ 開始日〜終了日） */
function eventDays_(row) {
  var d = Number(row[EV.DAYS]);
  if (d >= 1) return Math.min(d, DAYS);
  var s = asDate_(row[EV.START]), e = asDate_(row[EV.END]);
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

/** 「{開始日}_経営管理_{催事名}」のような名前の型に、日付や催事名を当てはめる */
function fillPattern_(pattern, shop, eventName, start, tz) {
  var d = start || new Date();
  return String(pattern)
    .replace(/\{開始日\}/g, Utilities.formatDate(d, tz, 'yyyy-MM-dd'))
    .replace(/\{年月\}/g, Utilities.formatDate(d, tz, 'yyyy-MM'))
    .replace(/\{年\}/g, Utilities.formatDate(d, tz, 'yyyy'))
    .replace(/\{店名\}/g, shop)
    .replace(/\{催事名\}/g, eventName || shop);
}

/**
 * 親フォルダの中から催事のフォルダを探し、なければ作る。
 * 「2026-01_西宮阪急_九州うまかもん」のように後ろに名前が続くフォルダも、先頭が一致すれば同じものとして使う。
 */
function findOrCreateFolder_(parent, folderName) {
  var it = parent.getFolders();
  while (it.hasNext()) {
    var f = it.next(), n = f.getName();
    if (n === folderName || n.indexOf(folderName + '_') === 0) return f;
  }
  return parent.createFolder(folderName);
}

/** テンプレートをコピーして店舗ファイルを作り、催事マスタにIDを記録する */
function createStoreFile_(hq, row) {
  var settings = hq.getSheetByName(SHEET.SETTINGS);
  var templateId = settings.getRange('B1').getValue();
  var rootId = settings.getRange('B2').getValue();            // 催事フォルダを作る親（例: 03_催事出店）
  var filePattern = settings.getRange('B3').getValue() || '{開始日}_損益管理_{店名}';
  var folderPattern = settings.getRange('B4').getValue() || '{年月}_{店名}';
  var ev = hq.getSheetByName(SHEET.EVENT);
  var v = ev.getRange(row, 1, 1, EV.COLS).getValues()[0];
  var tz = hq.getSpreadsheetTimeZone();
  var startDate = asDate_(v[EV.START]);
  var shop = shopOfKey_(v[EV.KEY]);
  var evName = String(v[EV.EVENT] || '').trim();
  var folder = findOrCreateFolder_(DriveApp.getFolderById(rootId), fillPattern_(folderPattern, shop, evName, startDate, tz));
  var fileName = fillPattern_(filePattern, shop, evName, startDate, tz);
  var copy = DriveApp.getFileById(templateId).makeCopy(fileName, folder);
  var store = SpreadsheetApp.openById(copy.getId());
  var st = store.getSheetByName(STORE.STOCK);
  st.getRange('B1').setValue(fileName);                 // 在庫管理表の催事名はファイル名と同じにする
  st.getRange('B2').setValue(startDate || v[EV.START]);
  st.getRange('D2').setValue(v[EV.RATE]);             // 出店料率
  applyDays_(store, eventDays_(v));
  ev.getRange(row, EV.ID + 1).setValue(copy.getId());
  return copy.getId();
}

/** メニュー: 催事マスタの「日数」「出店料率」「開始日」を、作成済みの店舗ファイルに反映する */
function updateDays() {
  var hq = SpreadsheetApp.getActive();
  var sh = hq.getSheetByName(SHEET.EVENT);
  var n = sh.getLastRow() - 1;
  if (n < 1) return;
  var done = [];
  sh.getRange(2, 1, n, EV.COLS).getValues().forEach(function (v) {
    if (!v[EV.KEY] || !v[EV.ID]) return;
    try {
      var store = SpreadsheetApp.openById(String(v[EV.ID]));
      var st = store.getSheetByName(STORE.STOCK);
      st.getRange('D2').setValue(v[EV.RATE]);
      applyDays_(store, eventDays_(v));
      done.push(v[EV.KEY]);
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
  var vals = sh.getRange(2, 1, n, EV.COLS).getValues();
  var made = [];
  vals.forEach(function (r, i) {
    if (r[EV.KEY] && !r[EV.ID]) { createStoreFile_(hq, i + 2); made.push(r[EV.KEY]); }
  });
  SpreadsheetApp.getUi().alert(made.length ? '店舗ファイルを作成しました:\n' + made.join('\n') : '作成が必要な催事はありません');
}

// ---------------------------------------------------------------- 過去の催事データの移行（元の経営管理ファイルから）

/**
 * 催事マスタのJ列「過去データ移行」に「○」を付けた催事だけ、元の経営管理ファイルから店舗ファイルへ写す。
 * 写し終わると J列が「済」になる。店舗ファイルが無ければ作る。少しずつ進めたいときは、○を付けた分だけが対象。
 *   元の同名タブ（在庫）と、使用経費・人件費・備品原価・領収書の該当行を写す。元ファイルのIDは「設定」タブの B5。
 * 「済」の催事にもう一度「○」を付けると、やり直せる（使用経費などの入力欄は、いったん消してから写し直す）。
 */
function migratePast() {
  var hq = SpreadsheetApp.getActive();
  var oldId = hq.getSheetByName(SHEET.SETTINGS).getRange('B5').getValue();
  var ui = SpreadsheetApp.getUi();
  if (!oldId) { ui.alert('「設定」タブのB5に、元の経営管理ファイル（Googleスプレッドシート版）のIDを入れてください'); return; }
  var old = SpreadsheetApp.openById(String(oldId));
  var sh = hq.getSheetByName(SHEET.EVENT);
  var n = sh.getLastRow() - 1;
  if (n < 1) return;
  var rows = sh.getRange(2, 1, n, 10).getValues();
  var t0 = Date.now(), done = [], skipped = [], stopped = false, any = false;

  rows.forEach(function (v, i) {
    var mark = String(v[9]).trim();
    if (!v[EV.KEY] || (mark !== '○' && mark !== '〇')) return;
    any = true;
    if (stopped) return;
    var key = String(v[EV.KEY]).trim(), shop = shopOfKey_(key);
    var tab = old.getSheetByName(shop);
    if (!tab) { skipped.push(key + '（元のファイルに「' + shop + '」タブなし）'); return; }
    if (Date.now() - t0 > 4.2 * 60 * 1000) { stopped = true; return; }   // 実行時間の上限対策（もう一度押せば続きから）
    try {
      migrateOne_(old, tab, openStore_(hq, key), shop, asDate_(v[EV.START]) || new Date());
      sh.getRange(i + 2, 10).setValue('済');
      done.push(key);
    } catch (err) { skipped.push(key + '（' + err.message + '）'); }
  });

  if (!any) { ui.alert('催事マスタのJ列「過去データ移行」に、移行したい催事の行へ「○」を付けてから押してください'); return; }
  if (done.length) pullStoreData_(hq, done);
  ui.alert('過去データの移行\n移行: ' + (done.join('、') || 'なし') +
    (skipped.length ? '\n飛ばした: ' + skipped.join('、') : '') +
    (stopped ? '\n\n時間切れのため途中までです。もう一度押すと、○のまま残った分が続きから進みます。' : ''));
}

function migrateOne_(old, tab, store, shop, startDate) {
  var sh = store.getSheetByName(STORE.STOCK);
  var layout = stockLayout_(sh);

  // 在庫管理表: 元のタブの商品名で突き合わせて、入力欄（期首・納品・解凍・閉店・ロス・他・実売上）を写す
  var oldNames = tab.getRange(FIRST_ROW, 3, 60, 1).getValues().map(function (r) { return String(r[0]).trim(); });
  var oldEnd = oldNames.indexOf('商品合計'); if (oldEnd < 0) oldEnd = 17;
  var rowOf = layout.names.slice(0, layout.count).map(function (n) {
    var j = oldNames.indexOf(n); return j >= 0 && j < oldEnd ? j : -1;
  });
  var num = function (v) { return v === '' || v === null || isNaN(Number(v)) ? 0 : Number(v); };

  var oldOpen = tab.getRange(FIRST_ROW, 4, oldEnd, 1).getValues();
  sh.getRange(FIRST_ROW, 4, layout.count, 1).setValues(rowOf.map(function (j) { return [j < 0 ? 0 : num(oldOpen[j][0])]; }));

  var oldSalesRow = FIRST_ROW + oldEnd + 2;
  for (var k = 0; k < layout.days; k++) {
    var c = FIRST_COL + 8 * k;
    var blk = tab.getRange(FIRST_ROW, c, oldEnd, 6).getValues();           // 納品, 在庫計, 解凍, 閉店冷蔵, ロス, 他
    sh.getRange(FIRST_ROW, c, layout.count, 1).setValues(rowOf.map(function (j) { return [j < 0 ? 0 : num(blk[j][0])]; }));
    sh.getRange(FIRST_ROW, c + 2, layout.count, 4).setValues(rowOf.map(function (j) {
      return j < 0 ? [0, 0, 0, 0] : [num(blk[j][2]), num(blk[j][3]), num(blk[j][4]), num(blk[j][5])];
    }));
    var sales = tab.getRange(oldSalesRow, c + 1, 1, 2).getValues()[0];
    sh.getRange(layout.salesRow, c + 1, 1, 2).setValues([[num(sales[0]), num(sales[1])]]);
  }

  // 使用経費 / 人件費 / 備品原価 / 領収書: 元の表から、この催事の行だけを選んで、列を詰めて写す
  var take = function (name, nCols, key) {
    var s = old.getSheetByName(name);
    var n = s ? s.getLastRow() - 1 : 0;
    if (n < 1) return [];
    return s.getRange(2, 1, n, nCols).getValues().filter(function (r) { return String(r[key]).trim() === shop; });
  };
  var put = function (name, rows, cols) {          // cols: [[元の列, 先の先頭列, 列数]...] を行ごとに並べ替えて書く
    if (!rows.length) return;
    var d = store.getSheetByName(name), start = firstEmpty_(d, 1, 2, 300);
    cols.forEach(function (m) {
      d.getRange(start, m.to, rows.length, m.from.length).setValues(rows.map(function (r) {
        return m.from.map(function (i) { return r[i]; });
      }));
    });
  };
  // やり直しで二重にならないよう、入力欄をいったん空にしてから写す
  ensureEquipBuy_(store);
  [[STORE.EQUIP_BUY, 'A2:C300'], [STORE.EXPENSE, 'A2:D300'], [STORE.LABOR, 'A2:E300'], [STORE.LABOR, 'G2:I300'], [STORE.EQUIP, 'A2:C150'], [STORE.EQUIP, 'E2:E150'], [STORE.RECEIPT, 'A2:F300']].forEach(function (x) {
    store.getSheetByName(x[0]).getRange(x[1]).clearContent();
  });
  put(STORE.EXPENSE, take('使用経費（本部専用）', 5, 1), [{ from: [0, 2, 3, 4], to: 1 }]);                       // 日付,項目,内容,金額
  put(STORE.LABOR, take('人件費（本部専用）', 11, 2), [{ from: [0, 1, 4, 5, 6], to: 1 }, { from: [8, 9, 10], to: 7 }]);
  var equipRows = take('備品原価（本部専用）', 6, 0);                       // 品名,単価,事前持込,途中購入,持ち帰り
  ensureEquipBuy_(store);
  put(STORE.EQUIP, equipRows, [{ from: [1, 2, 3], to: 1 }, { from: [5], to: 5 }]);   // 途中購入(D列)は式なので、備品購入タブへ
  var buys = equipRows.filter(function (r) { return Number(r[4]) > 0; }).map(function (r) { return [startDate, r[1], Number(r[4])]; });
  if (buys.length) store.getSheetByName(STORE.EQUIP_BUY).getRange(2, 1, buys.length, 3).setValues(buys);
  put(STORE.RECEIPT, take('領収書（立替経費）', 9, 8), [{ from: [0, 1, 2, 3, 4, 5], to: 1 }]);
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
  var master = ev.getRange(2, 1, n, EV.COLS).getValues();
  var data = hq.getSheetByName(SHEET.STOREDATA);
  var last = data.getLastRow();
  var existing = last > 1 ? data.getRange(2, 1, last - 1, 1).getValues() : [];
  var rowOf = {};
  existing.forEach(function (r, i) { rowOf[String(r[0])] = i + 2; });
  var now = new Date(), count = 0, nextRow = last + 1;

  master.forEach(function (m) {
    var name = String(m[EV.KEY]).trim(), id = m[EV.ID];
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

// ---------------------------------------------------------------- レシートの写真を読み取って取り込む（Claude API）

var RECEIPT_MODEL = 'claude-sonnet-5-5';   // 設定タブのB8で変えられる（例: claude-haiku-5-5 は安い、claude-opus-5-5 は高性能）
var RECEIPT_PROMPT = [
  'これは日本の店舗のレシート（または日次締めの精算レシート）の画像です。次のJSONだけを返してください（説明文やコードブロックは不要）。',
  '{',
  '  "type": "sales_close" | "purchase" | "unknown",',
  '  "date": "YYYY-MM-DD",',
  '  "store": "購入した店名（無ければ空文字）",',
  '  "sales_excl_tax": 数値または null,',
  '  "sales_incl_tax": 数値または null,',
  '  "items": [ { "name": "品名", "amount_excl_tax": 数値または null, "amount_incl_tax": 数値または null, "tax_rate": 8 または 10 または null } ],',
  '  "total_incl_tax": 数値または null,',
  '  "note": "読み取りに自信がない点があれば短く"',
  '}',
  '決まり:',
  '- type: レジの「日次締め／精算／Zレポート」など、1日の売上合計が出ている紙は sales_close。買い物のレシートは purchase。どちらか判断できなければ unknown。',
  '- sales_close: sales_excl_tax は税抜の売上合計（返品・値引き後の純売上）、sales_incl_tax は税込の売上合計。items は空配列。',
  '- purchase: 明細ごとに items に入れる。税抜の金額が書いてあれば amount_excl_tax、税込のみなら amount_incl_tax に入れ、tax_rate（軽減税率は8、標準は10）も分かれば入れる。値引き行は負の金額の明細にする。',
  '- 金額はすべて円の数値（カンマなし）。見えない・分からない項目は null。推測で数字を作らない。',
  '- date はレシートに印字された日付（西暦に直す）。'
].join('\n');

/** メニュー: APIキーをこのスクリプトだけに保存する（シートには書かない） */
function setReceiptKey() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('Claude APIキー', 'console.anthropic.com で作ったAPIキー（sk-ant-…）を貼ってください。\nスクリプトの「スクリプトプロパティ」に保存され、シートには残りません。', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK || !r.getResponseText().trim()) return;
  PropertiesService.getScriptProperties().setProperty('ANTHROPIC_API_KEY', r.getResponseText().trim());
  ui.alert('保存しました。「レシートを読み取る」で試してください。');
}

/** モデルが返した文字列から JSON を取り出す（```json で囲まれていても読む） */
function parseModelJson_(text) {
  var t = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  var a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('レシートの読み取り結果がJSONではありませんでした');
  return JSON.parse(t.slice(a, b + 1));
}

/** 画像/PDFを Claude API に渡して、レシートの内容を取り出す */
function readReceipt_(file, apiKey, model) {
  var blob = file.getBlob(), mime = blob.getContentType();
  var isPdf = mime === 'application/pdf';
  if (!isPdf && !/^image\/(jpeg|png|gif|webp)$/.test(mime)) throw new Error('対応していない形式です（' + mime + '）。JPEG/PNG/PDFで入れてください');
  if (blob.getBytes().length > 4.5 * 1024 * 1024) throw new Error('ファイルが大きすぎます（4.5MBまで）');
  var data = Utilities.base64Encode(blob.getBytes());
  var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({
      model: model || RECEIPT_MODEL, max_tokens: 4000,
      output_config: { effort: 'low' },             // 読み取りだけなので、考える量は控えめ（費用を抑える）
      messages: [{ role: 'user', content: [
        { type: isPdf ? 'document' : 'image', source: { type: 'base64', media_type: mime, data: data } },
        { type: 'text', text: RECEIPT_PROMPT }
      ] }]
    })
  });
  var code = res.getResponseCode(), body = res.getContentText();
  if (code !== 200) throw new Error('API エラー(' + code + '): ' + body.slice(0, 200));
  var content = JSON.parse(body).content || [];
  var text = content.filter(function (c) { return c.type === 'text'; }).map(function (c) { return c.text; }).join('');
  return parseModelJson_(text);
}

function ymdToMd_(d) { var p = String(d).split('-'); return Number(p[1]) + '/' + Number(p[2]); }
function cleanToken_(s) { return String(s || '').replace(/[\s　:：]/g, ''); }

/**
 * 読み取り結果を、報告文（日次報告）に直す。どの催事かは、ファイル名の先頭の店名 → レシートの日付が期間内の催事（1つに決まるとき）の順で決める。
 * 戻り値: { text } または { error }
 */
function receiptToReport_(rc, fileName, events, today) {
  if (!rc || rc.type === 'unknown' || !rc.type) return { error: 'レシートの種類（売上の日次締め／購入）を判別できませんでした' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(rc.date || ''))) return { error: 'レシートの日付を読み取れませんでした' };

  var key = null, first = String(fileName).split(/[\s_　]+/)[0];
  if (first) key = findEvent_(events, first, rc.date, today);
  if (!key) {
    var d = toDate_(rc.date);
    var open = events.filter(function (e) { return e.start && d >= e.start && d <= (e.end || e.start); });
    if (open.length === 1) key = open[0].key;
    else return { error: open.length ? 'この日に開催中の催事が複数あります。ファイル名の先頭に店名を付けてください（例: 浜屋 売上.jpg）' : 'この日付に開催中の催事が見つかりません（ファイル名の先頭に店名を付けてください）' };
  }
  var head = '日次報告 ' + key + ' ' + ymdToMd_(rc.date) + '\n';

  if (rc.type === 'sales_close') {
    if (rc.sales_excl_tax == null) return { error: '売上の税抜が読み取れませんでした（手入力してください）' };
    return { key: key, text: head + '売上(税抜)：' + Math.round(rc.sales_excl_tax) + '\n' +
      (rc.sales_incl_tax != null ? '売上(税込)：' + Math.round(rc.sales_incl_tax) + '\n' : '') };
  }
  if (rc.type === 'purchase') {
    var store = cleanToken_(rc.store) || '-';
    var lines = [];
    (rc.items || []).forEach(function (it) {
      var name = cleanToken_(it.name) || '品名不明';
      var rate = it.tax_rate === 8 ? 8 : 10;
      if (it.amount_excl_tax != null) lines.push('消耗品：' + name + ' ' + store + ' 税抜' + Math.round(it.amount_excl_tax) + '円 ' + rate + '%');
      else if (it.amount_incl_tax != null) lines.push('消耗品：' + name + ' ' + store + ' 税込' + Math.round(it.amount_incl_tax) + '円 ' + rate + '%');
    });
    if (!lines.length && rc.total_incl_tax != null) lines.push('消耗品：レシート合計 ' + store + ' 税込' + Math.round(rc.total_incl_tax) + '円 10%');
    if (!lines.length) return { error: '購入の明細・合計を読み取れませんでした' };
    return { key: key, text: head + '報告者：レシート読み取り\n' + lines.join('\n') + '\n' };
  }
  return { error: '未対応のレシートの種類です（' + rc.type + '）' };
}

/**
 * 「レシート受付」フォルダの写真/PDFを読み取って取り込み、終わったら「処理済み」フォルダへ移す。
 * ファイル名の先頭に店名を付けると確実（例: 「浜屋 売上 10/21.jpg」）。付けなくても、その日に開催中の催事が1つなら自動で決まる。
 */
function processReceipts() {
  var hq = SpreadsheetApp.getActive();
  var ui = null; try { ui = SpreadsheetApp.getUi(); } catch (e) { /* トリガー実行 */ }
  var apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  var set = hq.getSheetByName(SHEET.SETTINGS);
  var inId = set.getRange('B6').getValue(), doneId = set.getRange('B7').getValue();
  var model = String(set.getRange('B8').getValue() || '').trim() || RECEIPT_MODEL;
  if (!apiKey || !inId || !doneId) { if (ui) ui.alert('先に「レシート読み取りの設定（APIキー）」を行ってください（設定タブのB6・B7にフォルダIDも必要です）'); return; }

  var inbox = DriveApp.getFolderById(inId), done = DriveApp.getFolderById(doneId);
  var tz = hq.getSpreadsheetTimeZone();
  var now = new Date(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var events = readMaster_(hq);
  var files = inbox.getFiles(), t0 = Date.now(), n = 0, ok = [], ng = [];

  while (files.hasNext()) {
    if (n >= 8 || Date.now() - t0 > 4 * 60 * 1000) break;      // 1回あたりの上限（残りは次回）
    var f = files.next();
    n++;
    try {
      var rc = readReceipt_(f, apiKey, model);
      var conv = receiptToReport_(rc, f.getName(), events, today);
      if (conv.error) throw new Error(conv.error);
      var msg = importText(conv.text);
      if (/エラー 0 行/.test(msg)) {
        var label = f.getName() + '（' + (rc.type === 'sales_close' ? '売上' : '購入') + ' ' + rc.date + '）';
        f.setName(Utilities.formatDate(now, tz, 'yyyyMMdd-HHmm') + '_' + f.getName());
        f.moveTo(done);
        ok.push(label);
      } else {
        ng.push(f.getName() + ' → ' + msg.split('\n').slice(0, 3).join(' / '));
      }
    } catch (err) {
      ng.push(f.getName() + ' → ' + err.message);
      var ls = hq.getSheetByName(SHEET.LOG);
      ls.getRange(ls.getLastRow() + 1, 1, 1, 5).setValues([[now, 'receipt', f.getName(), 'エラー', err.message]]);
    }
  }
  var summary = 'レシート読み取り: 取り込み ' + ok.length + ' 件 / 失敗 ' + ng.length + ' 件' +
    (ok.length ? '\n成功: ' + ok.join('、') : '') + (ng.length ? '\n失敗（ファイルは受付フォルダに残しています）:\n' + ng.join('\n') : '');
  if (ui) ui.alert(summary);
}

function setupReceiptTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'processReceipts') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('processReceipts').timeBased().everyHours(1).create();
  SpreadsheetApp.getUi().alert('1時間ごとに、レシート受付フォルダを読み取る設定をしました');
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
