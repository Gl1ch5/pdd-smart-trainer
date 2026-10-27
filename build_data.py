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

EMPTY_AI = {
    "topics": [], "format": None, "memorize_number": False, "number_kind": None,
    "number_value": None, "difficulty": 2, "trap": False, "trap_reason": None,
    "involves": [], "key_fact": None,
}


def load_questions():
    with open(DATA_JS, "r", encoding="utf-8") as f:
        raw = f.read()
    return json.loads(raw[raw.index("["):raw.rindex("]") + 1])


def sections_of(explanation):
    found = re.findall(r"punkt_(\d+)_", explanation or "")
    return sorted({int(s) for s in found})


def main():
    questions = load_questions()
    with open(AI_TAGS, "r", encoding="utf-8") as f:
        ai = json.load(f)

    missing = []
    for q in questions:
        q.pop("tags", None)
        tags = ai.get(q["id"])
        if not tags:
            missing.append(q["id"])
        q["ai"] = {**EMPTY_AI, **(tags or {})}
        q["sections"] = sections_of(q.get("explanation"))

    with open(DATA_JS, "w", encoding="utf-8") as f:
        f.write("// Auto-generated PDD database with AI tags (build_data.py)\n")
        f.write("window.PDD_QUESTIONS = ")
        json.dump(questions, f, ensure_ascii=False)
        f.write(";\n")

    print(f"Questions: {len(questions)}, without AI tags: {len(missing)} {missing[:20]}")


if __name__ == "__main__":
    main()
