#!/usr/bin/env python3
"""
Extract language list from TWP's final.json and generate HTML option tags.
Outputs sorted list of languages with English names.
"""

import json
import sys
from pathlib import Path

def extract_languages():
    """Extract languages from TWP final.json and generate HTML options."""
    script_dir = Path(__file__).parent
    project_root = script_dir.parent
    twp_file = project_root / "TWP" / "extra" / "out" / "final.json"
    
    if not twp_file.exists():
        print(f"Error: {twp_file} not found", file=sys.stderr)
        sys.exit(1)
    
    with open(twp_file, "r", encoding="utf-8") as f:
        data = json.load(f)
    
    # Get English language names
    en_langs = data.get("en", {})
    if not en_langs:
        print("Error: No 'en' key found in final.json", file=sys.stderr)
        sys.exit(1)
    
    # Convert to list of (code, name) tuples and sort by name
    languages = [(code, name) for code, name in en_langs.items()]
    languages.sort(key=lambda x: x[1].lower())  # Sort by name, case-insensitive
    
    # Generate HTML options
    html_options = []
    for code, name in languages:
        html_options.append(f'            <option value="{code}">{name}</option>')
    
    # Output to stdout
    print("\n".join(html_options))
    
    # Also print summary
    print(f"\n# Total languages: {len(languages)}", file=sys.stderr)

if __name__ == "__main__":
    extract_languages()

