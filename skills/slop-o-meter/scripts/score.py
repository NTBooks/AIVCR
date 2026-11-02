"""Check a slop.json against the rubric, print the score, and write the description block for YouTube.

    python scripts/score.py <slop.json>            score table + description text on stdout
    python scripts/score.py --rubric               the categories, weights and hints (to fill a manifest)
"""
import json
import math
import os
import sys

RUBRIC = json.load(open(os.path.join(os.path.dirname(__file__), "..", "rubric.json"), encoding="utf-8"))
CATS = {c["id"]: c for c in RUBRIC["categories"]}
LEVELS = {float(k): v for k, v in RUBRIC["levels"].items()}


def rubric_for(m):
    """The categories one manifest is scored on, as meter-core.js rubricFor does: its kind's (m["kind"], default the
    first kind, video), plus any extras it ticked (m["extras"]), minus any marked doesn't-apply (m["na"]; never the core
    one), with weights scaled to total 100. Returns (kind, [category dicts with the scaled "weight"])."""
    kinds = RUBRIC.get("kinds")
    if not kinds:
        return None, RUBRIC["categories"]
    k = next((x for x in kinds if x["id"] == m.get("kind")), kinds[0])
    picks = list(k["cats"])
    for e in k.get("extras", []):
        if e["id"] in m.get("extras", []):
            picks += e["cats"]
    picks = [o for o in picks if o.get("core") or o["id"] not in m.get("na", [])]
    total = sum(o["weight"] for o in picks)
    return k, [dict(CATS[o["id"]], weight=o["weight"] * 100 / total, label=o.get("label", CATS[o["id"]]["label"]),
                    short=o.get("short", CATS[o["id"]]["short"])) for o in picks]


def fmt(p):
    return str(round(p)) if abs(p - round(p)) < 1e-6 else f"{p:.1f}"


def main(path):
    m = json.load(open(path, encoding="utf-8"))
    kind, cats = rubric_for(m)
    asked = {c["id"]: c for c in cats}
    named = {c["id"]: c["label"] for c in rubric_for(dict(m, na=[]))[1]}   # this kind's names, skipped ones included
    errors, rows = [], []
    if kind is None and (m.get("kind") or m.get("extras") or m.get("na")):
        errors.append("this rubric.json has no kinds: kind, extras and na are ignored")
    elif kind and m.get("kind") and m["kind"] != kind["id"]:
        errors.append(f"unknown kind {m['kind']!r}; scored as {kind['id']}")
    for u in m["uses"]:
        if u["cat"] not in CATS:
            errors.append(f"unknown category {u['cat']!r}")
            continue
        c = asked.get(u["cat"])
        if not c:
            why = "marked doesn't apply" if u["cat"] in m.get("na", []) else f"not asked for {kind['byline']}"
            errors.append(f"{u['cat']}: {why}, so it isn't scored")
            continue
        if float(u["level"]) not in LEVELS:
            errors.append(f"{u['cat']}: level {u['level']} is not one of {sorted(LEVELS)}")
        if len(u["text"]) > 52:
            errors.append(f"{u['cat']}: text is {len(u['text'])} chars; keep it under 52 so it stays readable")
        rows.append((c, float(u["level"]), u["text"], c["weight"] * float(u["level"])))
    if len({r[0]["id"] for r in rows}) != len(rows):
        errors.append("one row per category: merge the duplicates")
    score = math.floor(sum(r[3] for r in rows) * 10 + 0.5) / 10   # halves up, like the card (Python's round() goes to even)
    verdict = [v for v in RUBRIC["verdicts"] if score >= v["min"]][-1]["text"]
    used = {r[0]["id"] for r in rows if r[1] > 0}
    if kind:
        print(f"  scored as {kind['label'].lower()}" + (f" + {', '.join(m['extras'])}" if m.get("extras") else ""))
    for c in cats:
        print(f"  {c['label']:<28} {fmt(c['weight']):>3}  " + next((f"{LEVELS[r[1]]:<8} +{fmt(r[3])}" for r in rows if r[0] is c), "-"))
    for cid in m.get("na", []):
        if cid in CATS and cid not in asked:
            print(f"  {named.get(cid, CATS[cid]['label']):<28}   -  doesn't apply")
    print(f"\nSLOP-O-METER: {fmt(score)} / 100 -> {verdict}")
    for e in errors:
        print("  !", e)
    print("\n--- description block ---")
    print(f"Slop-o-meter: {fmt(score)}/100 ({verdict.title()}). Where the AI went:")
    for c, lvl, text, pts in sorted(rows, key=lambda r: -r[3]):
        if lvl > 0:
            print(f"- {text} (+{fmt(pts)})")
    none = [c["short"] for c in cats if c["id"] not in used and c["tier"] <= m.get("noneTier", 2)]
    if none:
        print("None: " + ", ".join(none) + ".")
    if m.get("human"):
        print("By hand: " + ", ".join(m["human"]) + ".")
    skipped = [named.get(cid, CATS[cid]["label"]).lower() for cid in m.get("na", []) if cid in CATS and cid not in asked]
    if skipped:
        print("Doesn't apply: " + ", ".join(skipped) + ".")
    if not kind or kind["id"] == "video":
        print("(Scored against the most AI the video could have used: AI writing, direction, video and music weigh most, mastering least.)")
    else:
        print(f"(Scored out of 100: all the AI {kind['byline']} could have used.)")
    return 1 if errors else 0


if __name__ == "__main__":
    if sys.argv[1:] == ["--rubric"]:
        for c in RUBRIC["categories"]:
            print(f"{c['id']:<10} tier {c['tier']}  {c['weight']:>3}  {c['label']}: {c['hint']}")
        print("levels:", ", ".join(f"{k} = {v}" for k, v in RUBRIC["levels"].items()))
        for k in RUBRIC.get("kinds", []):
            extras = "; extras: " + ", ".join(f"{e['id']} (+{', '.join(o['id'] for o in e['cats'])})" for e in k["extras"]) if k.get("extras") else ""
            print(f"kind {k['id']:<8} " + ", ".join(o["id"] + ("*" if o.get("core") else "") + f" {o['weight']}" for o in k["cats"]) + extras)
        if RUBRIC.get("kinds"):
            print("(* = core: can't be marked doesn't apply. Weights are relative; the ones a log is scored on are scaled to 100.)")
        sys.exit(0)
    sys.exit(main(sys.argv[1]))
