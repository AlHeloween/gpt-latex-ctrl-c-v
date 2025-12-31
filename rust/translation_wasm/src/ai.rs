// AI translation services: ChatGPT, Gemini, Pollinations

use crate::service::{TranslationInfo, TranslationService};
use serde_json::json;

pub struct ChatGPTService {
    api_key: String,
}

impl ChatGPTService {
    pub fn new(api_key: String) -> Self {
        Self { api_key }
    }
}

impl TranslationService for ChatGPTService {
    fn service_name(&self) -> &str {
        "chatgpt"
    }

    fn transform_request(&self, source_array: &[String]) -> String {
        source_array.join("\n")
    }

    fn parse_response(&self, response: &str) -> Result<Vec<(String, Option<String>)>, String> {
        use serde_json::Value;
        
        let json: Value = serde_json::from_str(response)
            .map_err(|e| format!("JSON parse error: {}", e))?;

        if let Some(choices) = json.get("choices").and_then(|v| v.as_array()) {
            if let Some(choice) = choices.get(0) {
                if let Some(message) = choice.get("message") {
                    if let Some(content) = message.get("content").and_then(|v| v.as_str()) {
                        return Ok(vec![(content.to_string(), None)]);
                    }
                }
            }
        }

        Err("Invalid response format".to_string())
    }

    fn transform_response(&self, result: &str, _dont_sort: bool) -> Vec<String> {
        vec![result.to_string()]
    }

    fn get_extra_parameters(
        &self,
        _source_lang: &str,
        _target_lang: &str,
        _requests: &[TranslationInfo],
    ) -> String {
        String::new()
    }

    fn get_request_body(
        &self,
        _source_lang: &str,
        target_lang: &str,
        requests: &[TranslationInfo],
    ) -> Option<String> {
        let text = requests.iter().map(|r| r.original_text.clone()).collect::<Vec<_>>().join("\n");
        let prompt = format!(
            "Translate the following text to {}. Preserve formatting, code blocks, and formulas. Only translate the text content, not code or formulas.\n\nText to translate:\n{}",
            target_lang, text
        );
        
        Some(json!({
            "model": "gpt-3.5-turbo",
            "messages": [{
                "role": "user",
                "content": prompt
            }],
            "temperature": 0.3
        }).to_string())
    }

    fn get_extra_headers(&self) -> Vec<(String, String)> {
        vec![
            ("Content-Type".to_string(), "application/json".to_string()),
            ("Authorization".to_string(), format!("Bearer {}", self.api_key.clone())),
        ]
    }

    fn get_base_url(&self) -> String {
        "https://api.openai.com/v1/chat/completions".to_string()
    }

    fn get_method(&self) -> &str {
        "POST"
    }
}

pub struct GeminiService {
    api_key: String,
    model: String,
}

impl GeminiService {
    pub fn new(api_key: String) -> Self {
        Self {
            api_key,
            model: "gemini-1.5-flash".to_string(),
        }
    }
}

impl TranslationService for GeminiService {
    fn service_name(&self) -> &str {
        "gemini"
    }

    fn transform_request(&self, source_array: &[String]) -> String {
        source_array.join("\n")
    }

    fn parse_response(&self, response: &str) -> Result<Vec<(String, Option<String>)>, String> {
        use serde_json::Value;
        
        let json: Value = serde_json::from_str(response)
            .map_err(|e| format!("JSON parse error: {}", e))?;

        if let Some(candidates) = json.get("candidates").and_then(|v| v.as_array()) {
            if let Some(candidate) = candidates.get(0) {
                if let Some(content) = candidate.get("content") {
                    if let Some(parts) = content.get("parts").and_then(|v| v.as_array()) {
                        if let Some(part) = parts.get(0) {
                            if let Some(text) = part.get("text").and_then(|v| v.as_str()) {
                                return Ok(vec![(text.to_string(), None)]);
                            }
                        }
                    }
                }
            }
        }

        Err("Invalid response format".to_string())
    }

    fn transform_response(&self, result: &str, _dont_sort: bool) -> Vec<String> {
        vec![result.to_string()]
    }

    fn get_extra_parameters(
        &self,
        _source_lang: &str,
        _target_lang: &str,
        _requests: &[TranslationInfo],
    ) -> String {
        format!("?key={}", crate::utils::url_encode(&self.api_key))
    }

    fn get_request_body(
        &self,
        _source_lang: &str,
        target_lang: &str,
        requests: &[TranslationInfo],
    ) -> Option<String> {
        let text = requests.iter().map(|r| r.original_text.clone()).collect::<Vec<_>>().join("\n");
        let prompt = format!(
            "Translate the following text to {}. Preserve formatting, code blocks, and formulas. Only translate the text content, not code or formulas.\n\nText to translate:\n{}",
            target_lang, text
        );
        
        Some(json!({
            "contents": [{
                "parts": [{
                    "text": prompt
                }]
            }]
        }).to_string())
    }

    fn get_extra_headers(&self) -> Vec<(String, String)> {
        vec![("Content-Type".to_string(), "application/json".to_string())]
    }

    fn get_base_url(&self) -> String {
        format!("https://generativelanguage.googleapis.com/v1/models/{}:generateContent", self.model)
    }

    fn get_method(&self) -> &str {
        "POST"
    }
}

pub struct PollinationsService {
    api_key: Option<String>,
    custom_endpoint: Option<String>,
}

impl PollinationsService {
    pub fn new(api_key: Option<String>, custom_endpoint: Option<String>) -> Self {
        Self {
            api_key,
            custom_endpoint,
        }
    }
}

impl TranslationService for PollinationsService {
    fn service_name(&self) -> &str {
        "pollinations"
    }

    fn transform_request(&self, source_array: &[String]) -> String {
        source_array.join("\n")
    }

    fn parse_response(&self, response: &str) -> Result<Vec<(String, Option<String>)>, String> {
        // Pollinations returns text directly or JSON
        match serde_json::from_str::<serde_json::Value>(response) {
            Ok(json) => {
                if let Some(text) = json.get("text").and_then(|v| v.as_str()) {
                    Ok(vec![(text.to_string(), None)])
                } else if let Some(result) = json.get("result").and_then(|v| v.as_str()) {
                    Ok(vec![(result.to_string(), None)])
                } else if let Some(content) = json.get("content").and_then(|v| v.as_str()) {
                    Ok(vec![(content.to_string(), None)])
                } else if let Some(response) = json.get("response").and_then(|v| v.as_str()) {
                    Ok(vec![(response.to_string(), None)])
                } else {
                    Ok(vec![(response.trim().to_string(), None)])
                }
            }
            Err(_) => Ok(vec![(response.trim().to_string(), None)]),
        }
    }

    fn transform_response(&self, result: &str, _dont_sort: bool) -> Vec<String> {
        vec![result.to_string()]
    }

    fn get_extra_parameters(
        &self,
        _source_lang: &str,
        target_lang: &str,
        requests: &[TranslationInfo],
    ) -> String {
        let text = requests.iter().map(|r| r.original_text.clone()).collect::<Vec<_>>().join("\n");
        let prompt = format!(
            "Translate the following text to {}. Preserve formatting, code blocks, and formulas. Only translate the text content, not code or formulas.\n\nText to translate:\n{}",
            target_lang, text
        );
        
        if self.custom_endpoint.is_some() {
            format!("?prompt={}", crate::utils::url_encode(&prompt))
        } else {
            format!("/{}", crate::utils::url_encode(&prompt))
        }
    }

    fn get_request_body(
        &self,
        _source_lang: &str,
        _target_lang: &str,
        _requests: &[TranslationInfo],
    ) -> Option<String> {
        None // GET request
    }

    fn get_extra_headers(&self) -> Vec<(String, String)> {
        let mut headers = Vec::new();
        if let Some(ref api_key) = self.api_key {
            headers.push(("Authorization".to_string(), format!("Bearer {}", api_key)));
        }
        headers
    }

    fn get_base_url(&self) -> String {
        if let Some(ref endpoint) = self.custom_endpoint {
            endpoint.clone()
        } else {
            "https://text.pollinations.ai".to_string()
        }
    }

    fn get_method(&self) -> &str {
        "GET"
    }
}

