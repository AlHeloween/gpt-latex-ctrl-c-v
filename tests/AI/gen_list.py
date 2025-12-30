from google import genai

client = genai.Client(api_key="AIzaSyD72AjikereonlhM8CiLeeiGxYGW1VwZjk")

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