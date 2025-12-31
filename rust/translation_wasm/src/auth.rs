// Auth token extraction for Google, Bing, and Yandex
// Ports TWP's auth helper classes
// Note: Actual HTTP calls will be handled via JavaScript bridge

pub struct GoogleHelper {
    last_request_time: Option<u64>,
    translate_auth: Option<String>,
    auth_not_found: bool,
}

impl GoogleHelper {
    pub fn new() -> Self {
        Self {
            last_request_time: None,
            translate_auth: None,
            auth_not_found: false,
        }
    }

    pub fn get_auth(&self) -> Option<String> {
        self.translate_auth.clone()
    }

    pub fn set_auth(&mut self, auth: String) {
        self.translate_auth = Some(auth);
        self.auth_not_found = false;
    }

    pub fn set_auth_not_found(&mut self) {
        // No hardcoded fallback - API keys should be provided by the user
        // This method marks that auth was not found, but does not set a fallback key
        self.auth_not_found = true;
    }

    pub fn should_update(&self) -> bool {
        // Check if we need to update (cache for 20 minutes if found, 5 minutes if not found, 1 minute if first time)
        // Actual time checking will be done in JavaScript
        self.last_request_time.is_none() || self.translate_auth.is_none()
    }
}

impl Default for GoogleHelper {
    fn default() -> Self {
        Self::new()
    }
}

pub struct BingHelper {
    last_request_time: Option<u64>,
    translate_auth: Option<String>,
    auth_not_found: bool,
}

impl BingHelper {
    pub fn new() -> Self {
        Self {
            last_request_time: None,
            translate_auth: None,
            auth_not_found: false,
        }
    }

    pub fn get_auth(&self) -> Option<String> {
        self.translate_auth.clone()
    }

    pub fn set_auth(&mut self, auth: String) {
        self.translate_auth = Some(auth);
        self.auth_not_found = false;
    }

    pub fn set_auth_not_found(&mut self) {
        self.auth_not_found = true;
    }

    pub fn should_update(&self) -> bool {
        self.last_request_time.is_none() || self.translate_auth.is_none()
    }
}

impl Default for BingHelper {
    fn default() -> Self {
        Self::new()
    }
}

pub struct YandexHelper {
    last_request_time: Option<u64>,
    translate_sid: Option<String>,
    sid_not_found: bool,
}

impl YandexHelper {
    pub fn new() -> Self {
        Self {
            last_request_time: None,
            translate_sid: None,
            sid_not_found: false,
        }
    }

    pub fn get_sid(&self) -> Option<String> {
        self.translate_sid.clone()
    }

    pub fn set_sid(&mut self, sid: String) {
        self.translate_sid = Some(sid);
        self.sid_not_found = false;
    }

    pub fn set_sid_not_found(&mut self) {
        self.sid_not_found = true;
    }

    pub fn should_update(&self) -> bool {
        self.last_request_time.is_none() || self.translate_sid.is_none()
    }
}

impl Default for YandexHelper {
    fn default() -> Self {
        Self::new()
    }
}
