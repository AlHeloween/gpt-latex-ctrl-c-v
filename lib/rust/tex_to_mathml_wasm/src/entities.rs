pub fn decode_entities(s: &str) -> String {
    // Minimal HTML entity decoding (deterministic; no external deps).
    // Supports: &amp; &lt; &gt; &quot; &#39; and numeric refs (decimal/hex).
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    let bytes = s.as_bytes();
    while i < bytes.len() {
        if bytes[i] != b'&' {
            out.push(bytes[i] as char);
            i += 1;
            continue;
        }
        let semi = s[i..].find(';').map(|d| i + d);
        let Some(semi) = semi else {
            out.push('&');
            i += 1;
            continue;
        };
        let ent = &s[i + 1..semi];
        let decoded: Option<char> = match ent {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "#39" => Some('\''),
            "#x27" | "#X27" => Some('\''),
            _ if ent.starts_with("#x") || ent.starts_with("#X") => {
                u32::from_str_radix(&ent[2..], 16)
                    .ok()
                    .and_then(char::from_u32)
            }
            _ if ent.starts_with('#') => ent[1..].parse::<u32>().ok().and_then(char::from_u32),
            _ => None,
        };
        if let Some(c) = decoded {
            out.push(c);
            i = semi + 1;
        } else {
            out.push_str(&s[i..=semi]);
            i = semi + 1;
        }
    }
    out
}
