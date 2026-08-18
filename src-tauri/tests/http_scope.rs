//! The HTTP scope in `capabilities/default.json` must allow local servers.
//!
//! This exists because of a bug that cost a build to find. The scope allowed
//! `http://**` and `https://**`, every tool that talked to a real service worked,
//! and the offline-model feature hung on "loading" forever — because
//! `tauri-plugin-http` wildcards a pattern's pathname, search and hash but *not*
//! its port, so a pattern with no port matches only 80/443. Every request to
//! llama-server on its own port, or Ollama on 11434, was refused before it was
//! sent, and the refusal looked exactly like the server being down.
//!
//! The matcher below is the plugin's `parse_url_pattern`, reproduced so the
//! capability file can be asserted against the real semantics rather than an
//! assumption about them.

use urlpattern::{UrlPattern, UrlPatternMatchInput};

fn parse(pattern: &str) -> UrlPattern {
    let mut init =
        urlpattern::UrlPatternInit::parse_constructor_string::<regex::Regex>(pattern, None).unwrap();
    if init.search.as_ref().map(|p| p.is_empty()).unwrap_or(true) {
        init.search.replace("*".to_string());
    }
    if init.hash.as_ref().map(|p| p.is_empty()).unwrap_or(true) {
        init.hash.replace("*".to_string());
    }
    if init
        .pathname
        .as_ref()
        .map(|p| p.is_empty() || p == "/")
        .unwrap_or(true)
    {
        init.pathname.replace("*".to_string());
    }
    UrlPattern::parse(init, Default::default()).unwrap()
}

/// The `http:default` allow-list as the shipped capability file declares it.
fn allowed_patterns() -> Vec<String> {
    let raw = std::fs::read_to_string("capabilities/default.json").expect("capability file");
    let json: serde_json::Value = serde_json::from_str(&raw).expect("capability file is valid JSON");
    let permissions = json["permissions"].as_array().expect("permissions array");
    let http = permissions
        .iter()
        .find(|p| p["identifier"] == "http:default")
        .expect("an http:default entry");
    http["allow"]
        .as_array()
        .expect("allow array")
        .iter()
        .map(|e| e["url"].as_str().expect("url string").to_string())
        .collect()
}

fn is_allowed(url: &str) -> bool {
    let parsed = url::Url::parse(url).expect("test URL parses");
    allowed_patterns()
        .iter()
        .any(|p| parse(p).test(UrlPatternMatchInput::Url(parsed.clone())).unwrap_or(false))
}

#[test]
fn a_local_server_on_its_own_port_is_reachable() {
    // llama-server, started by DevHelper on an ephemeral port.
    assert!(is_allowed("http://127.0.0.1:63937/health"));
    assert!(is_allowed("http://127.0.0.1:63937/v1/chat/completions"));
    // Ollama's default port — the same bug applied to it.
    assert!(is_allowed("http://localhost:11434/api/chat"));
    // A dev API, the everyday case for the API tester.
    assert!(is_allowed("http://localhost:5000/api/orders?take=10"));
}

#[test]
fn ordinary_public_endpoints_still_work() {
    assert!(is_allowed("https://api.openai.com/v1/chat/completions"));
    assert!(is_allowed("https://api.github.com/repos/ggml-org/llama.cpp/releases/latest"));
    assert!(is_allowed("http://example.com/thing"));
    assert!(is_allowed("https://management.azure.com:443/subscriptions"));
}

#[test]
fn the_pattern_without_a_port_really_does_not_cover_one() {
    // The claim the fix rests on. If a future urlpattern release starts
    // wildcarding the port, this test fails and the extra entries become
    // redundant rather than load-bearing — which is worth being told about.
    let default_port_only = parse("http://**");
    let with_port = url::Url::parse("http://127.0.0.1:63937/health").unwrap();
    assert!(
        !default_port_only
            .test(UrlPatternMatchInput::Url(with_port))
            .unwrap_or(false),
        "http://** matched a non-default port; the :* entries may no longer be needed"
    );
}
