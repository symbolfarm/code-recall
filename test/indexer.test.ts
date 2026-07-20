import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildGraph, collectSourceFiles } from "../src/indexer";

test("buildGraph extracts files, declarations, methods, and local imports", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "code-recall-"));
  try {
    const model = path.join(root, "model.ts");
    const service = path.join(root, "service.ts");
    fs.writeFileSync(model, "export interface User { name: string }\n");
    fs.writeFileSync(service, [
      'import { User } from "./model";',
      "export class UserService {",
      "  find(id: string): User | undefined { return undefined; }",
      "}",
      "export function createService(): UserService { return new UserService(); }",
    ].join("\n"));

    const graph = buildGraph(root);
    assert.equal(graph.nodes.filter((node) => node.kind === "file").length, 2);
    assert.ok(graph.nodes.some((node) => node.kind === "interface" && node.name === "User"));
    assert.ok(graph.nodes.some((node) => node.kind === "class" && node.name === "UserService"));
    assert.ok(graph.nodes.some((node) => node.kind === "method" && node.name === "find"));
    assert.ok(graph.nodes.some((node) => node.kind === "function" && node.name === "createService"));
    assert.ok(graph.edges.some((edge) => edge.kind === "imports" && edge.from === "file:service.ts" && edge.to === "file:model.ts"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("collectSourceFiles skips dependencies, build output, and declarations", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "code-recall-"));
  try {
    fs.mkdirSync(path.join(root, "node_modules"));
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(path.join(root, "node_modules", "ignored.ts"), "export {};");
    fs.writeFileSync(path.join(root, "src", "types.d.ts"), "declare const x: number;");
    fs.writeFileSync(path.join(root, "src", "kept.tsx"), "export const App = () => null;");
    assert.deepEqual(collectSourceFiles(root), [path.join(root, "src", "kept.tsx")]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

