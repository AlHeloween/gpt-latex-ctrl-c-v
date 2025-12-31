import sys
from pathlib import Path
from google import genai
from google.genai import types
from PIL import Image
from io import BytesIO

# Add parent directory to path to import api_keys
sys.path.insert(0, str(Path(__file__).parent))
from api_keys import get_api_key

# 1. Setup the client
# Get API key from keyring
api_key = get_api_key("gemini") or get_api_key("google")
if not api_key:
    raise ValueError("API key not found in keyring. Please store it using: from api_keys import set_api_key; set_api_key('gemini', 'your-key')")
client = genai.Client(api_key=api_key)

# 2. Define prompt
prompt = "A futuristic city with flying cars, neon lights, and a giant glowing moon, digital art style"

# 3. Generate the image using the model found in your list
try:
    print("Generating image with Imagen 4.0...")
    response = client.models.generate_images(
        model='imagen-4.0-fast-generate-001',
        prompt=prompt,
        config=types.GenerateImagesConfig(
            number_of_images=1,
            aspect_ratio="16:9",  # Options: "1:1", "3:4", "4:3", "16:9", "9:16"
            # safety_filter_level="BLOCK_MEDIUM_AND_ABOVE", 
            person_generation="ALLOW_ADULT"
        )
    )

    # 4. Save and show
    for generated_image in response.generated_images:
        image = Image.open(BytesIO(generated_image.image.image_bytes))
        image.save("generated_result.png")
        image.show()
        print("Success! Image saved as 'generated_result.png'")

except Exception as e:
    print(f"An error occurred: {e}")