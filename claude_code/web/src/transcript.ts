import type { TranscriptItem } from "@addon/shared";

/** Append a transcript item, replacing any existing item with the same id. */
export function appendItem(
  items: TranscriptItem[],
  item: TranscriptItem,
): TranscriptItem[] {
  const idx = items.findIndex((i) => i.id === item.id);
  if (idx >= 0) {
    const next = items.slice();
    next[idx] = item;
    return next;
  }
  return [...items, item];
}

/**
 * Apply a partial patch to the item with `itemId`. Patches merge shallowly; the
 * item's id and (in practice) its kind are preserved by the merge. Unknown ids
 * are ignored.
 */
export function updateItem(
  items: TranscriptItem[],
  itemId: string,
  patch: Partial<TranscriptItem>,
): TranscriptItem[] {
  const idx = items.findIndex((i) => i.id === itemId);
  if (idx < 0) return items;
  const next = items.slice();
  next[idx] = { ...next[idx], ...patch, id: itemId } as TranscriptItem;
  return next;
}
