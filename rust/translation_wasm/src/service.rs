// Base Service trait and implementation
// Ports TWP's Service class architecture

use crate::cache::{get_cache_key, CacheEntry};
use std::collections::HashMap;

#[derive(Clone, Debug)]
pub enum TranslationStatus {
    Translating,
    Complete,
    Error,
}

#[derive(Clone, Debug)]
pub struct TranslationInfo {
    pub original_text: String,
    pub translated_text: Option<String>,
    pub detected_language: Option<String>,
    pub status: TranslationStatus,
}

pub trait TranslationService {
    fn service_name(&self) -> &str;
    
    fn transform_request(&self, source_array: &[String]) -> String;
    
    fn parse_response(&self, response: &str) -> Result<Vec<(String, Option<String>)>, String>;
    
    fn transform_response(&self, result: &str, dont_sort: bool) -> Vec<String>;
    
    fn get_extra_parameters(
        &self,
        source_lang: &str,
        target_lang: &str,
        requests: &[TranslationInfo],
    ) -> String;
    
    fn get_request_body(
        &self,
        source_lang: &str,
        target_lang: &str,
        requests: &[TranslationInfo],
    ) -> Option<String>;
    
    fn get_extra_headers(&self) -> Vec<(String, String)>;
    
    fn get_base_url(&self) -> String;
    
    fn get_method(&self) -> &str;
}

pub struct ServiceManager {
    translations_in_progress: HashMap<String, TranslationInfo>,
    cache: HashMap<String, CacheEntry>,
}

impl ServiceManager {
    pub fn new() -> Self {
        Self {
            translations_in_progress: HashMap::new(),
            cache: HashMap::new(),
        }
    }
    
    pub fn get_requests(
        &mut self,
        service: &dyn TranslationService,
        source_lang: &str,
        target_lang: &str,
        source_array_2d: &[Vec<String>],
    ) -> (Vec<Vec<TranslationInfo>>, Vec<TranslationInfo>) {
        let mut requests: Vec<Vec<TranslationInfo>> = Vec::new();
        let mut current_translations: Vec<TranslationInfo> = Vec::new();
        
        let mut current_request: Vec<TranslationInfo> = Vec::new();
        let mut current_size = 0;
        const MAX_SIZE: usize = 800;
        
        for source_array in source_array_2d {
            let request_string = service.transform_request(source_array);
            let request_hash = format!("{}:{}:{}", source_lang, target_lang, request_string);
            
            // Check in-memory cache
            if let Some(cached) = self.translations_in_progress.get(&request_hash) {
                current_translations.push(cached.clone());
                continue;
            }
            
            // Check persistent cache (would be checked via JS bridge)
            let cache_key = get_cache_key(
                service.service_name(),
                source_lang,
                target_lang,
                &request_string,
            );
            
            // Create new translation info
            let mut trans_info = TranslationInfo {
                original_text: request_string.clone(),
                translated_text: None,
                detected_language: None,
                status: TranslationStatus::Translating,
            };
            
            // Check cache
            if let Some(cached_entry) = self.cache.get(&cache_key) {
                trans_info.translated_text = Some(cached_entry.translated_text.clone());
                trans_info.detected_language = Some(cached_entry.detected_language.clone());
                trans_info.status = TranslationStatus::Complete;
            } else {
                current_request.push(trans_info.clone());
                current_size += trans_info.original_text.len();
                
                if current_size > MAX_SIZE {
                    requests.push(current_request);
                    current_request = Vec::new();
                    current_size = 0;
                }
            }
            
            self.translations_in_progress.insert(request_hash, trans_info.clone());
            current_translations.push(trans_info);
        }
        
        if !current_request.is_empty() {
            requests.push(current_request);
        }
        
        (requests, current_translations)
    }
    
    pub fn remove_translations_with_error(&mut self) {
        self.translations_in_progress.retain(|_, info| {
            !matches!(info.status, TranslationStatus::Error)
        });
    }
    
    pub fn update_translation(
        &mut self,
        key: &str,
        translated_text: String,
        detected_language: Option<String>,
    ) {
        if let Some(info) = self.translations_in_progress.get_mut(key) {
            info.translated_text = Some(translated_text);
            info.detected_language = detected_language;
            info.status = TranslationStatus::Complete;
        }
    }
    
    pub fn set_cache_entry(&mut self, key: String, entry: CacheEntry) {
        self.cache.insert(key, entry);
    }
}

impl Default for ServiceManager {
    fn default() -> Self {
        Self::new()
    }
}

