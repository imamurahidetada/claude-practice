#!/usr/bin/env python3
"""海馬と KW のリンク健診。孤立・行き止まり・切れリンクを数え、密度を出す。

使い方:
    python3 ~/Documents/汎用/海馬/リンク健診.py                 # 海馬
    python3 ~/Documents/汎用/海馬/リンク健診.py ~/Documents/汎用/kushclan-workspace
    python3 ~/Documents/汎用/海馬/リンク健診.py --quiet          # 数だけ

**この道具が存在する理由**（2026-10-02）: grep で `[[...]]` を数えると、
次の5つで必ず嘘をつく。実際に 67件の切れリンクを報告したが、本当は 26件だった。

1. **インラインコードの中** — `` `[[名前]]` `` はリンクにならない（Obsidian も同じ）。
   逆に、リンクのつもりでコードスパンに入れてしまった実リンクも、ここで見つかる
2. **行をまたぐバッククォート** — ファイル全体に正規表現をかけると、
   奇数個のバッククォートでペアがずれて、無関係な行が消える。**行単位で処理する**
3. **ユニコード正規化** — macOS のファイル名は NFD（「バ」が「ハ」＋濁点）、
   本文は NFC。正規化せずに比べると、濁点を含む名前のリンクが全部切れて見える
4. **パス付きリンクと同名ノート** — `[[日々/2026-09-14]]` と
   `[[Addness/スナップショット/2026-09-14]]` は別物。stem だけで照合すると混ざる
5. **表の中のエスケープ** — 表のセルでは `[[A\\|B]]` が正しく、表の外では `[[A|B]]` が正しい。
   前者を切れリンクと数えてはいけない（逆に、表の外の `\\|` は本当に壊れている）

frontmatter の `関連:` に置いた `"[[A]]"` も、Obsidian はリンクとして解決する。
外に出す読み物（台本・Diana へ渡す資料）の本文を汚さずにリンクを張れるので、ここも数える。
"""
import re
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path
from urllib.parse import unquote

NFC = lambda s: unicodedata.normalize("NFC", s)
QUIET = "--quiet" in sys.argv
ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
ROOT = Path(ARGS[0] if ARGS else Path.home() / "Documents/汎用/海馬/海馬").expanduser().resolve()

# 凍結した記録（後から書き換えない）。行き止まりでも直さない
FROZEN = ("日々/", "Addness/スナップショット/", "基盤/CLAUDE.mdの版/", "CLAUDE.md",
          "01_日報/", ".claude/", "07_配布/", "08_連絡/inbox/")

# 生データ（調べ役の出力そのまま）。まとめ側からフォルダ単位で張れていれば十分
RAW = ("_raw", "/raw/", "ブランディング調査/")

# ひな形・説明文の中の「名前の置き場所」。切れリンクとして数えない
PLACEHOLDER = re.compile(r"[〈〉<>]|〇〇|[○◯]{2}|^\^|ページ名$|ノート名$|^名前$|^まだ無い名前$|^資料名$|^商品名")


def strip_code(text):
    """コードフェンスを消し、インラインコードは行単位・同幅バッククォートで消す。"""
    text = re.sub(r"^```.*?^```", "", text, flags=re.S | re.M)
    return "\n".join(re.sub(r"(`+)(.*?)\1", "", line) for line in text.split("\n"))


def main():
    files = sorted(p for p in ROOT.rglob("*.md")
                   if ".obsidian" not in str(p) and "/.git/" not in str(p))
    if not files:
        sys.exit("md が見つかりません: %s" % ROOT)

    by_stem, by_path = defaultdict(list), {}
    for p in files:
        rel = p.relative_to(ROOT)
        by_stem[NFC(p.stem)].append(p)
        by_path[NFC(rel.with_suffix("").as_posix())] = p   # Windows でも区切りは / に揃える（2026-10-07）
        by_path[NFC(rel.as_posix())] = p

    def resolve_wiki(target, src=None):
        t = NFC(target.replace("\\|", "|").split("|")[0].split("#")[0].strip())
        if not t:
            return "SELF"                                   # [[#見出し]] は自ファイル内
        for cand in (t, t + ".md", t[:-3] if t.endswith(".md") else t):
            if cand in by_path:
                return by_path[cand]
        stem = t.split("/")[-1]
        stem = stem[:-3] if stem.endswith(".md") else stem
        hits = by_stem.get(stem)
        if not hits:
            return None
        if len(hits) == 1:
            return hits[0]
        # 同名が複数（日付だけの名前など）: ①同じフォルダ ②凍結でないもの ③パス順。
        # 2026-10-07 に Windows の体が「孤立 8」を報告し、Mac は 0 だった。原因は hits[0] が OS のファイル順に依存していたこと
        same = [h for h in hits if src is not None and h.parent == src.parent]
        if same:
            return sorted(same)[0]
        live = [h for h in hits if not h.relative_to(ROOT).as_posix().startswith(FROZEN)]
        return sorted(live or hits)[0]

    inbound, outbound = defaultdict(set), defaultdict(set)
    broken, total, ambiguous, placeholders = defaultdict(list), 0, [], 0
    for p in files:
        body = strip_code(p.read_text(encoding="utf-8")).replace('"[[', "[[").replace(']]"', "]]")
        for m in re.finditer(r"\[\[([^\]\n]+)\]\]", body):          # Obsidian 形式
            r = resolve_wiki(m.group(1), p)
            if r is None:
                if not PLACEHOLDER.search(m.group(1)):
                    broken[p].append(m.group(1))
                else:
                    placeholders += 1
            elif r not in ("SELF", p):
                total += 1
                outbound[p].add(r)
                inbound[r].add(p)
        for m in re.finditer(r"\[[^\]\n]*\]\(([^)\n]+)\)", body):    # Markdown 形式（KW）
            u = unquote(m.group(1).split("#")[0].strip())
            if u.startswith(("http", "mailto:", "#")) or not u:
                continue
            t = p.parent / u
            if t.is_dir():                                           # フォルダは GitHub で有効
                continue
            try:
                r = ROOT / t.resolve().relative_to(ROOT)
            except Exception:
                continue
            if r.suffix == ".md" and r in files:
                total += 1
                outbound[p].add(r)
                inbound[r].add(p)
            elif not t.exists() and u.endswith(".md"):
                broken[p].append(u)

    for stem, ps in by_stem.items():
        if len(ps) > 1:
            ambiguous.append((stem, ps))

    def frozen(p):
        rel = p.relative_to(ROOT).as_posix()
        return rel.startswith(FROZEN) or any(x in "/" + rel for x in RAW)
    orphans = [p for p in files
               if not inbound[p] and p.name not in ("目録.md", "README.md") and not frozen(p)]
    dead = [p for p in files if not outbound[p] and not frozen(p)]
    n_broken = sum(len(v) for v in broken.values())

    print("%s ／ ノート %d 本 ／ リンク %d 本（1本あたり %.1f）" %
          (ROOT.name, len(files), total, total / len(files)))
    print("孤立 %d ／ 行き止まり %d ／ 切れリンク %d ／ 同名の衝突 %d"
          "（凍結した記録とひな形の例示 %d 件は除く）" %
          (len(orphans), len(dead), n_broken, len(ambiguous), placeholders))
    if QUIET:
        # 数だけのときも大きさと索引は数える（終了コードに入れる）
        fat_hubs = [h for h in ("目録.md", "本人.md", "やること.md", "保留中のタスク.md")
                    if (ROOT / h).exists() and (ROOT / h).stat().st_size > 15_000]
        return 1 if (orphans or n_broken) else 0

    def show(label, items, fmt=lambda p: p.stem):
        if not items:
            return
        print("\n== %s ==" % label)
        g = defaultdict(list)
        for p in items:
            g[str(p.relative_to(ROOT).parent)].append(fmt(p))
        for d in sorted(g):
            print("  [%s] %s" % (d, "、".join(sorted(g[d]))))

    show("孤立（どこからも張られていない）", orphans)
    show("行き止まり（どこへも張っていない）", dead)
    if broken:
        print("\n== 切れリンク ==")
        for p, v in sorted(broken.items(), key=lambda x: str(x[0])):
            print("  %s → %s" % (p.relative_to(ROOT), "、".join(v)))
    if ambiguous:
        print("\n== 同名のノート（リンクがどちらに行くか決まらない。パスから書くこと） ==")
        for stem, ps in sorted(ambiguous):
            print("  %s → %s" % (stem, "、".join(str(x.relative_to(ROOT)) for x in ps)))

    # ── 大きさ（Claude の仕様: Read は約25kトークン≒60KB で切れる／圧縮後に戻るのは各5kトークン≒15KB） ──
    # 「毎回まず読む」ハブ。15KB を超えたら経緯を別ノートへ移す（知見/海馬の決まり）
    HUBS = ("目録.md", "本人.md", "やること.md", "保留中のタスク.md")
    big = sorted(((p.stat().st_size, p) for p in files if p.stat().st_size > 60_000), reverse=True)
    fat = [(ROOT / h).stat().st_size for h in HUBS if (ROOT / h).exists() and (ROOT / h).stat().st_size > 15_000]
    fat_hubs = [(ROOT / h) for h in HUBS if (ROOT / h).exists() and (ROOT / h).stat().st_size > 15_000]
    print("大きさ: 60KB 超（1回の Read で切れる）%d 本 ／ ハブで 15KB 超（圧縮後に戻らない）%d 本" % (len(big), len(fat_hubs)))
    if big:
        print("\n== 60KB 超（先頭に「一言で」と目次があれば可。現役のハブなら経緯を別ノートへ） ==")
        for s_, p in big:
            print("  %4dKB  %s" % (s_ // 1024, p.relative_to(ROOT).as_posix()))
    if fat_hubs:
        print("\n== ハブで 15KB 超（日付の記録を <ハブ名>/経緯_YYYY-MM.md へ移す） ==")
        for p in fat_hubs:
            print("  %4dKB  %s" % (p.stat().st_size // 1024, p.relative_to(ROOT).as_posix()))

    # ── 索引の取りこぼし（二段の索引: フォルダ索引に載っていないノート） ──
    INDEX = {"知見": "知見/知見.md", "基盤": "基盤/基盤.md", "sources": "sources/README.md", "人物": "人物/README.md",
             "私事": "私事/私事.md", "日々": "日々/日々.md", "事業/AIのエージェント": "事業/AIのエージェント/索引.md"}
    gaps = []
    for folder, ix in INDEX.items():
        ixp = ROOT / ix
        if not ixp.exists():
            continue
        listed = set()
        for m in re.finditer(r"\[\[([^\]\n]+)\]\]", strip_code(ixp.read_text(encoding="utf-8"))):
            t = NFC(m.group(1).replace("\\|", "|").split("|")[0].split("#")[0].strip())
            listed.add(t.split("/")[-1].removesuffix(".md"))
        for p in (ROOT / folder).rglob("*.md"):
            if p.name in ("README.md",) or p == ixp or NFC(p.stem) in listed:
                continue
            gaps.append((ix, p.relative_to(ROOT).as_posix()))
    print("索引の取りこぼし: %d 本" % len(gaps))
    if gaps:
        print("\n== 索引に載っていないノート（索引に1行足す） ==")
        for ix, p in gaps:
            print("  %s ← %s" % (ix, p))

    thin = [(len(inbound[p]), p) for p in files if len(inbound[p]) <= 1 and not frozen(p)]
    if thin:
        print("\n== 被リンクが1本以下（次に繋ぐ候補） ==")
        for c, p in sorted(thin):
            print("  %d ← %s" % (c, p.relative_to(ROOT)))
    return 1 if (orphans or n_broken or fat_hubs or gaps) else 0


if __name__ == "__main__":
    sys.exit(main())
