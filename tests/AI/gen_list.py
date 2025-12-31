import sys
from pathlib import Path
from google import genai

# Add parent directory to path to import api_keys
sys.path.insert(0, str(Path(__file__).parent))
from api_keys import get_api_key

# Get API key from keyring
api_key = get_api_key("gemini") or get_api_key("google")
if not api_key:
    raise ValueError("API key not found in keyring. Please store it using: from api_keys import set_api_key; set_api_key('gemini', 'your-key')")
client = genai.Client(api_key=api_key)

print("Listing all available models for your API key:")
print("----------------------------------------------")

try:
    for model in client.models.list():
        # Print the model name directly
        print(f"Name: {model.name}")
        
        # Optional: Print display name if available
        if hasattr(model, 'display_name'):
             print(f"  Display Name: {model.display_name}")

except Exception as e:
    print(f"Error listing models: {e}")