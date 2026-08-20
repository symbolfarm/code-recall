#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const args = process.argv.slice(2);
const check = args.includes("--check");
const positional = args.filter((arg) => arg !== "--check");
const targetRoot = path.resolve(positional[0] ?? path.join(repoRoot, "..", "agent-desk"));
const outputPath = path.join(repoRoot, "passes", "agentdesk-security.md");

const sections = [
  {
    title: "1. Sandbox boundary",
    intent: "Trace each untrusted input to the enforcement point that is supposed to stop it.",
    cards: [
      {
        prompt: "A skill supplies `../outside.txt`. Where is it rejected, and what happens for a not-yet-created write target whose existing parent contains a symlink?",
        file: "src-tauri/src/sandbox/scope.rs",
        start: 33,
        end: 105,
        expect: ["canonicalize_partial", "escapes the scope root", "ParentDir"],
        check: "Explain why lexical `..` rejection is not the whole jail. Then identify the value returned after validation and ask whether any caller can swap a path component before use.",
      },
      {
        prompt: "Do authored app bytes share the user-selected file-tool scope? Which values choose their directory and entry point, and where are those values validated?",
        file: "src-tauri/src/storage/apps.rs",
        start: 21,
        end: 80,
        expect: ["pub struct AppStore", "scope.resolve", "remove_dir_all"],
        check: "Draw the two roots: the mutable workspace scope and the stable app-content root. Follow read, write, and delete separately.",
      },
      {
        prompt: "What combination makes an authored HTML app a dead end? For each layer, name the exact code or platform setting that enforces it.",
        file: "src-tauri/src/render.rs",
        start: 1,
        end: 105,
        expect: ["allow-scripts", "default-src 'none'", "for_main_frame_only"],
        check: "Account for iframe flags, opaque origin, header CSP, frame ancestors, and Tauri IPC injection. State which claims are code-level and which rely on webview behaviour.",
      },
      {
        prompt: "Given an `appdata://` path, enumerate every refusal gate before bytes are returned. What does an unknown render-contract version do?",
        file: "src-tauri/src/render.rs",
        start: 129,
        end: 209,
        expect: ["StatusCode::FORBIDDEN", "entry != meta.entry_point", "CONTENT_SECURITY_POLICY"],
        check: "Walk `respond → serve → parse_appdata_path` in execution order. Include response headers and the second path jail in `AppStore`.",
      },
      {
        prompt: "A Rhai skill declares only `read_file`. What prevents it from writing, and what happens to an unknown permission token?",
        file: "src-tauri/src/script/mod.rs",
        start: 1,
        end: 145,
        expect: ["function is absent", "Unknown tokens are ignored", "if has(Permission::WriteFile)"],
        check: "Distinguish capability omission from path confinement. Decide whether silently ignored unknown permissions fail closed for capability grant and whether they fail clearly for the user.",
      },
    ],
  },
  {
    title: "2. Key handling",
    intent: "Separate the implementation that exists from the accepted design that has not landed.",
    cards: [
      {
        prompt: "Where does the API key live today, when is it loaded, and which values can observe it before it becomes an Authorization header?",
        file: "src-tauri/src/llm/client.rs",
        start: 45,
        end: 112,
        expect: ["api_key: String", "std::env::var(\"LLM_API_KEY\")", "bearer_auth"],
        check: "Trace process environment → owned `String` → cloned client state → request builder. Do not answer from the planned secret-store task.",
      },
      {
        prompt: "What startup behaviour makes the current key path unsuitable for a released AppImage?",
        file: "src-tauri/src/lib.rs",
        start: 89,
        end: 105,
        expect: ["dotenvy::dotenv", "LlmClient::from_env().expect"],
        check: "Describe the missing-`.env` path and whether failure is recoverable in the running UI.",
      },
      {
        prompt: "What key-storage design has already been decided, including fallback, precedence, and non-disclosure rules? Which of it is still only a task contract?",
        file: ".tasks/task-029-llm-config-secret-store.md",
        start: 24,
        end: 84,
        expect: ["keyring", "owner-only", "never the key value itself", "env vars win"],
        check: "Make a two-column list: present at the pinned commit vs required by task-029. Include SQLite exclusion, frontend exclusion, logging exclusion, and fallback permissions.",
      },
    ],
  },
  {
    title: "3. SQLite at rest",
    intent: "Inventory what is persisted, what protection SQLite itself provides here, and what the product currently promises.",
    cards: [
      {
        prompt: "Which user data is stored in SQLite, in what representation, and which tables are created by each migration?",
        file: "src-tauri/src/storage/db.rs",
        start: 96,
        end: 196,
        expect: ["serde_json::to_string", "INSERT INTO conversations", "INSERT INTO memory"],
        check: "Name the conversation and memory payloads, update semantics, and query ordering. Then inspect the later migration excerpt below for app metadata.",
      },
      {
        prompt: "What does opening the database configure for confidentiality at rest? What happens if the on-disk database cannot be opened?",
        file: "src-tauri/src/storage/db.rs",
        start: 58,
        end: 94,
        expect: ["Connection::open(path)", "open_in_memory", "migrate(&conn)"],
        check: "Separate mutex/concurrency guarantees from confidentiality. Identify any cipher, key, file-mode, or SQLCipher setup actually present in this path.",
      },
      {
        prompt: "Where is the database placed, and what is the failure mode for persistence setup?",
        file: "src-tauri/src/lib.rs",
        start: 132,
        end: 180,
        expect: ["default_db_path", "using in-memory store", "default_apps_root"],
        check: "Compare the hidden database location with the visible authored-app root. Note which content is SQLite metadata and which remains plain files.",
      },
      {
        prompt: "What does the current product spec promise about secrets and encryption at rest, and what is explicitly deferred?",
        file: "docs/mvp-spec.md",
        start: 172,
        end: 191,
        expect: ["never in SQLite", "encryption-at-rest", "plaintext fallback"],
        check: "Do not collapse two claims: API-key handling is specified now; general encryption-at-rest is deferred. List the data that remains exposed if the host account or disk is compromised.",
      },
    ],
  },
];

function readLines(relative) {
  const absolute = path.join(targetRoot, relative);
  if (!fs.existsSync(absolute)) throw new Error(`missing source: ${absolute}`);
  return fs.readFileSync(absolute, "utf8").split(/\r?\n/);
}

function excerpt(card) {
  const lines = readLines(card.file);
  if (card.end > lines.length) throw new Error(`${card.file} has ${lines.length} lines, expected at least ${card.end}`);
  const text = lines.slice(card.start - 1, card.end).join("\n");
  for (const needle of card.expect) {
    if (!text.includes(needle)) throw new Error(`${card.file}:${card.start}-${card.end} no longer contains ${JSON.stringify(needle)}`);
  }
  return text;
}

function render() {
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: targetRoot, encoding: "utf8" }).trim();
  const selected = sections.flatMap((section) => section.cards.map((card) => `${card.file}\0${excerpt(card)}`)).join("\0");
  const digest = createHash("sha256").update(selected).digest("hex");
  const out = [
    "# AgentDesk security-surface comprehension pass",
    "",
    `**Pinned AgentDesk commit:** \`${commit}\`  `,
    `**Selected-source digest:** \`${digest}\`  `,
    "**Mode:** active recall; preparation only — no security conclusion is supplied.",
    "",
    "## How to use this pass",
    "",
    "For each card, answer the prompt without opening the source. Then expand the source and review check. Mark uncertainties in your own notes; those are the output of the session. Expect 45–75 minutes for a careful first pass.",
    "",
    "> This pass distinguishes implemented controls from planned work. It is not an audit, threat model, or assurance claim.",
    "",
  ];

  for (const section of sections) {
    out.push(`## ${section.title}`, "", section.intent, "");
    for (const [index, card] of section.cards.entries()) {
      const source = excerpt(card);
      const lang = card.file.endsWith(".rs") ? "rust" : "markdown";
      out.push(
        `### ${section.title.split(". ")[0]}.${index + 1} Recall`,
        "",
        `**Prompt:** ${card.prompt}`,
        "",
        `<details><summary>Source · <code>${card.file}:${card.start}-${card.end}</code></summary>`,
        "",
        `\`\`\`${lang}`,
        source,
        "```",
        "",
        "</details>",
        "",
        `<details><summary>Review check</summary>`,
        "",
        card.check,
        "",
        "</details>",
        "",
      );
    }
  }

  out.push(
    "## Close the pass",
    "",
    "Without reopening the cards, draw one data-flow diagram covering: user/LLM input → skill/file scope; authored HTML → app store → renderer/webview; API key → provider request; conversation/memory → SQLite. Mark every trust boundary, fallback, and planned-but-not-implemented control.",
    "",
    "Finish with three lists:",
    "",
    "1. controls you can explain from executable code;",
    "2. controls that depend on platform behaviour or an unfinished task;",
    "3. questions that would need an adversarial test or threat model rather than more reading.",
    "",
    "## Regenerate",
    "",
    "From the Code Recall repository:",
    "",
    "```sh",
    "npm run prepare:agentdesk-security -- /path/to/agent-desk",
    "npm run check:agentdesk-security -- /path/to/agent-desk",
    "```",
    "",
    "Generation fails if a pinned excerpt no longer contains its expected control markers. Review changed ranges rather than mechanically updating line numbers.",
    "",
  );
  return out.join("\n");
}

const generated = render();
if (check) {
  if (!fs.existsSync(outputPath) || fs.readFileSync(outputPath, "utf8") !== generated) {
    console.error(`stale generated pass: ${outputPath}`);
    process.exit(1);
  }
  console.log(`pass is current: ${outputPath}`);
} else {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, generated);
  console.log(`wrote ${outputPath}`);
}
