// ORBIT desktop shell - build script.
//
// Responsibilities, in order:
//   1. Pick the surface from the ORBIT_SURFACE env var (default "orbit").
//   2. Read desktop/surfaces.json - the single source of truth for all five apps.
//   3. Copy that surface's icon set into icons/active/ so tauri-build stamps the
//      right icon into the .exe resource. (One tauri.conf.json, five icons.)
//   4. Read the surface's HTML payload, extract its window.ORBIT_BUILD stamp
//      WITHOUT modifying the payload, gzip it into OUT_DIR/payload.gz.
//   5. Generate OUT_DIR/surface.rs with the per-surface constants.
//   6. Hand over to tauri_build::build().
//
// Cargo re-runs this script when ORBIT_SURFACE changes or when the payload or
// surfaces.json changes, and a build-script re-run forces the crate to rebuild.
// That is what keeps the exe and its payload in lockstep.

use std::env;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

fn main() {
    println!("cargo:rerun-if-env-changed=ORBIT_SURFACE");
    println!("cargo:rerun-if-env-changed=ORBIT_PAYLOAD_OVERRIDE");
    println!("cargo:rerun-if-env-changed=ORBIT_ALLOW_PLACEHOLDER_PAYLOAD");
    println!("cargo:rerun-if-env-changed=ORBIT_GZIP_LEVEL");

    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let desktop_dir = manifest_dir
        .parent()
        .expect("desktop dir (parent of src-tauri)")
        .to_path_buf();
    let repo_root = desktop_dir
        .parent()
        .expect("repo root (parent of desktop)")
        .to_path_buf();
    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR"));

    // ---- 1 + 2: surface table -------------------------------------------------
    let surfaces_path = desktop_dir.join("surfaces.json");
    println!("cargo:rerun-if-changed={}", surfaces_path.display());
    let raw = fs::read_to_string(&surfaces_path)
        .unwrap_or_else(|e| panic!("ORBIT build: cannot read {}: {}", surfaces_path.display(), e));
    let doc: serde_json::Value = serde_json::from_str(&raw)
        .unwrap_or_else(|e| panic!("ORBIT build: {} is not valid JSON: {}", surfaces_path.display(), e));

    let key = env::var("ORBIT_SURFACE").unwrap_or_else(|_| "orbit".to_string());
    let list = doc["surfaces"]
        .as_array()
        .expect("ORBIT build: surfaces.json must have a \"surfaces\" array");
    let known: Vec<String> = list
        .iter()
        .map(|s| s["key"].as_str().unwrap_or("?").to_string())
        .collect();
    let s = list
        .iter()
        .find(|s| s["key"].as_str() == Some(key.as_str()))
        .unwrap_or_else(|| {
            panic!(
                "ORBIT build: unknown ORBIT_SURFACE '{}'. Known surfaces: {}",
                key,
                known.join(", ")
            )
        });

    let product_name = str_field(s, "productName");
    let title = str_field(s, "title");
    let payload_rel = str_field(s, "payload");
    let version = doc["version"].as_str().unwrap_or("0.0.0").to_string();
    let width = num_field(s, "width");
    let height = num_field(s, "height");
    let min_width = num_field(s, "minWidth");
    let min_height = num_field(s, "minHeight");

    // ---- 3: per-surface icon set ---------------------------------------------
    let icon_src = match s["icon"].as_str() {
        Some(rel) if !rel.trim().is_empty() => repo_root.join(rel),
        _ => manifest_dir.join("icons").join(&key),
    };
    let icon_dst = manifest_dir.join("icons").join("active");
    copy_icons(&icon_src, &icon_dst);

    // ---- 4: payload -----------------------------------------------------------
    let payload_path = match env::var("ORBIT_PAYLOAD_OVERRIDE") {
        Ok(p) if !p.trim().is_empty() => PathBuf::from(p),
        _ => repo_root.join(&payload_rel),
    };
    println!("cargo:rerun-if-changed={}", payload_path.display());

    let allow_placeholder = env::var("ORBIT_ALLOW_PLACEHOLDER_PAYLOAD")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);

    let (bytes, is_placeholder) = match fs::read(&payload_path) {
        Ok(b) => (b, false),
        Err(e) => {
            if allow_placeholder {
                println!(
                    "cargo:warning=ORBIT build: payload {} missing ({}). ORBIT_ALLOW_PLACEHOLDER_PAYLOAD=1 -> embedding a PLACEHOLDER. This exe is NOT shippable.",
                    payload_path.display(),
                    e
                );
                (placeholder_html(&key, &title).into_bytes(), true)
            } else {
                panic!(
                    "ORBIT build: payload not found: {}\n\
                     This surface's HTML is produced by the web-payload lane.\n\
                     Fix one of:\n\
                       - build the payload so it lands at that path, or\n\
                       - set ORBIT_PAYLOAD_OVERRIDE to an existing .html, or\n\
                       - set ORBIT_ALLOW_PLACEHOLDER_PAYLOAD=1 to build a NON-SHIPPABLE shell for smoke testing.\n\
                     Underlying error: {}",
                    payload_path.display(),
                    e
                );
            }
        }
    };

    let raw_len = bytes.len();
    let stamp = extract_stamp(&bytes).unwrap_or_else(|| {
        if is_placeholder {
            format!("PLACEHOLDER-{}", key)
        } else {
            println!(
                "cargo:warning=ORBIT build: no window.ORBIT_BUILD stamp found in {} - the six-artefact stamp guard cannot verify this build.",
                payload_path.display()
            );
            "UNSTAMPED".to_string()
        }
    });

    let level: u32 = env::var("ORBIT_GZIP_LEVEL")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(6);
    let gz_path = out_dir.join("payload.gz");
    let gz_file = fs::File::create(&gz_path)
        .unwrap_or_else(|e| panic!("ORBIT build: cannot create {}: {}", gz_path.display(), e));
    let mut enc = flate2::write::GzEncoder::new(gz_file, flate2::Compression::new(level));
    enc.write_all(&bytes).expect("ORBIT build: gzip write failed");
    enc.finish().expect("ORBIT build: gzip finish failed");
    let gz_len = fs::metadata(&gz_path).map(|m| m.len()).unwrap_or(0);

    println!(
        "cargo:warning=ORBIT build: surface={} product={} stamp={} payload={} raw={} bytes gz={} bytes",
        key, product_name, stamp, payload_rel, raw_len, gz_len
    );

    // ---- 5: generated constants ----------------------------------------------
    let generated = format!(
        "// GENERATED by build.rs - do not edit.\n\
         pub const SURFACE_KEY: &str = {key};\n\
         pub const PRODUCT_NAME: &str = {product};\n\
         pub const APP_TITLE: &str = {title};\n\
         pub const APP_VERSION: &str = {version};\n\
         pub const PAYLOAD_STAMP: &str = {stamp};\n\
         pub const PAYLOAD_SOURCE: &str = {source};\n\
         pub const PAYLOAD_RAW_LEN: usize = {raw_len};\n\
         pub const PAYLOAD_IS_PLACEHOLDER: bool = {placeholder};\n\
         pub const WIN_WIDTH: f64 = {width:.1};\n\
         pub const WIN_HEIGHT: f64 = {height:.1};\n\
         pub const MIN_WIDTH: f64 = {min_width:.1};\n\
         pub const MIN_HEIGHT: f64 = {min_height:.1};\n",
        key = quote(&key),
        product = quote(&product_name),
        title = quote(&title),
        version = quote(&version),
        stamp = quote(&stamp),
        source = quote(&payload_rel),
        raw_len = raw_len,
        placeholder = is_placeholder,
        width = width,
        height = height,
        min_width = min_width,
        min_height = min_height,
    );
    fs::write(out_dir.join("surface.rs"), generated).expect("ORBIT build: cannot write surface.rs");

    // ---- 6 --------------------------------------------------------------------
    tauri_build::build();
}

fn str_field(v: &serde_json::Value, k: &str) -> String {
    v[k].as_str()
        .unwrap_or_else(|| panic!("ORBIT build: surfaces.json entry missing string field '{}'", k))
        .to_string()
}

fn num_field(v: &serde_json::Value, k: &str) -> f64 {
    v[k].as_f64()
        .unwrap_or_else(|| panic!("ORBIT build: surfaces.json entry missing number field '{}'", k))
}

fn quote(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            _ => out.push(c),
        }
    }
    out.push('"');
    out
}

// Find window.ORBIT_BUILD = "<stamp>" without altering the payload.
fn extract_stamp(bytes: &[u8]) -> Option<String> {
    let needle = b"window.ORBIT_BUILD";
    // Cheap first-byte filter: build scripts compile without optimisation, and a
    // naive windows() scan over a 41 MB payload is measurably slow there.
    // Every payload contains the name TWICE (measured 2026-08-21 on all five
    // artefacts): once as the assignment we want, and once inside the shell's
    // own build-badge markup as `window.ORBIT_BUILD || "dev"`. Both are followed
    // closely by a quoted string, so "first quote within N bytes" would happily
    // return "dev" if the order ever flipped - a wrong stamp that still passes
    // the guard, which is worse than no stamp.
    // So: walk EVERY occurrence, and accept one only if what separates the name
    // from the opening quote is whitespace and exactly one '=' (never '==' and
    // never '||'). Return the first that qualifies.
    let last = bytes.len().saturating_sub(needle.len());
    let mut i = 0usize;
    while i <= last {
        if bytes[i] != b'w' || &bytes[i..i + needle.len()] != needle {
            i += 1;
            continue;
        }
        let rest = &bytes[i + needle.len()..];
        let scan = &rest[..rest.len().min(64)];

        let mut j = 0usize;
        let mut eq = 0u32;
        let mut ok = true;
        while j < scan.len() && scan[j] != b'"' && scan[j] != b'\'' {
            match scan[j] {
                b' ' | b'\t' | b'\r' | b'\n' => {}
                b'=' => eq += 1,
                _ => {
                    ok = false;
                    break;
                }
            }
            j += 1;
        }
        if ok && eq == 1 && j < scan.len() {
            let quote_char = scan[j];
            let after = &rest[j + 1..];
            let cap = after.len().min(256);
            if let Some(q2) = after[..cap].iter().position(|c| *c == quote_char) {
                if let Ok(s) = String::from_utf8(after[..q2].to_vec()) {
                    return Some(s);
                }
            }
        }
        i += needle.len();
    }
    None
}

fn copy_icons(src: &Path, dst: &Path) {
    if !src.is_dir() {
        panic!(
            "ORBIT build: icon set not found: {}\nRun: python desktop/scripts/make-icons.py",
            src.display()
        );
    }
    fs::create_dir_all(dst).expect("ORBIT build: cannot create icons/active");
    for entry in fs::read_dir(src).expect("ORBIT build: cannot read icon dir") {
        let entry = entry.expect("ORBIT build: bad dir entry");
        let path = entry.path();
        if path.is_file() {
            println!("cargo:rerun-if-changed={}", path.display());
            let target = dst.join(entry.file_name());
            fs::copy(&path, &target).unwrap_or_else(|e| {
                panic!("ORBIT build: cannot copy {} -> {}: {}", path.display(), target.display(), e)
            });
        }
    }
}

fn placeholder_html(key: &str, title: &str) -> String {
    format!(
        "<!doctype html>\n<html><head><meta charset=\"utf-8\"><title>{title}</title>\n\
         <script>window.ORBIT_BUILD = \"PLACEHOLDER-{key}\";</script>\n\
         <style>body{{margin:0;background:#0c1117;color:#e8b34b;font:14px/1.6 ui-sans-serif,system-ui,sans-serif}}\n\
         .w{{padding:32px;max-width:860px}}h1{{font-size:18px;margin:0 0 12px}}\n\
         pre{{background:#111820;border:1px solid #223;padding:12px;color:#9aa7b4;white-space:pre-wrap}}\n\
         button{{background:#1a2430;color:#e8b34b;border:1px solid #33414f;padding:6px 10px;margin:2px;cursor:pointer}}</style>\n\
         </head><body><div class=\"w\">\n\
         <h1>{title} - PLACEHOLDER PAYLOAD</h1>\n\
         <p>This shell was built with ORBIT_ALLOW_PLACEHOLDER_PAYLOAD=1. It is NOT shippable.</p>\n\
         <p>Native bridge smoke test:</p>\n\
         <div>\n\
         <button onclick=\"t('caseFilePath')\">caseFilePath</button>\n\
         <button onclick=\"t('lockHolder')\">lockHolder</button>\n\
         <button onclick=\"t('acquireLock')\">acquireLock</button>\n\
         <button onclick=\"t('readCase')\">readCase</button>\n\
         <button onclick=\"w()\">writeCase</button>\n\
         <button onclick=\"t('releaseLock')\">releaseLock</button>\n\
         <button onclick=\"t('forceLock')\">forceLock</button>\n\
         </div>\n\
         <pre id=\"o\">ready</pre>\n\
         <script>\n\
         var o=document.getElementById('o');\n\
         function p(l,v){{o.textContent=l+': '+JSON.stringify(v,null,2)+'\\n\\n'+o.textContent;}}\n\
         function t(n){{try{{window.__ORBIT_NATIVE__[n]().then(function(r){{p(n,r);}},function(e){{p(n+' REJECTED',String(e));}});}}catch(e){{p(n+' THREW',String(e));}}}}\n\
         function w(){{var j=JSON.stringify({{demo:true,at:new Date().toISOString()}});\n\
         window.__ORBIT_NATIVE__.writeCase(j).then(function(r){{p('writeCase',r);}},function(e){{p('writeCase REJECTED',String(e));}});}}\n\
         window.addEventListener('load',function(){{p('info',window.__ORBIT_INFO__||null);\n\
         window.__ORBIT_NATIVE__.onCaseChanged(function(d){{p('onCaseChanged',d);}});}});\n\
         </script></div></body></html>\n",
        title = title,
        key = key
    )
}
