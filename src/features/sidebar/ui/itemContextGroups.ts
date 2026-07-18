import type {
  NoteContextRef,
  SourceMention,
} from "../../../domain/conversation";

function countItemContextSelections(
  mentions: SourceMention[],
  noteContexts: NoteContextRef[],
  includeImplicitDefault = false,
): number {
  return (
    mentions.length + noteContexts.length + (includeImplicitDefault ? 1 : 0)
  );
}

export { countItemContextSelections };
