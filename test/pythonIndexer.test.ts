import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildGraph } from "../src/indexer";
import { reviewOrder } from "../src/scheduler";

test("buildGraph indexes Python classes, methods, functions, and local imports", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "code-recall-py-"));
  try {
    const pkg = path.join(root, "pkg");
    fs.mkdirSync(pkg);
    fs.writeFileSync(path.join(pkg, "__init__.py"), "");
    fs.writeFileSync(path.join(pkg, "model.py"), "class User:\n    def rename(self, name: str) -> None:\n        self.name = name\n");
    fs.writeFileSync(path.join(pkg, "service.py"), [
      "from .model import User",
      "import pkg.model",
      "",
      "def create_user(name: str) -> User:",
      "    return User()",
    ].join("\n"));

    const graph = buildGraph(root);
    assert.ok(graph.nodes.some((node) => node.kind === "class" && node.name === "User"));
    assert.ok(graph.nodes.some((node) => node.kind === "method" && node.name === "rename"));
    const fn = graph.nodes.find((node) => node.kind === "function" && node.name === "create_user");
    assert.ok(fn, "expected create_user function node");
    assert.equal(fn!.signature, "create_user(name: str) -> User");
    // relative `from .model` and absolute `import pkg.model` both resolve to the same file.
    assert.ok(graph.edges.some((edge) => edge.kind === "imports" && edge.from === "file:pkg/service.ts".replace(".ts", ".py") && edge.to === "file:pkg/model.py"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("reviewOrder puts the most-imported module first, then its declarations by line", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "code-recall-order-"));
  try {
    // core.py is imported by two others; leaf.py by none.
    fs.writeFileSync(path.join(root, "core.py"), "class Engine:\n    def run(self):\n        pass\n\ndef boot():\n    pass\n");
    fs.writeFileSync(path.join(root, "a.py"), "from core import Engine\n");
    fs.writeFileSync(path.join(root, "b.py"), "from core import boot\n");
    fs.writeFileSync(path.join(root, "leaf.py"), "x = 1\n");

    const order = reviewOrder(buildGraph(root));
    const files = order.filter((node) => node.kind === "file").map((node) => node.name);
    assert.equal(files[0], "core.py", "most-imported file should lead");
    // core's declarations follow it in source order: class, its method, then boot().
    const coreIndex = order.findIndex((node) => node.name === "core.py");
    const following = order.slice(coreIndex + 1, coreIndex + 4).map((node) => node.name);
    assert.deepEqual(following, ["Engine", "run", "boot"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
