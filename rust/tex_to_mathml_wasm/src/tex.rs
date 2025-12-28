use latex2mathml::{latex_to_mathml, DisplayStyle};

pub fn tex_to_mathml(latex: &str, display: bool) -> Result<String, String> {
    let style = if display {
        DisplayStyle::Block
    } else {
        DisplayStyle::Inline
    };

    match latex_to_mathml(latex, style) {
        Ok(mathml) => {
            if mathml.contains("[PARSE ERROR:") {
                return Err("parse error: unsupported LaTeX command or token".to_string());
            }
            Ok(mathml)
        }
        Err(e) => Err(format!("{}", e)),
    }
}
