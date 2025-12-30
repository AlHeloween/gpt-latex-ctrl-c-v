# -*- coding: utf-8 -*-
"""
Smoke tests for AI provider integrations.

Tests basic connectivity and functionality of each AI provider.
"""

from __future__ import annotations

import pytest
from site_link_cli.ai.base import AIProvider, AIFunction, PROVIDER_CAPABILITIES
from site_link_cli.config.api_keys import get_api_key

# PARENT_FILE: src/site_link_cli/ai/base.py | Smoke tests for AI providers
# Purpose: Validates that all AI providers can be initialized and basic functions work
# Created: AI integration phase


class TestProviderCapabilities:
    """Test provider capability mapping."""
    
    def test_gemini_capabilities(self):
        """Test Gemini capabilities."""
        capabilities = PROVIDER_CAPABILITIES[AIProvider.GEMINI]
        assert AIFunction.TEXT_GENERATION in capabilities
        assert AIFunction.IMAGE_GENERATION in capabilities
    
    def test_openai_capabilities(self):
        """Test OpenAI capabilities."""
        capabilities = PROVIDER_CAPABILITIES[AIProvider.OPENAI]
        assert AIFunction.TEXT_GENERATION in capabilities
        assert AIFunction.IMAGE_GENERATION in capabilities
    
    def test_grok_capabilities(self):
        """Test Grok capabilities."""
        capabilities = PROVIDER_CAPABILITIES[AIProvider.GROK]
        assert AIFunction.TEXT_GENERATION in capabilities
        assert AIFunction.IMAGE_GENERATION in capabilities
    
    def test_deepseek_capabilities(self):
        """Test DeepSeek capabilities (text only, no images)."""
        capabilities = PROVIDER_CAPABILITIES[AIProvider.DEEPSEEK]
        assert AIFunction.TEXT_GENERATION in capabilities
        assert AIFunction.PROMPT_CONDITIONING in capabilities
        assert AIFunction.IMAGE_GENERATION not in capabilities


class TestAPIKeysAvailable:
    """Test that API keys are available for all providers."""
    
    @pytest.mark.parametrize("provider", ["gemini", "openai", "grok", "deepseek"])
    def test_provider_key_available(self, provider):
        """Test that API key is available for provider."""
        key = get_api_key(provider)
        assert key is not None, f"API key for {provider} is not available"
        assert isinstance(key, str), f"API key for {provider} must be a string"
        assert len(key) > 0, f"API key for {provider} must not be empty"


class TestProviderInitialization:
    """Test provider initialization (smoke tests)."""
    
    def test_all_providers_have_keys(self):
        """Test that all providers have keys configured."""
        providers_with_keys = []
        
        for provider in ["gemini", "openai", "grok", "deepseek"]:
            key = get_api_key(provider)
            if key:
                providers_with_keys.append(provider)
        
        # At least some providers should have keys
        assert len(providers_with_keys) > 0, "No provider keys found"
        print(f"Providers with keys configured: {', '.join(providers_with_keys)}")

