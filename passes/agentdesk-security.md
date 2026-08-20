# AgentDesk security-surface comprehension pass

**Pinned AgentDesk commit:** `266a0f30d333bfa5eec176607735b94a6b54aedd`  
**Selected-source digest:** `a5cf6096b1b7159316a83102f5f264f7a2e51e3df3449aed81b4c69e3990792f`  
**Mode:** active recall; preparation only — no security conclusion is supplied.

## How to use this pass

For each card, answer the prompt without opening the source. Then expand the source and review check. Mark uncertainties in your own notes; those are the output of the session. Expect 45–75 minutes for a careful first pass.

> This pass distinguishes implemented controls from planned work. It is not an audit, threat model, or assurance claim.

## 1. Sandbox boundary

Trace each untrusted input to the enforcement point that is supposed to stop it.

### 1.1 Recall

**Prompt:** A skill supplies `../outside.txt`. Where is it rejected, and what happens for a not-yet-created write target whose existing parent contains a symlink?

<details><summary>Source · <code>src-tauri/src/sandbox/scope.rs:33-105</code></summary>

```rust
    /// Resolve `rel` against the scope root and validate it stays inside.
    ///
    /// Rejects:
    /// - Absolute paths
    /// - `..` components (traversal)
    /// - Symlinks whose canonical target escapes the root
    pub fn resolve(&self, rel: impl AsRef<Path>) -> Result<PathBuf> {
        let rel = rel.as_ref();

        // `is_absolute()` is platform-specific: on Windows, `/etc/passwd` has a
        // root but no drive prefix, so it returns false. Use `has_root()` as
        // well to catch Unix-style absolute paths on Windows.
        if rel.is_absolute() || rel.has_root() {
            bail!("Path must be relative, got {:?}", rel);
        }

        // Reject obvious traversal without touching the filesystem
        for component in rel.components() {
            use std::path::Component;
            if matches!(component, Component::ParentDir) {
                bail!("Path traversal (`..`) is not allowed");
            }
        }

        let joined = self.root.join(rel);

        // Canonicalize resolves symlinks and normalizes `.` / extra separators.
        // If the path doesn't exist yet (e.g. write target), check the longest
        // existing prefix instead.
        let canonical = canonicalize_partial(&joined)?;

        if !canonical.starts_with(&self.root) {
            bail!("Path {:?} escapes the scope root {:?}", rel, self.root);
        }

        Ok(joined)
    }
}

/// Like `Path::canonicalize` but works even when the path doesn't exist yet:
/// walks up to the first existing ancestor, canonicalizes that, then re-appends
/// the remaining (not-yet-existing) suffix.
fn canonicalize_partial(path: &Path) -> Result<PathBuf> {
    // Fast path: path already exists
    if let Ok(c) = path.canonicalize() {
        return Ok(c);
    }

    // Walk up to find an existing ancestor
    let mut existing = path;
    let mut suffix = std::collections::VecDeque::new();

    loop {
        match existing.parent() {
            Some(parent) => {
                if let Ok(c) = parent.canonicalize() {
                    // Re-attach the not-yet-existing suffix
                    let mut result = c;
                    for part in suffix.iter().rev() {
                        result = result.join(part);
                    }
                    return Ok(result);
                }
                // Push the current last component onto the suffix stack
                if let Some(name) = existing.file_name() {
                    suffix.push_front(name);
                }
                existing = parent;
            }
            None => bail!("Cannot resolve path {:?}", path),
        }
    }
}
```

</details>

<details><summary>Review check</summary>

Explain why lexical `..` rejection is not the whole jail. Then identify the value returned after validation and ask whether any caller can swap a path component before use.

</details>

### 1.2 Recall

**Prompt:** Do authored app bytes share the user-selected file-tool scope? Which values choose their directory and entry point, and where are those values validated?

<details><summary>Source · <code>src-tauri/src/storage/apps.rs:21-80</code></summary>

```rust
/// Owns the apps root directory and mediates all file access beneath it.
///
/// Managed by Tauri alongside [`crate::storage::Db`]. Path safety is delegated
/// to [`Scope`]: even though `dir_name` / `entry_point` are internally
/// generated (never raw user input), routing every path through the scope means
/// a stray separator or `..` can't escape the root — defence in depth.
pub struct AppStore {
    scope: Scope,
}

impl AppStore {
    /// Open `root` as the apps store. The directory must already exist (callers
    /// create it at startup), which [`Scope::new`] enforces.
    pub fn new(root: impl AsRef<Path>) -> Result<Self> {
        let scope = Scope::new(root).context("opening apps root")?;
        Ok(Self { scope })
    }

    /// Absolute, validated path to an app's directory.
    pub fn app_dir(&self, dir_name: &str) -> Result<PathBuf> {
        self.scope.resolve(dir_name)
    }

    /// Write `bytes` to `<dir_name>/<entry_point>`, creating the app directory
    /// if needed. Overwrites an existing entry — the authoring loop (task-035)
    /// revises an app by rewriting its entry point.
    pub fn write_entry(&self, dir_name: &str, entry_point: &str, bytes: &[u8]) -> Result<()> {
        let path = self.scope.resolve(Path::new(dir_name).join(entry_point))?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("creating app dir {}", parent.display()))?;
        }
        std::fs::write(&path, bytes)
            .with_context(|| format!("writing app entry {}", path.display()))?;
        Ok(())
    }

    /// Read `<dir_name>/<entry_point>` as raw bytes.
    pub fn read_entry(&self, dir_name: &str, entry_point: &str) -> Result<Vec<u8>> {
        let path = self.scope.resolve(Path::new(dir_name).join(entry_point))?;
        std::fs::read(&path).with_context(|| format!("reading app entry {}", path.display()))
    }

    /// Remove an app's entire directory (its content plus any version history
    /// nested under it). A missing directory is not an error — the caller pairs
    /// this with [`crate::storage::Db::delete_app_meta`] and either half may
    /// already be gone.
    pub fn remove_app(&self, dir_name: &str) -> Result<()> {
        let path = self.scope.resolve(dir_name)?;
        // Guard against a `dir_name` that resolves back to the root itself
        // (e.g. `.`): removing the whole apps store must never be a
        // single-app delete.
        if path == self.scope.root() {
            bail!("refusing to remove the apps root itself");
        }
        if path.exists() {
            std::fs::remove_dir_all(&path)
                .with_context(|| format!("removing app dir {}", path.display()))?;
        }
        Ok(())
```

</details>

<details><summary>Review check</summary>

Draw the two roots: the mutable workspace scope and the stable app-content root. Follow read, write, and delete separately.

</details>

### 1.3 Recall

**Prompt:** What combination makes an authored HTML app a dead end? For each layer, name the exact code or platform setting that enforces it.

<details><summary>Source · <code>src-tauri/src/render.rs:1-105</code></summary>

```rust
//! Render Contract V1 — the security spine of the app-builder MVP.
//!
//! An authored app is **inert data interpreted by the signed parent webview,
//! never an on-disk executable** (the ISM-1657 / Essential Eight *application
//! control* story). This module makes that true: it serves an app's stored
//! bytes over a custom `appdata://` protocol with a strict, header-delivered
//! CSP, to be framed by the trusted shell in a locked-down sandboxed iframe.
//!
//! The dead-end is enforced at the web-platform layer by three things acting
//! together — see the task-031 spike debrief for the runtime verification:
//!
//! 1. **`<iframe sandbox="allow-scripts">` WITHOUT `allow-same-origin`.** The
//!    app's own JS runs, but the frame is a unique *opaque* origin: it cannot
//!    touch the parent, storage, or cookies. Adding `allow-same-origin` would
//!    let the app delete its own sandbox attribute — never add it.
//! 2. **A header-delivered CSP** ([`RENDER_CONTRACT_V1_BASE`]). It must be an
//!    HTTP response header, not a `<meta>` tag: WebKitGTK ignores
//!    `frame-ancestors` when meta-delivered.
//! 3. **No IPC bridge in sub-frames.** Tauri injects `window.__TAURI__`
//!    `for_main_frame_only`, so a framed app never receives it.
//!
//! ## Why `frame-ancestors` is NOT `'self'`
//!
//! mvp-spec §4 originally specified `frame-ancestors 'self'`. That was an
//! artefact of the spike's test rig, where parent and child were served from
//! **one** origin. In the real app the trusted shell is `tauri://localhost` and
//! an app is `appdata://localhost` — *cross-origin* — so `'self'` (the app's own
//! origin) refuses framing by the shell and the app never renders. This was
//! empirically confirmed on WebKitGTK 4.1. We pin `frame-ancestors` to the
//! trusted shell origin(s) instead: it renders correctly AND is *stricter* than
//! `'self'` — one app can no longer frame another (both are `appdata://`, which
//! `'self'` would have permitted).

use std::borrow::Cow;

use tauri::http::{header, Request, Response, StatusCode};
use tauri::{AppHandle, Manager, Runtime};

use crate::storage::{AppStore, Db};

/// The render-contract version stamped onto apps authored now. The single
/// source of truth: the app-authoring service ([`crate::apps::create_app`])
/// stamps this onto new rows, and [`contract_for_version`] maps it back to the
/// profile that governs rendering.
/// Bump when the contract changes, and add the matching arm to
/// [`contract_for_version`] so old apps keep rendering under the policy they
/// were approved under.
pub const CURRENT_RENDER_CONTRACT_VERSION: i64 = 1;

/// Every CSP directive of Render Contract V1 *except* `frame-ancestors`
/// (assembled per-request in [`RenderContract::csp`]). Verbatim from
/// docs/mvp-spec.md §4. `default-src 'none'` is the backstop: anything not
/// explicitly re-permitted below is denied, so there is no network egress, no
/// `connect-src`, no external scripts/styles/images.
const RENDER_CONTRACT_V1_BASE: &str = "default-src 'none'; script-src 'unsafe-inline'; \
    style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; \
    form-action 'none'; base-uri 'none'";

/// Origins permitted to *frame* an app (`frame-ancestors`): only the trusted
/// shell. Tauri serves the main webview from `tauri://localhost` on Linux/macOS
/// and `http://tauri.localhost` on Windows.
#[cfg(not(debug_assertions))]
const SHELL_FRAME_ANCESTORS: &str = "tauri://localhost http://tauri.localhost";

/// Debug builds additionally trust the Vite dev-server origin so that
/// `tauri dev` (whose main window is served from `http://localhost:1420`) can
/// frame apps. Gated to debug builds so the shipped binary trusts *only* the
/// real shell origins — the dev origin is never in a release CSP.
#[cfg(debug_assertions)]
const SHELL_FRAME_ANCESTORS: &str =
    "tauri://localhost http://tauri.localhost http://localhost:1420";

/// A named, versioned render profile: the CSP + iframe sandbox flags an app is
/// rendered under. Selected by an app's stamped `render_contract_version` via
/// [`contract_for_version`]; an app is never rendered under a profile other than
/// the one it was authored/approved under.
pub struct RenderContract {
    pub version: i64,
    /// The iframe `sandbox` attribute. V1: `allow-scripts` (no
    /// `allow-same-origin` — see the module docs).
    pub sandbox: &'static str,
}

impl RenderContract {
    /// The `Content-Security-Policy` header value for this profile.
    pub fn csp(&self) -> String {
        // Only V1 exists today. When a V2 profile is added, branch on
        // `self.version` here so each app gets its own contract's CSP.
        debug_assert_eq!(self.version, 1, "only render contract v1 is defined");
        format!("{RENDER_CONTRACT_V1_BASE}; frame-ancestors {SHELL_FRAME_ANCESTORS}")
    }
}

/// Map a stamped `render_contract_version` to its profile. Returns `None` for an
/// unknown/future version — the caller must **refuse to render** rather than
/// fall back to a policy the app was never approved under.
pub fn contract_for_version(version: i64) -> Option<RenderContract> {
    match version {
        1 => Some(RenderContract {
            version: 1,
            sandbox: "allow-scripts",
        }),
        _ => None,
    }
}
```

</details>

<details><summary>Review check</summary>

Account for iframe flags, opaque origin, header CSP, frame ancestors, and Tauri IPC injection. State which claims are code-level and which rely on webview behaviour.

</details>

### 1.4 Recall

**Prompt:** Given an `appdata://` path, enumerate every refusal gate before bytes are returned. What does an unknown render-contract version do?

<details><summary>Source · <code>src-tauri/src/render.rs:129-209</code></summary>

```rust
/// Build the HTTP response for an `appdata://` request `path` against the given
/// stores, attaching the render contract's CSP + `nosniff` headers on success.
///
/// This is the trust boundary. Split out from [`handle_appdata_request`] so the
/// moat — CSP/header attachment, contract-version gating, entry-point matching,
/// traversal rejection — can be regression-tested against the real code path
/// without standing up a Tauri runtime/webview (the wrapper adds only managed
/// state resolution). Everything it returns `Ok` for is served with the
/// versioned CSP header attached below. It refuses, rather than serves, on:
/// unknown app, unknown/future contract version, any path other than the app's
/// stamped entry point (multi-file apps are out of scope for MVP), or a read
/// error.
pub fn respond(db: &Db, store: &AppStore, path: &str) -> Response<Cow<'static, [u8]>> {
    match serve(db, store, path) {
        Ok((bytes, csp)) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
            // The load-bearing header. Delivered here, not via <meta>.
            .header(header::CONTENT_SECURITY_POLICY, csp)
            // Belt-and-braces: we always serve HTML, so forbid MIME sniffing.
            .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
            // Never cache app bytes: an approved edit rewrites the entry in
            // place under the *same* `appdata://` URL, so the authoring loop's
            // re-render (task-035) must re-read from disk, not a stale cache.
            .header(header::CACHE_CONTROL, "no-store")
            .body(Cow::Owned(bytes))
            .expect("static response builder cannot fail"),
        Err(status) => Response::builder()
            .status(status)
            .body(Cow::Borrowed(&b""[..]))
            .expect("static error response builder cannot fail"),
    }
}

fn serve(db: &Db, store: &AppStore, path: &str) -> Result<(Vec<u8>, String), StatusCode> {
    let (id, entry) = parse_appdata_path(path).ok_or(StatusCode::NOT_FOUND)?;

    let meta = db
        .get_app_meta(&id)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;

    // Refuse an app stamped with a version this build has no profile for, rather
    // than serving it under V1's policy.
    let contract =
        contract_for_version(meta.render_contract_version).ok_or(StatusCode::FORBIDDEN)?;

    // MVP serves only the stamped entry point; any other in-dir path is a 404.
    // (`AppStore::read_entry` is also `Scope`-jailed, so traversal is rejected
    // regardless — this is the earlier, cheaper gate.)
    if entry != meta.entry_point {
        return Err(StatusCode::NOT_FOUND);
    }

    let bytes = store
        .read_entry(&meta.dir_name, &meta.entry_point)
        .map_err(|_| StatusCode::NOT_FOUND)?;

    Ok((bytes, contract.csp()))
}

/// Split an `appdata://` request path into `(app_id, entry)`.
///
/// `convertFileSrc` percent-encodes the path it is given, so the separator
/// arrives as `%2F`; we percent-decode first, then split on the first `/`.
/// Returns `None` for a malformed path (no separator, empty component, or a `..`
/// segment) so the caller 404s.
fn parse_appdata_path(path: &str) -> Option<(String, String)> {
    let decoded = percent_encoding::percent_decode_str(path)
        .decode_utf8()
        .ok()?;
    let trimmed = decoded.trim_start_matches('/');
    let (id, entry) = trimmed.split_once('/')?;
    if id.is_empty() || entry.is_empty() {
        return None;
    }
    // Defensive traversal reject (Scope also jails; fail early and cheaply).
    if id.split('/').any(|c| c == "..") || entry.split('/').any(|c| c == "..") {
        return None;
    }
    Some((id.to_string(), entry.to_string()))
```

</details>

<details><summary>Review check</summary>

Walk `respond → serve → parse_appdata_path` in execution order. Include response headers and the second path jail in `AppStore`.

</details>

### 1.5 Recall

**Prompt:** A Rhai skill declares only `read_file`. What prevents it from writing, and what happens to an unknown permission token?

<details><summary>Source · <code>src-tauri/src/script/mod.rs:1-145</code></summary>

```rust
// The skill registry (task-002b) is the first real consumer of this module.
// Until then the public API is exercised only by tests, so silence the
// dead-code lint at the module level rather than peppering each item.
#![allow(dead_code)]

//! Sandboxed Rhai engine for skill execution.
//!
//! A skill declares the `ctx` functions it needs in its `metadata.permissions_required`
//! field. At engine construction time we register *only* those functions on the
//! engine — a skill that asks for `read_file` literally cannot call `write_file`,
//! because the function is absent from its Rhai scope and the call will fail
//! with a "function not found" error at evaluation time.
//!
//! All path-taking `ctx` functions route through [`crate::sandbox::Scope`], so
//! every read/write/list is jailed to the user's chosen working directory in
//! the same way the Phase 0 hardcoded tools were.

use std::sync::Arc;

use rhai::{Engine, EvalAltResult};

use crate::sandbox::Scope;

/// A capability that a skill may request access to in its frontmatter.
///
/// Each variant corresponds 1:1 to a method that may be registered on the
/// `ctx` object. Anything not listed here cannot be exposed to a script.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Permission {
    /// `ctx.read_file(rel_path) -> string`
    ReadFile,
    /// `ctx.write_file(rel_path, contents) -> ()`
    WriteFile,
    /// `ctx.list_dir(rel_path) -> array<string>`
    ListDir,
    /// `ctx.search_files(query, glob_opt) -> array<map>` — case-insensitive
    /// substring search across the scoped tree. Distinct from `ReadFile`
    /// because the blast radius is the *whole* tree, not one named file.
    SearchFiles,
    /// `ctx.resolve_path(rel_path) -> string` — exposes the absolute path
    /// after jail validation. Useful for skills that want to display where
    /// they're operating, without granting read or write.
    ResolvePath,
    /// `ctx.llm_call(prompt) -> string` — stubbed in Phase 1, returns an
    /// error. Real implementation lands in Phase 2+.
    LlmCall,
}

impl Permission {
    /// Parse a space-separated permission spec (as found in SKILL.md
    /// frontmatter under `metadata.permissions_required`).
    ///
    /// Unknown tokens are ignored rather than rejected — registries may
    /// want to log them, but this layer stays permissive about extra
    /// names so future permissions don't break older callers.
    pub fn parse_list(spec: &str) -> Vec<Permission> {
        spec.split_whitespace()
            .filter_map(|tok| match tok {
                "read_file" => Some(Permission::ReadFile),
                "write_file" => Some(Permission::WriteFile),
                "list_dir" => Some(Permission::ListDir),
                "search_files" => Some(Permission::SearchFiles),
                "resolve_path" => Some(Permission::ResolvePath),
                "llm_call" => Some(Permission::LlmCall),
                _ => None,
            })
            .collect()
    }
}

/// The `ctx` object handed to every Rhai script.
///
/// `Arc<Scope>` so the engine can hold one (Rhai requires custom types to
/// be `Clone`) and so multiple concurrent engines can share the same jail
/// without cloning the canonicalized root path.
#[derive(Clone)]
pub struct Ctx {
    scope: Arc<Scope>,
}

impl Ctx {
    pub fn new(scope: Arc<Scope>) -> Self {
        Self { scope }
    }
}

/// Build a sandboxed Rhai engine for a skill with the given permissions.
///
/// Callers should construct one engine per script invocation. The returned
/// engine has no filesystem or network access except via the `ctx` methods
/// registered below — Rhai itself ships none.
pub fn build_engine(permissions: &[Permission]) -> Engine {
    let mut engine = Engine::new();

    // Defensive limits. These are well above what any reasonable skill
    // should need, and well below "infinite loop will hang the app".
    // Tune via settings if/when a skill bumps into them.
    engine.set_max_expr_depths(64, 64);
    engine.set_max_operations(1_000_000);
    engine.set_max_call_levels(64);
    engine.set_max_string_size(10 * 1024 * 1024); // 10 MiB
    engine.set_max_array_size(10_000);

    engine.register_type_with_name::<Ctx>("Ctx");

    // O(n) membership checks are fine — n is at most ~5.
    let has = |p: Permission| permissions.contains(&p);

    if has(Permission::ResolvePath) {
        engine.register_fn(
            "resolve_path",
            |ctx: &mut Ctx, rel: &str| -> Result<String, Box<EvalAltResult>> {
                ctx.scope
                    .resolve(rel)
                    .map(|p| p.to_string_lossy().into_owned())
                    .map_err(rhai_err)
            },
        );
    }

    if has(Permission::ReadFile) {
        engine.register_fn(
            "read_file",
            |ctx: &mut Ctx, rel: &str| -> Result<String, Box<EvalAltResult>> {
                let path = ctx.scope.resolve(rel).map_err(rhai_err)?;
                std::fs::read_to_string(&path).map_err(|e| {
                    Box::new(EvalAltResult::ErrorRuntime(
                        format!("read_file({rel:?}): {e}").into(),
                        rhai::Position::NONE,
                    ))
                })
            },
        );
    }

    if has(Permission::WriteFile) {
        engine.register_fn(
            "write_file",
            |ctx: &mut Ctx, rel: &str, contents: &str| -> Result<(), Box<EvalAltResult>> {
                let path = ctx.scope.resolve(rel).map_err(rhai_err)?;
                if let Some(parent) = path.parent() {
                    std::fs::create_dir_all(parent).map_err(|e| {
                        Box::new(EvalAltResult::ErrorRuntime(
                            format!("write_file({rel:?}): cannot create parent: {e}").into(),
                            rhai::Position::NONE,
```

</details>

<details><summary>Review check</summary>

Distinguish capability omission from path confinement. Decide whether silently ignored unknown permissions fail closed for capability grant and whether they fail clearly for the user.

</details>

## 2. Key handling

Separate the implementation that exists from the accepted design that has not landed.

### 2.1 Recall

**Prompt:** Where does the API key live today, when is it loaded, and which values can observe it before it becomes an Authorization header?

<details><summary>Source · <code>src-tauri/src/llm/client.rs:45-112</code></summary>

```rust
/// HTTP client for any OpenAI-compatible `/v1/chat/completions` endpoint.
/// Configured via environment variables loaded from `.env` at startup.
#[derive(Debug, Clone)]
pub struct LlmClient {
    http: Client,
    base_url: String,
    api_key: String,
    model: String,
}

impl LlmClient {
    /// Build from environment variables.
    ///
    /// Required:
    ///   `LLM_BASE_URL`  — e.g. `https://openrouter.ai/api/v1`
    ///   `LLM_API_KEY`   — your provider API key
    ///
    /// Optional:
    ///   `LLM_MODEL`     — defaults to `openai/gpt-4o-mini`
    pub fn from_env() -> Result<Self> {
        let base_url = std::env::var("LLM_BASE_URL")
            .context("LLM_BASE_URL not set — did you create a .env file?")?;
        let api_key = std::env::var("LLM_API_KEY")
            .context("LLM_API_KEY not set — did you create a .env file?")?;
        let model = std::env::var("LLM_MODEL").unwrap_or_else(|_| "openai/gpt-4o-mini".into());

        let http = Client::builder()
            .timeout(Duration::from_secs(120))
            .build()
            .context("Failed to build HTTP client")?;

        Ok(Self {
            http,
            base_url,
            api_key,
            model,
        })
    }

    pub fn model(&self) -> &str {
        &self.model
    }

    /// Send a chat completion request (non-streaming).
    /// Returns the raw API response; the agent loop handles tool-call dispatch.
    pub async fn chat(
        &self,
        messages: Vec<ChatMessage>,
        tools: Vec<ToolDefinition>,
    ) -> Result<ChatResponse> {
        let url = format!("{}/chat/completions", self.base_url.trim_end_matches('/'));

        let body = ChatRequest {
            model: self.model.clone(),
            messages,
            tools,
        };

        let resp = self
            .http
            .post(&url)
            .bearer_auth(&self.api_key)
            // OpenRouter requires this header to identify the app
            .header("HTTP-Referer", "https://github.com/symbolfarm/agentdesk")
            .header("X-Title", "AgentDesk")
            .json(&body)
            .send()
            .await
```

</details>

<details><summary>Review check</summary>

Trace process environment → owned `String` → cloned client state → request builder. Do not answer from the planned secret-store task.

</details>

### 2.2 Recall

**Prompt:** What startup behaviour makes the current key path unsuitable for a released AppImage?

<details><summary>Source · <code>src-tauri/src/lib.rs:89-105</code></summary>

```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Load .env file if present (silently ignore if missing)
    let _ = dotenvy::dotenv();

    let llm = LlmClient::from_env().expect(
        "Failed to initialise LLM client. \
         Make sure LLM_BASE_URL and LLM_API_KEY are set in your .env file.",
    );

    let scope_root = default_scope_root();

    // Create the default workspace directory if it doesn't exist yet
    if !scope_root.exists() {
        std::fs::create_dir_all(&scope_root)
            .unwrap_or_else(|e| eprintln!("Warning: could not create workspace dir: {e}"));
    }
```

</details>

<details><summary>Review check</summary>

Describe the missing-`.env` path and whether failure is recoverable in the running UI.

</details>

### 2.3 Recall

**Prompt:** What key-storage design has already been decided, including fallback, precedence, and non-disclosure rules? Which of it is still only a task contract?

<details><summary>Source · <code>.tasks/task-029-llm-config-secret-store.md:24-84</code></summary>

```markdown
## Goal

Persist LLM config outside `.env`: the API key in the OS keychain (with a
documented plaintext fallback when no Secret Service is available), the
non-secret fields in the SQLite settings table. Expose read/write Tauri
commands, and make `LlmClient` construction read from this store.

## Acceptance criteria

- [ ] A `keyring`-backed secret store writes/reads the API key under a
      stable service+account name. On Linux this targets the Secret
      Service (libsecret/gnome-keyring).
- [ ] **Keychain-unavailable fallback:** when the Secret Service is
      missing/unreachable (common on headless/enterprise Linux), the key
      falls back to a plaintext file in the app config dir, and the store
      reports *which* backend is in use so the UI can warn the user. The
      fallback file is created with owner-only permissions (`0o600` on
      Unix).
- [ ] Non-secret config (`base_url`, `model`) persists in a SQLite
      `settings` table via a new `PRAGMA user_version` migration (follow
      the task-022/023 migration-runner pattern).
- [ ] Config-resolution precedence is explicit and documented in code:
      **`LLM_*` env vars win if set** (preserves the `.env` dev/CI/manual-
      test-plan workflow), otherwise the stored config is used.
- [ ] Tauri commands: get current config (key presence/backend reported,
      **never the key value itself**), set config (base_url + model + key),
      and clear the key. A "config is complete enough to chat" check is
      exposed for the frontend to gate on.
- [ ] The API key value is **never** logged, returned to the frontend in
      a get, or written to SQLite. Only its presence + storage backend are
      observable.
- [ ] `LlmClient` build path uses the resolver; the existing error copy
      that references `.env` is updated to point users at in-app settings
      (the `.env` mention only makes sense in dev).
- [ ] Unit tests cover: resolver precedence (env vs stored), fallback
      selection when keychain is unavailable, the settings-table
      migration, and that `get_config` does not leak the key.
- [ ] `cargo fmt --check`, `cargo clippy --all-targets --all-features -D
      warnings`, and `cargo test --all-features` pass.

## Relevant files

- `src-tauri/src/llm/client.rs` (current env-var read at L65–69)
- `src-tauri/src/lib.rs` (`dotenvy` load L84; managed state + command registration)
- `src-tauri/src/storage/db.rs` (migration runner; settings table goes here)
- `.tasks/debriefs/task-022.md`, `task-023.md` (SQLite foundation + migration pattern)
- `src-tauri/Cargo.toml`

## Decisions already made

- **Key storage = OS keychain via the `keyring` crate, with a plaintext
  file fallback** (Toby, 2026-06-28). The fallback is honest plaintext +
  a user-visible warning, *not* on-disk "encryption" with a co-located
  key (that's theatre). The point of the fallback is usability on Linux
  boxes without a running Secret Service.
- **Env vars take precedence over stored config.** Keeps the existing
  `.env` dev loop, CI, and the manual test plan working unchanged; the
  shipped app simply has no env set and falls through to stored config.
- **Secret and non-secret config are stored separately.** base_url/model
  in SQLite; the key only ever in keychain-or-fallback-file. The key must
  never land in the SQLite DB.
```

</details>

<details><summary>Review check</summary>

Make a two-column list: present at the pinned commit vs required by task-029. Include SQLite exclusion, frontend exclusion, logging exclusion, and fallback permissions.

</details>

## 3. SQLite at rest

Inventory what is persisted, what protection SQLite itself provides here, and what the product currently promises.

### 3.1 Recall

**Prompt:** Which user data is stored in SQLite, in what representation, and which tables are created by each migration?

<details><summary>Source · <code>src-tauri/src/storage/db.rs:96-196</code></summary>

```rust
    /// Persist `history` as the current conversation, upserting the single
    /// current row. `created_at` is set on first insert and preserved across
    /// later updates; `updated_at` advances every save.
    ///
    /// The messages are stored as one JSON blob (matching the spec's "messages
    /// as JSON"); normalised per-message rows would be premature for a store
    /// we only ever read/write whole.
    pub fn save_conversation(&self, history: &[ChatMessage]) -> Result<()> {
        let json = serde_json::to_string(history).context("serializing conversation history")?;
        let conn = self.conn.lock().expect("db mutex poisoned");
        conn.execute(
            "INSERT INTO conversations (id, created_at, updated_at, messages)
             VALUES (?1, datetime('now'), datetime('now'), ?2)
             ON CONFLICT(id) DO UPDATE SET
                 updated_at = datetime('now'),
                 messages   = excluded.messages",
            rusqlite::params![CURRENT_CONVERSATION_ID, json],
        )
        .context("writing conversation row")?;
        Ok(())
    }

    /// Load the most-recently-updated conversation, or an empty history if the
    /// table is empty (fresh install). An empty result is *not* an error: the
    /// caller seeds the system prompt on the first turn when history is empty.
    pub fn load_latest_conversation(&self) -> Result<Vec<ChatMessage>> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        let json: Option<String> = conn
            .query_row(
                "SELECT messages FROM conversations
                 ORDER BY updated_at DESC, id DESC
                 LIMIT 1",
                [],
                |row| row.get(0),
            )
            .optional()
            .context("reading latest conversation")?;
        match json {
            Some(j) => serde_json::from_str(&j).context("deserializing conversation history"),
            None => Ok(Vec::new()),
        }
    }

    /// Upsert a remembered fact keyed on `key` (latest value wins), refreshing
    /// its timestamp. Re-`remember`ing an existing key overwrites it rather
    /// than letting contradictory facts pile up under one key; genuinely
    /// distinct facts use distinct keys. `source_conversation` is the single
    /// current conversation — there is no multi-conversation scoping yet.
    ///
    /// Like `save_conversation`, this locks the `Db`'s own mutex synchronously
    /// for the write and releases it before returning; it is never held across
    /// an LLM `await`, so it is safe to call from inside the agent loop.
    pub fn save_memory(&self, key: &str, value: &str) -> Result<()> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        conn.execute(
            "INSERT INTO memory (key, value, source_conversation, timestamp)
             VALUES (?1, ?2, ?3, datetime('now'))
             ON CONFLICT(key) DO UPDATE SET
                 value     = excluded.value,
                 timestamp = excluded.timestamp",
            rusqlite::params![key, value, CURRENT_CONVERSATION_ID],
        )
        .context("writing memory row")?;
        Ok(())
    }

    /// Test-only: drop the `conversations` table so every subsequent
    /// `save_conversation` fails. Lets a caller exercise the best-effort
    /// persistence path (a DB error must be logged and swallowed, never fatal)
    /// without mocking out the whole store.
    #[cfg(test)]
    pub fn break_conversation_storage(&self) {
        let conn = self.conn.lock().expect("db mutex poisoned");
        conn.execute_batch("DROP TABLE conversations;")
            .expect("dropping conversations table in test");
    }

    /// Return all remembered facts, newest first. Assembly (`agent::context`)
    /// applies the token / row budget on top; the store stays dumb and hands
    /// back everything, ordered so the assembler can keep the most recent
    /// facts when it has to truncate.
    pub fn all_memory(&self) -> Result<Vec<MemoryFact>> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        let mut stmt = conn
            .prepare(
                "SELECT key, value, timestamp FROM memory
                 ORDER BY timestamp DESC, id DESC",
            )
            .context("preparing memory query")?;
        let facts = stmt
            .query_map([], |row| {
                Ok(MemoryFact {
                    key: row.get(0)?,
                    value: row.get(1)?,
                    timestamp: row.get(2)?,
                })
            })
            .context("querying memory")?
            .collect::<rusqlite::Result<Vec<_>>>()
            .context("reading memory rows")?;
        Ok(facts)
```

</details>

<details><summary>Review check</summary>

Name the conversation and memory payloads, update semantics, and query ordering. Then inspect the later migration excerpt below for app metadata.

</details>

### 3.2 Recall

**Prompt:** What does opening the database configure for confidentiality at rest? What happens if the on-disk database cannot be opened?

<details><summary>Source · <code>src-tauri/src/storage/db.rs:58-94</code></summary>

```rust
/// Owns the SQLite connection.
///
/// Wrapped in a `Mutex` because `rusqlite::Connection` is `Send` but **not**
/// `Sync`, and Tauri-managed state must be `Send + Sync`. The `Mutex` also
/// serialises the (infrequent, small) writes, which is all the concurrency
/// control a single-user desktop app needs.
///
/// `Db` lives in Tauri-managed state *separate from* `AppState` so a DB write
/// never extends the time the `AppState` lock — which guards the streaming hot
/// path — is held. Persistence happens after a turn completes, in the command's
/// synchronous tail, never across an LLM `await`.
pub struct Db {
    conn: Mutex<Connection>,
}

impl Db {
    /// Open (creating if absent) the database at `path` and run migrations.
    /// The parent directory must already exist — callers create it.
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path)
            .with_context(|| format!("opening database at {}", path.display()))?;
        Self::from_connection(conn)
    }

    /// An in-memory database. Used by tests, and as a startup fallback when the
    /// on-disk path can't be opened: the app still runs, persistence just won't
    /// survive a restart. Better a working session than a failed launch.
    pub fn open_in_memory() -> Result<Self> {
        Self::from_connection(Connection::open_in_memory().context("opening in-memory database")?)
    }

    fn from_connection(conn: Connection) -> Result<Self> {
        migrate(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }
```

</details>

<details><summary>Review check</summary>

Separate mutex/concurrency guarantees from confidentiality. Identify any cipher, key, file-mode, or SQLCipher setup actually present in this path.

</details>

### 3.3 Recall

**Prompt:** Where is the database placed, and what is the failure mode for persistence setup?

<details><summary>Source · <code>src-tauri/src/lib.rs:132-180</code></summary>

```rust
    // Open the conversation/memory database, creating its parent directory if
    // needed. If anything goes wrong we fall back to an in-memory DB and log:
    // a desktop session that can't persist is still far better than a launch
    // that fails outright. Restore the previous conversation into `history` so
    // a restarted app shows where the user left off.
    let db_path = default_db_path();
    if let Some(parent) = db_path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            eprintln!(
                "Warning: could not create data dir {}: {e}",
                parent.display()
            );
        }
    }
    let db = storage::Db::open(&db_path).unwrap_or_else(|e| {
        eprintln!(
            "Warning: could not open conversation DB ({e:#}); \
             using in-memory store (conversation won't persist across restart)"
        );
        storage::Db::open_in_memory().expect("in-memory SQLite should always open")
    });
    let history = db.load_latest_conversation().unwrap_or_else(|e| {
        eprintln!("Warning: could not load saved conversation ({e:#}); starting fresh");
        Vec::new()
    });
    // Snapshot memory for the restored conversation. Frozen for its lifetime
    // (see `AppState::memory`); a "New chat" re-snapshots via `snapshot_memory`.
    let memory = snapshot_memory(&db);

    // Open the app-content store. Its root is a visible, stable directory under
    // the home dir (see `default_apps_root`) — created here so `AppStore::new`
    // (which requires an existing dir) succeeds. If it can't be opened we fall
    // back to a temp dir so the app still launches; apps authored this session
    // just won't persist, mirroring the in-memory DB fallback above.
    let apps_root = default_apps_root();
    if let Err(e) = std::fs::create_dir_all(&apps_root) {
        eprintln!(
            "Warning: could not create apps dir {}: {e}",
            apps_root.display()
        );
    }
    let app_store = AppStore::new(&apps_root).unwrap_or_else(|e| {
        eprintln!(
            "Warning: could not open apps root ({e:#}); \
             using a temporary dir (authored apps won't persist across restart)"
        );
        let tmp = std::env::temp_dir().join(format!("{APP_DIR_NAME}-apps-fallback"));
        std::fs::create_dir_all(&tmp).expect("creating fallback apps dir");
        AppStore::new(&tmp).expect("opening fallback apps dir")
```

</details>

<details><summary>Review check</summary>

Compare the hidden database location with the visible authored-app root. Note which content is SQLite metadata and which remains plain files.

</details>

### 3.4 Recall

**Prompt:** What does the current product spec promise about secrets and encryption at rest, and what is explicitly deferred?

<details><summary>Source · <code>docs/mvp-spec.md:172-191</code></summary>

```markdown
## 8. Security model summary

- **Sandbox = the product's security spine and its compliance story.** Render
  Contract V1 (§4) is the application-control answer (inert data, signed
  parent), aligned to ISM target **OFFICIAL**, designed not to foreclose
  PROTECTED.
- Secrets: API key in OS keychain or owner-only plaintext fallback (visible
  warning); never in SQLite, logs, or returned to the frontend.
- **Durability is a design principle:** restrict external dependencies →
  little can rot; pin the render contract → old apps keep rendering.
- Cheap ISM groundwork to land alongside MVP: a `docs/security/` control-map,
  TLS-stack check (rustls/TLS1.2+), a structured audit log of
  security-relevant events, and the sandbox threat model (≈ this §4 + §8).

## 9. Deferred / post-MVP

Capability bridge (apps persist own state / touch gated data) — the moat;
multi-file apps; allow-listed CDN offline hash-pinned store; managed
API-endpoint subscription (aggregator-only, never proxy our cloud);
encryption-at-rest; gix git backend; macOS/Windows; gov/enterprise plumbing.
```

</details>

<details><summary>Review check</summary>

Do not collapse two claims: API-key handling is specified now; general encryption-at-rest is deferred. List the data that remains exposed if the host account or disk is compromised.

</details>

## Close the pass

Without reopening the cards, draw one data-flow diagram covering: user/LLM input → skill/file scope; authored HTML → app store → renderer/webview; API key → provider request; conversation/memory → SQLite. Mark every trust boundary, fallback, and planned-but-not-implemented control.

Finish with three lists:

1. controls you can explain from executable code;
2. controls that depend on platform behaviour or an unfinished task;
3. questions that would need an adversarial test or threat model rather than more reading.

## Regenerate

From the Code Recall repository:

```sh
npm run prepare:agentdesk-security -- /path/to/agent-desk
npm run check:agentdesk-security -- /path/to/agent-desk
```

Generation fails if a pinned excerpt no longer contains its expected control markers. Review changed ranges rather than mechanically updating line numbers.
