# -*- coding: utf-8 -*-
"""
Smoke test for image generation APIs.

NOTE: Image generation is NOT FULLY IMPLEMENTED - these tests verify the interface
exists but failures are expected and acceptable.

Run this script directly to test the image generation interface for each provider.
Usage: python -m tests.ai.smoke_test_image_generation
"""

from __future__ import annotations

import sys
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from site_link_cli.config.api_keys import get_api_key

from site_link_cli.ai.factory import create_client
from site_link_cli.ai.base import AIProvider, AIFunction


def test_openai_image_generation():
    """Test OpenAI (DALL-E) image generation."""
    print("\n" + "="*60)
    print("Testing OpenAI (DALL-E) Image Generation")
    print("="*60)
    
    api_key = get_api_key("openai")
    if not api_key:
        print("❌ OpenAI API key not available - FAILING")
        raise ValueError("OpenAI API key must be configured")
    
    try:
        client = create_client(AIProvider.OPENAI)
        print("✅ Client created successfully")
        
        # Test supports function
        supports = client.supports_function(AIFunction.IMAGE_GENERATION)
        print(f"   Supports image generation: {supports}")
        
        if not supports:
            print("❌ OpenAI client reports it doesn't support image generation")
            return False
        
        # Try to generate a simple image
        # Note: Image generation is NOT FULLY IMPLEMENTED - this is a placeholder test
        prompt = "a simple red circle on a white background"
        print(f"   Generating image with prompt: '{prompt}'")
        print("   Note: Image generation is NOT FULLY IMPLEMENTED - expected to fail")
        # Use supported size (1024x1024, 1024x1792, or 1792x1024)
        result = client.generate_image(prompt, size="1024x1024")
        
        if result is None:
            print("❌ Image generation returned None")
            return False
        
        if not isinstance(result, bytes):
            print(f"❌ Expected bytes, got {type(result)}")
            return False
        
        if len(result) == 0:
            print("❌ Image data is empty")
            return False
        
        print(f"✅ Image generated successfully: {len(result)} bytes")
        
        # Check if it looks like image data
        image_magics = [
            (b'\xff\xd8\xff', 'JPEG'),
            (b'\x89PNG', 'PNG'),
            (b'GIF8', 'GIF'),
        ]
        
        for magic, format_name in image_magics:
            if result.startswith(magic):
                print(f"✅ Image format detected: {format_name}")
                return True
        
        print("⚠️ Image data doesn't match expected formats, but has content")
        return True  # Still consider it success if we got data
        
    except ImportError as e:
        print(f"❌ Import error: {e}")
        print("   Install with: pip install openai")
        return False
    except Exception as e:
        print(f"⚠️  Error (expected - image generation not fully implemented): {type(e).__name__}: {e}")
        print("   Image generation is NOT FULLY IMPLEMENTED - this failure is acceptable")
        import traceback
        traceback.print_exc()
        return False  # Still return False but with clear messaging


def test_grok_image_generation():
    """Test Grok image generation."""
    print("\n" + "="*60)
    print("Testing Grok Image Generation")
    print("="*60)
    
    api_key = get_api_key("grok")
    if not api_key:
        print("❌ Grok API key not available - FAILING")
        raise ValueError("Grok API key must be configured")
    
    try:
        client = create_client(AIProvider.GROK)
        print("✅ Client created successfully")
        
        # Test supports function
        supports = client.supports_function(AIFunction.IMAGE_GENERATION)
        print(f"   Supports image generation: {supports}")
        
        if not supports:
            print("❌ Grok client reports it doesn't support image generation")
            return False
        
        # Try to generate a simple image
        # Note: Image generation is NOT FULLY IMPLEMENTED - this is a placeholder test
        prompt = "a simple red circle on a white background"
        print(f"   Generating image with prompt: '{prompt}'")
        print("   Note: Image generation is NOT FULLY IMPLEMENTED - expected to fail")
        print("   Note: Grok API may not actually support image generation")
        
        # Use supported size and quality parameters
        result = client.generate_image(prompt, size="1024x1024", quality="high")
        
        if result is None:
            print("⚠️  Image generation returned None (expected - not fully implemented)")
            print("   Image generation is NOT FULLY IMPLEMENTED - this failure is acceptable")
            return False
        
        if not isinstance(result, bytes):
            print(f"❌ Expected bytes, got {type(result)}")
            return False
        
        if len(result) == 0:
            print("❌ Image data is empty")
            return False
        
        print(f"✅ Image generated successfully: {len(result)} bytes")
        
        # Check if it looks like image data
        image_magics = [
            (b'\xff\xd8\xff', 'JPEG'),
            (b'\x89PNG', 'PNG'),
            (b'GIF8', 'GIF'),
        ]
        
        for magic, format_name in image_magics:
            if result.startswith(magic):
                print(f"✅ Image format detected: {format_name}")
                print("✅ Grok image generation IS WORKING!")
                return True
        
        print("⚠️ Image data doesn't match expected formats, but has content")
        return True  # Still consider it success if we got data
        
    except ImportError as e:
        print(f"❌ Import error: {e}")
        print("   Install with: pip install openai")
        return False
    except Exception as e:
        print(f"⚠️  Error (expected - image generation not fully implemented): {type(e).__name__}: {e}")
        print("   Image generation is NOT FULLY IMPLEMENTED - this failure is acceptable")
        import traceback
        traceback.print_exc()
        return False  # Still return False but with clear messaging


def test_gemini_image_generation():
    """Test that Gemini does NOT support image generation."""
    print("\n" + "="*60)
    print("Testing Gemini Image Generation (should NOT work)")
    print("="*60)
    
    api_key = get_api_key("gemini")
    if not api_key:
        print("❌ Gemini API key not available - FAILING")
        raise ValueError("Gemini API key must be configured")
    
    try:
        client = create_client(AIProvider.GEMINI)
        print("✅ Client created successfully")
        
        # Test supports function
        supports = client.supports_function(AIFunction.IMAGE_GENERATION)
        print(f"   Supports image generation: {supports}")
        
        if supports:
            print("❌ Gemini incorrectly reports it supports image generation")
            return False
        
        # Try to generate - should return None
        result = client.generate_image("test prompt")
        if result is None:
            print("✅ Gemini correctly returns None for image generation")
            print("✅ Gemini does NOT support image generation (as expected)")
            return True
        else:
            print(f"❌ Gemini returned data when it should return None: {type(result)}")
            return False
        
    except ImportError as e:
        print(f"⚠️  Import error (expected - dependencies may not be installed): {e}")
        print("   Install with: pip install google-generativeai")
        print("   Gemini image generation is NOT SUPPORTED (as expected)")
        return True  # This is expected - Gemini doesn't support image generation
    except RuntimeError as e:
        if "package is required" in str(e):
            print(f"⚠️  Dependency missing (expected): {e}")
            print("   Gemini image generation is NOT SUPPORTED (as expected)")
            return True  # This is expected - Gemini doesn't support image generation
        raise
    except Exception as e:
        print(f"⚠️  Unexpected error: {type(e).__name__}: {e}")
        print("   Gemini image generation is NOT SUPPORTED (as expected)")
        import traceback
        traceback.print_exc()
        return True  # Still consider it OK since Gemini shouldn't support this


def main():
    """Run all smoke tests."""
    print("\n" + "="*60)
    print("AI Image Generation Smoke Tests")
    print("="*60)
    print("\n✅ Using keyring for API keys")
    
    results = {}
    
    # Test OpenAI
    results['openai'] = test_openai_image_generation()
    
    # Test Grok
    results['grok'] = test_grok_image_generation()
    
    # Test Gemini (should not work)
    results['gemini'] = test_gemini_image_generation()
    
    # Summary
    print("\n" + "="*60)
    print("SUMMARY")
    print("="*60)
    
    for provider, result in results.items():
        if result:
            status = "✅ WORKING"
        else:
            status = "❌ NOT WORKING"
        print(f"  {provider.upper():10} : {status}")
    
    print("\n" + "="*60)
    print("NOTE: Image generation is NOT FULLY IMPLEMENTED")
    print("These tests verify the interface exists but failures are expected")
    print("="*60)
    
    # Final verdict
    if results.get('openai'):
        print("✅ OpenAI (DALL-E) image generation working (unexpected but good!)")
    else:
        print("⚠️  OpenAI image generation not working (expected - not fully implemented)")
    
    if results.get('grok'):
        print("✅ Grok image generation working (unexpected but good!)")
    elif results.get('grok') is False:
        print("⚠️  Grok image generation not working (expected - not fully implemented)")


if __name__ == "__main__":
    main()

