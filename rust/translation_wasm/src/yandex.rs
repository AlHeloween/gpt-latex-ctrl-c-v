// Yandex Translator service implementation

use crate::escape::escape_html;
use crate::service::{TranslationInfo, TranslationService};
use crate::utils::url_encode;

pub struct YandexService {
    auth_helper: crate::auth::YandexHelper,
}

impl YandexService {
    pub fn new() -> Self {
        Self {
            auth_helper: crate::auth::YandexHelper::new(),
        }
    }
}

fn map_language_code(lang: &str) -> String {
    // Language code mappings from TWP
    match lang {
        "zh-CN" | "zh-TW" => "zh".to_string(),
        "fr-CA" => "fr".to_string(),
        "pt" => "pt-BR".to_string(),
        "pt-PT" => "pt".to_string(),
        _ => lang.to_string(),
    }
}

impl TranslationService for YandexService {
    fn service_name(&self) -> &str {
        "yandex"
    }

    fn transform_request(&self, source_array: &[String]) -> String {
        // Join with <wbr> separator
        source_array
            .iter()
            .map(|s| escape_html(s))
            .collect::<Vec<_>>()
            .join("<wbr>")
    }

    fn parse_response(&self, response: &str) -> Result<Vec<(String, Option<String>)>, String> {
        use serde_json::Value;
        
        let json: Value = serde_json::from_str(response)
            .map_err(|e| format!("JSON parse error: {}", e))?;

        let mut detected_lang = None;
        if let Some(lang) = json.get("lang").and_then(|v| v.as_str()) {
            detected_lang = lang.split('-').next().map(|s| s.to_string());
        }

        let mut results = Vec::new();
        if let Some(texts) = json.get("text").and_then(|v| v.as_array()) {
            for text in texts {
                if let Some(text_str) = text.as_str() {
                    results.push((text_str.to_string(), detected_lang.clone()));
                }
            }
        }

        Ok(results)
    }

    fn transform_response(&self, result: &str, _dont_sort: bool) -> Vec<String> {
        // Split by <wbr> and unescape
        result
            .split("<wbr>")
            .map(|s| crate::escape::unescape_html(s))
            .collect()
    }

    fn get_extra_parameters(
        &self,
        source_lang: &str,
        target_lang: &str,
        requests: &[TranslationInfo],
    ) -> String {
        let source = map_language_code(source_lang);
        let target = map_language_code(target_lang);
        
        let lang_param = if source == "auto" {
            format!("lang={}", target)
        } else {
            format!("lang={}-{}", source, target)
        };
        
        let mut params = format!("&id={}-0-0&format=html&{}", 
            self.auth_helper.get_sid().unwrap_or_else(|| "0".to_string()),
            lang_param
        );
        
        for req in requests {
            params.push_str(&format!("&text={}", url_encode(&req.original_text)));
        }
        
        params
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
        vec![("Content-Type".to_string(), "application/x-www-form-urlencoded".to_string())]
    }

    fn get_base_url(&self) -> String {
        "https://translate.yandex.net/api/v1/tr.json/translate?srv=tr-url-widget".to_string()
    }

    fn get_method(&self) -> &str {
        "GET"
    }
}

impl Default for YandexService {
    fn default() -> Self {
        Self::new()
    }
}

