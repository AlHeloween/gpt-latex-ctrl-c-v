
use anyhow::{anyhow, Context, Result};
use clap::Parser;
use html5ever::parse_document;
use html5ever::tendril::TendrilSink;
use markup5ever_rcdom::{Handle, NodeData, RcDom};
use std::collections::{BTreeMap, BTreeSet};
use std::fs::File;
use std::io::{Read, Write};
use std::path::PathBuf;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

#[derive(Parser, Debug)]
#[command(author, version, about)]
struct Args {
    /// Input HTML file (any fragment or full document).
    #[arg(long)]
    html_file: PathBuf,

    /// Output .docx path.
    #[arg(long)]
    out: PathBuf,

    /// Optional document title (currently unused; accepted for compatibility with the test harness).
    #[arg(long)]
    title: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct RunStyle {
    bold: bool,
    italic: bool,
    code: bool,
}

#[derive(Debug, Clone)]
enum Segment {
    Text { text: String, style: RunStyle },
    LinkText { text: String, style: RunStyle, href: String },
    Break,
    Omml(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ParagraphStyle {
    Normal,
    Heading1,
    Heading2,
    CodeBlock,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ListInfo {
    num_id: u32, // 1 = bullet, 2 = decimal
    ilvl: u32,   // nesting level
}

#[derive(Debug, Clone)]
struct Paragraph {
    style: ParagraphStyle,
    list: Option<ListInfo>,
    segments: Vec<Segment>,
}

#[derive(Debug, Clone)]
struct TableCell {
    paragraphs: Vec<Paragraph>,
}

#[derive(Debug, Clone)]
struct TableRow {
    cells: Vec<TableCell>,
}

#[derive(Debug, Clone)]
struct Table {
    rows: Vec<TableRow>,
}

#[derive(Debug, Clone)]
enum Block {
    Paragraph(Paragraph),
    Table(Table),
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

fn normalize_omml_namespace(xml: &str) -> String {
    xml.replace(
        "http://schemas.microsoft.com/office/2004/12/omml",
        "http://schemas.openxmlformats.org/officeDocument/2006/math",
    )
}

fn normalize_omml_case(xml: &str) -> String {
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

fn sanitize_href(href: &str) -> Option<String> {
    let h = href.trim();
    if h.is_empty() {
        return None;
    }
    let low = h.to_ascii_lowercase();
    if low.starts_with("javascript:") || low.starts_with("data:") || low.starts_with("vbscript:") {
        return None;
    }
    Some(h.to_string())
}

fn comment_extract_ms_equation_omml(contents: &str) -> Option<String> {
    let c = contents;
    if !c.to_ascii_lowercase().contains("msequation") {
        return None;
    }
    let start = c.find("]>")?;
    let rest = &c[start + 2..];
    let end = rest.find("<![endif]")?;
    let xml = rest[..end].trim();
    if !xml.contains("<m:") {
        return None;
    }
    Some(normalize_omml_namespace(&normalize_omml_case(xml)))
}

fn html5_parse(input: &str) -> RcDom {
    parse_document(RcDom::default(), Default::default()).one(input)
}

fn tag_lower(node: &Handle) -> Option<String> {
    match &node.data {
        NodeData::Element { name, .. } => Some(name.local.to_string().to_ascii_lowercase()),
        _ => None,
    }
}

fn attrs_vec(node: &Handle) -> Vec<(String, String)> {
    match &node.data {
        NodeData::Element { attrs, .. } => attrs
            .borrow()
            .iter()
            .map(|a| (a.name.local.to_string(), a.value.to_string()))
            .collect(),
        _ => Vec::new(),
    }
}

fn attr_get(attrs: &[(String, String)], name: &str) -> Option<String> {
    for (k, v) in attrs {
        if k.eq_ignore_ascii_case(name) {
            return Some(v.to_string());
        }
    }
    None
}

fn collapse_ws(s: &str) -> String {
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

#[derive(Clone)]
struct BuildCtx {
    bold_depth: u32,
    italic_depth: u32,
    code_depth: u32,
    pre_depth: u32,
    link_stack: Vec<Option<String>>,
    list_stack: Vec<u32>,            // 1 bullet, 2 decimal
    li_list_stack: Vec<Option<ListInfo>>,
}

impl BuildCtx {
    fn new() -> Self {
        Self {
            bold_depth: 0,
            italic_depth: 0,
            code_depth: 0,
            pre_depth: 0,
            link_stack: Vec::new(),
            list_stack: Vec::new(),
            li_list_stack: Vec::new(),
        }
    }

    fn current_href(&self) -> Option<&String> {
        self.link_stack.last().and_then(|x| x.as_ref())
    }

    fn current_list(&self) -> Option<ListInfo> {
        self.li_list_stack.last().cloned().unwrap_or(None)
    }
}

fn paragraph_has_content(p: &Paragraph) -> bool {
    p.segments.iter().any(|s| match s {
        Segment::Text { text, .. } => !text.trim().is_empty(),
        Segment::LinkText { text, .. } => !text.trim().is_empty(),
        Segment::Break => true,
        Segment::Omml(_) => true,
    })
}

fn flush_paragraph(blocks: &mut Vec<Block>, current: &mut Paragraph) {
    if paragraph_has_content(current) {
        blocks.push(Block::Paragraph(current.clone()));
    }
    current.style = ParagraphStyle::Normal;
    current.list = None;
    current.segments.clear();
}

fn start_paragraph(
    blocks: &mut Vec<Block>,
    current: &mut Paragraph,
    style: ParagraphStyle,
    list: Option<ListInfo>,
) {
    flush_paragraph(blocks, current);
    current.style = style;
    current.list = list;
    current.segments.clear();
}

fn emit_text(current: &mut Paragraph, ctx: &BuildCtx, raw: &str) {
    if raw.is_empty() {
        return;
    }

    let t0 = raw.trim_start();
    if t0.starts_with("<![if") || t0.starts_with("<![endif") {
        return;
    }

    let preserve_space = ctx.pre_depth > 0;
    let mut text = if preserve_space {
        raw.replace("\r\n", "\n").replace('\r', "\n")
    } else {
        collapse_ws(&raw.replace("\r\n", "\n").replace('\r', "\n").replace('\n', " "))
    };

    if !preserve_space && current.segments.is_empty() {
        text = text.trim_start().to_string();
    }

    let style = RunStyle {
        bold: ctx.bold_depth > 0,
        italic: ctx.italic_depth > 0,
        code: (ctx.code_depth > 0) || (ctx.pre_depth > 0),
    };

    let push_text = |s: String, current: &mut Paragraph| {
        if let Some(href) = ctx.current_href() {
            current.segments.push(Segment::LinkText {
                text: s,
                style,
                href: href.to_string(),
            });
        } else {
            current.segments.push(Segment::Text { text: s, style });
        }
    };

    if preserve_space && text.contains('\n') {
        let mut first = true;
        for line in text.split('\n') {
            if !first {
                current.segments.push(Segment::Break);
            }
            first = false;
            if !line.is_empty() {
                push_text(line.to_string(), current);
            }
        }
        return;
    }

    if !text.is_empty() {
        push_text(text, current);
    }
}

fn parse_table(node: &Handle) -> Table {
    fn find_children(node: &Handle, name: &str, out: &mut Vec<Handle>) {
        if let Some(tag) = tag_lower(node) {
            if tag == name {
                out.push(node.clone());
            }
        }
        for c in node.children.borrow().iter() {
            find_children(c, name, out);
        }
    }

    let mut trs: Vec<Handle> = Vec::new();
    find_children(node, "tr", &mut trs);

    let mut rows: Vec<TableRow> = Vec::new();
    for tr in trs {
        let mut cells: Vec<TableCell> = Vec::new();
        for c in tr.children.borrow().iter() {
            let Some(tag) = tag_lower(c) else { continue };
            if tag != "td" && tag != "th" {
                continue;
            }
            let mut cell_blocks = build_blocks_from_nodes(&c.children.borrow().clone(), false);
            let mut paras: Vec<Paragraph> = Vec::new();
            for b in cell_blocks.drain(..) {
                if let Block::Paragraph(p) = b {
                    paras.push(p);
                }
            }
            if paras.is_empty() {
                paras.push(Paragraph {
                    style: ParagraphStyle::Normal,
                    list: None,
                    segments: Vec::new(),
                });
            }
            cells.push(TableCell { paragraphs: paras });
        }
        if !cells.is_empty() {
            rows.push(TableRow { cells });
        }
    }

    Table { rows }
}

fn build_blocks_from_nodes(nodes: &[Handle], allow_tables: bool) -> Vec<Block> {
    let mut blocks: Vec<Block> = Vec::new();
    let mut current = Paragraph {
        style: ParagraphStyle::Normal,
        list: None,
        segments: Vec::new(),
    };
    let mut ctx = BuildCtx::new();

    fn walk(
        node: &Handle,
        allow_tables: bool,
        ctx: &mut BuildCtx,
        blocks: &mut Vec<Block>,
        current: &mut Paragraph,
    ) {
        match &node.data {
            NodeData::Text { contents } => {
                let s = contents.borrow().to_string();
                emit_text(current, ctx, &s);
            }
            NodeData::Comment { contents } => {
                if let Some(omml) = comment_extract_ms_equation_omml(&contents.to_string()) {
                    current.segments.push(Segment::Omml(omml));
                }
            }
            NodeData::Element { .. } => {
                let Some(tag) = tag_lower(node) else { return };
                let attrs = attrs_vec(node);

                if allow_tables && tag == "table" {
                    flush_paragraph(blocks, current);
                    blocks.push(Block::Table(parse_table(node)));
                    return;
                }

                if tag == "math" || tag == "annotation" {
                    return;
                }

                match tag.as_str() {
                    "h1" => start_paragraph(blocks, current, ParagraphStyle::Heading1, ctx.current_list()),
                    "h2" | "h3" => start_paragraph(blocks, current, ParagraphStyle::Heading2, ctx.current_list()),
                    "pre" => {
                        ctx.pre_depth += 1;
                        start_paragraph(blocks, current, ParagraphStyle::CodeBlock, ctx.current_list());
                    }
                    "p" | "div" | "user-query-content" | "message-content" => {
                        start_paragraph(blocks, current, ParagraphStyle::Normal, ctx.current_list());
                    }
                    "br" => current.segments.push(Segment::Break),
                    "hr" => flush_paragraph(blocks, current),
                    "ul" => ctx.list_stack.push(1),
                    "ol" => ctx.list_stack.push(2),
                    "li" => {
                        let num_id = ctx.list_stack.last().cloned().unwrap_or(1);
                        let ilvl = ctx.list_stack.len().saturating_sub(1) as u32;
                        ctx.li_list_stack.push(Some(ListInfo { num_id, ilvl }));
                        start_paragraph(blocks, current, ParagraphStyle::Normal, ctx.current_list());
                    }
                    "a" => {
                        let href = attr_get(&attrs, "href").and_then(|h| sanitize_href(&h));
                        ctx.link_stack.push(href);
                    }
                    "code" => ctx.code_depth += 1,
                    "b" | "strong" => ctx.bold_depth += 1,
                    "i" | "em" => ctx.italic_depth += 1,
                    _ => {}
                }

                for c in node.children.borrow().iter() {
                    walk(c, allow_tables, ctx, blocks, current);
                }

                match tag.as_str() {
                    "h1" | "h2" | "h3" => flush_paragraph(blocks, current),
                    "p" | "div" | "user-query-content" | "message-content" => flush_paragraph(blocks, current),
                    "pre" => {
                        flush_paragraph(blocks, current);
                        ctx.pre_depth = ctx.pre_depth.saturating_sub(1);
                    }
                    "ul" | "ol" => {
                        let _ = ctx.list_stack.pop();
                    }
                    "li" => {
                        flush_paragraph(blocks, current);
                        let _ = ctx.li_list_stack.pop();
                    }
                    "a" => {
                        let _ = ctx.link_stack.pop();
                    }
                    "code" => ctx.code_depth = ctx.code_depth.saturating_sub(1),
                    "b" | "strong" => ctx.bold_depth = ctx.bold_depth.saturating_sub(1),
                    "i" | "em" => ctx.italic_depth = ctx.italic_depth.saturating_sub(1),
                    _ => {}
                }
            }
            _ => {}
        }
    }

    for n in nodes {
        walk(n, allow_tables, &mut ctx, &mut blocks, &mut current);
    }
    flush_paragraph(&mut blocks, &mut current);
    blocks
}

fn build_blocks_from_html(input_html: &str) -> Vec<Block> {
    let wrapped = if input_html.to_ascii_lowercase().contains("<html") {
        input_html.to_string()
    } else {
        format!(
            "<!doctype html><html><head><meta charset=\"utf-8\"></head><body>{}</body></html>",
            input_html
        )
    };

    let dom = html5_parse(&wrapped);
    let mut body_children: Vec<Handle> = Vec::new();
    fn walk_find_body(node: &Handle, out: &mut Vec<Handle>) -> bool {
        if let NodeData::Element { name, .. } = &node.data {
            if name.local.to_string().eq_ignore_ascii_case("body") {
                out.extend(node.children.borrow().iter().cloned());
                return true;
            }
        }
        for c in node.children.borrow().iter() {
            if walk_find_body(c, out) {
                return true;
            }
        }
        false
    }
    if !walk_find_body(&dom.document, &mut body_children) {
        body_children = dom.document.children.borrow().iter().cloned().collect();
    }
    build_blocks_from_nodes(&body_children, true)
}

fn hyperlink_run_xml(text: &str, style: RunStyle) -> String {
    if text.is_empty() {
        return String::new();
    }
    let escaped = xml_escape_text(text);
    let mut out = String::new();
    out.push_str("<w:r><w:rPr>");
    if style.bold {
        out.push_str("<w:b/>");
    }
    if style.italic {
        out.push_str("<w:i/>");
    }
    if style.code {
        out.push_str("<w:rFonts w:ascii=\"Consolas\" w:hAnsi=\"Consolas\" w:cs=\"Consolas\"/>");
    }
    out.push_str("</w:rPr>");
    out.push_str("<w:t xml:space=\"preserve\">");
    out.push_str(&escaped);
    out.push_str("</w:t></w:r>");
    out
}

fn run_xml(text: &str, style: RunStyle) -> String {
    if text.is_empty() {
        return String::new();
    }
    let escaped = xml_escape_text(text);
    let mut out = String::new();
    out.push_str("<w:r>");
    if style.bold || style.italic || style.code {
        out.push_str("<w:rPr>");
        if style.bold {
            out.push_str("<w:b/>");
        }
        if style.italic {
            out.push_str("<w:i/>");
        }
        if style.code {
            out.push_str("<w:rFonts w:ascii=\"Consolas\" w:hAnsi=\"Consolas\" w:cs=\"Consolas\"/>");
        }
        out.push_str("</w:rPr>");
    }
    out.push_str("<w:t xml:space=\"preserve\">");
    out.push_str(&escaped);
    out.push_str("</w:t></w:r>");
    out
}

fn paragraph_xml(p: &Paragraph, link_to_rid: &BTreeMap<String, String>) -> String {
    let mut out = String::new();
    out.push_str("<w:p>");

    if p.style != ParagraphStyle::Normal || p.list.is_some() {
        out.push_str("<w:pPr>");
        match p.style {
            ParagraphStyle::Normal => {}
            ParagraphStyle::Heading1 => out.push_str("<w:pStyle w:val=\"Heading1\"/>"),
            ParagraphStyle::Heading2 => out.push_str("<w:pStyle w:val=\"Heading2\"/>"),
            ParagraphStyle::CodeBlock => out.push_str("<w:pStyle w:val=\"CodeBlock\"/>"),
        }
        if let Some(li) = p.list {
            out.push_str("<w:numPr>");
            out.push_str(&format!("<w:ilvl w:val=\"{}\"/>", li.ilvl));
            out.push_str(&format!("<w:numId w:val=\"{}\"/>", li.num_id));
            out.push_str("</w:numPr>");
        }
        out.push_str("</w:pPr>");
    }

    let mut in_link: Option<(String, RunStyle, String)> = None;
    let flush_link =
        |out: &mut String, st: &mut Option<(String, RunStyle, String)>| {
            if let Some((buf, style, href)) = st.take() {
                if buf.is_empty() {
                    return;
                }
                if let Some(rid) = link_to_rid.get(&href) {
                    out.push_str(&format!(
                        "<w:hyperlink r:id=\"{}\" w:history=\"1\">",
                        rid
                    ));
                    out.push_str(&hyperlink_run_xml(&buf, style));
                    out.push_str("</w:hyperlink>");
                } else {
                    out.push_str(&run_xml(&buf, style));
                }
            }
        };

    for seg in &p.segments {
        match seg {
            Segment::Break => {
                flush_link(&mut out, &mut in_link);
                out.push_str("<w:r><w:br/></w:r>");
            }
            Segment::Omml(xml) => {
                flush_link(&mut out, &mut in_link);
                out.push_str(xml);
            }
            Segment::Text { text, style } => {
                flush_link(&mut out, &mut in_link);
                out.push_str(&run_xml(text, *style));
            }
            Segment::LinkText { text, style, href } => match &mut in_link {
                Some((buf, cur_style, cur_href))
                    if cur_href == href && *cur_style == *style =>
                {
                    buf.push_str(text);
                }
                _ => {
                    flush_link(&mut out, &mut in_link);
                    in_link = Some((text.clone(), *style, href.clone()));
                }
            },
        }
    }
    flush_link(&mut out, &mut in_link);

    out.push_str("</w:p>");
    out
}

fn table_xml(t: &Table, link_to_rid: &BTreeMap<String, String>) -> String {
    let mut out = String::new();
    out.push_str("<w:tbl>");
    out.push_str("<w:tblPr>");
    out.push_str("<w:tblW w:w=\"0\" w:type=\"auto\"/>");
    out.push_str(
        r#"<w:tblBorders>
<w:top w:val="single" w:sz="4" w:space="0" w:color="D9D9D9"/>
<w:left w:val="single" w:sz="4" w:space="0" w:color="D9D9D9"/>
<w:bottom w:val="single" w:sz="4" w:space="0" w:color="D9D9D9"/>
<w:right w:val="single" w:sz="4" w:space="0" w:color="D9D9D9"/>
<w:insideH w:val="single" w:sz="4" w:space="0" w:color="D9D9D9"/>
<w:insideV w:val="single" w:sz="4" w:space="0" w:color="D9D9D9"/>
</w:tblBorders>"#,
    );
    out.push_str("</w:tblPr>");

    for row in &t.rows {
        out.push_str("<w:tr>");
        for cell in &row.cells {
            out.push_str("<w:tc>");
            out.push_str("<w:tcPr><w:tcW w:w=\"0\" w:type=\"auto\"/></w:tcPr>");
            for p in &cell.paragraphs {
                out.push_str(&paragraph_xml(p, link_to_rid));
            }
            out.push_str("</w:tc>");
        }
        out.push_str("</w:tr>");
    }

    out.push_str("</w:tbl>");
    out
}

fn document_xml(blocks: &[Block], link_to_rid: &BTreeMap<String, String>) -> String {
    let mut body = String::new();
    for b in blocks {
        match b {
            Block::Paragraph(p) => body.push_str(&paragraph_xml(p, link_to_rid)),
            Block::Table(t) => body.push_str(&table_xml(t, link_to_rid)),
        }
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
</w:document>"#,
        body = body
    )
}

fn content_types_xml(has_numbering: bool) -> String {
    let mut out = String::new();
    out.push_str(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>"#);
    out.push('\n');
    out.push_str(r#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">"#);
    out.push('\n');
    out.push_str(
        r#"  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>"#,
    );
    out.push('\n');
    out.push_str(r#"  <Default Extension="xml" ContentType="application/xml"/>"#);
    out.push('\n');
    out.push_str(r#"  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>"#);
    out.push('\n');
    out.push_str(r#"  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>"#);
    out.push('\n');
    if has_numbering {
        out.push_str(r#"  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>"#);
        out.push('\n');
    }
    out.push_str("</Types>");
    out
}

fn rels_xml() -> &'static str {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"#
}

fn document_rels_xml(link_to_rid: &BTreeMap<String, String>) -> String {
    let mut out = String::new();
    out.push_str(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>"#);
    out.push('\n');
    out.push_str(r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">"#);
    out.push('\n');
    for (href, rid) in link_to_rid {
        out.push_str(&format!(
            r#"  <Relationship Id="{rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="{href}" TargetMode="External"/>"#,
            rid = rid,
            href = xml_escape_text(href),
        ));
        out.push('\n');
    }
    out.push_str("</Relationships>");
    out
}

fn styles_xml() -> &'static str {
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
      <w:keepNext/>
      <w:spacing w:before="360" w:after="120"/>
      <w:outlineLvl w:val="0"/>
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
      <w:keepNext/>
      <w:spacing w:before="240" w:after="120"/>
      <w:outlineLvl w:val="1"/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:sz w:val="28"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="CodeBlock">
    <w:name w:val="Code Block"/>
    <w:basedOn w:val="Normal"/>
    <w:uiPriority w:val="99"/>
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

fn numbering_xml() -> &'static str {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="1">
    <w:multiLevelType w:val="hybridMultilevel"/>
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/></w:lvl>
    <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/></w:lvl>
    <w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/></w:lvl>
    <w:lvl w:ilvl="3"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/></w:lvl>
    <w:lvl w:ilvl="4"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/></w:lvl>
    <w:lvl w:ilvl="5"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/></w:lvl>
    <w:lvl w:ilvl="6"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/></w:lvl>
    <w:lvl w:ilvl="7"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/></w:lvl>
    <w:lvl w:ilvl="8"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/></w:lvl>
  </w:abstractNum>
  <w:abstractNum w:abstractNumId="2">
    <w:multiLevelType w:val="hybridMultilevel"/>
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/></w:lvl>
    <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%2."/><w:lvlJc w:val="left"/></w:lvl>
    <w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%3."/><w:lvlJc w:val="left"/></w:lvl>
    <w:lvl w:ilvl="3"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%4."/><w:lvlJc w:val="left"/></w:lvl>
    <w:lvl w:ilvl="4"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%5."/><w:lvlJc w:val="left"/></w:lvl>
    <w:lvl w:ilvl="5"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%6."/><w:lvlJc w:val="left"/></w:lvl>
    <w:lvl w:ilvl="6"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%7."/><w:lvlJc w:val="left"/></w:lvl>
    <w:lvl w:ilvl="7"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%8."/><w:lvlJc w:val="left"/></w:lvl>
    <w:lvl w:ilvl="8"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%9."/><w:lvlJc w:val="left"/></w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num>
</w:numbering>"#
}

fn gather_hrefs(blocks: &[Block]) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    for b in blocks {
        match b {
            Block::Paragraph(p) => {
                for s in &p.segments {
                    if let Segment::LinkText { href, .. } = s {
                        out.insert(href.to_string());
                    }
                }
            }
            Block::Table(t) => {
                for row in &t.rows {
                    for cell in &row.cells {
                        for p in &cell.paragraphs {
                            for s in &p.segments {
                                if let Segment::LinkText { href, .. } = s {
                                    out.insert(href.to_string());
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    out
}

fn blocks_need_numbering(blocks: &[Block]) -> bool {
    for b in blocks {
        match b {
            Block::Paragraph(p) => {
                if p.list.is_some() {
                    return true;
                }
            }
            Block::Table(t) => {
                for row in &t.rows {
                    for cell in &row.cells {
                        for p in &cell.paragraphs {
                            if p.list.is_some() {
                                return true;
                            }
                        }
                    }
                }
            }
        }
    }
    false
}

fn write_docx(
    out_path: &PathBuf,
    document_xml: &str,
    doc_rels_xml: &str,
    has_numbering: bool,
) -> Result<()> {
    let f = File::create(out_path).with_context(|| format!("create {}", out_path.display()))?;
    let mut zip = ZipWriter::new(f);
    let opts = SimpleFileOptions::default();

    zip.start_file("[Content_Types].xml", opts)?;
    zip.write_all(content_types_xml(has_numbering).as_bytes())?;

    zip.start_file("_rels/.rels", opts)?;
    zip.write_all(rels_xml().as_bytes())?;

    zip.start_file("word/document.xml", opts)?;
    zip.write_all(document_xml.as_bytes())?;

    zip.start_file("word/styles.xml", opts)?;
    zip.write_all(styles_xml().as_bytes())?;

    if has_numbering {
        zip.start_file("word/numbering.xml", opts)?;
        zip.write_all(numbering_xml().as_bytes())?;
    }

    zip.start_file("word/_rels/document.xml.rels", opts)?;
    zip.write_all(doc_rels_xml.as_bytes())?;

    zip.finish()?;
    Ok(())
}

fn main() -> Result<()> {
    let args = Args::parse();

    let mut html = String::new();
    File::open(&args.html_file)
        .with_context(|| format!("open {}", args.html_file.display()))?
        .read_to_string(&mut html)
        .with_context(|| format!("read {}", args.html_file.display()))?;

    if html.trim().is_empty() {
        return Err(anyhow!("empty html"));
    }

    let blocks = build_blocks_from_html(&html);

    let hrefs = gather_hrefs(&blocks);
    let mut link_to_rid = BTreeMap::new();
    let mut rid_counter: u32 = 10;
    for href in hrefs {
        link_to_rid.insert(href, format!("rId{}", rid_counter));
        rid_counter += 1;
    }

    let doc_xml = document_xml(&blocks, &link_to_rid);
    let doc_rels = document_rels_xml(&link_to_rid);
    let has_numbering = blocks_need_numbering(&blocks);

    write_docx(&args.out, &doc_xml, &doc_rels, has_numbering)?;
    Ok(())
}
