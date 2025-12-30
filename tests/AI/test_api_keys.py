# -*- coding: utf-8 -*-
"""
Tests for secure API key storage.
"""

from __future__ import annotations

import pytest
from site_link_cli.config.api_keys import (
    get_api_key,
    set_api_key,
    has_api_key,
    delete_api_key,
)

# PARENT_FILE: src/site_link_cli/config/api_keys.py | Tests for API key storage
# Purpose: Validates secure key storage functionality
# Created: AI integration phase


class TestAPIKeyStorage:
    """Test API key storage and retrieval."""
    
    def test_set_and_get_key(self):
        """Test storing and retrieving a key."""
        provider = "test_provider"
        test_key = "test_key_value_12345"
        
        try:
            # Store key
            result = set_api_key(provider, test_key)
            assert result is True
            
            # Retrieve key
            retrieved = get_api_key(provider)
            assert retrieved == test_key
            
        finally:
            # Cleanup
            delete_api_key(provider)
    
    def test_has_api_key(self):
        """Test checking if key exists."""
        provider = "test_provider_exists"
        test_key = "test_key_value"
        
        try:
            # Initially should not exist
            assert has_api_key(provider) is False
            
            # After storing, should exist
            set_api_key(provider, test_key)
            assert has_api_key(provider) is True
            
        finally:
            # Cleanup
            delete_api_key(provider)
    
    def test_get_real_providers(self):
        """Test that real provider keys are accessible (if stored)."""
        providers = ["gemini", "openai", "grok", "deepseek"]
        
        for provider in providers:
            # Should not raise, may return None if not set
            key = get_api_key(provider)
            # If key exists, it should be a non-empty string
            if key is not None:
                assert isinstance(key, str)
                assert len(key) > 0

