import { assert } from "chai";
import {
  buildSidebarCommands,
  filterSidebarCommands,
} from "../../../src/modules/sidebar/app/commandRegistry.ts";
import type {
  SidebarPromptView,
  SidebarState,
} from "../../../src/modules/sidebar/app/types.ts";

describe("sidebar command registry", function () {
  it("builds commands across the required product categories", function () {
    const commands = buildSidebarCommands(createState());
    const categories = new Set(commands.map((command) => command.category));

    assert.deepEqual([...categories].sort(), [
      "attachment",
      "prompt",
      "reader",
      "session",
      "source",
    ]);
  });

  it("filters commands with Chinese aliases", function () {
    const matches = filterSidebarCommands(
      buildSidebarCommands(createState()),
      "附件",
    );

    assert.deepEqual(
      matches.map((command) => command.id),
      ["attachment.upload"],
    );
  });

  it("makes custom prompts available when the composer is ready", function () {
    const commands = buildSidebarCommands(
      createState({
        prompts: TEST_PROMPTS,
      }),
    );

    assert.isTrue(
      commands.find((command) => command.id === "prompt.custom-critique")
        ?.available,
    );
  });

  it("disables prompt commands while the composer is unavailable", function () {
    const commands = buildSidebarCommands(
      createState({
        composerEnabled: false,
        prompts: TEST_PROMPTS,
      }),
    );

    const promptCommand = commands.find(
      (command) => command.id === "prompt.custom-critique",
    );
    assert.isFalse(promptCommand?.available);
    assert.equal(
      promptCommand?.disabledReason,
      "Composer is not ready for prompt insertion.",
    );
  });
});

const TEST_PROMPTS: SidebarPromptView[] = [
  {
    id: "custom-critique",
    title: "Critique paper",
    body: "Critique {{paper}}.",
    variables: ["paper"],
    scope: "global",
    updatedAt: "2026-06-13T07:00:00.000Z",
    custom: true,
  },
];

function createState(patch: Partial<SidebarState> = {}): SidebarState {
  return {
    title: "Paper",
    context: {
      label: "Paper",
      workspaceKey: "item:1:AAA",
      paperKey: "1:AAA",
    },
    messages: [],
    sessions: [],
    sessionsOpen: false,
    sessionsMode: "history",
    composerEnabled: true,
    busy: false,
    models: [],
    selectedModel: "gpt-5.5",
    selectedReasoningEffort: "medium",
    availableReasoningEfforts: ["medium"],
    codexStatus: "connected",
    focusToken: 0,
    sourceCandidates: [],
    collectionOptions: [],
    prompts: TEST_PROMPTS,
    ...patch,
  };
}
