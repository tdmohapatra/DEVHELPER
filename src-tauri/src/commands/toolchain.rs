//! Toolchain Manager native side.
//!
//! Three detection strategies, driven entirely by specs sent from the frontend catalog
//! (`src/tools/lib/toolchain.ts`) so adding a tool needs no Rust change:
//!   * `cli`      — run `bin args…` and keep the first line of output
//!   * `registry` — match a DisplayName in the Windows uninstall registry
//!   * `path`     — a file/directory exists (`%VAR%` expanded)
//!
//! Installing is opt-in per click from the UI and goes through winget only. The package
//! id is validated so it can never turn into extra command-line arguments.

use serde::{Deserialize, Serialize};
use std::process::Command;
use std::sync::OnceLock;

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Spawn helper that never flashes a console window in the GUI app.
fn cmd(bin: &str) -> Command {
    let mut c = Command::new(bin);
    #[cfg(windows)]
    c.creation_flags(CREATE_NO_WINDOW);
    c
}

#[derive(Deserialize, Clone)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Check {
    Cli {
        bin: String,
        #[serde(default)]
        args: Vec<String>,
    },
    Registry {
        #[serde(rename = "match")]
        pattern: String,
    },
    Path {
        path: String,
    },
}

#[derive(Deserialize, Clone)]
pub struct ProbeSpec {
    pub id: String,
    pub checks: Vec<Check>,
}

#[derive(Serialize, Clone)]
pub struct ProbeResult {
    pub id: String,
    pub installed: bool,
    pub version: String,
    pub source: String,
    pub detail: String,
}

impl ProbeResult {
    fn missing(id: &str) -> Self {
        ProbeResult {
            id: id.to_string(),
            installed: false,
            version: String::new(),
            source: String::new(),
            detail: String::new(),
        }
    }
}

/// One installed program as reported by the Windows uninstall registry.
#[derive(Clone)]
struct InstalledApp {
    name_lower: String,
    name: String,
    version: String,
}

/// Expand `%VAR%` tokens in a path; unknown variables are left untouched.
pub fn expand_env(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    while let Some(start) = rest.find('%') {
        let (before, after) = rest.split_at(start);
        out.push_str(before);
        match after[1..].find('%') {
            Some(end) => {
                let name = &after[1..=end];
                match std::env::var(name) {
                    Ok(v) => out.push_str(&v),
                    Err(_) => {
                        out.push('%');
                        out.push_str(name);
                        out.push('%');
                    }
                }
                rest = &after[end + 2..];
            }
            None => {
                out.push_str(after);
                return out;
            }
        }
    }
    out.push_str(rest);
    out
}

/// `"redis insight|redisinsight"` — any alternative matching as a substring is a hit.
pub fn pattern_matches(pattern: &str, haystack_lower: &str) -> bool {
    pattern
        .split('|')
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .any(|p| haystack_lower.contains(&p.to_lowercase()))
}

/// Read the uninstall registry once per process via PowerShell (no extra crate needed).
fn installed_apps() -> &'static Vec<InstalledApp> {
    static CACHE: OnceLock<Vec<InstalledApp>> = OnceLock::new();
    CACHE.get_or_init(load_installed_apps)
}

fn load_installed_apps() -> Vec<InstalledApp> {
    const SCRIPT: &str = concat!(
        "$p=@('HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
        "'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
        "'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*');",
        "Get-ItemProperty $p -ErrorAction SilentlyContinue | Where-Object DisplayName |",
        "Select-Object DisplayName,DisplayVersion | ConvertTo-Json -Compress"
    );

    let out = match cmd("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", SCRIPT])
        .output()
    {
        Ok(o) => o,
        Err(_) => return Vec::new(),
    };
    parse_installed_apps(&String::from_utf8_lossy(&out.stdout))
}

fn parse_installed_apps(json: &str) -> Vec<InstalledApp> {
    let value: serde_json::Value = match serde_json::from_str(json.trim()) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    // ConvertTo-Json emits a bare object when there is exactly one result.
    let items: Vec<&serde_json::Value> = match &value {
        serde_json::Value::Array(a) => a.iter().collect(),
        v => vec![v],
    };
    items
        .into_iter()
        .filter_map(|v| {
            let name = v.get("DisplayName")?.as_str()?.trim().to_string();
            if name.is_empty() {
                return None;
            }
            let version = v
                .get("DisplayVersion")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            Some(InstalledApp {
                name_lower: name.to_lowercase(),
                name,
                version,
            })
        })
        .collect()
}

/// Run a version command.
///
/// On Windows many dev CLIs are `.cmd`/`.bat` shims (npm, ng, tsc, claude, code…) which
/// `CreateProcess` refuses to execute directly, so fall back to `cmd /C` before giving up.
fn run_version_command(bin: &str, args: &[String]) -> Option<std::process::Output> {
    match cmd(bin).args(args).output() {
        Ok(out) => Some(out),
        Err(_) => {
            // Confirm the shim really exists first — otherwise `cmd /C` happily returns
            // "'x' is not recognized…" on stderr, which would look like a version string.
            let found = cmd("cmd")
                .args(["/C", "where", bin])
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false);
            if !found {
                return None;
            }
            cmd("cmd").arg("/C").arg(bin).args(args).output().ok()
        }
    }
}

fn run_check(id: &str, check: &Check) -> Option<ProbeResult> {
    match check {
        Check::Cli { bin, args } => {
            let out = run_version_command(bin, args)?;
            let stdout = String::from_utf8_lossy(&out.stdout);
            let stderr = String::from_utf8_lossy(&out.stderr);
            // Some tools (java, docker on error) print the version to stderr.
            let text = if stdout.trim().is_empty() { stderr } else { stdout };
            if text.trim().is_empty() && !out.status.success() {
                return None;
            }
            let version = text
                .lines()
                .find(|l| !l.trim().is_empty())
                .unwrap_or("")
                .trim()
                .to_string();
            Some(ProbeResult {
                id: id.to_string(),
                installed: true,
                version,
                source: "cli".into(),
                detail: format!("{} {}", bin, args.join(" ")).trim().to_string(),
            })
        }
        Check::Registry { pattern } => installed_apps()
            .iter()
            .find(|app| pattern_matches(pattern, &app.name_lower))
            .map(|app| ProbeResult {
                id: id.to_string(),
                installed: true,
                version: app.version.clone(),
                source: "registry".into(),
                detail: app.name.clone(),
            }),
        Check::Path { path } => {
            let full = expand_env(path);
            if std::path::Path::new(&full).exists() {
                Some(ProbeResult {
                    id: id.to_string(),
                    installed: true,
                    version: String::new(),
                    source: "path".into(),
                    detail: full,
                })
            } else {
                None
            }
        }
    }
}

fn probe_one(spec: &ProbeSpec) -> ProbeResult {
    spec.checks
        .iter()
        .find_map(|c| run_check(&spec.id, c))
        .unwrap_or_else(|| ProbeResult::missing(&spec.id))
}

/// Detect every tool in the given specs. CLI probes run on a small thread pool because
/// a full catalog sweep spawns dozens of short-lived processes.
#[tauri::command]
pub async fn toolchain_probe(specs: Vec<ProbeSpec>) -> Result<Vec<ProbeResult>, String> {
    tokio::task::spawn_blocking(move || {
        // Warm the registry snapshot once, before threads fan out.
        let _ = installed_apps();

        let mut results: Vec<Option<ProbeResult>> = vec![None; specs.len()];
        const LANES: usize = 8;
        std::thread::scope(|scope| {
            let mut handles = Vec::new();
            for lane in 0..LANES {
                let specs = &specs;
                handles.push(scope.spawn(move || {
                    specs
                        .iter()
                        .enumerate()
                        .filter(|(i, _)| i % LANES == lane)
                        .map(|(i, spec)| (i, probe_one(spec)))
                        .collect::<Vec<_>>()
                }));
            }
            for h in handles {
                if let Ok(part) = h.join() {
                    for (i, r) in part {
                        results[i] = Some(r);
                    }
                }
            }
        });

        Ok(results
            .into_iter()
            .zip(specs.iter())
            .map(|(r, spec)| r.unwrap_or_else(|| ProbeResult::missing(&spec.id)))
            .collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// winget package ids are alphanumerics plus `. _ + -`; anything else is rejected so a
/// catalog entry can never inject extra arguments into the install command.
pub fn valid_package_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .chars()
            .next()
            .map(|c| c.is_ascii_alphanumeric())
            .unwrap_or(false)
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '+' | '-'))
}

/// Keep the tail of a winget transcript — the interesting part (result / error) is last.
fn tail(text: &str, max: usize) -> String {
    let clean: String = text.replace('\r', "\n");
    let trimmed = clean.trim();
    if trimmed.len() <= max {
        return trimmed.to_string();
    }
    let start = trimmed.len() - max;
    // Don't split a UTF-8 character.
    let start = (start..trimmed.len())
        .find(|i| trimmed.is_char_boundary(*i))
        .unwrap_or(trimmed.len());
    format!("…\n{}", &trimmed[start..])
}

/// True when winget is available to install anything at all.
#[tauri::command]
pub fn toolchain_winget_available() -> bool {
    cmd("winget")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Install the latest version of a package through winget.
///
/// This changes the machine, so it is only ever called from an explicit, confirmed click
/// in the UI. Windows may still raise a UAC prompt for the underlying installer.
#[tauri::command]
pub async fn toolchain_install(package_id: String) -> Result<String, String> {
    if !valid_package_id(&package_id) {
        return Err(format!("Refusing to install: invalid package id {package_id:?}"));
    }
    tokio::task::spawn_blocking(move || {
        let out = cmd("winget")
            .args([
                "install",
                "--id",
                &package_id,
                "--exact",
                "--source",
                "winget",
                "--accept-package-agreements",
                "--accept-source-agreements",
                "--disable-interactivity",
            ])
            .output()
            .map_err(|e| format!("winget could not be started: {e}"))?;
        let text = format!(
            "{}{}",
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        );
        if out.status.success() {
            Ok(tail(&text, 2000))
        } else {
            Err(tail(&text, 2000))
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pattern_alternatives_match_case_insensitively() {
        assert!(pattern_matches("redis insight|redisinsight", "redisinsight 2.0"));
        assert!(pattern_matches("Postman", "postman x64 12.20.2"));
        assert!(!pattern_matches("toad", "notepad++"));
        assert!(!pattern_matches("", "anything"));
    }

    #[test]
    fn env_vars_expand_and_unknown_ones_survive() {
        std::env::set_var("DEVHELPER_TEST_DIR", "C:\\tmp");
        assert_eq!(
            expand_env("%DEVHELPER_TEST_DIR%\\x.exe"),
            "C:\\tmp\\x.exe"
        );
        assert_eq!(expand_env("%NOPE_NOT_SET%\\x"), "%NOPE_NOT_SET%\\x");
        assert_eq!(expand_env("C:\\plain\\path"), "C:\\plain\\path");
        assert_eq!(expand_env("50% done"), "50% done");
    }

    #[test]
    fn package_ids_are_validated() {
        assert!(valid_package_id("Git.Git"));
        assert!(valid_package_id("Oven-sh.Bun"));
        assert!(valid_package_id("7zip.7zip"));
        assert!(!valid_package_id(""));
        assert!(!valid_package_id("--force"));
        assert!(!valid_package_id("a b"));
        assert!(!valid_package_id("a&calc.exe"));
        assert!(!valid_package_id("a;b"));
        assert!(!valid_package_id(&"x".repeat(129)));
    }

    #[test]
    fn registry_json_parses_object_and_array_forms() {
        let one = r#"{"DisplayName":"Git","DisplayVersion":"2.52.0"}"#;
        let apps = parse_installed_apps(one);
        assert_eq!(apps.len(), 1);
        assert_eq!(apps[0].version, "2.52.0");

        let many = r#"[{"DisplayName":"Git","DisplayVersion":"2.52.0"},
                       {"DisplayName":"Postman x64 12.20.2","DisplayVersion":null}]"#;
        let apps = parse_installed_apps(many);
        assert_eq!(apps.len(), 2);
        assert_eq!(apps[1].version, "");
        assert_eq!(apps[1].name_lower, "postman x64 12.20.2");

        assert!(parse_installed_apps("not json").is_empty());
    }

    #[test]
    fn path_and_cli_checks_resolve() {
        // A path that always exists on Windows and on CI Linux containers alike.
        let dir = std::env::temp_dir().to_string_lossy().to_string();
        let hit = run_check(
            "tmp",
            &Check::Path {
                path: dir,
            },
        );
        assert!(hit.is_some());
        assert_eq!(hit.unwrap().source, "path");

        let miss = run_check(
            "nope",
            &Check::Path {
                path: "C:\\definitely\\not\\here\\devhelper".into(),
            },
        );
        assert!(miss.is_none());

        let missing_bin = run_check(
            "nope",
            &Check::Cli {
                bin: "devhelper_no_such_binary".into(),
                args: vec!["--version".into()],
            },
        );
        assert!(missing_bin.is_none());
    }

    /// npm and friends are `.cmd` shims: direct spawn fails, the `cmd /C` fallback works.
    #[cfg(windows)]
    #[test]
    fn cmd_shims_are_detected_through_the_fallback() {
        let hit = run_check(
            "npm",
            &Check::Cli {
                bin: "npm".into(),
                args: vec!["--version".into()],
            },
        );
        // Only assert when npm is actually on this machine.
        if std::process::Command::new("cmd")
            .args(["/C", "where", "npm"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
        {
            let hit = hit.expect("npm should be detected via the cmd /C fallback");
            assert!(hit.installed);
            assert!(hit.version.chars().next().is_some_and(|c| c.is_ascii_digit()));
        }
    }

    #[test]
    fn tail_keeps_the_end_and_marks_truncation() {
        assert_eq!(tail("short", 100), "short");
        let long = "a".repeat(50);
        let t = tail(&long, 10);
        assert!(t.starts_with('…'));
        assert!(t.ends_with("aaaaaaaaaa"));
    }
}
