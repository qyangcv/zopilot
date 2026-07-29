import type {
  ConversationMessage,
  ConversationMetadata,
  PaperIdentity,
} from "../../../domain/conversation";

type LegacyConversationMetadata = Omit<
  ConversationMetadata,
  "revision" | "activeSources" | "primarySourceId"
> & {
  codexThreadId?: string;
  backendId?: string;
  providerProfileId?: string;
};

type LegacyConversationMessage = ConversationMessage & {
  codexThreadId?: string;
  codexTurnId?: string;
  backendRunId?: string;
  backendTurnId?: string;
};

type LegacyPaperConversationMetadata = PaperIdentity & {
  id: string;
  scope: "paper";
  label: string;
  createdAt: string;
  updatedAt: string;
  latestPreview?: string;
  archived?: boolean;
  codexThreadId?: string;
  backendId?: string;
  providerProfileId?: string;
};

type LegacyConversation = {
  metadata: LegacyConversationMetadata;
  messages: LegacyConversationMessage[];
};

export type {
  LegacyConversation,
  LegacyConversationMessage,
  LegacyConversationMetadata,
  LegacyPaperConversationMetadata,
};
