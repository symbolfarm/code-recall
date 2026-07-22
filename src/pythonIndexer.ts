import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { CodeEdge, CodeNode, NodeKind } from "./model";

// Extraction runs in the interpreter that owns the language: Python's own `ast`
// module is ground truth for Python structure, needs no grammar asset, and keeps
// the indexer deterministic and headless-testable. We only walk top-level
// declarations and one level of class methods, matching the TypeScript path.
const EXTRACTOR = String.raw`
import sys, json, ast

def sig_of(node):
    try:
        header = ast.AsyncFunctionDef if isinstance(node, ast.AsyncFunctionDef) else ast.FunctionDef
        fields = dict(name=node.name, args=node.args, body=[ast.Pass()],
                      decorator_list=[], returns=getattr(node, 'returns', None))
        try:
            stub = header(**fields)
        except TypeError:
            fields['type_params'] = []
            stub = header(**fields)
        ast.fix_missing_locations(stub)
        line = ast.unparse(stub).splitlines()[0]
        for prefix in ('async def ', 'def '):
            if line.startswith(prefix):
                line = line[len(prefix):]
        return line.rstrip(':').strip()
    except Exception:
        return node.name

def func_entry(node):
    return {'name': node.name, 'line': node.lineno,
            'endLine': getattr(node, 'end_lineno', node.lineno), 'signature': sig_of(node)}

def index_file(path):
    with open(path, 'r', encoding='utf-8') as handle:
        tree = ast.parse(handle.read(), filename=path)
    classes, functions, imports = [], [], []
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            functions.append(func_entry(node))
        elif isinstance(node, ast.ClassDef):
            methods = [func_entry(m) for m in node.body
                       if isinstance(m, (ast.FunctionDef, ast.AsyncFunctionDef))]
            classes.append({'name': node.name, 'line': node.lineno,
                            'endLine': getattr(node, 'end_lineno', node.lineno),
                            'signature': node.name, 'methods': methods})
        elif isinstance(node, ast.Import):
            for alias in node.names:
                imports.append({'module': alias.name, 'level': 0})
        elif isinstance(node, ast.ImportFrom):
            imports.append({'module': node.module or '', 'level': node.level or 0})
    return {'path': path, 'classes': classes, 'functions': functions, 'imports': imports}

payload = json.load(sys.stdin)
out = []
for target in payload['files']:
    try:
        out.append(index_file(target))
    except Exception as exc:
        out.append({'path': target, 'classes': [], 'functions': [], 'imports': [], 'error': str(exc)})
json.dump({'files': out}, sys.stdout)
`;

interface PyFunction {
  name: string;
  line: number;
  endLine: number;
  signature: string;
}

interface PyClass extends PyFunction {
  methods: PyFunction[];
}

interface PyImport {
  module: string;
  level: number;
}

interface PyFileResult {
  path: string;
  classes: PyClass[];
  functions: PyFunction[];
  imports: PyImport[];
  error?: string;
}

export interface IndexContext {
  root: string;
  fileIds: Map<string, string>;
  byId: Map<string, CodeNode>;
  nodes: CodeNode[];
  edges: CodeEdge[];
}

/** Populate `ctx` with Python declarations and local import edges. No-op when
 *  Python is unavailable or the extractor fails, so a TS/JS atlas still builds. */
export function indexPythonFiles(pyFiles: string[], ctx: IndexContext): void {
  if (pyFiles.length === 0) return;
  const result = runExtractor(pyFiles.map((file) => path.resolve(file)));
  if (!result) return;

  for (const file of result.files) {
    const absolute = path.resolve(file.path);
    const fileId = ctx.fileIds.get(absolute);
    if (!fileId) continue;
    const fileNode = ctx.byId.get(fileId);
    if (!fileNode) continue;

    for (const imp of file.imports) {
      const target = resolvePythonImport(absolute, imp, ctx.root, ctx.fileIds);
      if (target && target !== fileId) ctx.edges.push({ from: fileId, to: target, kind: "imports" });
    }
    for (const fn of file.functions) addPyNode(fn, "function", fileNode, absolute, ctx);
    for (const cls of file.classes) {
      const classNode = addPyNode(cls, "class", fileNode, absolute, ctx);
      for (const method of cls.methods) addPyNode(method, "method", classNode, absolute, ctx);
    }
  }
}

function addPyNode(entry: PyFunction, kind: NodeKind, parent: CodeNode, file: string, ctx: IndexContext): CodeNode {
  const qualifiedName = `${parent.qualifiedName}#${entry.name}`;
  const id = `${kind}:${qualifiedName}`;
  const node: CodeNode = {
    id,
    kind,
    name: entry.name,
    qualifiedName,
    signature: entry.signature,
    location: { file, start: 0, end: 0, line: entry.line },
    parentId: parent.id,
    childIds: [],
  };
  ctx.nodes.push(node);
  ctx.byId.set(id, node);
  parent.childIds.push(id);
  ctx.edges.push({ from: parent.id, to: id, kind: "contains" });
  return node;
}

/** Resolve a Python import to an indexed file id, or undefined for packages and
 *  unresolved specifiers. Relative imports walk up from the importer; absolute
 *  dotted paths resolve from the repository root where the package lives. */
function resolvePythonImport(fromFile: string, imp: PyImport, root: string, fileIds: Map<string, string>): string | undefined {
  const parts = imp.module ? imp.module.split(".") : [];
  let baseDir: string;
  if (imp.level > 0) {
    baseDir = path.dirname(fromFile);
    for (let up = 1; up < imp.level; up++) baseDir = path.dirname(baseDir);
  } else {
    baseDir = root;
  }
  const target = path.join(baseDir, ...parts);
  for (const candidate of [`${target}.py`, path.join(target, "__init__.py")]) {
    const id = fileIds.get(path.resolve(candidate));
    if (id) return id;
  }
  return undefined;
}

function runExtractor(files: string[]): { files: PyFileResult[] } | undefined {
  const input = JSON.stringify({ files });
  for (const interpreter of ["python3", "python"]) {
    const proc = spawnSync(interpreter, ["-c", EXTRACTOR], {
      input,
      encoding: "utf-8",
      maxBuffer: 64 * 1024 * 1024,
    });
    if (proc.error) {
      if ((proc.error as NodeJS.ErrnoException).code === "ENOENT") continue;
      console.warn(`Code Recall: Python extraction failed: ${proc.error.message}`);
      return undefined;
    }
    if (proc.status !== 0) {
      console.warn(`Code Recall: Python extraction exited ${proc.status}: ${proc.stderr}`);
      return undefined;
    }
    try {
      return JSON.parse(proc.stdout) as { files: PyFileResult[] };
    } catch (error) {
      console.warn(`Code Recall: could not parse Python extraction output: ${String(error)}`);
      return undefined;
    }
  }
  console.warn("Code Recall: no Python interpreter found; skipping .py files.");
  return undefined;
}
