//! Run a downloaded GGUF model: find llama.cpp's server, start it on a model
//! file, watch it, stop it.
//!
//! DevHelper does not do inference. It supervises a process that does. The split
//! is the same one `devicelink.rs` makes: Rust owns the thing the webview cannot
//! touch — a child process, a port, a pipe — and every decision that can be
//! written as a string (which files count as models, what the command line says)
//! lives in `src/tools/lib/localLlm.ts` where it has tests.
//!
//! Two rules the rest of the feature depends on:
//!
//! - **One server at a time.** Loading a second 8B model beside the first is how
//!   a laptop starts swapping. `llm_start` stops whatever is running first.
//! - **The child never outlives the app.** A llama-server left behind holds the
//!   model in RAM (and the GPU's VRAM) with no window to close, so `lib.rs` calls
//!   `stop` on exit and `Drop` is the backstop.

use std::collections::VecDeque;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

/// How many lines of the server's own output to keep.
///
/// llama.cpp says why it failed — a missing CUDA DLL, a corrupt file, a context
/// size the model will not accept — on stderr and then exits. Without these the
/// UI can only report "the process died", which is the least useful true thing
/// it could say.
const LOG_LINES: usize = 200;

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct LlmStatus {
    pub running: bool,
    pub pid: Option<u32>,
    pub port: Option<u16>,
    /// The model path this server was started on.
    pub model: Option<String>,
    /// The runtime binary in use.
    pub runtime: Option<String>,
    /// Tail of the server's stdout+stderr, oldest first.
    pub log: Vec<String>,
    /// Set once the child has exited: how it exited.
    pub exit: Option<String>,
}

struct Running {
    child: Child,
    port: u16,
    model: String,
    runtime: String,
    log: Arc<Mutex<VecDeque<String>>>,
    /// How the process ended, once it has. Latched: the first exit wins.
    exit: Arc<Mutex<Option<String>>>,
    /// Dropping this asks Windows to kill the child, whatever happened to us.
    #[cfg(windows)]
    _job: Option<JobHandle>,
}

impl Running {
    fn kill(&mut self) {
        let _ = self.child.kill();
        // Reap it. Without the wait the process stays a zombie on Unix and the
        // handle stays open on Windows, which keeps the model file locked.
        let _ = self.child.wait();
    }
}

#[derive(Default)]
pub struct LlmState {
    inner: Mutex<Option<Running>>,
}

impl LlmState {
    /// Stop the running server, if there is one. Safe to call when idle.
    pub fn stop(&self) {
        if let Ok(mut guard) = self.inner.lock() {
            if let Some(mut r) = guard.take() {
                r.kill();
            }
        }
    }
}

impl Drop for LlmState {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Put the child in a job object that dies with this process.
///
/// `on_window_event` in `lib.rs` handles the ordinary shutdown and `Drop` covers
/// a panic, but neither runs when DevHelper is force-killed — Task Manager,
/// `taskkill /F`, a debugger detaching — and a leaked llama-server then holds
/// several gigabytes with no window to close. Found exactly that way: an orphan
/// on port 65248 still resident after its parent had been killed.
///
/// A job object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` moves the guarantee
/// into the kernel: when the last handle to the job closes, which happens however
/// this process ends, Windows terminates everything in it.
#[cfg(windows)]
fn confine_to_job(child: &Child) -> Result<JobHandle, String> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    // SAFETY: every call below is a documented Win32 entry point given a handle
    // this function owns, or a zeroed struct of the size the API is told.
    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            return Err("Cannot create a job object for the model server".into());
        }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let ok = SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const _,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        if ok == 0 {
            return Err("Cannot configure the job object for the model server".into());
        }
        if AssignProcessToJobObject(job, child.as_raw_handle() as HANDLE) == 0 {
            return Err("Cannot put the model server in its job object".into());
        }
        Ok(JobHandle(job as isize))
    }
}

/// Owns the job handle for as long as the server is meant to run.
#[cfg(windows)]
pub struct JobHandle(isize);

#[cfg(windows)]
impl Drop for JobHandle {
    fn drop(&mut self) {
        // Closing the last handle is what triggers the kill, so this is both the
        // cleanup and the mechanism.
        // SAFETY: the handle came from CreateJobObjectW and is closed once.
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.0 as _);
        }
    }
}

#[cfg(windows)]
// The handle is only ever created, stored and closed; nothing reads across
// threads, and Windows handles are process-wide.
unsafe impl Send for JobHandle {}

fn push_log(log: &Arc<Mutex<VecDeque<String>>>, line: String) {
    if let Ok(mut l) = log.lock() {
        if l.len() >= LOG_LINES {
            l.pop_front();
        }
        l.push_back(line);
    }
}

/// Is this a file we could execute?
fn usable(path: &Path) -> bool {
    path.is_file()
}

/// Directories on PATH, so a runtime installed system-wide is found without the
/// user having to type where it is.
fn path_dirs() -> Vec<PathBuf> {
    std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default()
}

/// Find llama-server.
///
/// `candidates` comes from the frontend (`runtimeCandidates`) so the search
/// order is stated in one place and tested there; PATH is appended here because
/// only this side can read the environment.
#[tauri::command]
pub fn llm_find_runtime(candidates: Vec<String>) -> Option<String> {
    for c in &candidates {
        let p = PathBuf::from(c);
        if usable(&p) {
            return Some(p.to_string_lossy().to_string());
        }
    }
    let names = if cfg!(windows) {
        vec!["llama-server.exe", "server.exe"]
    } else {
        vec!["llama-server", "server"]
    };
    for dir in path_dirs() {
        for n in &names {
            let p = dir.join(n);
            if usable(&p) {
                return Some(p.to_string_lossy().to_string());
            }
        }
    }
    None
}

/// A free loopback port for the server to bind.
///
/// Asking the OS for port 0 and reading back what it gave is the only way to
/// pick one that is honest about what is already in use. There is a race between
/// closing this listener and llama-server binding it; on a desktop with one user
/// it does not happen, and if it ever does the start fails loudly rather than
/// silently talking to someone else's server.
#[tauri::command]
pub fn llm_free_port() -> Result<u16, String> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Cannot reserve a local port: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Cannot read the reserved port: {e}"))?
        .port();
    drop(listener);
    Ok(port)
}

fn status_of(r: &mut Running) -> LlmStatus {
    // try_wait is what turns "we started it" into "it is still there". A model
    // that fails to load exits within seconds and the UI has to notice.
    let exit = match r.child.try_wait() {
        Ok(Some(st)) => {
            let msg = match st.code() {
                Some(0) => "exited".to_string(),
                Some(c) => format!("exited with code {c}"),
                None => "terminated".to_string(),
            };
            if let Ok(mut e) = r.exit.lock() {
                if e.is_none() {
                    *e = Some(msg.clone());
                }
            }
            Some(msg)
        }
        Ok(None) => None,
        Err(e) => Some(format!("cannot check the process: {e}")),
    };

    let log = r
        .log
        .lock()
        .map(|l| l.iter().cloned().collect())
        .unwrap_or_default();

    LlmStatus {
        running: exit.is_none(),
        pid: Some(r.child.id()),
        port: Some(r.port),
        model: Some(r.model.clone()),
        runtime: Some(r.runtime.clone()),
        log,
        exit,
    }
}

/// Start the local model server.
///
/// `args` is built by `serverArgs` in TypeScript and passed through unchanged —
/// including `--host 127.0.0.1`, which is why this does not add a host of its
/// own. `port` is only recorded so status and health checks know where to look.
#[tauri::command]
pub fn llm_start(
    state: State<'_, LlmState>,
    runtime: String,
    args: Vec<String>,
    port: u16,
    model: String,
) -> Result<LlmStatus, String> {
    if !usable(Path::new(&runtime)) {
        return Err(format!("{runtime} is not a file"));
    }
    if !usable(Path::new(&model)) {
        return Err(format!("{model} is not a file"));
    }

    // One at a time.
    state.stop();

    let mut cmd = Command::new(&runtime);
    cmd.args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());
    // The runtime folder holds the DLLs llama-server links against (ggml, CUDA
    // shims). Windows resolves those relative to the working directory, so a
    // server started from DevHelper's own directory fails to load with an error
    // that names no file.
    if let Some(dir) = Path::new(&runtime).parent() {
        cmd.current_dir(dir);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Cannot start {runtime}: {e}"))?;

    let log: Arc<Mutex<VecDeque<String>>> = Arc::new(Mutex::new(VecDeque::new()));
    let exit: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));

    for pipe in [
        child.stdout.take().map(|s| Box::new(s) as Box<dyn std::io::Read + Send>),
        child.stderr.take().map(|s| Box::new(s) as Box<dyn std::io::Read + Send>),
    ]
    .into_iter()
    .flatten()
    {
        let log = Arc::clone(&log);
        std::thread::spawn(move || {
            for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                push_log(&log, line);
            }
        });
    }

    push_log(&log, format!("$ {runtime} {}", args.join(" ")));

    // Best effort: if the job object cannot be created the server still runs, and
    // the ordinary shutdown paths still stop it. Saying so in the log beats
    // refusing to start over a cleanup guarantee.
    #[cfg(windows)]
    let job = match confine_to_job(&child) {
        Ok(j) => Some(j),
        Err(e) => {
            push_log(&log, format!("warning: {e}; it will still be stopped on exit"));
            None
        }
    };

    let mut running = Running {
        child,
        port,
        model,
        runtime,
        log,
        exit,
        #[cfg(windows)]
        _job: job,
    };
    let status = status_of(&mut running);
    *state.inner.lock().map_err(|_| "LLM state is poisoned")? = Some(running);
    Ok(status)
}

/// What the local server is doing, including its own output.
#[tauri::command]
pub fn llm_status(state: State<'_, LlmState>) -> LlmStatus {
    let mut guard = match state.inner.lock() {
        Ok(g) => g,
        Err(_) => return LlmStatus::default(),
    };
    match guard.as_mut() {
        Some(r) => status_of(r),
        None => LlmStatus::default(),
    }
}

/// Stop the local server and free the model's memory.
#[tauri::command]
pub fn llm_stop(state: State<'_, LlmState>) -> LlmStatus {
    state.stop();
    LlmStatus::default()
}

// ---------------------------------------------------------------------------
// Installing the runtime
// ---------------------------------------------------------------------------

/// Hosts a runtime download may come from.
///
/// The app downloads an executable and then runs it, so the URL is not a
/// parameter to be trusted because the frontend produced it. The frontend picks
/// the release asset; this decides whether the result is allowed to exist. Both
/// checks are cheap and the one that matters is this one.
const ALLOWED_HOSTS: &[&str] = &["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"];
/// The only project whose builds we will install.
const ALLOWED_PATH: &str = "ggml-org/llama.cpp";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallReport {
    /// Full path of the llama-server executable that was installed.
    pub runtime: String,
    pub files: usize,
    pub bytes: u64,
}

fn host_of(url: &str) -> Option<String> {
    let rest = url.strip_prefix("https://")?;
    let host = rest.split('/').next()?;
    Some(host.split(':').next()?.to_ascii_lowercase())
}

fn check_url(url: &str) -> Result<(), String> {
    let host = host_of(url).ok_or_else(|| format!("Not an https URL: {url}"))?;
    if !ALLOWED_HOSTS.contains(&host.as_str()) {
        return Err(format!("Refusing to download a runtime from {host}"));
    }
    // The redirect target for a release asset does not repeat the repo path, so
    // this only applies to the URL the caller started with.
    if host == "github.com" && !url.contains(ALLOWED_PATH) {
        return Err("Refusing to download a runtime from another project".into());
    }
    Ok(())
}

/// Download and unpack a llama.cpp Windows build into `dest`.
///
/// `expected_sha256` is verified when the release metadata supplied one. A
/// mismatch aborts before anything is written, because the point of the check is
/// that a corrupted or substituted archive never reaches the disk, let alone
/// gets executed.
#[tauri::command]
pub async fn llm_install_runtime(
    url: String,
    dest: String,
    expected_sha256: Option<String>,
) -> Result<InstallReport, String> {
    check_url(&url)?;

    let bytes = reqwest::get(&url)
        .await
        .map_err(|e| format!("Download failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Download failed: {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("Download failed: {e}"))?;

    if let Some(want) = expected_sha256 {
        use sha2::{Digest, Sha256};
        let got = format!("{:x}", Sha256::digest(&bytes));
        let want = want.trim().trim_start_matches("sha256:").to_ascii_lowercase();
        if got != want {
            return Err(format!("The download does not match its published checksum (expected {want}, got {got})"));
        }
    }

    let total = bytes.len() as u64;
    let dest_dir = PathBuf::from(&dest);
    std::fs::create_dir_all(&dest_dir).map_err(|e| format!("Cannot create {dest}: {e}"))?;

    let reader = std::io::Cursor::new(bytes);
    let mut zip = zip::ZipArchive::new(reader).map_err(|e| format!("Not a readable zip: {e}"))?;

    let mut files = 0usize;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| format!("Cannot read entry {i}: {e}"))?;
        // `enclosed_name` returns None for anything that would escape the target
        // directory — `..`, an absolute path, a Windows drive letter. A zip that
        // tries is not one to unpack halfway.
        let Some(rel) = entry.enclosed_name() else {
            return Err(format!("The archive contains an unsafe path: {}", entry.name()));
        };
        let out = dest_dir.join(rel);
        if entry.is_dir() {
            std::fs::create_dir_all(&out).map_err(|e| format!("Cannot create {}: {e}", out.display()))?;
            continue;
        }
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("Cannot create {}: {e}", parent.display()))?;
        }
        let mut sink = std::fs::File::create(&out).map_err(|e| format!("Cannot write {}: {e}", out.display()))?;
        std::io::copy(&mut entry, &mut sink).map_err(|e| format!("Cannot write {}: {e}", out.display()))?;
        files += 1;
    }

    // The build lays its files out however it likes; what matters is where the
    // server ended up, and that is what the UI needs to show and to run.
    let runtime = find_server(&dest_dir)
        .ok_or_else(|| format!("The archive unpacked, but no llama-server executable was found under {dest}"))?;

    Ok(InstallReport { runtime: runtime.to_string_lossy().to_string(), files, bytes: total })
}

/// Look for llama-server up to two levels down — some builds nest a folder.
fn find_server(dir: &Path) -> Option<PathBuf> {
    let names: &[&str] = if cfg!(windows) { &["llama-server.exe"] } else { &["llama-server"] };
    for n in names {
        let direct = dir.join(n);
        if direct.is_file() {
            return Some(direct);
        }
    }
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let path = entry.path();
        if path.is_dir() {
            for n in names {
                let nested = path.join(n);
                if nested.is_file() {
                    return Some(nested);
                }
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_github_hosts_are_allowed() {
        assert!(check_url("https://github.com/ggml-org/llama.cpp/releases/download/b1/x.zip").is_ok());
        assert!(check_url("https://objects.githubusercontent.com/whatever.zip").is_ok());
        assert!(check_url("https://evil.example.com/ggml-org/llama.cpp/x.zip").is_err());
        // http, not https: the executable would be substitutable in transit.
        assert!(check_url("http://github.com/ggml-org/llama.cpp/x.zip").is_err());
    }

    #[test]
    fn another_project_on_github_is_still_refused() {
        assert!(check_url("https://github.com/someone/else/releases/download/v1/x.zip").is_err());
    }

    #[test]
    fn a_host_with_a_port_or_credentials_does_not_slip_through() {
        assert!(check_url("https://github.com:443/ggml-org/llama.cpp/x.zip").is_ok());
        assert!(check_url("https://github.com.evil.net/ggml-org/llama.cpp/x.zip").is_err());
    }
}

// ---------------------------------------------------------------------------
// Downloading a model
// ---------------------------------------------------------------------------

/// Hosts a model download may come from.
///
/// Separate from the runtime's allow-list because the two are different risks: a
/// runtime is an executable this app then runs, a model is data it feeds to one.
/// Hugging Face redirects release files to a CDN host, so the CDN is named too.
const MODEL_HOSTS: &[&str] = &[
    "huggingface.co",
    "cdn-lfs.huggingface.co",
    "cdn-lfs-us-1.huggingface.co",
    "cdn-lfs-eu-1.huggingface.co",
    "transfer.xethub.hf.co",
    "cas-bridge.xethub.hf.co",
];

/// Event carrying download progress to the UI.
pub const DOWNLOAD_EVENT: &str = "llm://download";

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    /// Bytes written so far.
    received: u64,
    /// Total bytes, when the server said. Zero when it did not.
    total: u64,
    done: bool,
}

fn check_model_url(url: &str) -> Result<(), String> {
    let host = host_of(url).ok_or_else(|| format!("Not an https URL: {url}"))?;
    let ok = MODEL_HOSTS.contains(&host.as_str())
        // Hugging Face's CDN hostnames are generated, so the suffix is what can
        // be checked. A suffix match is only safe with the leading dot.
        || host.ends_with(".hf.co")
        || host.ends_with(".huggingface.co");
    if !ok {
        return Err(format!("Refusing to download a model from {host}"));
    }
    Ok(())
}

/// Create a folder if it is not there. Used for the model hub on a new machine.
#[tauri::command]
pub fn llm_ensure_dir(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| format!("Cannot create {path}: {e}"))
}

/// Download a model file, reporting progress as it goes.
///
/// Written to a `.part` file and renamed at the end, so an interrupted download
/// never leaves something that looks like a usable model in the hub folder — the
/// scanner would list it, the user would pick it, and llama.cpp would fail on a
/// truncated file.
#[tauri::command]
pub async fn llm_download_model(
    app: AppHandle,
    url: String,
    dest: String,
) -> Result<String, String> {
    use futures_util::StreamExt;
    use std::io::Write;

    check_model_url(&url)?;
    let final_path = PathBuf::from(&dest);
    if final_path.exists() {
        return Err(format!("{dest} already exists"));
    }
    if let Some(parent) = final_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Cannot create {}: {e}", parent.display()))?;
    }
    let part_path = final_path.with_extension("part");

    let res = reqwest::get(&url)
        .await
        .map_err(|e| format!("Download failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Download failed: {e}"))?;
    let total = res.content_length().unwrap_or(0);

    let mut file = std::fs::File::create(&part_path)
        .map_err(|e| format!("Cannot write {}: {e}", part_path.display()))?;
    let mut stream = res.bytes_stream();
    let mut received: u64 = 0;
    // Emitting on every chunk would be thousands of events for a 2GB file, which
    // costs more than the progress bar is worth. Every 8MB is roughly a percent.
    let mut next_report: u64 = 0;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download interrupted after {received} bytes: {e}"))?;
        file.write_all(&chunk)
            .map_err(|e| format!("Cannot write {}: {e}", part_path.display()))?;
        received += chunk.len() as u64;
        if received >= next_report {
            next_report = received + 8 * 1024 * 1024;
            let _ = app.emit(DOWNLOAD_EVENT, DownloadProgress { received, total, done: false });
        }
    }
    file.flush().map_err(|e| format!("Cannot finish {}: {e}", part_path.display()))?;
    drop(file);

    // A server that closed early leaves a short file that would still load as a
    // "model" and fail cryptically. Better to fail here, naming both numbers.
    if total > 0 && received != total {
        let _ = std::fs::remove_file(&part_path);
        return Err(format!("Download ended early: {received} of {total} bytes"));
    }

    std::fs::rename(&part_path, &final_path)
        .map_err(|e| format!("Cannot move the finished download into place: {e}"))?;
    let _ = app.emit(DOWNLOAD_EVENT, DownloadProgress { received, total, done: true });
    Ok(final_path.to_string_lossy().to_string())
}

#[cfg(test)]
mod model_url_tests {
    use super::*;

    #[test]
    fn hugging_face_and_its_cdn_are_allowed() {
        assert!(check_model_url("https://huggingface.co/bartowski/Qwen2.5-3B-Instruct-GGUF/resolve/main/x.gguf").is_ok());
        assert!(check_model_url("https://cdn-lfs-us-1.huggingface.co/repos/ab/cd/x.gguf").is_ok());
        assert!(check_model_url("https://transfer.xethub.hf.co/xorbs/default/x").is_ok());
    }

    #[test]
    fn nothing_else_is() {
        assert!(check_model_url("https://evil.example.com/x.gguf").is_err());
        assert!(check_model_url("http://huggingface.co/x.gguf").is_err());
        // The suffix check must not accept a host that merely ends with the text.
        assert!(check_model_url("https://huggingface.co.evil.net/x.gguf").is_err());
        assert!(check_model_url("https://nothf.co/x.gguf").is_err());
    }
}
