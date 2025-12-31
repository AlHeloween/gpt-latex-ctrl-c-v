// Custom API service implementation

use crate::service::{TranslationInfo, TranslationService};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomApiConfig {
    pub endpoint: String,
    pub method: String,
    pub headers: std::collections::HashMap<String, String>,
    pub payload_format: PayloadFormat,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PayloadFormat {
    pub template: Option<String>,
    #[serde(flatten)]
    pub extra: std::collections::HashMap<String, serde_json::Value>,
}

pub struct CustomService {
    config: CustomApiConfig,
}

impl CustomService {
    pub fn new(config: CustomApiConfig) -> Self {
        Self { config }
    }
}

impl TranslationService for CustomService {
    fn service_name(&self) -> &str {
        "custom"
    }

    fn transform_request(&self, source_array: &[String]) -> String {
        source_array.join("\n")
    }

    fn parse_response(&self, response: &str) -> Result<Vec<(String, Option<String>)>, String> {
        use serde_json::Value;
        
        // Try to parse as JSON
        match serde_json::from_str::<Value>(response) {
            Ok(json) => {
                // Try common response field names
                if let Some(text) = json.get("text").and_then(|v| v.as_str()) {
                    Ok(vec![(text.to_string(), None)])
                } else if let Some(translated) = json.get("translatedText").and_then(|v| v.as_str()) {
                    Ok(vec![(translated.to_string(), None)])
                } else if let Some(result) = json.get("result").and_then(|v| v.as_str()) {
                    Ok(vec![(result.to_string(), None)])
                } else {
                    // Return original response as text
                    Ok(vec![(response.to_string(), None)])
                }
            }
            Err(_) => {
                // Not JSON, return as-is
                Ok(vec![(response.to_string(), None)])
            }
        }
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
        
        if self.config.method == "GET" {
            return None;
        }

        if let Some(ref template) = self.config.payload_format.template {
            // Use template with {{text}} and {{lang}} placeholders
            Some(
                template
                    .replace("{{text}}", &text)
                    .replace("{{lang}}", target_lang)
            )
        } else {
            // Use JSON format
            let mut payload = serde_json::Map::new();
            payload.insert("text".to_string(), serde_json::Value::String(text));
            payload.insert("targetLang".to_string(), serde_json::Value::String(target_lang.to_string()));
            
            // Add extra fields from config
            for (k, v) in &self.config.payload_format.extra {
                payload.insert(k.clone(), v.clone());
            }
            
            Some(serde_json::to_string(&payload).unwrap_or_default())
        }
    }

    fn get_extra_headers(&self) -> Vec<(String, String)> {
        let mut headers = vec![("Content-Type".to_string(), "application/json".to_string())];
        
        // Add custom headers from config
        for (k, v) in &self.config.headers {
            headers.push((k.clone(), v.clone()));
        }
        
        headers
    }

    fn get_base_url(&self) -> String {
        self.config.endpoint.clone()
    }

    fn get_method(&self) -> &str {
        &self.config.method
    }
}

