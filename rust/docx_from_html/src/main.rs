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

#[derive(Debug, Clone)]
enum Segment {
    Text(String),
    Omml(String),
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

fn strip_tags_preserve_newlines(html: &str) -> String {
    // Deterministic, non-HTML5 parse:
    // - convert some tags to newlines
    // - then strip everything else as tags
    let mut s = html.to_string();
    for pat in ["<br", "<BR"] {
        // Normalize <br> variants to newline
        while let Some(idx) = s.find(pat) {
            // Find end of tag
            if let Some(gt) = s[idx..].find('>') {
                s.replace_range(idx..idx + gt + 1, "\n");
            } else {
                break;
            }
        }
    }

    // Paragraph-ish boundaries
    for close in ["</p>", "</div>", "</li>", "</h1>", "</h2>", "</h3>", "</h4>", "</h5>", "</h6>"] {
        s = s.replace(close, "\n\n");
        s = s.replace(&close.to_uppercase(), "\n\n");
    }

    // Now strip remaining tags.
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for ch in s.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }

    decode_entities_basic(&out)
}

fn build_segments_from_html(body_html: &str) -> Result<Vec<Vec<Segment>>> {
    // Extract OMML blocks and replace with tokens, then strip remaining HTML to text
    // while preserving blank-line paragraph splits.
    let re_omml = Regex::new(r"(?is)<m:omathpara\b[^>]*>.*?</m:omathpara>|<m:omath\b[^>]*>.*?</m:omath>")?;
    let re_annotation = Regex::new(r"(?is)<annotation\b[^>]*>.*?</annotation>")?;
    let re_math = Regex::new(r"(?is)<math\b[^>]*>.*?</math>")?;

    let mut omml_blocks: Vec<String> = Vec::new();
    let mut replaced = String::with_capacity(body_html.len());
    let mut last = 0usize;
    for m in re_omml.find_iter(body_html) {
        replaced.push_str(&body_html[last..m.start()]);
        let idx = omml_blocks.len();
        omml_blocks.push(normalize_omml_case(&body_html[m.start()..m.end()]));
        replaced.push_str(&format!("__OMML_{idx}__"));
        last = m.end();
    }
    replaced.push_str(&body_html[last..]);

    // Prevent raw TeX (KaTeX annotation encoding="application/x-tex") from leaking into plain text.
    replaced = re_annotation.replace_all(&replaced, "").to_string();

    // If OMML exists, drop MathML from the remaining HTML to avoid duplicating equations in the output
    // (OMML is kept as the canonical math representation in the DOCX).
    if !omml_blocks.is_empty() {
        replaced = re_math.replace_all(&replaced, "").to_string();
    }

    let text = strip_tags_preserve_newlines(&replaced);
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let paragraphs: Vec<&str> = normalized
        .split("\n\n")
        .map(|p| p.trim_matches('\n'))
        .filter(|p| !p.trim().is_empty())
        .collect();

    let token_re = Regex::new(r"__OMML_(\d+)__")?;
    let mut out: Vec<Vec<Segment>> = Vec::new();
    for p in paragraphs {
        let mut segs: Vec<Segment> = Vec::new();
        let mut cursor = 0usize;
        for caps in token_re.captures_iter(p) {
            let m = caps.get(0).unwrap();
            let before = &p[cursor..m.start()];
            if !before.is_empty() {
                segs.push(Segment::Text(before.to_string()));
            }
            let idx: usize = caps.get(1).unwrap().as_str().parse().unwrap_or(usize::MAX);
            if idx < omml_blocks.len() {
                segs.push(Segment::Omml(omml_blocks[idx].clone()));
            } else {
                segs.push(Segment::Text(m.as_str().to_string()));
            }
            cursor = m.end();
        }
        let tail = &p[cursor..];
        if !tail.is_empty() {
            segs.push(Segment::Text(tail.to_string()));
        }
        out.push(segs);
    }

    Ok(out)
}

fn build_document_xml(paragraphs: &[Vec<Segment>]) -> String {
    // Minimal WordprocessingML with OMML support.
    let mut body = String::new();
    for segs in paragraphs {
        body.push_str("<w:p>");
        for seg in segs {
            match seg {
                Segment::Text(t) => {
                    let t = t.replace('\u{00A0}', " ");
                    let t = t.replace('\n', " ");
                    let t = t.trim_end_matches(' ');
                    if t.is_empty() {
                        continue;
                    }
                    let escaped = xml_escape_text(t);
                    body.push_str(r#"<w:r><w:t xml:space="preserve">"#);
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
    // Minimal default style set.
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
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
    let paragraphs = build_segments_from_html(body).context("parse html into segments")?;
    if paragraphs.is_empty() {
        return Err(anyhow!("no paragraphs produced from input"));
    }

    let document_xml = build_document_xml(&paragraphs);
    write_docx(&args.out, &document_xml)?;

    // Title is currently unused; kept for future core-properties support.
    let _ = args.title;
    Ok(())
}
