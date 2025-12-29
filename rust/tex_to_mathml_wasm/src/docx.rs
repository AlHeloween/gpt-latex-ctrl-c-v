use markup5ever_rcdom::{Handle, NodeData, RcDom};
use html5ever::parse_document;
use html5ever::tendril::TendrilSink;
use zip::write::{FileOptions, ZipWriter};
use zip::CompressionMethod;
use std::io::{Cursor, Write};

// Word XML namespaces
const NS_W: &str = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const NS_R: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_M: &str = "http://schemas.openxmlformats.org/officeDocument/2006/math";
const NS_CT: &str = "http://schemas.openxmlformats.org/package/2006/content-types";
const NS_RELS: &str = "http://schemas.openxmlformats.org/package/2006/relationships";

fn escape_xml_text_simple(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

pub fn generate_content_types_xml() -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="{}">
    <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
    <Default Extension="xml" ContentType="application/xml"/>
    <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>"#,
        NS_CT
    )
}

pub fn generate_rels_xml() -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="{}">
    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"#,
        NS_RELS
    )
}

pub fn generate_document_rels_xml() -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="{}">
</Relationships>"#,
        NS_RELS
    )
}

fn extract_omml_from_html(html: &str) -> Vec<String> {
    // Extract OMML from conditional comments like <!--[if gte msEquation 12]><m:oMath>...</m:oMath><![endif]-->
    // Or from <!--[if mso]><m:oMath>...</m:oMath><![endif]-->
    let mut omml_chunks = Vec::new();
    let mut i = 0;
    
    while i < html.len() {
        // Look for <!--[if gte msEquation 12]> or <!--[if mso]>
        let pattern1 = "<!--[if gte msEquation 12]>";
        let pattern2 = "<!--[if mso]>";
        
        let pos1 = html[i..].find(pattern1);
        let pos2 = html[i..].find(pattern2);
        
        let (pattern, pos_opt) = match (pos1, pos2) {
            (Some(p1), Some(p2)) => {
                if p1 < p2 {
                    (pattern1, Some(p1))
                } else {
                    (pattern2, Some(p2))
                }
            }
            (Some(p), None) => (pattern1, Some(p)),
            (None, Some(p)) => (pattern2, Some(p)),
            (None, None) => break,
        };
        
        if let Some(comment_start) = pos_opt {
            let start_pos = i + comment_start;
            let after_comment = start_pos + pattern.len();
            
            // Look for <![endif]--> to find the end of the conditional
            if let Some(end_comment) = html[after_comment..].find("<![endif]-->") {
                let omml_content = html[after_comment..after_comment + end_comment].trim();
                
                // Extract OMML - should start with <m:oMath> or <oMath
                if omml_content.starts_with("<m:oMath") || omml_content.starts_with("<oMath") {
                    omml_chunks.push(omml_content.to_string());
                }
                
                i = after_comment + end_comment + "<![endif]-->".len();
            } else {
                i = after_comment;
            }
        } else {
            break;
        }
    }
    
    omml_chunks
}

fn html_to_word_xml(html: &str) -> Result<String, String> {
    // Parse HTML
    let dom = parse_document(RcDom::default(), Default::default()).one(html);
    
    // Extract OMML chunks
    let omml_chunks = extract_omml_from_html(html);
    
    // Build Word XML document - for now, use a simple approach
    // TODO: Integrate OMML chunks properly during node processing
    let mut doc_xml = String::new();
    doc_xml.push_str(&format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="{}" xmlns:m="{}" xmlns:r="{}">
<w:body>
"#,
        NS_W, NS_M, NS_R
    ));
    
    // Process body children - convert HTML to Word XML
    let body_children = if let Some(body) = find_body(&dom.document) {
        body.children.borrow().clone()
    } else {
        dom.document.children.borrow().clone()
    };
    
    for child in body_children {
        process_node(&child, &mut doc_xml, &omml_chunks)?;
    }
    
    doc_xml.push_str("</w:body></w:document>");
    
    Ok(doc_xml)
}

fn find_body(node: &Handle) -> Option<Handle> {
    if let NodeData::Element { name, .. } = &node.data {
        if name.local.to_string().eq_ignore_ascii_case("body") {
            return Some(node.clone());
        }
    }
    for child in node.children.borrow().iter() {
        if let Some(body) = find_body(child) {
            return Some(body);
        }
    }
    None
}

fn process_node(node: &Handle, output: &mut String, omml_chunks: &[String]) -> Result<(), String> {
    match &node.data {
        NodeData::Text { contents } => {
            let text = contents.borrow().to_string();
            if !text.trim().is_empty() {
                output.push_str("<w:p><w:r><w:t xml:space=\"preserve\">");
                output.push_str(&escape_xml_text_simple(&text));
                output.push_str("</w:t></w:r></w:p>");
            }
        }
        NodeData::Element { name, .. } => {
            let tag = name.local.to_string().to_ascii_lowercase();
            match tag.as_str() {
                "p" | "div" => {
                    output.push_str("<w:p>");
                    for child in node.children.borrow().iter() {
                        process_run_node(child, output, omml_chunks)?;
                    }
                    output.push_str("</w:p>");
                }
                "strong" | "b" => {
                    output.push_str("<w:r><w:rPr><w:b/></w:rPr>");
                    for child in node.children.borrow().iter() {
                        process_run_node(child, output, omml_chunks)?;
                    }
                    output.push_str("</w:r>");
                }
                "em" | "i" => {
                    output.push_str("<w:r><w:rPr><w:i/></w:rPr>");
                    for child in node.children.borrow().iter() {
                        process_run_node(child, output, omml_chunks)?;
                    }
                    output.push_str("</w:r>");
                }
                "br" => {
                    output.push_str("<w:p><w:r><w:br/></w:r></w:p>");
                }
                "ul" | "ol" => {
                    for child in node.children.borrow().iter() {
                        if let NodeData::Element { name, .. } = &child.data {
                            if name.local.to_string().eq_ignore_ascii_case("li") {
                                output.push_str("<w:p><w:pPr><w:numPr><w:ilvl w:val=\"0\"/><w:numId w:val=\"1\"/></w:numPr></w:pPr>");
                                for grandchild in child.children.borrow().iter() {
                                    process_run_node(grandchild, output, omml_chunks)?;
                                }
                                output.push_str("</w:p>");
                            }
                        }
                    }
                }
                "a" => {
                    // Extract href attribute
                    let mut href = String::new();
                    if let NodeData::Element { attrs, .. } = &node.data {
                        for attr in attrs.borrow().iter() {
                            if attr.name.local.to_string().eq_ignore_ascii_case("href") {
                                href = attr.value.to_string();
                                break;
                            }
                        }
                    }
                    if !href.is_empty() {
                        output.push_str(&format!("<w:hyperlink r:id=\"rId1\"><w:r><w:rPr><w:color w:val=\"1155CC\"/><w:u w:val=\"single\"/></w:rPr><w:t>"));
                    } else {
                        output.push_str("<w:r><w:t>");
                    }
                    for child in node.children.borrow().iter() {
                        process_run_node(child, output, omml_chunks)?;
                    }
                    if !href.is_empty() {
                        output.push_str("</w:t></w:r></w:hyperlink>");
                    } else {
                        output.push_str("</w:t></w:r>");
                    }
                }
                _ => {
                    // Default: process children
                    for child in node.children.borrow().iter() {
                        process_node(child, output, omml_chunks)?;
                    }
                }
            }
        }
        _ => {}
    }
    Ok(())
}

fn process_run_node(node: &Handle, output: &mut String, omml_chunks: &[String]) -> Result<(), String> {
    match &node.data {
        NodeData::Text { contents } => {
            let text = contents.borrow().to_string();
            output.push_str(&escape_xml_text_simple(&text));
        }
        NodeData::Element { name, .. } => {
            let tag = name.local.to_string().to_ascii_lowercase();
            match tag.as_str() {
                "strong" | "b" => {
                    output.push_str("<w:r><w:rPr><w:b/></w:rPr><w:t>");
                    for child in node.children.borrow().iter() {
                        process_run_node(child, output, omml_chunks)?;
                    }
                    output.push_str("</w:t></w:r>");
                }
                "em" | "i" => {
                    output.push_str("<w:r><w:rPr><w:i/></w:rPr><w:t>");
                    for child in node.children.borrow().iter() {
                        process_run_node(child, output, omml_chunks)?;
                    }
                    output.push_str("</w:t></w:r>");
                }
                _ => {
                    for child in node.children.borrow().iter() {
                        process_run_node(child, output, omml_chunks)?;
                    }
                }
            }
        }
        NodeData::Comment { .. } => {
            // Skip comments for now - OMML is extracted separately
        }
        _ => {}
    }
    Ok(())
}

pub fn html_with_omml_to_docx(html: &str) -> Result<Vec<u8>, String> {
    // Generate Word XML document
    let doc_xml = html_to_word_xml(html)?;
    
    // Create ZIP archive
    let mut zip_buf = Vec::new();
    {
        let mut zip = ZipWriter::new(Cursor::new(&mut zip_buf));
        let options = FileOptions::default().compression_method(CompressionMethod::Deflated);
        
        // Add [Content_Types].xml
        zip.start_file("[Content_Types].xml", options).map_err(|e| format!("ZIP error: {}", e))?;
        zip.write_all(generate_content_types_xml().as_bytes()).map_err(|e| format!("Write error: {}", e))?;
        
        // Add _rels/.rels
        zip.start_file("_rels/.rels", options).map_err(|e| format!("ZIP error: {}", e))?;
        zip.write_all(generate_rels_xml().as_bytes()).map_err(|e| format!("Write error: {}", e))?;
        
        // Add word/document.xml
        zip.start_file("word/document.xml", options).map_err(|e| format!("ZIP error: {}", e))?;
        zip.write_all(doc_xml.as_bytes()).map_err(|e| format!("Write error: {}", e))?;
        
        // Add word/_rels/document.xml.rels
        zip.start_file("word/_rels/document.xml.rels", options).map_err(|e| format!("ZIP error: {}", e))?;
        zip.write_all(generate_document_rels_xml().as_bytes()).map_err(|e| format!("Write error: {}", e))?;
        
        zip.finish().map_err(|e| format!("ZIP finish error: {}", e))?;
    }
    
    Ok(zip_buf)
}

