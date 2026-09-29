//! Every .alex file in this repository, and in mochi when it is checked out beside it, parses and writes back out
//! byte for byte, in both modes. Whether the tree matches the C# Alex's is `cardengine/conformance`'s question.

use std::fs;
use std::path::{Path, PathBuf};

use tcg_engine::alex::parser::{self, ParseMode};
use tcg_engine::alex::writer;

#[test]
fn every_alex_file_round_trips() {
    let files = corpus();
    assert!(files.len() > 20, "found only {} .alex files", files.len());

    let mut different: Vec<String> = Vec::new();
    for file in &files {
        let source = fs::read(file).unwrap();
        for mode in [ParseMode::Program, ParseMode::Data] {
            let tree = parser::parse(&source, mode);
            let mut written: Vec<u8> = Vec::new();
            writer::write(&tree.root, &source, &mut written);
            if written != source {
                different.push(format!("{} ({:?})", file.display(), mode));
            }
        }
    }

    assert!(different.is_empty(), "these do not write back out unchanged:\n{}", different.join("\n"));
}

#[test]
fn broken_input_never_panics_and_still_round_trips() {
    let inputs: [&[u8]; 12] = [
        b"",
        b"@",
        b"@@@",
        b"x = ",
        b"type T { a: [K: } ",
        b"effect e { if a { } else if b { } }",
        b"x = [a = 1, 2, b]\n#type Game",
        b"\xEF\xBB\xBFx = 'unclosed\r\ny = \"no\"",
        b"scenario 'S' {\n given a b\n then c(,\n}",
        b"x = Game { A = 1, b = { } }",
        b"#type\n#type game\n#type A B\n",
        b"\xFF\xFE x = 1\r",
    ];
    for input in inputs {
        for mode in [ParseMode::Program, ParseMode::Data] {
            let tree = parser::parse(input, mode);
            let mut written: Vec<u8> = Vec::new();
            writer::write(&tree.root, input, &mut written);
            assert_eq!(written, input, "{:?}", String::from_utf8_lossy(input));
        }
    }
}

fn corpus() -> Vec<PathBuf> {
    let fruitcats = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let mut files: Vec<PathBuf> = Vec::new();
    collect(&fruitcats, &mut files);
    let mochi = fruitcats.join("../mochi");
    if mochi.is_dir() {
        collect(&mochi, &mut files);
    }
    files
}

fn collect(directory: &Path, files: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(directory) else { return };
    for entry in entries {
        let path = entry.unwrap().path();
        let name = path.file_name().unwrap().to_string_lossy().into_owned();
        if path.is_dir() {
            if name != "node_modules" && name != "target" && name != "bin" && name != "obj" && !name.starts_with('.') {
                collect(&path, files);
            }
        } else if name.ends_with(".alex") {
            files.push(path);
        }
    }
}
