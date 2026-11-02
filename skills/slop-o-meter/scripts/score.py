"""Check a slop.json against the rubric, print the score, and write the description block for YouTube.

    python scripts/score.py <slop.json>            score table + description text on stdout
    python scripts/score.py --rubric               the categories, weights and hints (to fill a manifest)
"""
import json
import os
import sys

RUBRIC = json.load(open(os.path.join(os.path.dirname(__file__), "..", "rubric.json"), encoding="utf-8"))
CATS = {c["id"]: c for c in RUBRIC["categories"]}
LEVELS = {float(k): v for k, v in RUBRIC["levels"].items()}


def fmt(p):
    return str(round(p)) if abs(p - round(p)) < 1e-6 else f"{p:.1f}"


def main(path):
    m = json.load(open(path, encoding="utf-8"))
    errors, rows = [], []
    for u in m["uses"]:
        c = CATS.get(u["cat"])
        if not c:
            errors.append(f"unknown category {u['cat']!r}")
            continue
        if float(u["level"]) not in LEVELS:
            errors.append(f"{u['cat']}: level {u['level']} is not one of {sorted(LEVELS)}")
        if len(u["text"]) > 52:
            errors.append(f"{u['cat']}: text is {len(u['text'])} chars; keep it under 52 so it stays readable")
        rows.append((c, float(u["level"]), u["text"], c["weight"] * float(u["level"])))
    if len({r[0]["id"] for r in rows}) != len(rows):
        errors.append("one row per category: merge the duplicates")
    score = round(sum(r[3] for r in rows), 1)
    verdict = [v for v in RUBRIC["verdicts"] if score >= v["min"]][-1]["text"]
    used = {r[0]["id"] for r in rows if r[1] > 0}
    for c in RUBRIC["categories"]:
        print(f"  {c['label']:<28} {c['weight']:>3}  " + next((f"{LEVELS[r[1]]:<8} +{fmt(r[3])}" for r in rows if r[0] is c), "-"))
    print(f"\nSLOP-O-METER: {fmt(score)} / 100 -> {verdict}")
    for e in errors:
        print("  !", e)
    print("\n--- description block ---")
    print(f"Slop-o-meter: {fmt(score)}/100 ({verdict.title()}). Where the AI went:")
    for c, lvl, text, pts in sorted(rows, key=lambda r: -r[3]):
        if lvl > 0:
            print(f"- {text} (+{fmt(pts)})")
    none = [c["short"] for c in RUBRIC["categories"] if c["id"] not in used and c["tier"] <= m.get("noneTier", 2)]
    if none:
        print("None: " + ", ".join(none) + ".")
    if m.get("human"):
        print("By hand: " + ", ".join(m["human"]) + ".")
    print("(Scored against the most AI the video could have used: AI writing, direction, video and music weigh most, mastering least.)")
    return 1 if errors else 0


if __name__ == "__main__":
    if sys.argv[1:] == ["--rubric"]:
        for c in RUBRIC["categories"]:
            print(f"{c['id']:<10} tier {c['tier']}  {c['weight']:>3}  {c['label']}: {c['hint']}")
        print("levels:", ", ".join(f"{k} = {v}" for k, v in RUBRIC["levels"].items()))
        sys.exit(0)
    sys.exit(main(sys.argv[1]))
