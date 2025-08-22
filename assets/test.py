
from PIL import Image

# Define the target sizes and file paths (using underscores)
sizes = {
    16: "icon_16.png",
    32: "icon_32.png",
    48: "icon_48.png",
    128: "icon_128.png",
}

# Path to your source image (must be large enough)
source_image = "icon.png"

# Open source image
with Image.open(source_image) as img:
    for size, path in sizes.items():
        resized = img.resize((size, size), Image.LANCZOS)
        resized.save(path, format="PNG")
        print(f"Saved: {path}")
