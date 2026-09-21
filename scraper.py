import urllib.request
import json
import re
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

def fetch_ticket(ticket_num):
    url = f"https://www.drom.ru/pdd/bilet_{ticket_num}/training/"
    req = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read()
            m = re.search(rb'<script[^>]*data-drom-module=\"pdd-exam\"[^>]*>(.*?)</script>', raw)
            if not m:
                return ticket_num, None, "No script found"
            script_text = m.group(1).decode('ascii', errors='ignore')
            data = json.loads(script_text)
            questions = data['initialState']['questions']
            clean_questions = []
            for q in questions:
                # Find correct answer index (1-based or 0-based)
                answers = []
                correct_idx = -1
                for idx, a in enumerate(q.get('answers', [])):
                    answers.append(a.get('text', '').strip())
                    if a.get('isCorrect'):
                        correct_idx = idx
                
                # Image URL check
                img_url = q.get('image', '').strip()
                if img_url and not img_url.startswith('http'):
                    img_url = 'https:' + img_url

                clean_q = {
                    "id": f"t{ticket_num}_q{q.get('num', len(clean_questions)+1)}",
                    "ticket": ticket_num,
                    "num": q.get('num', len(clean_questions)+1),
                    "title": q.get('text', '').strip(),
                    "image": img_url,
                    "answers": answers,
                    "correct": correct_idx,
                    "explanation": q.get('commentTagged', '').strip()
                }
                clean_questions.append(clean_q)
            return ticket_num, clean_questions, None
    except Exception as e:
        return ticket_num, None, str(e)

def main():
    print("Starting download of 40 tickets from Drom.ru...")
    all_tickets = {}
    total_tickets = 40
    
    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = {executor.submit(fetch_ticket, t): t for t in range(1, total_tickets + 1)}
        for future in as_completed(futures):
            t_num, questions, err = future.result()
            if err:
                print(f"[FAIL] Ticket {t_num}: {err}")
            else:
                print(f"[OK] Ticket {t_num}: {len(questions)} questions")
                all_tickets[t_num] = questions

    # Check missing and retry sequentially
    for t_num in range(1, total_tickets + 1):
        if t_num not in all_tickets or not all_tickets[t_num]:
            print(f"Retrying ticket {t_num}...")
            time.sleep(1)
            t_num, questions, err = fetch_ticket(t_num)
            if questions:
                all_tickets[t_num] = questions
                print(f"[RETRY OK] Ticket {t_num}")
            else:
                print(f"[RETRY FAIL] Ticket {t_num}: {err}")

    # Flatten questions list
    flat_questions = []
    for t in sorted(all_tickets.keys()):
        flat_questions.extend(all_tickets[t])

    output_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pdd_raw.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(flat_questions, f, ensure_ascii=False, indent=2)

    print(f"Total questions scraped: {len(flat_questions)}")
    print(f"Saved to {output_path}")

if __name__ == "__main__":
    main()
