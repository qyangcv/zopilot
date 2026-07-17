import type {
  NoteContextRef,
  SourceMention,
} from "../../../domain/conversation";

type ItemContextReference = Pick<SourceMention, "libraryID" | "parentItemKey">;

function itemContextKey(item: ItemContextReference): string {
  return `${item.libraryID}:${item.parentItemKey}`;
}

function rootItemMentions(mentions: SourceMention[]): SourceMention[] {
  const seen = new Set<string>();
  return mentions.filter((mention) => {
    const key = itemContextKey(mention);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function ungroupedNoteContexts(
  mentions: SourceMention[],
  noteContexts: NoteContextRef[],
): NoteContextRef[] {
  const mentionedItemKeys = new Set(mentions.map(itemContextKey));
  return noteContexts.filter(
    (note) => !mentionedItemKeys.has(itemContextKey(note)),
  );
}

function countItemContextSelections(
  mentions: SourceMention[],
  noteContexts: NoteContextRef[],
  includeImplicitDefault = false,
): number {
  return (
    mentions.length + noteContexts.length + (includeImplicitDefault ? 1 : 0)
  );
}

function sameItemContext(
  left: ItemContextReference,
  right: ItemContextReference,
): boolean {
  return itemContextKey(left) === itemContextKey(right);
}

export {
  countItemContextSelections,
  rootItemMentions,
  sameItemContext,
  ungroupedNoteContexts,
};
