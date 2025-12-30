# -*- coding: utf-8 -*-
"""
End-to-end tool chain tests.

Tests the complete workflow from key storage to provider usage.
"""

from __future__ import annotations

import pytest
from site_link_cli.config.api_keys import get_api_key, has_api_key
from site_link_cli.ai.base import AIProvider, AIFunction, PROVIDER_CAPABILITIES

# PARENT_FILE: tests/ai/test_ai_providers.py | End-to-end tool chain tests
# Purpose: Validates complete workflow from key storage to provider initialization
# Created: AI integration phase


class TestToolChain:
    """End-to-end tool chain tests."""
    
    def test_complete_workflow(self):
        """Test complete workflow: keys -> providers -> capabilities."""
        # Step 1: Verify all providers have keys
        providers_with_keys = []
        for provider_name in ["gemini", "openai", "grok", "deepseek"]:
            if has_api_key(provider_name):
                providers_with_keys.append(provider_name)
        
        assert len(providers_with_keys) > 0, "At least one provider should have a key"
        print(f"\n✓ Found keys for providers: {', '.join(providers_with_keys)}")
        
        # Step 2: Verify keys can be retrieved
        for provider_name in providers_with_keys:
            key = get_api_key(provider_name)
            assert key is not None, f"Key for {provider_name} should be retrievable"
            assert len(key) > 0, f"Key for {provider_name} should not be empty"
        print(f"✓ Retrieved keys for {len(providers_with_keys)} providers")
        
        # Step 3: Verify provider capability mapping
        provider_map = {
            "gemini": AIProvider.GEMINI,
            "openai": AIProvider.OPENAI,
            "grok": AIProvider.GROK,
            "deepseek": AIProvider.DEEPSEEK,
        }
        
        for provider_name in providers_with_keys:
            provider = provider_map[provider_name]
            capabilities = PROVIDER_CAPABILITIES[provider]
            assert AIFunction.TEXT_GENERATION in capabilities, f"{provider_name} should support text generation"
            print(f"✓ {provider_name}: {len(capabilities)} capabilities")
        
        # Step 4: Verify DeepSeek special case (no image generation)
        if "deepseek" in providers_with_keys:
            capabilities = PROVIDER_CAPABILITIES[AIProvider.DEEPSEEK]
            assert AIFunction.IMAGE_GENERATION not in capabilities, "DeepSeek should not support image generation"
            assert AIFunction.PROMPT_CONDITIONING in capabilities, "DeepSeek should support prompt conditioning"
            print("✓ DeepSeek correctly configured for text/prompt conditioning only")
        
        # Step 5: Verify image generation providers
        image_providers = [
            (AIProvider.GEMINI, "gemini"),
            (AIProvider.OPENAI, "openai"),
            (AIProvider.GROK, "grok"),
        ]
        
        for provider, name in image_providers:
            if name in providers_with_keys:
                capabilities = PROVIDER_CAPABILITIES[provider]
                assert AIFunction.IMAGE_GENERATION in capabilities, f"{name} should support image generation"
                print(f"✓ {name} supports image generation")
    
    def test_provider_function_mapping(self):
        """Test that provider function mapping is correct."""
        # Text generation: all providers
        text_providers = [
            AIProvider.GEMINI,
            AIProvider.OPENAI,
            AIProvider.GROK,
            AIProvider.DEEPSEEK,
        ]
        
        for provider in text_providers:
            assert AIFunction.TEXT_GENERATION in PROVIDER_CAPABILITIES[provider]
        
        # Image generation: Gemini, OpenAI, Grok (not DeepSeek)
        image_providers = [
            AIProvider.GEMINI,
            AIProvider.OPENAI,
            AIProvider.GROK,
        ]
        
        for provider in image_providers:
            assert AIFunction.IMAGE_GENERATION in PROVIDER_CAPABILITIES[provider]
        
        assert AIFunction.IMAGE_GENERATION not in PROVIDER_CAPABILITIES[AIProvider.DEEPSEEK]
        
        # Prompt conditioning: DeepSeek (specialized)
        assert AIFunction.PROMPT_CONDITIONING in PROVIDER_CAPABILITIES[AIProvider.DEEPSEEK]

