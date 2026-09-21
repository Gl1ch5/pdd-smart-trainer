import json
import urllib.request
import os
from concurrent.futures import ThreadPoolExecutor, as_completed

def download_image(url, target_path):
    if os.path.exists(target_path) and os.path.getsize(target_path) > 1000:
        return True
    try:
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })
        with urllib.request.urlopen(req, timeout=10) as resp:
            content = resp.read()
            with open(target_path, 'wb') as out:
                out.write(content)
        return True
    except Exception as e:
        return False

def main():
    dir_path = r"E:\pdd_trainer"
    images_dir = os.path.join(dir_path, "images")
    os.makedirs(images_dir, exist_ok=True)

    json_path = os.path.join(dir_path, "pdd_tagged.json")
    with open(json_path, "r", encoding="utf-8") as f:
        questions = json.load(f)

    # Collect unique images
    tasks = []
    for q in questions:
        img_url = q.get("image", "").strip()
        if img_url:
            filename = os.path.basename(img_url.split("?")[0])
            if not filename.endswith(".jpg") and not filename.endswith(".png"):
                filename += ".jpg"
            target_file = os.path.join(images_dir, filename)
            local_rel_url = f"images/{filename}"
            tasks.append((img_url, target_file, q, local_rel_url))

    print(f"Total images to download: {len(tasks)}")

    success_count = 0
    with ThreadPoolExecutor(max_workers=12) as executor:
        future_map = {executor.submit(download_image, t[0], t[1]): t for t in tasks}
        for future in as_completed(future_map):
            img_url, target_file, q, local_rel_url = future_map[future]
            ok = future.result()
            if ok:
                success_count += 1
                q["local_image"] = local_rel_url
                q["image"] = local_rel_url # Point directly to local image!

    print(f"Downloaded: {success_count} / {len(tasks)}")

    # Update tagged json and pdd_data.js
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(questions, f, ensure_ascii=False, indent=2)

    js_path = os.path.join(dir_path, "pdd_data.js")
    with open(js_path, "w", encoding="utf-8") as f:
        f.write("// Auto-generated PDD database with local image cache\n")
        f.write("window.PDD_QUESTIONS = ")
        json.dump(questions, f, ensure_ascii=False)
        f.write(";\n")

    print("Successfully updated database with local offline images!")

if __name__ == "__main__":
    main()
