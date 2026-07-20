import { ReviewRating, ReviewState } from "./model";

const DAY_MS = 86_400_000;

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

