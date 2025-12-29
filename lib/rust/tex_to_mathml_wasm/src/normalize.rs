pub fn normalize_latex(latex: &str) -> String {
    let mut s = String::from(latex);
    // Remove zero-width characters that often sneak into copied math identifiers.
    s.retain(|c| {
        !matches!(
            c,
            '\u{200B}' | '\u{200C}' | '\u{200D}' | '\u{2060}' | '\u{FEFF}'
        )
    });
    // Double-vertical bar (norm). Convert to plain bars to avoid unknown tokens.
    s = s.replace('\u{2016}', "||");
    // PUA glyph sometimes used for "not equals".
    s = s.replace('\u{E020}', "\\neq");
    // Normalize a few common Unicode math symbols into LaTeX commands.
    s = s
        .replace('\u{2297}', "\\otimes") // ⊗
        .replace('\u{03F5}', "\\epsilon") // ϵ
        .replace('\u{03D5}', "\\phi") // ϕ
        .replace('\u{2192}', "\\to") // →
        .replace('\u{2260}', "\\neq") // ≠
        .replace('\u{27E8}', "\\langle") // ⟨
        .replace('\u{27E9}', "\\rangle"); // ⟩
    s
}
