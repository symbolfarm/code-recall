import * as vscode from "vscode";
import { CodeGraph, CodeNode } from "./model";

export class AtlasProvider implements vscode.TreeDataProvider<CodeNode> {
  private readonly changed = new vscode.EventEmitter<CodeNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private graph?: CodeGraph;
  private readonly byId = new Map<string, CodeNode>();

  setGraph(graph: CodeGraph): void {
    this.graph = graph;
    this.byId.clear();
    graph.nodes.forEach((node) => this.byId.set(node.id, node));
    this.changed.fire(undefined);
  }

  getGraph(): CodeGraph | undefined { return this.graph; }

  getTreeItem(node: CodeNode): vscode.TreeItem {
    const collapsible = node.childIds.length > 0
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None;
    const item = new vscode.TreeItem(node.name, collapsible);
    item.id = node.id;
    item.description = node.kind;
    item.tooltip = new vscode.MarkdownString([
      `**${node.kind}** \`${node.qualifiedName}\``,
      node.signature ? `\n\n\`${node.signature}\`` : "",
      node.location ? `\n\n${node.location.file}:${node.location.line}` : "",
    ].join(""));
    item.contextValue = `codeRecall.${node.kind}`;
    item.iconPath = new vscode.ThemeIcon(iconFor(node));
    if (node.location) {
      item.command = { command: "codeRecall.openNode", title: "Open source", arguments: [node] };
    }
    return item;
  }

  getChildren(node?: CodeNode): CodeNode[] {
    if (!this.graph) return [];
    if (!node) return [this.byId.get(this.graph.rootId)!];
    return node.childIds.map((id) => this.byId.get(id)).filter((child): child is CodeNode => Boolean(child));
  }
}

function iconFor(node: CodeNode): string {
  switch (node.kind) {
    case "workspace": return "root-folder";
    case "file": return "file-code";
    case "class": return "symbol-class";
    case "interface": return "symbol-interface";
    case "function": return "symbol-function";
    case "method": return "symbol-method";
    case "type": return "symbol-type-parameter";
    case "enum": return "symbol-enum";
  }
}

