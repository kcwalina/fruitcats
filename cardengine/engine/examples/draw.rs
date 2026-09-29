//! Writes the draw list of every face of a game's cards, as `kardix cards` names its files:
//! `cargo run --release --example draw -- <folder> <out> [--set <name>] [frame=<name>] [no-art]` writes
//! `<out>/<set>/[<finish>/]<file>.txt`. A font the card layout names that isn't in the folder is read from the system's
//! fonts, as kardix does.

use std::fs;
use std::path::{Path, PathBuf};

use kardix::loader::project::{self, ProjectFile};
use kardix::loader::queries;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let root = PathBuf::from(args.get(1).map(String::as_str).unwrap_or("."));
    let out = PathBuf::from(args.get(2).map(String::as_str).unwrap_or("out/draw"));
    let mut files = Vec::new();
    collect(&root, &root, &mut files);
    files.sort_by(|a, b| a.path.cmp(&b.path));

    let first = project::load(files.clone());
    let fonts: Vec<String> = parse_strings(&queries::answer(&first, "fonts"));
    for font in fonts {
        let local = root.join(&font);
        let system = Path::new("C:/Windows/Fonts").join(font.rsplit('/').next().unwrap());
        let found = if local.exists() { local } else { system };
        match fs::read(&found) {
            Ok(bytes) => files.push(ProjectFile { path: font, bytes }),
            Err(_) => eprintln!("no font {}", font),
        }
    }
    let loaded = project::load(files);
    let rest: Vec<String> = args.iter().skip(3).cloned().collect();
    let set = rest.iter().position(|a| a == "--set").map(|i| rest[i + 1].clone()).unwrap_or_default();
    let options: Vec<&String> = rest.iter().filter(|a| a.contains('=') || *a == "no-art").collect();
    let options = options.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(" ");
    let faces = queries::answer(&loaded, &format!("faces {}", set));
    let mut written = 0;
    for face in faces.split("},{") {
        let field = |name: &str| -> String {
            let key = format!("\"{}\":\"", name);
            let start = face.find(&key).unwrap() + key.len();
            face[start..start + face[start..].find('"').unwrap()].to_string()
        };
        let (set, card, side, finish, file) = (field("set"), field("card"), field("face"), field("finish"), field("file"));
        let list = queries::answer(&loaded, &format!("draw {} {} {} {} {}", set, card, side, finish, options));
        let mut folder = out.join(&set);
        if finish != "standard" {
            folder = folder.join(&finish);
        }
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join(format!("{}.txt", file)), list).unwrap();
        written += 1;
    }
    println!("Wrote {} draw list(s).", written);
}

fn parse_strings(json: &str) -> Vec<String> {
    json.trim_matches(|c| c == '[' || c == ']').split(',').filter(|s| !s.is_empty()).map(|s| s.trim_matches('"').to_string()).collect()
}

fn collect(root: &Path, at: &Path, files: &mut Vec<ProjectFile>) {
    for entry in fs::read_dir(at).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            collect(root, &path, files);
        } else if path.extension().is_some_and(|e| e == "alex") {
            let relative = path.strip_prefix(root).unwrap().to_string_lossy().replace(std::path::MAIN_SEPARATOR, "/");
            files.push(ProjectFile { path: relative, bytes: fs::read(&path).unwrap() });
        }
    }
}
