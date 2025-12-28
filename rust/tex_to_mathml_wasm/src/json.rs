use crate::pipeline::{PreparedOffice, TexJob};

fn json_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 8);
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if c.is_control() => out.push_str(&format!("\\u{:04x}", c as u32)),
            _ => out.push(c),
        }
    }
    out
}

fn job_to_json(j: &TexJob) -> String {
    format!(
        "{{\"id\":{},\"latex\":\"{}\",\"display\":{}}}",
        j.id,
        json_escape(&j.latex),
        if j.display { "true" } else { "false" }
    )
}

pub fn prepared_office_to_json(p: &PreparedOffice) -> String {
    let mut out = String::new();
    out.push('{');
    out.push_str("\"html\":\"");
    out.push_str(&json_escape(&p.html));
    out.push_str("\",\"jobs\":[");
    for (i, j) in p.jobs.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str(&job_to_json(j));
    }
    out.push_str("]}");
    out
}
