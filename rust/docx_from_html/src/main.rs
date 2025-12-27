use anyhow::{anyhow, Context, Result};
use clap::Parser;
use regex::Regex;
use std::fs::File;
use std::io::{Read, Write};
use std::path::PathBuf;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

#[derive(Parser, Debug)]
#[command(author, version, about)]
struct Args {
    /// Input HTML file (expects a full document; body will be extracted if present).
    #[arg(long)]
    html_file: PathBuf,

    /// Output .docx path.
    #[arg(long)]
    out: PathBuf,

    /// Document title metadata (optional).
    #[arg(long)]
    title: Option<String>,
}

#[derive(Debug, Clone, Copy)]
struct RunStyle {
    bold: bool,
    italic: bool,
    code: bool,
}

#[derive(Debug, Clone)]
enum Segment {
    Text { text: String, style: RunStyle },
    Break,
    Omml(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ParagraphStyle {
    Normal,
    Heading1,
    Heading2,
    CodeBlock,
    Bullet,
}

#[derive(Debug, Clone)]
struct Paragraph {
    style: ParagraphStyle,
    segments: Vec<Segment>,
}

fn normalize_omml_case(xml: &str) -> String {
    // When OMML is round-tripped through an HTML DOM, element names can be lowercased.
    // WordprocessingML is XML and case-sensitive, so normalize to the schema's canonical case
    // for the (small) set of OMML element names we generate.
    let mut out = xml.to_string();
    let fixes = [
        ("omathpara", "oMathPara"),
        ("omath", "oMath"),
        ("ssubsup", "sSubSup"),
        ("ssub", "sSub"),
        ("ssup", "sSup"),
    ];
    for (from, to) in fixes {
        out = out.replace(&format!("<m:{from}"), &format!("<m:{to}"));
        out = out.replace(&format!("</m:{from}"), &format!("</m:{to}"));
    }
    out
}

fn xml_escape_text(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(ch),
        }
    }
    out
}

fn decode_entities_basic(s: &str) -> String {
    // Minimal deterministic decode; preserves UTF-8 (do NOT iterate bytes).
    let mut out = String::with_capacity(s.len());
    let mut it = s.chars().peekable();

    while let Some(ch) = it.next() {
        if ch != '&' {
            out.push(ch);
            continue;
        }

        // Collect up to ';' (limit to keep this predictable even on malformed input).
        let mut ent = String::new();
        let mut ended = false;
        while let Some(&c) = it.peek() {
            it.next();
            if c == ';' {
                ended = true;
                break;
            }
            ent.push(c);
            if ent.len() > 64 {
                break;
            }
        }

        let decoded: Option<char> = match ent.as_str() {
            "nbsp" => Some(' '),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "amp" => Some('&'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            _ => None,
        };

        if let Some(c) = decoded {
            out.push(c);
            continue;
        }

        if let Some(num) = ent.strip_prefix("#x") {
            if let Ok(v) = u32::from_str_radix(num, 16) {
                if let Some(c) = char::from_u32(v) {
                    out.push(c);
                    continue;
                }
            }
        } else if let Some(num) = ent.strip_prefix('#') {
            if let Ok(v) = num.parse::<u32>() {
                if let Some(c) = char::from_u32(v) {
                    out.push(c);
                    continue;
                }
            }
        }

        // Unknown/malformed: keep literal.
        out.push('&');
        out.push_str(&ent);
        if ended {
            out.push(';');
        }
    }

    out
}

fn extract_body(html: &str) -> &str {
    // Prefer <body> content if present; fallback to whole HTML.
    let lower = html.to_lowercase();
    if let (Some(b0), Some(b1)) = (lower.find("<body"), lower.rfind("</body>")) {
        if let Some(start_gt) = html[b0..].find('>') {
            let start = b0 + start_gt + 1;
            if start <= b1 && b1 <= html.len() {
                return &html[start..b1];
            }
        }
    }
    html
}

fn preprocess_html(body_html: &str) -> Result<(String, Vec<String>)> {
    // Extract OMML blocks and replace with tokens so we can parse the remaining HTML
    // without losing case-sensitive Word math tags in DOCX output.
    //
    // NOTE: When HTML is written to the real clipboard by browsers, namespaced tags like <m:oMath>
    // can be lowercased (<m:omath>) during HTML parsing/serialization. The extension embeds OMML
    // in msEquation conditional comments to preserve exact casing for Word paste:
    //   <!--[if gte msEquation 12]><m:oMath>...</m:oMath><![endif]-->
    // We must extract those blocks and strip the conditional wrappers deterministically.
    let re_omml = Regex::new(r"(?is)<m:omathpara\b[^>]*>.*?</m:omathpara>|<m:omath\b[^>]*>.*?</m:omath>")?;
    let re_ms_equation = Regex::new(
        r"(?is)<!--\s*\[if\s+gte\s+msEquation\s+12\]\s*>(.*?)<!\s*\[endif\]\s*-->",
    )?;
    let re_ms_equation_fallback =
        Regex::new(r"(?is)<!\s*\[if\s+!msEquation\]\s*>(.*?)<!\s*\[endif\]\s*>")?;
    let re_annotation = Regex::new(r"(?is)<annotation\b[^>]*>.*?</annotation>")?;
    let re_math = Regex::new(r"(?is)<math\b[^>]*>.*?</math>")?;

    let mut omml_blocks: Vec<String> = Vec::new();
    let mut replaced = String::with_capacity(body_html.len());

    fn normalize_omml_namespace(xml: &str) -> String {
        // DOCX expects the OpenXML OMML namespace. Word clipboard HTML often uses the older MS namespace.
        String::from(xml).replace(
            "http://schemas.microsoft.com/office/2004/12/omml",
            "http://schemas.openxmlformats.org/officeDocument/2006/math",
        )
    }

    // 1) Extract msEquation conditional comment OMML blocks as a whole (to remove wrappers).
    let mut last = 0usize;
    for cap in re_ms_equation.captures_iter(body_html) {
        let m0 = cap
            .get(0)
            .ok_or_else(|| anyhow!("msEquation regex capture missing group 0"))?;
        let inner = cap
            .get(1)
            .ok_or_else(|| anyhow!("msEquation regex capture missing group 1"))?
            .as_str();

        replaced.push_str(&body_html[last..m0.start()]);

        if let Some(omml_match) = re_omml.find(inner) {
            let idx = omml_blocks.len();
            let omml = normalize_omml_namespace(&normalize_omml_case(omml_match.as_str()));
            omml_blocks.push(omml);
            replaced.push_str(&format!("__OMML_{idx}__"));
        } else {
            // If we can't find OMML inside the conditional comment, keep the inner HTML as a fallback.
            replaced.push_str(inner);
        }

        last = m0.end();
    }
    replaced.push_str(&body_html[last..]);

    // Strip downlevel-revealed fallback wrappers (keep their inner HTML).
    replaced = re_ms_equation_fallback.replace_all(&replaced, "$1").to_string();

    // 2) Extract any remaining OMML tags (e.g., from test-bridge payloads).
    let mut final_replaced = String::with_capacity(replaced.len());
    let mut last2 = 0usize;
    for m in re_omml.find_iter(&replaced) {
        final_replaced.push_str(&replaced[last2..m.start()]);
        let idx = omml_blocks.len();
        let omml = normalize_omml_namespace(&normalize_omml_case(&replaced[m.start()..m.end()]));
        omml_blocks.push(omml);
        final_replaced.push_str(&format!("__OMML_{idx}__"));
        last2 = m.end();
    }
    final_replaced.push_str(&replaced[last2..]);
    replaced = final_replaced;

    // Prevent raw TeX (KaTeX annotation encoding="application/x-tex") from leaking into output.
    replaced = re_annotation.replace_all(&replaced, "").to_string();

    // If OMML exists, drop MathML from the remaining HTML to avoid duplicating equations in the output.
    if !omml_blocks.is_empty() {
        replaced = re_math.replace_all(&replaced, "").to_string();
    }

    Ok((replaced, omml_blocks))
}

fn collapse_whitespace(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_ws = false;
    for ch in s.chars() {
        if ch.is_whitespace() {
            if !in_ws {
                out.push(' ');
                in_ws = true;
            }
        } else {
            out.push(ch);
            in_ws = false;
        }
    }
    out
}

fn build_paragraphs_from_html(body_html: &str) -> Result<Vec<Paragraph>> {
    let (html, omml_blocks) = preprocess_html(body_html)?;
    let token_re = Regex::new(r"__OMML_(\d+)__")?;

    let mut paragraphs: Vec<Paragraph> = Vec::new();
    let mut current = Paragraph {
        style: ParagraphStyle::Normal,
        segments: Vec::new(),
    };

    let mut bold_depth: u32 = 0;
    let mut italic_depth: u32 = 0;
    let mut code_depth: u32 = 0;
    let mut pre_depth: u32 = 0;

    let mut i: usize = 0;
    let bytes = html.as_bytes();

    let flush = |paragraphs: &mut Vec<Paragraph>, current: &mut Paragraph| {
        // Trim whitespace-only text at edges (but keep for code blocks).
        if current.style != ParagraphStyle::CodeBlock {
            while let Some(Segment::Text { text, .. }) = current.segments.first() {
                if text.trim().is_empty() {
                    current.segments.remove(0);
                } else {
                    break;
                }
            }
            while let Some(Segment::Text { text, .. }) = current.segments.last() {
                if text.trim().is_empty() {
                    current.segments.pop();
                } else {
                    break;
                }
            }
        }

        let has_content = current.segments.iter().any(|s| match s {
            Segment::Text { text, .. } => !text.is_empty(),
            Segment::Break => true,
            Segment::Omml(_) => true,
        });

        if has_content {
            paragraphs.push(current.clone());
        }

        current.style = ParagraphStyle::Normal;
        current.segments.clear();
    };

    let start_new_paragraph =
        |style: ParagraphStyle, paragraphs: &mut Vec<Paragraph>, current: &mut Paragraph| {
        flush(paragraphs, current);
        current.style = style;
        current.segments.clear();
        if style == ParagraphStyle::Bullet {
            let style = RunStyle {
                bold: false,
                italic: false,
                code: false,
            };
            current.segments.push(Segment::Text {
                text: "• ".to_string(),
                style,
            });
        }
    };

    let emit_text = |raw: &str,
                         current: &mut Paragraph,
                         bold_depth: u32,
                         italic_depth: u32,
                         code_depth: u32,
                         pre_depth: u32|
     -> Result<()> {
        if raw.is_empty() {
            return Ok(());
        }

        let decoded = decode_entities_basic(raw);
        let preserve_space = pre_depth > 0;
        let mut text = if preserve_space {
            decoded.replace("\r\n", "\n").replace('\r', "\n")
        } else {
            collapse_whitespace(&decoded.replace("\r\n", "\n").replace('\r', "\n").replace('\n', " "))
        };

        if !preserve_space && current.segments.is_empty() {
            text = text.trim_start().to_string();
        }

        let run_style = RunStyle {
            bold: bold_depth > 0,
            italic: italic_depth > 0,
            code: (code_depth > 0) || (pre_depth > 0),
        };

        // Convert newlines to explicit breaks inside code blocks.
        if preserve_space && text.contains('\n') {
            let mut first = true;
            for line in text.split('\n') {
                if !first {
                    current.segments.push(Segment::Break);
                }
                first = false;
                if !line.is_empty() {
                    current.segments.push(Segment::Text {
                        text: line.to_string(),
                        style: run_style,
                    });
                }
            }
            return Ok(());
        }

        // Replace OMML token markers embedded in text with real OMML segments.
        let mut cursor = 0usize;
        for caps in token_re.captures_iter(&text) {
            let m = caps.get(0).unwrap();
            let before = &text[cursor..m.start()];
            if !before.is_empty() {
                current.segments.push(Segment::Text {
                    text: before.to_string(),
                    style: run_style,
                });
            }
            let idx: usize = caps.get(1).unwrap().as_str().parse().unwrap_or(usize::MAX);
            if idx < omml_blocks.len() {
                current.segments.push(Segment::Omml(omml_blocks[idx].clone()));
            } else {
                current.segments.push(Segment::Text {
                    text: m.as_str().to_string(),
                    style: run_style,
                });
            }
            cursor = m.end();
        }
        let tail = &text[cursor..];
        if !tail.is_empty() {
            current.segments.push(Segment::Text {
                text: tail.to_string(),
                style: run_style,
            });
        }

        Ok(())
    };

    while i < bytes.len() {
        // Skip HTML comments deterministically.
        if html[i..].starts_with("<!--") {
            if let Some(end) = html[i + 4..].find("-->") {
                i = i + 4 + end + 3;
                continue;
            } else {
                break;
            }
        }

        if bytes[i] == b'<' {
            // Find the end of tag.
            let Some(gt_rel) = html[i..].find('>') else {
                break;
            };
            let gt = i + gt_rel;
            let raw = html[i + 1..gt].trim();
            i = gt + 1;

            if raw.is_empty() {
                continue;
            }

            // Skip doctype/processing directives.
            if raw.starts_with('!') || raw.starts_with('?') {
                continue;
            }

            let is_end = raw.starts_with('/');
            let raw2 = raw.trim_start_matches('/').trim();
            let raw2 = raw2.trim_end_matches('/');
            let name = raw2
                .split_whitespace()
                .next()
                .unwrap_or("")
                .trim()
                .to_ascii_lowercase();

            // Skip script/style blocks entirely (content is not part of rich text).
            if !is_end && (name == "script" || name == "style") {
                let close = format!("</{name}>");
                if let Some(pos) = html[i..].find(&close) {
                    i += pos + close.len();
                }
                continue;
            }

            match (is_end, name.as_str()) {
                (false, "br") => current.segments.push(Segment::Break),
                (false, "hr") => flush(&mut paragraphs, &mut current),
                (false, "p" | "div" | "user-query-content" | "message-content") => {
                    start_new_paragraph(ParagraphStyle::Normal, &mut paragraphs, &mut current);
                }
                (true, "p" | "div" | "user-query-content" | "message-content") => {
                    flush(&mut paragraphs, &mut current);
                }
                (false, "li") => start_new_paragraph(ParagraphStyle::Bullet, &mut paragraphs, &mut current),
                (true, "li") => flush(&mut paragraphs, &mut current),
                (false, "h1") => start_new_paragraph(ParagraphStyle::Heading1, &mut paragraphs, &mut current),
                (true, "h1") => flush(&mut paragraphs, &mut current),
                (false, "h2" | "h3") => start_new_paragraph(ParagraphStyle::Heading2, &mut paragraphs, &mut current),
                (true, "h2" | "h3") => flush(&mut paragraphs, &mut current),
                (false, "pre") => {
                    pre_depth += 1;
                    start_new_paragraph(ParagraphStyle::CodeBlock, &mut paragraphs, &mut current);
                }
                (true, "pre") => {
                    flush(&mut paragraphs, &mut current);
                    pre_depth = pre_depth.saturating_sub(1);
                }
                (false, "code") => code_depth += 1,
                (true, "code") => code_depth = code_depth.saturating_sub(1),
                (false, "strong" | "b") => bold_depth += 1,
                (true, "strong" | "b") => bold_depth = bold_depth.saturating_sub(1),
                (false, "em" | "i") => italic_depth += 1,
                (true, "em" | "i") => italic_depth = italic_depth.saturating_sub(1),
                _ => {}
            }
        } else {
            let mut j = i;
            while j < bytes.len() && bytes[j] != b'<' {
                j += 1;
            }
            let raw_text = &html[i..j];
            i = j;
            emit_text(
                raw_text,
                &mut current,
                bold_depth,
                italic_depth,
                code_depth,
                pre_depth,
            )?;
        }
    }

    flush(&mut paragraphs, &mut current);
    Ok(paragraphs)
}

fn build_document_xml(paragraphs: &[Paragraph]) -> String {
    // Minimal WordprocessingML with basic formatting + OMML support.
    let mut body = String::new();
    for p in paragraphs {
        body.push_str("<w:p>");

        match p.style {
            ParagraphStyle::Normal | ParagraphStyle::Bullet => {}
            ParagraphStyle::Heading1 => {
                body.push_str(r#"<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>"#);
            }
            ParagraphStyle::Heading2 => {
                body.push_str(r#"<w:pPr><w:pStyle w:val="Heading2"/></w:pPr>"#);
            }
            ParagraphStyle::CodeBlock => {
                body.push_str(r#"<w:pPr><w:pStyle w:val="CodeBlock"/></w:pPr>"#);
            }
        }

        for seg in &p.segments {
            match seg {
                Segment::Break => {
                    body.push_str("<w:r><w:br/></w:r>");
                }
                Segment::Text { text, style } => {
                    if text.is_empty() {
                        continue;
                    }
                    let escaped = xml_escape_text(text);
                    body.push_str("<w:r>");
                    if style.bold || style.italic || style.code {
                        body.push_str("<w:rPr>");
                        if style.bold {
                            body.push_str("<w:b/>");
                        }
                        if style.italic {
                            body.push_str("<w:i/>");
                        }
                        if style.code {
                            body.push_str(r#"<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>"#);
                        }
                        body.push_str("</w:rPr>");
                    }
                    body.push_str(r#"<w:t xml:space="preserve">"#);
                    body.push_str(&escaped);
                    body.push_str("</w:t></w:r>");
                }
                Segment::Omml(xml) => {
                    // Insert as-is; assumes valid OMML (m: namespace is declared at root).
                    body.push_str(xml);
                }
            }
        }

        body.push_str("</w:p>");
    }

    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
 xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
 xmlns:v="urn:schemas-microsoft-com:vml"
 xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing"
 xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
 xmlns:w10="urn:schemas-microsoft-com:office:word"
 xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
 xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordprocessingml"
 xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordprocessingml"
 xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"
 xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk"
 xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml"
 xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
 mc:Ignorable="w14 w15 wp14">
  <w:body>
    {body}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>
      <w:cols w:space="708"/>
      <w:docGrid w:linePitch="360"/>
    </w:sectPr>
  </w:body>
</w:document>"#
    )
}

fn content_types_xml() -> &'static str {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>"#
}

fn rels_xml() -> &'static str {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"#
}

fn word_rels_xml() -> &'static str {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>"#
}

fn styles_xml() -> &'static str {
    // Minimal default style set (Normal + a few basic paragraph styles).
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:uiPriority w:val="9"/>
    <w:qFormat/>
    <w:pPr>
      <w:spacing w:before="240" w:after="120"/>
      <w:keepNext/>
      <w:keepLines/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:sz w:val="32"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:uiPriority w:val="9"/>
    <w:qFormat/>
    <w:pPr>
      <w:spacing w:before="200" w:after="100"/>
      <w:keepNext/>
      <w:keepLines/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:sz w:val="28"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="CodeBlock">
    <w:name w:val="Code Block"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr>
      <w:spacing w:before="120" w:after="120"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>
      <w:sz w:val="20"/>
    </w:rPr>
  </w:style>
</w:styles>"#
}

fn write_docx(out_path: &PathBuf, document_xml: &str) -> Result<()> {
    if let Some(parent) = out_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let file = File::create(out_path).with_context(|| format!("create {}", out_path.display()))?;
    let mut zip = ZipWriter::new(file);
    let opt = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    zip.start_file("[Content_Types].xml", opt)?;
    zip.write_all(content_types_xml().as_bytes())?;

    zip.add_directory("_rels/", opt)?;
    zip.start_file("_rels/.rels", opt)?;
    zip.write_all(rels_xml().as_bytes())?;

    zip.add_directory("word/", opt)?;
    zip.add_directory("word/_rels/", opt)?;

    zip.start_file("word/document.xml", opt)?;
    zip.write_all(document_xml.as_bytes())?;

    zip.start_file("word/_rels/document.xml.rels", opt)?;
    zip.write_all(word_rels_xml().as_bytes())?;

    zip.start_file("word/styles.xml", opt)?;
    zip.write_all(styles_xml().as_bytes())?;

    zip.finish()?;
    Ok(())
}

fn main() -> Result<()> {
    let args = Args::parse();
    let mut html = String::new();
    File::open(&args.html_file)
        .with_context(|| format!("open {}", args.html_file.display()))?
        .read_to_string(&mut html)
        .context("read html")?;

    let body = extract_body(&html);
    let paragraphs = build_paragraphs_from_html(body).context("parse html into paragraphs")?;
    if paragraphs.is_empty() {
        return Err(anyhow!("no paragraphs produced from input"));
    }

    let document_xml = build_document_xml(&paragraphs);
    write_docx(&args.out, &document_xml)?;

    // Title is currently unused; kept for future core-properties support.
    let _ = args.title;
    Ok(())
}
