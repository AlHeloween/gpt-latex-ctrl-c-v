use latex2mathml::{latex_to_mathml, DisplayStyle};

fn strip_parse_error_mtext(mathml: &str) -> String {
    // latex2mathml sometimes emits: <mtext>[PARSE ERROR: ...]</mtext> but still produces
    // useful MathML for the remaining tokens (e.g. unsupported style commands like \mathcal).
    // We strip these marker nodes to avoid leaking error text into Office/Word while keeping
    // the best-effort structure.
    let mut out = mathml.to_string();
    let start_pat = "<mtext>[PARSE ERROR:";
    let end_pat = "</mtext>";
    loop {
        let Some(s) = out.find(start_pat) else {
            break;
        };
        let Some(e_rel) = out[s..].find(end_pat) else {
            break;
        };
        let e = s + e_rel + end_pat.len();
        out.replace_range(s..e, "");
    }
    out
}

pub fn tex_to_mathml(latex: &str, display: bool) -> Result<String, String> {
    let style = if display {
        DisplayStyle::Block
    } else {
        DisplayStyle::Inline
    };

    match latex_to_mathml(latex, style) {
        Ok(mathml) => {
            let cleaned = strip_parse_error_mtext(&mathml);
            if cleaned.contains("[PARSE ERROR:") {
                return Err("parse error: unsupported LaTeX command or token".to_string());
            }
            Ok(cleaned)
        }
        Err(e) => Err(format!("{}", e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_mathcal_parse_error_marker_but_keeps_content() {
        // latex2mathml does not support \mathcal, but it still emits useful MathML for the rest.
        let out = tex_to_mathml("\\mathcal{Z}_{ij}", false).unwrap();
        assert!(!out.contains("[PARSE ERROR:"), "must not leak parse error marker");
        assert!(out.contains("<msub>"), "must keep the remaining structure");
        assert!(out.contains("<mi>Z</mi>"), "must keep the identifier");
    }
}
