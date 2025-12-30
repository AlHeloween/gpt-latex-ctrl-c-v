# -*- coding: utf-8 -*-
"""
Smoke tests for AI client implementations.

Tests actual API calls to verify clients work correctly.
"""

from __future__ import annotations

import pytest
from site_link_cli.config.api_keys import get_api_key
from site_link_cli.ai.factory import create_client
from site_link_cli.ai.base import AIProvider, AIFunction

# PARENT_FILE: src/site_link_cli/ai/factory.py | Smoke tests for AI client implementations
# Purpose: Validates that AI clients can make actual API calls
# Created: AI integration phase


class TestDeepSeekClient:
    """Test DeepSeek client."""
    
    @pytest.mark.slow
    def test_client_creation(self):
        """Test creating DeepSeek client."""
        api_key = get_api_key("deepseek")
        assert api_key is not None, "DeepSeek API key must be configured"
        assert len(api_key) > 0, "DeepSeek API key must not be empty"
        
        client = create_client(AIProvider.DEEPSEEK)
        assert client is not None
    
    @pytest.mark.slow
    def test_text_generation(self):
        """Test text generation with DeepSeek."""
        api_key = get_api_key("deepseek")
        assert api_key is not None, "DeepSeek API key must be configured"
        assert len(api_key) > 0, "DeepSeek API key must not be empty"
        
        client = create_client(AIProvider.DEEPSEEK)
        response = client.generate_text("Say 'Hello, World!' in one sentence.")
        assert isinstance(response, str)
        assert len(response) > 0
        print(f"\nDeepSeek response: {response[:100]}...")
    
    @pytest.mark.slow
    def test_prompt_conditioning(self):
        """Test prompt conditioning with DeepSeek."""
        api_key = get_api_key("deepseek")
        assert api_key is not None, "DeepSeek API key must be configured"
        assert len(api_key) > 0, "DeepSeek API key must not be empty"
        
        client = create_client(AIProvider.DEEPSEEK)
        original = "a cat"
        optimized = client.condition_prompt(original)
        assert isinstance(optimized, str)
        assert len(optimized) > len(original)  # Should be more detailed
        print(f"\nOriginal: {original}")
        print(f"Optimized: {optimized[:150]}...")


class TestGeminiClient:
    """Test Gemini client."""
    
    @pytest.mark.slow
    def test_client_creation(self):
        """Test creating Gemini client."""
        api_key = get_api_key("gemini")
        assert api_key is not None, "Gemini API key must be configured"
        assert len(api_key) > 0, "Gemini API key must not be empty"
        
        client = create_client(AIProvider.GEMINI)
        assert client is not None
    
    @pytest.mark.slow
    def test_text_generation(self):
        """Test text generation with Gemini."""
        api_key = get_api_key("gemini")
        assert api_key is not None, "Gemini API key must be configured"
        assert len(api_key) > 0, "Gemini API key must not be empty"
        
        client = create_client(AIProvider.GEMINI)
        response = client.generate_text("Say 'Hello, World!' in one sentence.")
        assert isinstance(response, str)
        assert len(response) > 0
        print(f"\nGemini response: {response[:100]}...")
    
    @pytest.mark.slow
    def test_image_generation_not_supported(self):
        """Test that Gemini does NOT support image generation - SMOKE TEST."""
        api_key = get_api_key("gemini")
        assert api_key is not None, "Gemini API key must be configured"
        assert len(api_key) > 0, "Gemini API key must not be empty"
        
        client = create_client(AIProvider.GEMINI)
        # Gemini should not support image generation
        assert not client.supports_function(AIFunction.IMAGE_GENERATION), "Gemini should not support image generation"
        
        # Try to generate image - should return None
        result = client.generate_image("test prompt")
        assert result is None, "Gemini generate_image should return None (not supported)"
        print("\n✅ Gemini correctly returns None for image generation (not supported)")


class TestOpenAIClient:
    """Test OpenAI client."""
    
    @pytest.mark.slow
    def test_client_creation(self):
        """Test creating OpenAI client."""
        api_key = get_api_key("openai")
        assert api_key is not None, "OpenAI API key must be configured"
        assert len(api_key) > 0, "OpenAI API key must not be empty"
        
        client = create_client(AIProvider.OPENAI)
        assert client is not None
    
    @pytest.mark.slow
    def test_text_generation(self):
        """Test text generation with OpenAI."""
        api_key = get_api_key("openai")
        assert api_key is not None, "OpenAI API key must be configured"
        assert len(api_key) > 0, "OpenAI API key must not be empty"
        
        client = create_client(AIProvider.OPENAI)
        response = client.generate_text("Say 'Hello, World!' in one sentence.")
        assert isinstance(response, str)
        assert len(response) > 0
        print(f"\nOpenAI response: {response[:100]}...")
    
    @pytest.mark.slow
    def test_image_generation(self):
        """Test image generation with OpenAI (DALL-E) - SMOKE TEST."""
        api_key = get_api_key("openai")
        assert api_key is not None, "OpenAI API key must be configured"
        assert len(api_key) > 0, "OpenAI API key must not be empty"
        
        client = create_client(AIProvider.OPENAI)
        # Simple test prompt
        prompt = "a simple red circle on a white background"
        result = client.generate_image(prompt, size="256x256")  # Smaller size for faster/cheaper test
        
        assert result is not None, "Image generation should return image data"
        assert isinstance(result, bytes), "Result should be bytes"
        assert len(result) > 0, "Image data should not be empty"
        print(f"\n✅ OpenAI (DALL-E) image generation WORKING - Generated {len(result)} bytes")
        
        # Verify it looks like image data
        image_magics = [b'\xff\xd8\xff', b'\x89PNG', b'GIF8']
        is_image = any(result.startswith(magic) for magic in image_magics)
        assert is_image, "Generated data should be a valid image format"
        print("✅ Image data appears valid (starts with image magic bytes)")


class TestGrokClient:
    """Test Grok client."""
    
    @pytest.mark.slow
    def test_client_creation(self):
        """Test creating Grok client."""
        api_key = get_api_key("grok")
        assert api_key is not None, "Grok API key must be configured"
        assert len(api_key) > 0, "Grok API key must not be empty"
        
        client = create_client(AIProvider.GROK)
        assert client is not None
    
    @pytest.mark.slow
    def test_text_generation(self):
        """Test text generation with Grok."""
        api_key = get_api_key("grok")
        assert api_key is not None, "Grok API key must be configured"
        assert len(api_key) > 0, "Grok API key must not be empty"
        
        client = create_client(AIProvider.GROK)
        response = client.generate_text("Say 'Hello, World!' in one sentence.")
        assert isinstance(response, str)
        assert len(response) > 0
        print(f"\nGrok response: {response[:100]}...")
    
    @pytest.mark.slow
    def test_image_generation(self):
        """Test image generation with Grok - SMOKE TEST."""
        api_key = get_api_key("grok")
        assert api_key is not None, "Grok API key must be configured"
        assert len(api_key) > 0, "Grok API key must not be empty"
        
        client = create_client(AIProvider.GROK)
        # Simple test prompt
        prompt = "a simple red circle on a white background"
        result = client.generate_image(prompt)
        
        assert result is not None, "Grok image generation should return image data"
        assert isinstance(result, bytes), "Result should be bytes"
        assert len(result) > 0, "Image data should not be empty"
        print(f"\n✅ Grok image generation WORKING - Generated {len(result)} bytes")
        
        # Verify it looks like image data (starts with image magic bytes)
        image_magics = [b'\xff\xd8\xff', b'\x89PNG', b'GIF8']
        is_image = any(result.startswith(magic) for magic in image_magics)
        assert is_image, "Generated data should be a valid image format"
        print("✅ Image data appears valid (starts with image magic bytes)")

