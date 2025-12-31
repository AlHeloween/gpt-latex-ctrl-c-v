// Google Translate service implementation
// Supports both paid API and free endpoints, plus HTML-aware translation

use crate::escape::escape_html;
use crate::html::{parse_google_html_response, parse_google_json_response};
use crate::service::{TranslationInfo, TranslationService};
use crate::utils::url_encode;
use serde_json::json;

pub struct GoogleService {
    api_key: Option<String>,
    use_html_endpoint: bool,
    auth_helper: crate::auth::GoogleHelper,
}

impl GoogleService {
    pub fn new() -> Self {
        Self {
            api_key: None,
            use_html_endpoint: true, // Use HTML endpoint by default (TWP approach)
            auth_helper: crate::auth::GoogleHelper::new(),
        }
    }

    pub fn set_api_key(&mut self, key: String) {
        self.api_key = Some(key);
    }

    pub fn use_free_endpoint(&mut self) {
        self.use_html_endpoint = false;
    }
}

impl TranslationService for GoogleService {
    fn service_name(&self) -> &str {
        "google"
    }

    fn transform_request(&self, source_array: &[String]) -> String {
        // Escape HTML and wrap in <a i={index}> tags if multiple segments
        let escaped: Vec<String> = source_array.iter().map(|s| escape_html(s)).collect();
        
        if source_array.len() > 1 {
            escaped
                .iter()
                .enumerate()
                .map(|(i, text)| format!("<a i={}>{}</a>", i, text))
                .collect::<Vec<_>>()
                .join("")
        } else {
            format!("<pre>{}</pre>", escaped.join(""))
        }
    }

    fn parse_response(&self, response: &str) -> Result<Vec<(String, Option<String>)>, String> {
        if self.use_html_endpoint {
            // Parse HTML response
            let results = parse_google_html_response(response)?;
            Ok(results.into_iter().map(|s| (s, None)).collect())
        } else {
            // Parse JSON response
            let (translations, detected) = parse_google_json_response(response)?;
            Ok(translations.into_iter().map(|s| (s, detected.clone())).collect())
        }
    }

    fn transform_response(&self, result: &str, _dont_sort: bool) -> Vec<String> {
        // For HTML endpoint, result is already parsed
        // For JSON endpoint, result is a single string
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
        source_lang: &str,
        target_lang: &str,
        requests: &[TranslationInfo],
    ) -> Option<String> {
        if self.use_html_endpoint {
            // HTML endpoint format
            let texts: Vec<String> = requests.iter().map(|r| r.original_text.clone()).collect();
            let body = json!([
                [texts, source_lang, target_lang],
                "te"
            ]);
            Some(body.to_string())
        } else if self.api_key.is_some() {
            // Paid API format
            let texts: Vec<String> = requests.iter().map(|r| r.original_text.clone()).collect();
            let body = json!({
                "q": texts,
                "target": target_lang,
            });
            Some(body.to_string())
        } else {
            // Free endpoint - GET request with query params
            None
        }
    }

    fn get_extra_headers(&self) -> Vec<(String, String)> {
        let mut headers = Vec::new();
        
        if self.use_html_endpoint {
            headers.push((
                "Content-Type".to_string(),
                "application/application/json+protobuf".to_string(),
            ));
            // Try to get auth token from helper
            if let Some(auth) = self.auth_helper.get_auth() {
                headers.push(("Authorization".to_string(), format!("Bearer {}", auth)));
            }
        } else if self.api_key.is_some() {
            headers.push(("Content-Type".to_string(), "application/json".to_string()));
        } else {
            // Free endpoint - no special headers
        }
        
        headers
    }

    fn get_base_url(&self) -> String {
        if self.use_html_endpoint {
            "https://translate-pa.googleapis.com/v1/translateHtml".to_string()
        } else if self.api_key.is_some() {
            "https://translation.googleapis.com/language/translate/v2".to_string()
        } else {
            "https://translate.googleapis.com/translate_a/single".to_string()
        }
    }

    fn get_method(&self) -> &str {
        if self.api_key.is_some() || self.use_html_endpoint {
            "POST"
        } else {
            "GET"
        }
    }
}

impl Default for GoogleService {
    fn default() -> Self {
        Self::new()
    }
}

