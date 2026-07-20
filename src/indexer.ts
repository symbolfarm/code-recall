import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript";
import { CodeEdge, CodeGraph, CodeNode, NodeKind } from "./model";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"]);
const IGNORED_DIRECTORIES = new Set([".git", "node_modules", "dist", "build", "coverage", ".next"]);

export function collectSourceFiles(root: string): string[] {
  const result: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name)) visit(path.join(directory, entry.name));
      else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name)) && !entry.name.endsWith(".d.ts")) {
        result.push(path.join(directory, entry.name));
      }
    }
  };
  visit(root);
  return result.sort();
}

export function buildGraph(root: string, files = collectSourceFiles(root)): CodeGraph {
  const workspaceId = "workspace:.";
  const nodes: CodeNode[] = [{ id: workspaceId, kind: "workspace", name: path.basename(root), qualifiedName: path.basename(root), childIds: [] }];
  const edges: CodeEdge[] = [];
  const fileIds = new Map<string, string>();
  const normalizedFiles = files.map((file) => path.resolve(file));

  for (const absolute of normalizedFiles) {
    const relative = normalize(path.relative(root, absolute));
    const id = `file:${relative}`;
    fileIds.set(absolute, id);
    nodes.push({ id, kind: "file", name: relative, qualifiedName: relative, location: { file: absolute, start: 0, end: fs.statSync(absolute).size, line: 1 }, parentId: workspaceId, childIds: [] });
    nodes[0].childIds.push(id);
    edges.push({ from: workspaceId, to: id, kind: "contains" });
  }

  const program = ts.createProgram(normalizedFiles, { allowJs: true, jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ES2022, moduleResolution: ts.ModuleResolutionKind.NodeNext, module: ts.ModuleKind.NodeNext });
  for (const source of program.getSourceFiles()) {
    const absolute = path.resolve(source.fileName);
    const fileId = fileIds.get(absolute);
    if (!fileId) continue;
    const fileNode = nodes.find((node) => node.id === fileId)!;

    for (const statement of source.statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        const target = resolveImport(absolute, statement.moduleSpecifier.text, fileIds);
        if (target) edges.push({ from: fileId, to: target, kind: "imports" });
      }
      const declaration = declarationInfo(statement, source);
      if (declaration) addDeclaration(declaration.node, declaration.kind, fileNode, source, nodes, edges);
    }
  }

  return { rootId: workspaceId, nodes, edges, indexedAt: new Date().toISOString() };
}

function addDeclaration(node: ts.NamedDeclaration, kind: NodeKind, parent: CodeNode, source: ts.SourceFile, nodes: CodeNode[], edges: CodeEdge[]): void {
  if (!node.name || !ts.isIdentifier(node.name)) return;
  const name = node.name.text;
  const qualifiedName = `${parent.qualifiedName}#${name}`;
  const id = `${kind}:${qualifiedName}`;
  const start = node.getStart(source);
  const line = source.getLineAndCharacterOfPosition(start).line + 1;
  const signature = signatureOf(node, source);
  const codeNode: CodeNode = { id, kind, name, qualifiedName, signature, location: { file: source.fileName, start, end: node.end, line }, parentId: parent.id, childIds: [] };
  nodes.push(codeNode);
  parent.childIds.push(id);
  edges.push({ from: parent.id, to: id, kind: "contains" });

  if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) {
    for (const member of node.members) {
      if ((ts.isMethodDeclaration(member) || ts.isMethodSignature(member)) && member.name && ts.isIdentifier(member.name)) {
        addDeclaration(member, "method", codeNode, source, nodes, edges);
      }
    }
  }
}

function declarationInfo(node: ts.Node, source: ts.SourceFile): { node: ts.NamedDeclaration; kind: NodeKind } | undefined {
  if (ts.isClassDeclaration(node)) return { node, kind: "class" };
  if (ts.isInterfaceDeclaration(node)) return { node, kind: "interface" };
  if (ts.isFunctionDeclaration(node)) return { node, kind: "function" };
  if (ts.isTypeAliasDeclaration(node)) return { node, kind: "type" };
  if (ts.isEnumDeclaration(node)) return { node, kind: "enum" };
  const _exhaustive: ts.Node = node;
  void _exhaustive; void source;
  return undefined;
}

function signatureOf(node: ts.NamedDeclaration, source: ts.SourceFile): string {
  if (ts.isFunctionLike(node)) {
    const parameters = node.parameters.map((parameter) => parameter.getText(source)).join(", ");
    const returnType = node.type ? `: ${node.type.getText(source)}` : "";
    return `${node.name?.getText(source) ?? "anonymous"}(${parameters})${returnType}`;
  }
  return node.name?.getText(source) ?? "anonymous";
}

function resolveImport(fromFile: string, specifier: string, fileIds: Map<string, string>): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const base = path.resolve(path.dirname(fromFile), specifier);
  for (const candidate of [base, ...[...SOURCE_EXTENSIONS].map((extension) => base + extension), ...[...SOURCE_EXTENSIONS].map((extension) => path.join(base, `index${extension}`))]) {
    const id = fileIds.get(candidate);
    if (id) return id;
  }
  return undefined;
}

function normalize(value: string): string { return value.split(path.sep).join("/"); }

