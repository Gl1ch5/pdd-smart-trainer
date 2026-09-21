import os
import glob
from PIL import Image

def convert_all():
    img_dir = r"E:\pdd_trainer\images"
    files = glob.glob(os.path.join(img_dir, "*.*"))
    print(f"Checking {len(files)} files...")
    
    count = 0
    for f in files:
        try:
            with Image.open(f) as im:
                # If it's webp or whatever, re-save as true standard JPEG and PNG
                base = os.path.splitext(f)[0]
                jpeg_path = base + ".jpg"
                png_path = base + ".png"
                im.convert("RGB").save(jpeg_path, "JPEG", quality=95)
                im.convert("RGB").save(png_path, "PNG")
                count += 1
        except Exception as e:
            print(f"Error {f}: {e}")
            
    print(f"Successfully converted {count} images to standard JPEG and PNG!")

if __name__ == "__main__":
    convert_all()
