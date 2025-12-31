// LibreTranslate service implementation

use crate::service::{TranslationInfo, TranslationService};
use crate::utils::url_encode;

pub struct LibreService {
    url: String,
    api_key: Option<String>,
}

impl LibreService {
    pub fn new(url: String, api_key: Option<String>) -> Self {
        Self { url, api_key }
    }
}

impl TranslationService for LibreService {
    fn service_name(&self) -> &str {
        "libre"
    }

    fn transform_request(&self, source_array: &[String]) -> String {
        source_array.first().cloned().unwrap_or_default()
    }

    fn parse_response(&self, response: &str) -> Result<Vec<(String, Option<String>)>, String> {
        use serde_json::Value;
        
        let json: Value = serde_json::from_str(response)
            .map_err(|e| format!("JSON parse error: {}", e))?;

        let translated_text = json
            .get("translatedText")
            .and_then(|v| v.as_str())
            .ok_or("Missing translatedText")?
            .to_string();

        let detected_language = json
            .get("detectedLanguage")
            .and_then(|v| v.get("language"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        Ok(vec![(translated_text, detected_language)])
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
        source_lang: &str,
        target_lang: &str,
        requests: &[TranslationInfo],
    ) -> Option<String> {
        let text = requests.first().map(|r| r.original_text.clone()).unwrap_or_default();
        
        let mut params = format!(
            "q={}&source={}&target={}&format=text",
            url_encode(&text),
            url_encode(source_lang),
            url_encode(target_lang)
        );
        
        if let Some(ref api_key) = self.api_key {
            params.push_str(&format!("&api_key={}", url_encode(api_key)));
        }
        
        Some(params)
    }

    fn get_extra_headers(&self) -> Vec<(String, String)> {
        vec![("Content-Type".to_string(), "application/x-www-form-urlencoded".to_string())]
    }

    fn get_base_url(&self) -> String {
        self.url.clone()
    }

    fn get_method(&self) -> &str {
        "POST"
    }
}

