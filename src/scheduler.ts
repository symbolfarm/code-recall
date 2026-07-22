import { CodeGraph, CodeNode, ReviewRating, ReviewState } from "./model";

const DAY_MS = 86_400_000;

/** Order for a guided comprehension pass: most-depended-on files first (by
 *  local-import in-degree), each immediately followed by its declarations in
 *  source order. Central modules are the ones worth being able to explain. */
export function reviewOrder(graph: CodeGraph): CodeNode[] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const inDegree = new Map<string, number>();
  for (const edge of graph.edges) {
    if (edge.kind === "imports") inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }
  const files = graph.nodes
    .filter((node) => node.kind === "file")
    .sort((a, b) => (inDegree.get(b.id) ?? 0) - (inDegree.get(a.id) ?? 0) || a.name.localeCompare(b.name));

  const lineOf = (node: CodeNode): number => node.location?.line ?? 0;
  const descendants = (node: CodeNode): CodeNode[] =>
    node.childIds
      .map((id) => byId.get(id))
      .filter((child): child is CodeNode => Boolean(child))
      .flatMap((child) => [child, ...descendants(child)]);

  const order: CodeNode[] = [];
  for (const file of files) {
    order.push(file);
    order.push(...descendants(file).sort((a, b) => lineOf(a) - lineOf(b)));
  }
  return order;
}

export function scheduleReview(
  nodeId: string,
  rating: ReviewRating,
  previous?: ReviewState,
  now = new Date(),
): ReviewState {
  const oldInterval = previous?.intervalDays ?? 0;
  const repetitions = rating === "again" ? 0 : (previous?.repetitions ?? 0) + 1;

  let intervalDays: number;
  switch (rating) {
    case "again": intervalDays = 0; break;
    case "hard": intervalDays = Math.max(1, Math.round(oldInterval * 1.2) || 1); break;
    case "good": intervalDays = oldInterval === 0 ? 1 : Math.max(2, Math.round(oldInterval * 2.5)); break;
    case "easy": intervalDays = oldInterval === 0 ? 4 : Math.max(4, Math.round(oldInterval * 3.5)); break;
  }

  return {
    nodeId,
    intervalDays,
    repetitions,
    dueAt: new Date(now.getTime() + intervalDays * DAY_MS).toISOString(),
    lastRating: rating,
  };
}

export function dueNodeIds(states: ReviewState[], now = new Date()): string[] {
  return [...states]
    .filter((state) => new Date(state.dueAt).getTime() <= now.getTime())
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
    .map((state) => state.nodeId);
}

