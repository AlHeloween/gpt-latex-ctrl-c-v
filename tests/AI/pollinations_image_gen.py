import requests

def download_image(prompt):
    url = f"https://pollinations.ai/p/{prompt}"
    response = requests.get(url)
    with open('generated_image.jpg', 'wb') as file:
        file.write(response.content)
    print('Image downloaded!')

download_image("conceptual_isometric_world_of_pollinations_ai_surreal_hyperrealistic_digital_garden")