export type NodeKind =
  | "workspace"
  | "file"
  | "class"
  | "interface"
  | "function"
  | "method"
  | "type"
  | "enum";

export interface SourceLocation {
  file: string;
  start: number;
  end: number;
  line: number;
}

export interface CodeNode {
  id: string;
  kind: NodeKind;
  name: string;
  qualifiedName: string;
  signature?: string;
  location?: SourceLocation;
  parentId?: string;
  childIds: string[];
}

export type EdgeKind = "contains" | "imports";

export interface CodeEdge {
  from: string;
  to: string;
  kind: EdgeKind;
}

export interface CodeGraph {
  rootId: string;
  nodes: CodeNode[];
  edges: CodeEdge[];
  indexedAt: string;
}

export interface ReviewState {
  nodeId: string;
  intervalDays: number;
  repetitions: number;
  dueAt: string;
  lastRating: ReviewRating;
}

export type ReviewRating = "again" | "hard" | "good" | "easy";

