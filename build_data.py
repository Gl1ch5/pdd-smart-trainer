#!/usr/bin/env python3
"""
Merges AI tags (pdd_ai_tags.json, see docs/TAGGING_SPEC.md) into pdd_data.js.

Each question gets:
  ai        — LLM tags (topics, format, memorize_number, number_kind, number_value,
              difficulty, trap, trap_reason, involves, key_fact)
  sections  — PDD sections referenced in the explanation (deterministic)
The legacy regex-based "tags" field is dropped.
"""
import json
import os
import re

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_JS = os.path.join(BASE_DIR, "pdd_data.js")
AI_TAGS = os.path.join(BASE_DIR, "pdd_ai_tags.json")
AI_SCORES = os.path.join(BASE_DIR, "pdd_ai_scores.json")

# Target shares (docs/TAGGING_SPEC.md): easy / medium / hard and traps
DIFFICULTY_SHARES = (0.30, 0.45)  # the rest is "hard"
TRAP_SHARE = 0.20
TRAP_MIN_SCORE = 5

EMPTY_AI = {
    "topics": [], "format": None, "memorize_number": False, "number_kind": None,
    "number_value": None, "difficulty": 2, "trap": False, "trap_reason": None,
    "involves": [], "key_fact": None, "error_rate": None,
}


def load_questions():
    with open(DATA_JS, "r", encoding="utf-8") as f:
        raw = f.read()
    return json.loads(raw[raw.index("["):raw.rindex("]") + 1])


def sections_of(explanation):
    found = re.findall(r"punkt_(\d+)_", explanation or "")
    return sorted({int(s) for s in found})


def calibrate(questions, scores):
    """Turns per-question ratings into difficulty levels and trap flags by percentile."""
    rated = [q for q in questions if q["id"] in scores]
    if not rated:
        return
    n = len(rated)
    by_hardness = sorted(rated, key=lambda q: (scores[q["id"]]["error_rate"] + scores[q["id"]]["trap_score"] * 0.5, q["id"]))
    easy_end = round(n * DIFFICULTY_SHARES[0])
    medium_end = easy_end + round(n * DIFFICULTY_SHARES[1])
    for i, q in enumerate(by_hardness):
        q["ai"]["difficulty"] = 1 if i < easy_end else 2 if i < medium_end else 3
        q["ai"]["error_rate"] = scores[q["id"]]["error_rate"]

    by_trap = sorted(rated, key=lambda q: (-scores[q["id"]]["trap_score"], -scores[q["id"]]["error_rate"], q["id"]))
    trap_ids = {q["id"] for q in by_trap[:round(n * TRAP_SHARE)] if scores[q["id"]]["trap_score"] >= TRAP_MIN_SCORE}
    for q in rated:
        is_trap = q["id"] in trap_ids
        q["ai"]["trap"] = is_trap
        q["ai"]["trap_reason"] = (scores[q["id"]].get("trap_reason") or q["ai"].get("trap_reason")) if is_trap else None


def main():
    questions = load_questions()
    with open(AI_TAGS, "r", encoding="utf-8") as f:
        ai = json.load(f)

    scores = {}
    if os.path.exists(AI_SCORES):
        with open(AI_SCORES, "r", encoding="utf-8") as f:
            scores = json.load(f)

    missing = []
    for q in questions:
        q.pop("tags", None)
        tags = ai.get(q["id"])
        if not tags:
            missing.append(q["id"])
        q["ai"] = {**EMPTY_AI, **(tags or {})}
        q["sections"] = sections_of(q.get("explanation"))

    calibrate(questions, scores)

    with open(DATA_JS, "w", encoding="utf-8") as f:
        f.write("// Auto-generated PDD database with AI tags (build_data.py)\n")
        f.write("window.PDD_QUESTIONS = ")
        json.dump(questions, f, ensure_ascii=False)
        f.write(";\n")

    levels = [sum(1 for q in questions if q["ai"]["difficulty"] == d) for d in (1, 2, 3)]
    traps = sum(1 for q in questions if q["ai"]["trap"])
    print(f"Questions: {len(questions)}, without AI tags: {len(missing)} {missing[:20]}, "
          f"without scores: {len(questions) - len(scores)}")
    print(f"Difficulty 1/2/3: {levels}, traps: {traps}")


if __name__ == "__main__":
    main()
