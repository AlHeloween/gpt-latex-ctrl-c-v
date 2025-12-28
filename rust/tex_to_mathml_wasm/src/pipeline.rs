use crate::entities::decode_entities;
use crate::markdown::markdown_to_html_string;
use crate::normalize::normalize_latex;
use crate::office::html_to_office_html;
use crate::sanitize::sanitize_for_office;
use html5ever::parse_document;
use html5ever::tendril::TendrilSink;
use markup5ever_rcdom::{Handle, NodeData, RcDom};

#[derive(Clone, Debug)]
pub struct TexJob {
    pub id: usize,
    pub latex: String,
    pub display: bool,
}

#[derive(Clone, Debug)]
pub struct PreparedOffice {
    pub html: String,
    pub jobs: Vec<TexJob>,
}

fn placeholder_for(id: usize, display: bool) -> String {
    let marker = format!("<!--COF_TEX_{id}-->");
    if display {
        // Use <span> to keep the placeholder valid in inline contexts (e.g. inside <p>).
        format!("<span class=\"cof-math-block\">{marker}</span>")
    } else {
        format!("<span class=\"cof-math-inline\">{marker}</span>")
    }
}

fn parse_to_dom(input: &str) -> RcDom {
    parse_document(RcDom::default(), Default::default()).one(input)
}

fn find_body_children(dom: &RcDom) -> Vec<Handle> {
    fn find_elem(node: &Handle, name: &str) -> Option<Handle> {
        if let NodeData::Element { name: q, .. } = &node.data {
            if q.local.to_string().eq_ignore_ascii_case(name) {
                return Some(node.clone());
            }
        }
        for c in node.children.borrow().iter() {
            if let Some(x) = find_elem(c, name) {
                return Some(x);
            }
        }
        None
    }

    if let Some(body) = find_elem(&dom.document, "body") {
        return body.children.borrow().clone();
    }
    dom.document.children.borrow().clone()
}

fn esc_text(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            _ => out.push(ch),
        }
    }
    out
}

fn esc_attr(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            _ => out.push(ch),
        }
    }
    out
}

fn is_void(tag: &str) -> bool {
    matches!(
        tag.to_ascii_lowercase().as_str(),
        "br" | "hr" | "img" | "meta" | "link" | "input"
    )
}

fn is_currency_like_inline_dollar(inner: &str) -> bool {
    let t = inner.trim();
    if t.is_empty() {
        return true;
    }
    // Heuristic: "$100" style currency should not be interpreted as math.
    t.chars()
        .all(|c| c.is_ascii_digit() || c == ',' || c == '.')
}

fn emit_text_with_tex_placeholders(out: &mut String, text: &str, jobs: &mut Vec<TexJob>) {
    let bytes = text.as_bytes();
    let mut i: usize = 0;
    let mut last: usize = 0;

    while i < bytes.len() {
        if text[i..].starts_with("$$") {
            if let Some(end_rel) = text[i + 2..].find("$$") {
                let end = i + 2 + end_rel;
                out.push_str(&esc_text(&text[last..i]));
                let inner = &text[i + 2..end];
                let latex = normalize_latex(&decode_entities(inner.trim()));
                if !latex.trim().is_empty() {
                    let id = jobs.len();
                    jobs.push(TexJob {
                        id,
                        latex,
                        display: true,
                    });
                    out.push_str(&placeholder_for(id, true));
                } else {
                    out.push_str(&esc_text(&text[i..end + 2]));
                }
                i = end + 2;
                last = i;
                continue;
            }
        }

        if text[i..].starts_with("\\[") {
            if let Some(end_rel) = text[i + 2..].find("\\]") {
                let end = i + 2 + end_rel;
                out.push_str(&esc_text(&text[last..i]));
                let inner = &text[i + 2..end];
                let latex = normalize_latex(&decode_entities(inner.trim()));
                if !latex.trim().is_empty() {
                    let id = jobs.len();
                    jobs.push(TexJob {
                        id,
                        latex,
                        display: true,
                    });
                    out.push_str(&placeholder_for(id, true));
                } else {
                    out.push_str(&esc_text(&text[i..end + 2]));
                }
                i = end + 2;
                last = i;
                continue;
            }
        }

        if text[i..].starts_with("\\(") {
            if let Some(end_rel) = text[i + 2..].find("\\)") {
                let end = i + 2 + end_rel;
                out.push_str(&esc_text(&text[last..i]));
                let inner = &text[i + 2..end];
                let latex = normalize_latex(&decode_entities(inner.trim()));
                if !latex.trim().is_empty() {
                    let id = jobs.len();
                    jobs.push(TexJob {
                        id,
                        latex,
                        display: false,
                    });
                    out.push_str(&placeholder_for(id, false));
                } else {
                    out.push_str(&esc_text(&text[i..end + 2]));
                }
                i = end + 2;
                last = i;
                continue;
            }
        }

        if bytes[i] == b'$' && !text[i..].starts_with("$$") {
            let escaped = i > 0 && bytes[i - 1] == b'\\';
            if !escaped {
                // Find the next non-escaped "$".
                let mut j = i + 1;
                while j < bytes.len() {
                    if bytes[j] == b'$' && !(j > 0 && bytes[j - 1] == b'\\') {
                        break;
                    }
                    let ch = text[j..].chars().next().unwrap_or('\0');
                    j += ch.len_utf8().max(1);
                }
                if j < bytes.len() && bytes[j] == b'$' {
                    let inner = &text[i + 1..j];
                    if !is_currency_like_inline_dollar(inner) {
                        out.push_str(&esc_text(&text[last..i]));
                        let latex = normalize_latex(&decode_entities(inner.trim()));
                        if !latex.trim().is_empty() {
                            let id = jobs.len();
                            jobs.push(TexJob {
                                id,
                                latex,
                                display: false,
                            });
                            out.push_str(&placeholder_for(id, false));
                            i = j + 1;
                            last = i;
                            continue;
                        }
                    }
                }
            }
        }

        let ch = text[i..].chars().next().unwrap_or('\0');
        i += ch.len_utf8().max(1);
    }

    out.push_str(&esc_text(&text[last..]));
}

fn inject_text_math_placeholders_in_sanitized_html(input_html: &str) -> (String, Vec<TexJob>) {
    let dom = parse_to_dom(input_html);
    let children = find_body_children(&dom);
    let mut out = String::with_capacity(input_html.len() + 256);
    let mut jobs: Vec<TexJob> = Vec::new();

    fn walk(node: &Handle, out: &mut String, jobs: &mut Vec<TexJob>, in_code: bool) {
        match &node.data {
            NodeData::Text { contents } => {
                let t = contents.borrow().to_string();
                if in_code {
                    out.push_str(&esc_text(&t));
                } else {
                    emit_text_with_tex_placeholders(out, &t, jobs);
                }
            }
            NodeData::Comment { contents } => {
                out.push_str("<!--");
                out.push_str(contents);
                out.push_str("-->");
            }
            NodeData::Element { name, attrs, .. } => {
                let tag = name.local.to_string();
                let tag_lower = tag.to_ascii_lowercase();
                let now_in_code = in_code || tag_lower == "code" || tag_lower == "pre";

                out.push('<');
                out.push_str(&tag);
                for a in attrs.borrow().iter() {
                    let k = a.name.local.to_string();
                    let v = a.value.to_string();
                    out.push(' ');
                    out.push_str(&k);
                    out.push_str("=\"");
                    out.push_str(&esc_attr(&v));
                    out.push('"');
                }

                if is_void(&tag) {
                    out.push_str("/>");
                    return;
                }

                out.push('>');
                for c in node.children.borrow().iter() {
                    walk(c, out, jobs, now_in_code);
                }
                out.push_str("</");
                out.push_str(&tag);
                out.push('>');
            }
            NodeData::Document => {
                for c in node.children.borrow().iter() {
                    walk(c, out, jobs, in_code);
                }
            }
            NodeData::Doctype { .. } | NodeData::ProcessingInstruction { .. } => {}
        }
    }

    for c in children {
        walk(&c, &mut out, &mut jobs, false);
    }

    (out, jobs)
}

fn find_tag_end(input: &str, lt: usize) -> Option<usize> {
    let bytes = input.as_bytes();
    let mut i = lt;
    let mut in_s = false;
    let mut in_d = false;
    while i < bytes.len() {
        let c = bytes[i] as char;
        match c {
            '\'' if !in_d => in_s = !in_s,
            '"' if !in_s => in_d = !in_d,
            '>' if !in_s && !in_d => return Some(i),
            _ => {}
        }
        i += 1;
    }
    None
}

fn parse_tag_name(raw: &str) -> Option<&str> {
    let t = raw.trim_start();
    let t = t.strip_prefix('/').unwrap_or(t).trim_start();
    if t.is_empty() {
        return None;
    }
    let end = t
        .find(|c: char| c.is_whitespace() || c == '/' || c == '>')
        .unwrap_or(t.len());
    Some(&t[..end])
}

fn attr_val(raw: &str, name: &str) -> Option<String> {
    let low = raw.to_ascii_lowercase();
    let needle = format!("{name}=");
    let idx = low.find(&needle)?;
    let after = &raw[idx + needle.len()..].trim_start();
    if after.starts_with('"') {
        let rest = &after[1..];
        let end = rest.find('"')?;
        return Some(rest[..end].to_string());
    }
    if after.starts_with('\'') {
        let rest = &after[1..];
        let end = rest.find('\'')?;
        return Some(rest[..end].to_string());
    }
    let end = after
        .find(|c: char| c.is_whitespace() || c == '>')
        .unwrap_or(after.len());
    if end == 0 {
        None
    } else {
        Some(after[..end].to_string())
    }
}

fn is_block_math(tag_name: &str, raw_tag: &str) -> bool {
    let n = tag_name.to_ascii_lowercase();
    if matches!(
        n.as_str(),
        "div" | "p" | "li" | "section" | "article" | "td" | "th"
    ) {
        return true;
    }
    raw_tag.to_ascii_lowercase().contains("math-block")
}

fn find_matching_end_tag(input: &str, mut i: usize, tag_name: &str) -> Option<usize> {
    let t = tag_name.to_ascii_lowercase();
    let needle_open = format!("<{t}");
    let needle_close = format!("</{t}");
    let lower = input.to_ascii_lowercase();
    let mut depth: i32 = 1;

    while i < lower.len() {
        let lt_rel = lower[i..].find('<')?;
        let lt = i + lt_rel;

        if lower[lt..].starts_with("<!--") {
            if let Some(end) = lower[lt + 4..].find("-->") {
                i = lt + 4 + end + 3;
                continue;
            }
        }

        if lower[lt..].starts_with(&needle_close) {
            if let Some(gt) = find_tag_end(input, lt) {
                depth -= 1;
                if depth == 0 {
                    return Some(gt + 1);
                }
                i = gt + 1;
                continue;
            }
        }

        if lower[lt..].starts_with(&needle_open) {
            let after = lt + needle_open.len();
            let boundary_ok = lower
                .get(after..after + 1)
                .map(|c| c == " " || c == "\n" || c == "\r" || c == "\t" || c == ">" || c == "/")
                .unwrap_or(true);
            if boundary_ok {
                if let Some(gt) = find_tag_end(input, lt) {
                    depth += 1;
                    i = gt + 1;
                    continue;
                }
            }
        }

        i = lt + 1;
    }

    None
}

fn replace_data_math_blocks_with_placeholders(input: &str) -> (String, Vec<TexJob>) {
    let mut out = String::with_capacity(input.len());
    let mut jobs: Vec<TexJob> = Vec::new();

    let mut i: usize = 0;
    while let Some(lt_rel) = input[i..].find('<') {
        let lt = i + lt_rel;
        out.push_str(&input[i..lt]);

        if input[lt..].starts_with("<!--") {
            if let Some(end) = input[lt + 4..].find("-->") {
                let j = lt + 4 + end + 3;
                out.push_str(&input[lt..j]);
                i = j;
                continue;
            }
        }

        let Some(gt) = find_tag_end(input, lt) else {
            out.push('<');
            i = lt + 1;
            continue;
        };
        let raw = &input[lt + 1..gt];
        let raw_trim = raw.trim();
        let is_end = raw_trim.starts_with('/');
        let Some(tag_name) = parse_tag_name(raw_trim) else {
            out.push_str(&input[lt..=gt]);
            i = gt + 1;
            continue;
        };

        if is_end {
            out.push_str(&input[lt..=gt]);
            i = gt + 1;
            continue;
        }

        let dm = attr_val(raw_trim, "data-math").map(|v| decode_entities(&v));
        if let Some(tex_raw) = dm {
            let id = jobs.len();
            let display = is_block_math(tag_name, raw_trim);
            let latex = normalize_latex(tex_raw.trim());
            jobs.push(TexJob { id, latex, display });

            let end = find_matching_end_tag(input, gt + 1, tag_name).unwrap_or(gt + 1);
            out.push_str(&placeholder_for(id, display));
            i = end;
            continue;
        }

        out.push_str(&input[lt..=gt]);
        i = gt + 1;
    }

    out.push_str(&input[i..]);
    (out, jobs)
}

pub fn html_to_office_prepared(input_html: &str) -> PreparedOffice {
    let (without_tex, jobs) = replace_data_math_blocks_with_placeholders(input_html);
    let sanitized = sanitize_for_office(&without_tex);
    let (with_text_math, mut more_jobs) = inject_text_math_placeholders_in_sanitized_html(&sanitized);
    let mut jobs = jobs;
    jobs.append(&mut more_jobs);
    let html = html_to_office_html(&with_text_math);
    PreparedOffice { html, jobs }
}

fn inject_markdown_math_placeholders(md: &str) -> (String, Vec<TexJob>) {
    let mut out = String::with_capacity(md.len());
    let mut jobs: Vec<TexJob> = Vec::new();

    let bytes = md.as_bytes();
    let mut i: usize = 0;
    let mut in_fence = false;
    let mut in_inline_code = false;

    while i < bytes.len() {
        if md[i..].starts_with("```") {
            in_fence = !in_fence;
            out.push_str("```");
            i += 3;
            continue;
        }
        if in_fence {
            out.push(bytes[i] as char);
            i += 1;
            continue;
        }

        if bytes[i] == b'`' {
            in_inline_code = !in_inline_code;
            out.push('`');
            i += 1;
            continue;
        }
        if in_inline_code {
            out.push(bytes[i] as char);
            i += 1;
            continue;
        }

        if md[i..].starts_with("$$") {
            if let Some(end_rel) = md[i + 2..].find("$$") {
                let inner = &md[i + 2..i + 2 + end_rel];
                let latex = normalize_latex(inner.trim());
                let id = jobs.len();
                jobs.push(TexJob {
                    id,
                    latex,
                    display: true,
                });
                out.push_str(&placeholder_for(id, true));
                i = i + 2 + end_rel + 2;
                continue;
            }
        }
        if md[i..].starts_with("\\[") {
            if let Some(end_rel) = md[i + 2..].find("\\]") {
                let inner = &md[i + 2..i + 2 + end_rel];
                let latex = normalize_latex(inner.trim());
                let id = jobs.len();
                jobs.push(TexJob {
                    id,
                    latex,
                    display: true,
                });
                out.push_str(&placeholder_for(id, true));
                i = i + 2 + end_rel + 2;
                continue;
            }
        }
        if md[i..].starts_with("\\(") {
            if let Some(end_rel) = md[i + 2..].find("\\)") {
                let inner = &md[i + 2..i + 2 + end_rel];
                let latex = normalize_latex(inner.trim());
                let id = jobs.len();
                jobs.push(TexJob {
                    id,
                    latex,
                    display: false,
                });
                out.push_str(&placeholder_for(id, false));
                i = i + 2 + end_rel + 2;
                continue;
            }
        }

        out.push(bytes[i] as char);
        i += 1;
    }

    (out, jobs)
}

pub fn markdown_to_office_prepared(md: &str) -> PreparedOffice {
    let (md_with_placeholders, jobs) = inject_markdown_math_placeholders(md);
    let html = markdown_to_html_string(&md_with_placeholders);
    let html = html_to_office_html(&html);
    PreparedOffice { html, jobs }
}

pub fn office_apply_mathml(html: &str, joined_mathml: &str) -> Result<String, String> {
    let sep = '\u{001F}';
    let parts: Vec<&str> = if joined_mathml.is_empty() {
        Vec::new()
    } else {
        joined_mathml.split(sep).collect()
    };

    if !html.contains("<!--COF_TEX_") {
        return Ok(html.to_string());
    }

    let mut out = html.to_string();
    for (idx, mathml) in parts.iter().enumerate() {
        let marker = format!("<!--COF_TEX_{idx}-->");
        if !out.contains(&marker) {
            return Err(format!("missing placeholder for job {idx}"));
        }
        out = out.replace(&marker, mathml);
    }

    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replaces_data_math_block_with_placeholder_and_job() {
        let html = r#"<div><div class="math-block" data-math="\\text{Logit}_{ij} = 1+1"></div><p>ok</p></div>"#;
        let prepared = html_to_office_prepared(html);
        assert!(prepared.html.contains("<!--COF_TEX_0-->"));
        assert_eq!(prepared.jobs.len(), 1);
        assert!(prepared.jobs[0].latex.contains("\\text{Logit}_{ij}"));
        assert!(prepared.jobs[0].display);
    }

    #[test]
    fn replaces_inline_dollar_math_with_placeholder_and_job() {
        let html = r#"<p>Price is $100 and math is $x^2 + y^2 = z^2$ ok</p>"#;
        let prepared = html_to_office_prepared(html);
        assert!(prepared.html.contains("Price is $100 and math is"));
        assert!(prepared.html.contains("<!--COF_TEX_0-->"));
        assert_eq!(prepared.jobs.len(), 1);
        assert!(!prepared.jobs[0].display);
        assert!(prepared.jobs[0].latex.contains("x^2"));
    }

    #[test]
    fn replaces_display_bracket_math_with_placeholder_and_job() {
        let html = r#"<p>Display: \[x = \frac{-b}{2a}\]</p>"#;
        let prepared = html_to_office_prepared(html);
        assert!(prepared.html.contains("Display:"));
        assert!(prepared.html.contains("<!--COF_TEX_0-->"));
        assert_eq!(prepared.jobs.len(), 1);
        assert!(prepared.jobs[0].display);
        assert!(prepared.jobs[0].latex.contains("\\frac"));
    }

    #[test]
    fn apply_mathml_replaces_markers() {
        let html = r#"<div><!--COF_TEX_0--></div><span><!--COF_TEX_1--></span>"#;
        let joined = format!(
            "{}\u{001F}{}",
            r#"<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>a</mi></math>"#,
            r#"<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>b</mi></math>"#
        );
        let out = office_apply_mathml(html, &joined).unwrap();
        assert!(!out.contains("COF_TEX_0"));
        assert!(out.contains("<mi>a</mi>"));
        assert!(out.contains("<mi>b</mi>"));
    }
}
