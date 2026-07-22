import * as path from "node:path";
import * as vscode from "vscode";
import { AtlasProvider } from "./atlasProvider";
import { showGraph } from "./graphView";
import { buildGraph } from "./indexer";
import { CodeGraph, CodeNode, ReviewRating, ReviewState } from "./model";
import { dueNodeIds, reviewOrder, scheduleReview } from "./scheduler";

const REVIEW_KEY = "codeRecall.reviews";

export function activate(context: vscode.ExtensionContext): void {
  const provider = new AtlasProvider();
  const tree = vscode.window.createTreeView("codeRecall.explorer", { treeDataProvider: provider, showCollapseAll: true });
  context.subscriptions.push(tree);

  const refresh = async (): Promise<void> => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      void vscode.window.showInformationMessage("Open a folder to build its Code Recall atlas.");
      return;
    }
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: "Code Recall: indexing ASTs" }, async () => {
      provider.setGraph(buildGraph(root));
    });
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("codeRecall.refresh", refresh),
    vscode.commands.registerCommand("codeRecall.showGraph", async () => {
      if (!provider.getGraph()) await refresh();
      const graph = provider.getGraph();
      if (graph) showGraph(graph);
    }),
    vscode.commands.registerCommand("codeRecall.openNode", openNode),
    vscode.commands.registerCommand("codeRecall.recall", (node?: CodeNode) => node && runRecall(node, context)),
    vscode.commands.registerCommand("codeRecall.reviewDue", async () => {
      const graph = provider.getGraph();
      if (!graph) return refresh();
      const states = context.workspaceState.get<ReviewState[]>(REVIEW_KEY, []);
      const due = dueNodeIds(states);
      const byId = new Map(graph.nodes.map((node) => [node.id, node]));
      const node = due.map((id) => byId.get(id)).find(Boolean)
        ?? graph.nodes.find((candidate) => candidate.kind !== "workspace");
      if (node) await runRecall(node, context);
    }),
    vscode.commands.registerCommand("codeRecall.reviewCodebase", async () => {
      if (!provider.getGraph()) await refresh();
      const graph = provider.getGraph();
      if (graph) await runGuidedPass(graph, context);
    }),
  );

  void refresh();
}

const SCOPE_KINDS: Record<string, ReadonlySet<CodeNode["kind"]> | null> = {
  "Modules only": new Set(["file"]),
  "Modules + declarations": new Set(["file", "class", "interface", "function", "type", "enum"]),
  "Everything (incl. methods)": null,
};

async function runGuidedPass(graph: CodeGraph, context: vscode.ExtensionContext): Promise<void> {
  const scope = await vscode.window.showQuickPick(Object.keys(SCOPE_KINDS), {
    title: "Guided review — how deep?",
    placeHolder: "Most-depended-on modules come first. Press Escape mid-pass to stop; the deck remembers.",
  });
  if (!scope) return;
  const kinds = SCOPE_KINDS[scope];
  const order = reviewOrder(graph).filter((node) => !kinds || kinds.has(node.kind));
  if (order.length === 0) {
    void vscode.window.showInformationMessage("Code Recall: nothing to review — the atlas is empty.");
    return;
  }
  for (let index = 0; index < order.length; index++) {
    const keepGoing = await runRecall(order[index], context, { index: index + 1, total: order.length });
    if (!keepGoing) {
      void vscode.window.showInformationMessage(`Code Recall: paused at ${index + 1}/${order.length}. Resume from the deck with Review Due Component.`);
      return;
    }
  }
  void vscode.window.showInformationMessage(`Code Recall: reviewed ${order.length} component(s). Spaced deck seeded.`);
}

async function openNode(node: CodeNode): Promise<void> {
  if (!node.location) return;
  const document = await vscode.workspace.openTextDocument(node.location.file);
  const editor = await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
  const position = new vscode.Position(Math.max(0, node.location.line - 1), 0);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position));
}

/** Run one recall prompt. Returns false only when the learner escapes the
 *  answer box, which a guided pass treats as "stop here". */
async function runRecall(node: CodeNode, context: vscode.ExtensionContext, progress?: { index: number; total: number }): Promise<boolean> {
  const tag = progress ? `(${progress.index}/${progress.total}) ` : "";
  const response = await vscode.window.showInputBox({
    title: `${tag}Recall: ${node.kind} — ${node.name}`,
    prompt: recallPrompt(node),
    placeHolder: "Describe it from memory. Your answer remains local and is not automatically graded.",
    ignoreFocusOut: true,
  });
  if (response === undefined) return false;

  const facts = deterministicFacts(node);
  const rating = await vscode.window.showQuickPick<RatingItem>([
    { label: "Again", description: "I could not recall it", rating: "again" },
    { label: "Hard", description: "I recalled it with difficulty", rating: "hard" },
    { label: "Good", description: "I recalled the important facts", rating: "good" },
    { label: "Easy", description: "This was immediate", rating: "easy" },
  ], { title: `${tag}Reveal · Your answer: ${response || "(blank)"}`, placeHolder: facts });
  if (!rating) return true;

  const states = context.workspaceState.get<ReviewState[]>(REVIEW_KEY, []);
  const previous = states.find((state) => state.nodeId === node.id);
  const next = scheduleReview(node.id, rating.rating, previous);
  await context.workspaceState.update(REVIEW_KEY, [...states.filter((state) => state.nodeId !== node.id), next]);
  void vscode.window.showInformationMessage(`${facts} Next review: ${formatDue(next.dueAt)}`);
  return true;
}

function recallPrompt(node: CodeNode): string {
  if (node.kind === "file") return `Without opening it, describe the responsibility of ${path.basename(node.name)} and name the declarations you expect inside it.`;
  return `Describe what ${node.name} does, its signature, and how it fits into ${node.parentId ?? "the workspace"}.`;
}

function deterministicFacts(node: CodeNode): string {
  const children = node.childIds.length ? ` Contains ${node.childIds.length} indexed declaration(s).` : "";
  const signature = node.signature ? ` Signature: ${node.signature}.` : "";
  const location = node.location ? ` Source: ${path.basename(node.location.file)}:${node.location.line}.` : "";
  return `${node.kind} ${node.qualifiedName}.${signature}${children}${location}`;
}

function formatDue(iso: string): string {
  const due = new Date(iso);
  return due.getTime() <= Date.now() ? "now" : due.toLocaleDateString();
}

interface RatingItem extends vscode.QuickPickItem { rating: ReviewRating; }

export function deactivate(): void {}
