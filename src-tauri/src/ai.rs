// AI assistant bridge. Keizu doesn't talk to AI services itself and never
// sees a password or API key: it runs an AI command-line tool the user has
// installed and signed in to with their own subscription (Claude Code with
// Claude Pro/Max, Gemini CLI with a Google account), passes the prompt on
// stdin and reads the answer from stdout.
//
// Only these known tools can be run, with fixed arguments. Map text never
// goes on the command line, and the tools run in an empty temporary folder
// with their own tools turned off where the tool allows it.

use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Manager};

/// Running jobs (job id → process id) and jobs asked to stop.
#[derive(Default)]
pub struct AiJobs {
    running: Mutex<HashMap<String, u32>>,
    cancelled: Mutex<HashSet<String>>,
}

#[derive(Clone, Copy, PartialEq)]
enum Provider {
    Claude,
    Gemini,
}

impl Provider {
    fn parse(s: &str) -> Result<Self, String> {
        match s {
            "claude" => Ok(Provider::Claude),
            "gemini" => Ok(Provider::Gemini),
            _ => Err(format!("bilinmeyen sağlayıcı: {s}")),
        }
    }
    fn exe(self) -> &'static str {
        match self {
            Provider::Claude => "claude",
            Provider::Gemini => "gemini",
        }
    }
}

fn home() -> Option<PathBuf> {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from)
}

/// Folders where these tools are usually installed but which a desktop app
/// may not have on its PATH (macOS apps don't get the shell's PATH).
fn extra_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(h) = home() {
        dirs.push(h.join(".local").join("bin"));
        dirs.push(h.join(".claude").join("local"));
        dirs.push(h.join(".npm-global").join("bin"));
        dirs.push(h.join(".bun").join("bin"));
        dirs.push(h.join(".volta").join("bin"));
    }
    if cfg!(windows) {
        if let Some(appdata) = std::env::var_os("APPDATA") {
            dirs.push(PathBuf::from(appdata).join("npm"));
        }
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            dirs.push(PathBuf::from(local).join("Programs").join("claude"));
        }
        if let Some(pf) = std::env::var_os("ProgramFiles") {
            dirs.push(PathBuf::from(pf).join("nodejs"));
        }
    } else {
        dirs.push(PathBuf::from("/opt/homebrew/bin"));
        dirs.push(PathBuf::from("/usr/local/bin"));
        dirs.push(PathBuf::from("/usr/bin"));
    }
    dirs
}

fn search_path() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    for d in extra_dirs() {
        if !dirs.contains(&d) {
            dirs.push(d);
        }
    }
    dirs
}

/// Finds the tool: the path set in Settings, or a search of PATH and the usual folders.
fn find_cli(p: Provider, custom: Option<&str>) -> Option<PathBuf> {
    if let Some(c) = custom.map(str::trim).filter(|c| !c.is_empty()) {
        let path = PathBuf::from(c);
        return path.is_file().then_some(path);
    }
    let names: Vec<String> = if cfg!(windows) {
        ["exe", "cmd", "bat"].iter().map(|e| format!("{}.{e}", p.exe())).collect()
    } else {
        vec![p.exe().to_string()]
    };
    for dir in search_path() {
        for n in &names {
            let candidate = dir.join(n);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

/// Whether the tool looks signed in, from the files it keeps after a login.
/// `None` when we can't tell (e.g. Claude Code on macOS keeps it in the keychain).
fn signed_in(p: Provider) -> Option<bool> {
    let h = home()?;
    match p {
        Provider::Claude => {
            if std::env::var_os("ANTHROPIC_API_KEY").is_some() || h.join(".claude").join(".credentials.json").is_file() {
                return Some(true);
            }
            match std::fs::read_to_string(h.join(".claude.json")) {
                Ok(s) if s.contains("\"oauthAccount\"") => Some(true),
                _ if cfg!(target_os = "macos") => None,
                _ => Some(false),
            }
        }
        Provider::Gemini => {
            let creds = h.join(".gemini").join("oauth_creds.json").is_file();
            let key = std::env::var_os("GEMINI_API_KEY").is_some() || std::env::var_os("GOOGLE_API_KEY").is_some();
            Some(creds || key)
        }
    }
}

fn command(exe: &Path) -> Command {
    let mut cmd = Command::new(exe);
    // The tool's own folder and the usual install folders go first on PATH,
    // so a Node-based tool finds `node` even when the app has a short PATH.
    let mut dirs: Vec<PathBuf> = exe.parent().map(|d| vec![d.to_path_buf()]).unwrap_or_default();
    dirs.extend(search_path());
    if let Ok(joined) = std::env::join_paths(dirs) {
        cmd.env("PATH", joined);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

fn kill_tree(child: &mut Child) {
    #[cfg(windows)]
    {
        // A .cmd shim starts node as a child: stop the whole tree.
        let _ = command(Path::new("taskkill")).args(["/T", "/F", "/PID", &child.id().to_string()]).status();
    }
    let _ = child.kill();
}

struct RunOutput {
    code: Option<i32>,
    stdout: String,
    stderr: String,
}

/// Runs `exe args`, feeding `input` on stdin, until it ends, the timeout
/// passes or the job is cancelled.
fn run_process(app: &AppHandle, job: &str, exe: &Path, args: &[&str], input: &str, timeout: Duration) -> Result<RunOutput, String> {
    let dir = std::env::temp_dir().join(format!("keizu-ai-{}", std::process::id()));
    let _ = std::fs::create_dir_all(&dir);
    let mut child = command(exe)
        .args(args)
        .current_dir(&dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("başlatılamadı: {e}"))?;
    let jobs = app.state::<AiJobs>();
    jobs.running.lock().unwrap().insert(job.to_string(), child.id());

    let mut stdin = child.stdin.take();
    let input = input.to_string();
    std::thread::spawn(move || {
        if let Some(s) = stdin.as_mut() {
            let _ = s.write_all(input.as_bytes());
        }
        drop(stdin);
    });
    let read = |r: Option<Box<dyn Read + Send>>| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            if let Some(mut r) = r {
                let _ = r.read_to_end(&mut buf);
            }
            String::from_utf8_lossy(&buf).into_owned()
        })
    };
    let out = read(child.stdout.take().map(|s| Box::new(s) as Box<dyn Read + Send>));
    let err = read(child.stderr.take().map(|s| Box::new(s) as Box<dyn Read + Send>));

    let started = Instant::now();
    let result = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status.code()),
            Ok(None) => {}
            Err(e) => break Err(e.to_string()),
        }
        if jobs.cancelled.lock().unwrap().remove(job) {
            kill_tree(&mut child);
            break Err("cancelled".into());
        }
        if started.elapsed() > timeout {
            kill_tree(&mut child);
            break Err("timeout".into());
        }
        std::thread::sleep(Duration::from_millis(100));
    };
    jobs.running.lock().unwrap().remove(job);
    let _ = child.wait();
    let stdout = out.join().unwrap_or_default();
    let stderr = err.join().unwrap_or_default();
    result.map(|code| RunOutput { code, stdout, stderr })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliStatus {
    provider: String,
    path: Option<String>,
    version: Option<String>,
    signed_in: Option<bool>,
}

/// Which tools are installed, their version and whether they look signed in.
#[tauri::command]
pub async fn ai_detect(app: AppHandle, paths: Option<HashMap<String, String>>) -> Vec<CliStatus> {
    let paths = paths.unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || {
        [Provider::Claude, Provider::Gemini]
            .into_iter()
            .map(|p| {
                let path = find_cli(p, paths.get(p.exe()).map(String::as_str));
                let version = path.as_ref().and_then(|exe| {
                    let job = format!("version-{}", p.exe());
                    run_process(&app, &job, exe, &["--version"], "", Duration::from_secs(20))
                        .ok()
                        .filter(|o| o.code == Some(0))
                        .map(|o| o.stdout.lines().next().unwrap_or("").trim().to_string())
                });
                CliStatus {
                    provider: p.exe().to_string(),
                    signed_in: path.as_ref().and_then(|_| signed_in(p)),
                    path: path.map(|p| p.to_string_lossy().into_owned()),
                    version,
                }
            })
            .collect()
    })
    .await
    .unwrap_or_default()
}

/// The answer inside Claude Code's `--output-format json` envelope: the
/// schema-checked object when there is one, otherwise the plain result.
fn claude_envelope(stdout: &str) -> Result<String, String> {
    let v: serde_json::Value = serde_json::from_str(stdout.trim()).map_err(|_| stdout.trim().chars().take(1500).collect::<String>())?;
    let result = v.get("result").and_then(|r| r.as_str()).unwrap_or("").to_string();
    if v.get("is_error").and_then(|e| e.as_bool()) == Some(true) {
        return Err(if result.trim().is_empty() { "error".into() } else { result.chars().take(1500).collect() });
    }
    match v.get("structured_output") {
        Some(so) if so.is_object() => Ok(so.to_string()),
        _ if !result.trim().is_empty() => Ok(result),
        _ => Err("empty".into()),
    }
}

/// Whether a failed run looks like an older tool that doesn't know an option.
fn unknown_option(out: &RunOutput) -> bool {
    let e = format!("{}{}", out.stderr, out.stdout).to_lowercase();
    e.contains("unknown option") || e.contains("--tools") || e.contains("--json-schema") || e.contains("--strict-mcp-config") || e.contains("unexpected argument")
}

/// Sends a prompt to the chosen tool and returns its answer. With `schema`
/// (a JSON Schema), Claude Code is asked for an answer that matches it.
#[tauri::command]
pub async fn ai_run(app: AppHandle, provider: String, prompt: String, job: String, path: Option<String>, timeout_secs: Option<u64>, schema: Option<String>) -> Result<String, String> {
    let p = Provider::parse(&provider)?;
    let exe = find_cli(p, path.as_deref()).ok_or_else(|| "not-installed".to_string())?;
    let timeout = Duration::from_secs(timeout_secs.unwrap_or(120).clamp(10, 600));
    tauri::async_runtime::spawn_blocking(move || {
        let out = match p {
            Provider::Claude => {
                // Print mode, no tools, no MCP servers, no slash commands,
                // nothing saved: Claude only answers, it can't act on anything.
                // With a schema the answer is checked against it. Older
                // versions that don't know an option fall back step by step.
                if let Some(schema) = schema.as_deref().filter(|s| !s.trim().is_empty()) {
                    let args = [
                        "-p", "--output-format", "json", "--tools", "", "--strict-mcp-config", "--no-session-persistence", "--disable-slash-commands", "--json-schema", schema,
                    ];
                    match run_process(&app, &job, &exe, &args, &prompt, timeout) {
                        Ok(o) if o.code == Some(0) => return claude_envelope(&o.stdout),
                        Ok(o) if !unknown_option(&o) => {
                            let msg = if o.stderr.trim().is_empty() { o.stdout } else { o.stderr };
                            return Err(msg.trim().chars().take(1500).collect());
                        }
                        Err(e) if e == "cancelled" || e == "timeout" => return Err(e),
                        // Unknown option, or the schema couldn't be passed on
                        // the command line (e.g. through a .cmd shim): plain mode.
                        _ => {}
                    }
                }
                let first = run_process(&app, &job, &exe, &["-p", "--output-format", "text", "--tools", ""], &prompt, timeout)?;
                if first.code != Some(0) && unknown_option(&first) {
                    run_process(&app, &job, &exe, &["-p", "--output-format", "text"], &prompt, timeout)?
                } else {
                    first
                }
            }
            // The -p text is added after what comes on stdin.
            Provider::Gemini => run_process(&app, &job, &exe, &["-p", "Reply to the request above."], &prompt, timeout)?,
        };
        if out.code == Some(0) && !out.stdout.trim().is_empty() {
            Ok(out.stdout)
        } else {
            let msg = if out.stderr.trim().is_empty() { out.stdout } else { out.stderr };
            Err(msg.trim().chars().take(1500).collect())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Stops a running job.
#[tauri::command]
pub fn ai_cancel(jobs: tauri::State<'_, AiJobs>, job: String) {
    if jobs.running.lock().unwrap().contains_key(&job) {
        jobs.cancelled.lock().unwrap().insert(job);
    }
}

/// Opens a terminal window running the tool, where the user signs in.
#[tauri::command]
pub fn ai_login(provider: String, path: Option<String>) -> Result<(), String> {
    let p = Provider::parse(&provider)?;
    let exe = find_cli(p, path.as_deref()).ok_or_else(|| "not-installed".to_string())?;
    let exe = exe.to_string_lossy().into_owned();
    if exe.contains('"') {
        return Err("geçersiz yol".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        Command::new("cmd")
            .raw_arg(format!("/c start \"Keizu\" cmd /k \"{exe}\""))
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        let script = format!("tell application \"Terminal\"\nactivate\ndo script \"'{}'\"\nend tell", exe.replace('\'', "'\\''").replace('\\', "\\\\").replace('"', "\\\""));
        Command::new("osascript").args(["-e", &script]).spawn().map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        for (term, flag) in [("x-terminal-emulator", "-e"), ("gnome-terminal", "--"), ("konsole", "-e"), ("xfce4-terminal", "-x"), ("xterm", "-e")] {
            if Command::new(term).args([flag, &exe]).spawn().is_ok() {
                return Ok(());
            }
        }
        Err("no-terminal".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_json_envelope() {
        let ok = r#"{"type":"result","is_error":false,"result":"{\"text\":\"x\"}","structured_output":{"text":"hi","add":[]}}"#;
        let v: serde_json::Value = serde_json::from_str(&claude_envelope(ok).unwrap()).unwrap();
        assert_eq!(v, serde_json::json!({"text":"hi","add":[]}));
        let plain = r#"{"is_error":false,"result":"{\"text\":\"y\"}"}"#;
        assert_eq!(claude_envelope(plain).unwrap(), r#"{"text":"y"}"#);
        let err = r#"{"is_error":true,"result":"Not logged in"}"#;
        assert_eq!(claude_envelope(err).unwrap_err(), "Not logged in");
        assert!(claude_envelope("not json").is_err());
    }
}
