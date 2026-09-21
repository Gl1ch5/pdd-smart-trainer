import json
import re
import os

def analyze_and_tag_questions(input_file, output_file, js_output_file):
    with open(input_file, "r", encoding="utf-8") as f:
        questions = json.load(f)

    # Categories and filter rules
    # 1. Numbers / Digits (числа, дистанции, скорости, сроки, проценты, градусы, давление, объемы)
    num_pattern = re.compile(r'(\b\d+(\s*,\s*\d+)?\s*(км/ч|м|см|мм|сек|с|мин|сут|дня|дней|мес|лет|года|м/с|%|промилле|°C|кг|т)\b|\b\d+\b)', re.IGNORECASE)

    speed_pattern = re.compile(r'\b(скорост[а-я]*|км/ч|\b(20|40|50|60|70|80|90|110|130)\s*км/ч)\b', re.IGNORECASE)
    distance_pattern = re.compile(r'\b(дистанци[а-я]*|расстояни[а-я]*|\d+\s*м(етр[а-я]*)?|\d+\s*см|\d+\s*мм)\b', re.IGNORECASE)
    pedestrian_pattern = re.compile(r'(пешеход|пешеходн|слеп[а-я]* пешеход|зебр[а-я])', re.IGNORECASE)
    tram_pattern = re.compile(r'(трамва[йяею]|регулировщик|жезл[а-я]*)', re.IGNORECASE)
    intersections_pattern = re.compile(r'(перекрест[а-я]*|равнозначн|неравнозначн|кругов|главн[а-я]* дорог|уступит[а-я]* дорогу|приоритет)', re.IGNORECASE)
    signs_pattern = re.compile(r'(знак|табличк[а-я]*|указател)', re.IGNORECASE)
    markings_pattern = re.compile(r'(разметк|лини[яеий]|сплошн|прерывист)', re.IGNORECASE)
    parking_pattern = re.compile(r'(остановк[а-я]*|стоянк[а-я]*|парковк[а-я]*|четным|нечетным|запрещена стоянка)', re.IGNORECASE)
    overtaking_pattern = re.compile(r'(обгон|опережени[а-я]*|встречн[а-я]* разъезд)', re.IGNORECASE)
    towing_pattern = re.compile(r'(буксировк|прицеп[а-я]*)', re.IGNORECASE)
    med_pattern = re.compile(r'(медицин|перв[а-я]* помощ|кровотечен|жгут|пострадавш|сердечно-легочн|пульс|повязк|перелом|травм)', re.IGNORECASE)
    tech_malfunction_pattern = re.compile(r'(неисправност|эксплуатаци[а-я]* запрещ|запрещается движение|люфт|остаточная глубина|протектор|светопропускани|стеклоочистител|звуковой сигнал)', re.IGNORECASE)
    maneuvering_pattern = re.compile(r'(разворот|поворот|перестроен|задн[а-я]* ход|указател[а-я]* поворота)', re.IGNORECASE)
    railway_pattern = re.compile(r'(железнодорожн|ж/д|переезд|шлагбаум)', re.IGNORECASE)
    highway_pattern = re.compile(r'(автомагистрал|дорог[а-я]* для автомобил)', re.IGNORECASE)
    duty_law_pattern = re.compile(r'(обязанност|документ|штраф|лишен[а-я]* прав|ответственност|страхов|осаго|дтп)', re.IGNORECASE)

    tag_stats = {}

    for q in questions:
        text_full = q['title'] + " " + " ".join(q['answers']) + " " + q.get('explanation', '')
        q_title_and_answers = q['title'] + " " + " ".join(q['answers'])

        tags = []

        # Check has numbers in question or answer options
        # We look for explicit digits in title or answers
        has_digits = bool(re.search(r'\d', q_title_and_answers))
        if has_digits:
            tags.append("numbers")

        if speed_pattern.search(q_title_and_answers):
            tags.append("speed")
        if distance_pattern.search(q_title_and_answers):
            tags.append("distance")
        if pedestrian_pattern.search(text_full):
            tags.append("pedestrians")
        if tram_pattern.search(text_full):
            tags.append("tram_adjuster")
        if intersections_pattern.search(text_full):
            tags.append("intersections")
        if signs_pattern.search(text_full):
            tags.append("signs")
        if markings_pattern.search(text_full):
            tags.append("markings")
        if parking_pattern.search(text_full):
            tags.append("parking")
        if overtaking_pattern.search(text_full):
            tags.append("overtaking")
        if towing_pattern.search(text_full):
            tags.append("towing")
        if med_pattern.search(text_full):
            tags.append("medicine")
        if tech_malfunction_pattern.search(text_full):
            tags.append("malfunctions")
        if maneuvering_pattern.search(text_full):
            tags.append("maneuvering")
        if railway_pattern.search(text_full):
            tags.append("railway")
        if highway_pattern.search(text_full):
            tags.append("highway")
        if duty_law_pattern.search(text_full):
            tags.append("law_duties")

        # Media tags
        if q.get('image'):
            tags.append("has_image")
        else:
            tags.append("text_only")

        # Hard questions / traps check
        # Usually medicine, malfunctions, adjuster, fine/numbers are historically the hardest
        if "tram_adjuster" in tags or "malfunctions" in tags or "medicine" in tags or ("numbers" in tags and "parking" in tags):
            tags.append("tricky")

        q['tags'] = tags

        for t in tags:
            tag_stats[t] = tag_stats.get(t, 0) + 1

    print("Tag statistics across 800 questions:")
    for t, cnt in sorted(tag_stats.items(), key=lambda x: -x[1]):
        print(f"  - {t}: {cnt} questions")

    # Save to JSON
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(questions, f, ensure_ascii=False, indent=2)

    # Also save directly as JS file (window.PDD_QUESTIONS = [...]) so the app works standalone from file:// without CORS issues!
    with open(js_output_file, "w", encoding="utf-8") as f:
        f.write("// Auto-generated PDD database with smart semantic tags\n")
        f.write("window.PDD_QUESTIONS = ")
        json.dump(questions, f, ensure_ascii=False)
        f.write(";\n")

    print(f"Saved JSON to {output_file}")
    print(f"Saved JS bundle to {js_output_file}")

if __name__ == "__main__":
    dir_path = os.path.dirname(os.path.abspath(__file__))
    input_file = os.path.join(dir_path, "pdd_raw.json")
    output_file = os.path.join(dir_path, "pdd_tagged.json")
    js_output_file = os.path.join(dir_path, "pdd_data.js")
    analyze_and_tag_questions(input_file, output_file, js_output_file)
