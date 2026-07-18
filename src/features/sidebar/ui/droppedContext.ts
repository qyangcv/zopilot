import {
  MAX_LOCAL_ATTACHMENTS,
  MAX_SELECTED_CONTEXTS,
} from "../../../domain/contextSelection";
import type {
  LocalAttachmentRef,
  NoteContextRef,
  SourceMention,
} from "../../../domain/conversation";
import type { DroppedContextCandidate } from "../context/ZoteroDroppedContextResolver";
import { sourceToMention } from "./mentions";

type ComposerContextSelection = {
  mentions: SourceMention[];
  noteContexts: NoteContextRef[];
  localAttachments: LocalAttachmentRef[];
};

function mergeDroppedContext(
  current: ComposerContextSelection,
  candidates: DroppedContextCandidate[],
): ComposerContextSelection {
  const mentions = [...current.mentions];
  const noteContexts = [...current.noteContexts];
  const localAttachments = [...current.localAttachments];
  const sourceIDs = new Set(mentions.map((mention) => mention.sourceId));
  const noteIDs = new Set(noteContexts.map((note) => note.id));
  const localPaths = new Set(
    localAttachments.map((attachment) => attachment.path),
  );
  let contextCount = mentions.length + noteContexts.length;

  for (const candidate of candidates) {
    if (candidate.kind === "source") {
      if (
        sourceIDs.has(candidate.source.sourceId) ||
        contextCount >= MAX_SELECTED_CONTEXTS
      ) {
        continue;
      }
      sourceIDs.add(candidate.source.sourceId);
      mentions.push(sourceToMention(candidate.source));
      contextCount += 1;
      continue;
    }
    if (candidate.kind === "note") {
      if (
        noteIDs.has(candidate.note.id) ||
        contextCount >= MAX_SELECTED_CONTEXTS
      ) {
        continue;
      }
      noteIDs.add(candidate.note.id);
      noteContexts.push(candidate.note);
      contextCount += 1;
      continue;
    }
    if (
      localPaths.has(candidate.attachment.path) ||
      localAttachments.length >= MAX_LOCAL_ATTACHMENTS
    ) {
      continue;
    }
    localPaths.add(candidate.attachment.path);
    localAttachments.push(candidate.attachment);
  }

  return { mentions, noteContexts, localAttachments };
}

function removeMentionFromComposerContext(
  current: ComposerContextSelection,
  mentionId: string,
): ComposerContextSelection {
  return {
    ...current,
    mentions: current.mentions.filter((mention) => mention.id !== mentionId),
  };
}

export { mergeDroppedContext, removeMentionFromComposerContext };
export type { ComposerContextSelection };
