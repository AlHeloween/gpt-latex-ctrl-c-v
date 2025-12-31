// DeepL translation service

use crate::service::{TranslationInfo, TranslationService};

pub struct DeepLService {
    api_key: Option<String>,
    use_free_api: bool,
}

impl DeepLService {
    pub fn new(api_key: Option<String>) -> Self {
        let use_free = api_key.is_some();
        Self {
            api_key,
            use_free_api: use_free,
        }
    }
}

fn map_language_code(lang: &str) -> String {
    // Language code mappings from TWP
    match lang {
        "pt" => "pt-BR".to_string(),
        "no" => "nb".to_string(),
        "zh-CN" => "zh-Hans".to_string(),
        "zh-TW" => "zh".to_string(),
        _ => lang.to_string(),
    }
}

impl TranslationService for DeepLService {
    fn service_name(&self) -> &str {
        "deepl"
    }

    fn transform_request(&self, source_array: &[String]) -> String {
        source_array.join("\n")
    }

    fn parse_response(&self, response: &str) -> Result<Vec<(String, Option<String>)>, String> {
        use serde_json::Value;
        
        let json: Value = serde_json::from_str(response)
            .map_err(|e| format!("JSON parse error: {}", e))?;

        let mut results = Vec::new();
        
        if let Some(translations) = json.get("translations").and_then(|v| v.as_array()) {
            for trans in translations {
                if let Some(text) = trans.get("text").and_then(|v| v.as_str()) {
                    let detected = trans
                        .get("detected_source_language")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    results.push((text.to_string(), detected));
                }
            }
        }

        Ok(results)
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
        let text = requests.iter().map(|r| r.original_text.clone()).collect::<Vec<_>>().join("\n");
        let target = map_language_code(target_lang);
        
        // Form-encoded body
        let mut params = format!("text={}&target_lang={}", 
            crate::utils::url_encode(&text),
            crate::utils::url_encode(&target)
        );
        
        if source_lang != "auto" {
            params.push_str(&format!("&source_lang={}", crate::utils::url_encode(source_lang)));
        }
        
        Some(params)
    }

    fn get_extra_headers(&self) -> Vec<(String, String)> {
        let mut headers = vec![
            ("Content-Type".to_string(), "application/x-www-form-urlencoded".to_string())
        ];
        
        if let Some(ref api_key) = self.api_key {
            headers.push(("Authorization".to_string(), format!("DeepL-Auth-Key {}", api_key)));
        }
        
        headers
    }

    fn get_base_url(&self) -> String {
        if self.use_free_api {
            "https://api-free.deepl.com/v2/translate".to_string()
        } else {
            "https://api.deepl.com/v2/translate".to_string()
        }
    }

    fn get_method(&self) -> &str {
        "POST"
    }
}

impl Default for DeepLService {
    fn default() -> Self {
        Self::new(None)
    }
}

