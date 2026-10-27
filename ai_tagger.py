#!/usr/bin/env python3
"""
AI tagging of PDD questions (see docs/TAGGING_SPEC.md).

Usage:
  LLM_API_KEY=... python3 ai_tagger.py [--base http://localhost:20128/v1] [--model agy/gemini-3.5-flash-lite]

Reads pdd_data.js, writes/updates pdd_ai_tags.json ({id: tags}). Resumable:
questions already present in the cache are skipped (use --force to redo).
"""
import argparse
import concurrent.futures
import json
import os
import re
import sys
import threading
import time
import urllib.request

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_JS = os.path.join(BASE_DIR, "pdd_data.js")
CACHE_FILE = os.path.join(BASE_DIR, "pdd_ai_tags.json")

TOPICS = {
    "general": "Общие положения, термины",
    "driver_duties": "Обязанности водителя, документы",
    "special_signals": "Спецсигналы, аварийная сигнализация, знак аварийной остановки",
    "signals_adjuster": "Светофоры и регулировщик",
    "signs": "Дорожные знаки",
    "markings": "Дорожная разметка",
    "maneuvering": "Начало движения, повороты, развороты, задний ход",
    "lane_position": "Расположение на проезжей части, полосы",
    "speed": "Скорость движения",
    "overtaking": "Обгон, опережение, встречный разъезд",
    "stopping_parking": "Остановка и стоянка",
    "intersections": "Проезд перекрестков",
    "pedestrians": "Пешеходные переходы и остановки маршрутных ТС",
    "railway": "Железнодорожные переезды",
    "highway_residential": "Автомагистрали и жилые зоны",
    "route_vehicles": "Приоритет маршрутных транспортных средств",
    "lights_horn": "Внешние световые приборы и звуковой сигнал",
    "towing": "Буксировка",
    "passengers_cargo": "Перевозка людей и грузов, учебная езда",
    "malfunctions": "Неисправности и условия эксплуатации ТС",
    "safety": "Безопасность движения и техника управления",
    "first_aid": "Первая помощь",
    "liability": "Ответственность водителя, ОСАГО, оформление ДТП",
}

FORMATS = {
    "who_first": "очередность проезда: кто проедет первым, в каком порядке, должны ли вы уступить",
    "allowed": "можно ли / разрешено ли действие в ситуации (да/нет, при каких условиях)",
    "action": "как следует поступить, что обязан сделать водитель",
    "meaning": "что означает знак/разметка/сигнал, зона действия, какой знак разрешает",
    "trajectory": "по какой траектории / из какой полосы / где можно развернуться или повернуть",
    "value": "ответ — число: сколько, на каком расстоянии, с какой скоростью, какой срок",
    "definition": "термин: что называется, кто/что считается",
    "fact": "прочие факты: первая помощь, ответственность, техника, безопасность",
}

NUMBER_KINDS = ["speed", "distance", "dimension", "time", "percent", "mass", "age", "count", "other"]

INVOLVES = {
    "tram": "трамвай",
    "pedestrian": "пешеход",
    "cyclist": "велосипедист",
    "motorcycle": "мотоцикл/мопед",
    "route_vehicle": "маршрутный автобус/троллейбус",
    "emergency": "ТС со спецсигналами",
    "adjuster": "регулировщик",
    "traffic_light": "светофор",
    "railway": "железнодорожный переезд",
    "roundabout": "круговое движение",
    "truck_trailer": "грузовик/прицеп",
    "children": "дети",
    "bad_conditions": "ночь, туман, гололед, недостаточная видимость",
    "tunnel_bridge": "тоннель/мост",
    "mountain_road": "горная дорога, подъем/спуск",
}

SYSTEM_PROMPT = """Ты — эксперт по ПДД РФ и экзаменам ГИБДД (категории A, B, M). Размечаешь экзаменационные вопросы для фильтров тренажера. Отвечай ТОЛЬКО JSON-объектом без пояснений.

Схема ответа:
{
  "topics": [1-3 id из списка TOPICS, первая — основная тема],
  "format": один id из FORMATS,
  "memorize_number": true|false,
  "number_kind": id из NUMBER_KINDS или null,
  "number_value": "число с единицей, коротко" или null,
  "difficulty": 1|2|3,
  "trap": true|false,
  "trap_reason": "до 80 символов" или null,
  "involves": [0-5 id из INVOLVES],
  "key_fact": "одна фраза до 140 символов — правило, по которому решается вопрос"
}

TOPICS:
%s

FORMATS:
%s

NUMBER_KINDS: %s

INVOLVES:
%s

Правила:
- memorize_number=true ТОЛЬКО если правильный ответ нельзя дать без знания конкретного числового значения нормы из ПДД/закона (скорость, метры, мм протектора, проценты, сроки, масса, возраст, количество людей). Цифры в номерах знаков, нумерация вариантов, числа на картинке, не требующие знания нормы, — это false. Вопрос «Разрешено ли вам остановиться?» с ответом, зависящим от «не ближе 5 м» — true. Если false, то number_kind и number_value = null.
- format="value" — когда сами варианты ответа являются числами/значениями.
- difficulty: 1 — очевидно, решается здравым смыслом; 2 — нужно знать конкретное правило; 3 — легко ошибиться (исключения, похожие варианты, несколько правил сразу, контринтуитивный ответ).
- trap=true, если интуитивный «бытовой» ответ неверен или всё решает мелкая деталь (табличка, тип ТС, время суток, слова «только»/«обязан»). Иначе trap_reason=null.
- involves — только то, что реально фигурирует в вопросе/ситуации (по тексту и пояснению).
- key_fact — сформулируй правило по-русски кратко, без ссылок и номеров пунктов, без «В данном вопросе».
""" % (
    "\n".join(f"- {k}: {v}" for k, v in TOPICS.items()),
    "\n".join(f"- {k}: {v}" for k, v in FORMATS.items()),
    ", ".join(NUMBER_KINDS),
    "\n".join(f"- {k}: {v}" for k, v in INVOLVES.items()),
)


def load_questions():
    with open(DATA_JS, "r", encoding="utf-8") as f:
        raw = f.read()
    start = raw.index("[")
    end = raw.rindex("]")
    return json.loads(raw[start:end + 1])


def strip_html(s):
    s = re.sub(r"<[^>]+>", "", s or "")
    return re.sub(r"\s+", " ", s).strip()


def build_user_prompt(q):
    answers = "\n".join(f"{i + 1}. {a}" for i, a in enumerate(q["answers"]))
    expl = strip_html(q.get("explanation", ""))[:1800]
    return (
        f"Билет {q['ticket']}, вопрос {q['num']}. Картинка: {'есть' if q.get('image') else 'нет'}.\n"
        f"Вопрос: {q['title']}\n"
        f"Варианты:\n{answers}\n"
        f"Правильный ответ: {q['correct'] + 1}\n"
        f"Пояснение: {expl}"
    )


def normalize(obj):
    if not isinstance(obj, dict):
        raise ValueError("not an object")
    topics = [t for t in obj.get("topics") or [] if t in TOPICS]
    topics = list(dict.fromkeys(topics))[:3]
    if not topics:
        raise ValueError("no valid topics")
    fmt = obj.get("format")
    if fmt not in FORMATS:
        raise ValueError(f"bad format {fmt!r}")
    mem = obj.get("memorize_number") is True
    kind = obj.get("number_kind") if mem else None
    if kind not in NUMBER_KINDS:
        kind = "other" if mem else None
    value = obj.get("number_value") if mem else None
    value = str(value).strip()[:40] if value else None
    try:
        diff = int(obj.get("difficulty"))
    except (TypeError, ValueError):
        diff = 2
    diff = min(3, max(1, diff))
    trap = obj.get("trap") is True
    reason = obj.get("trap_reason") if trap else None
    reason = str(reason).strip()[:120] if reason else None
    involves = list(dict.fromkeys(i for i in obj.get("involves") or [] if i in INVOLVES))[:5]
    key_fact = str(obj.get("key_fact") or "").strip()[:200] or None
    return {
        "topics": topics,
        "format": fmt,
        "memorize_number": mem,
        "number_kind": kind,
        "number_value": value,
        "difficulty": diff,
        "trap": trap,
        "trap_reason": reason,
        "involves": involves,
        "key_fact": key_fact,
    }


def call_llm(base, model, key, q, retries=4):
    body = json.dumps({
        "model": model,
        "temperature": 0.1,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": build_user_prompt(q)},
        ],
    }).encode("utf-8")
    last_err = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                base.rstrip("/") + "/chat/completions",
                data=body,
                headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
            )
            with urllib.request.urlopen(req, timeout=120) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            content = data["choices"][0]["message"]["content"]
            m = re.search(r"\{.*\}", content, re.S)
            if not m:
                raise ValueError("no JSON in response")
            return normalize(json.loads(m.group(0)))
        except Exception as e:  # noqa: BLE001 — retry on any transport/parse error
            last_err = e
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"{q['id']}: {last_err}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=os.environ.get("LLM_BASE_URL", "http://localhost:20128/v1"))
    ap.add_argument("--model", default=os.environ.get("LLM_MODEL", "agy/gemini-3.5-flash-lite"))
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    key = os.environ.get("LLM_API_KEY")
    if not key:
        sys.exit("LLM_API_KEY is not set")

    questions = load_questions()
    cache = {}
    if os.path.exists(CACHE_FILE) and not args.force:
        with open(CACHE_FILE, "r", encoding="utf-8") as f:
            cache = json.load(f)
    todo = [q for q in questions if q["id"] not in cache]
    if args.limit:
        todo = todo[:args.limit]
    print(f"Questions: {len(questions)}, cached: {len(cache)}, to process: {len(todo)}", flush=True)

    lock = threading.Lock()
    done = 0
    failed = []

    def save():
        tmp = CACHE_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False, indent=1, sort_keys=True)
        os.replace(tmp, CACHE_FILE)

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as ex:
        futures = {ex.submit(call_llm, args.base, args.model, key, q): q for q in todo}
        for fut in concurrent.futures.as_completed(futures):
            q = futures[fut]
            try:
                res = fut.result()
                with lock:
                    cache[q["id"]] = res
                    done += 1
                    if done % 25 == 0:
                        save()
                        print(f"  {done}/{len(todo)}", flush=True)
            except Exception as e:  # noqa: BLE001
                failed.append(q["id"])
                print(f"  FAIL {e}", flush=True)

    save()
    print(f"Done: {done}, failed: {len(failed)} {failed[:20]}", flush=True)


if __name__ == "__main__":
    main()
