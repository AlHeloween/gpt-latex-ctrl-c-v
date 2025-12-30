# -*- coding: utf-8 -*-
"""
Secure API key storage and retrieval.

Uses OS keyring for secure storage.
"""

from __future__ import annotations

from typing import Optional
import keyring

# PARENT_FILE: src/site_link_cli/config/__init__.py | Secure API key storage implementation
# Purpose: Manages API keys for AI providers (Pollinations.ai doesn't need API key, but Gemini, OpenAI, Grok, DeepSeek do)
# Created: AI integration phase


# Service name for keyring
SERVICE_NAME = "site_link_cli"


def get_api_key(provider: str) -> Optional[str]:
    """
    Get API key for a provider from keyring.
    
    Args:
        provider: Provider name (pollinations doesn't need key, but gemini, openai, grok, deepseek do)
        
    Returns:
        API key or None if not found
    """
    try:
        key = keyring.get_password(SERVICE_NAME, provider.lower())
        return key
    except Exception:
        # Keyring might fail (no backend available)
        return None


def set_api_key(provider: str, key: str) -> bool:
    """
    Store API key securely in keyring.
    
    Args:
        provider: Provider name (pollinations doesn't need key, but gemini, openai, grok, deepseek do)
        key: API key to store
        
    Returns:
        True if stored successfully
        
    Raises:
        RuntimeError: If keyring storage fails
    """
    try:
        keyring.set_password(SERVICE_NAME, provider.lower(), key)
        return True
    except Exception as e:
        raise RuntimeError(f"Failed to store API key: {e}") from e


def delete_api_key(provider: str) -> bool:
    """
    Delete stored API key from keyring.
    
    Args:
        provider: Provider name
        
    Returns:
        True if deleted successfully
    """
    try:
        keyring.delete_password(SERVICE_NAME, provider.lower())
        return True
    except Exception:
        return False


def has_api_key(provider: str) -> bool:
    """
    Check if API key is available for a provider in keyring.
    
    Args:
        provider: Provider name
        
    Returns:
        True if key is available in keyring
    """
    return get_api_key(provider) is not None

