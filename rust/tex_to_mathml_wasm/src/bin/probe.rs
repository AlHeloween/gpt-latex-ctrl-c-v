use latex2mathml::{latex_to_mathml, DisplayStyle};
use std::env;

fn main() {
    let mut args = env::args().skip(1).collect::<Vec<_>>();
    if args.is_empty() {
        eprintln!("usage: probe [--display] <latex>");
        std::process::exit(2);
    }

    let display = if args.get(0).map(|s| s.as_str()) == Some("--display") {
        args.remove(0);
        true
    } else {
        false
    };

    if args.is_empty() {
        eprintln!("usage: probe [--display] <latex>");
        std::process::exit(2);
    }

    let latex = args.join(" ");
    let style = if display {
        DisplayStyle::Block
    } else {
        DisplayStyle::Inline
    };
    match latex_to_mathml(&latex, style) {
        Ok(m) => {
            println!("{m}");
        }
        Err(e) => {
            eprintln!("parse error: {e}");
            std::process::exit(1);
        }
    }
}
