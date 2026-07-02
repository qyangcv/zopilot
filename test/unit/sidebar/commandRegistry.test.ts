import { assert } from "chai";
import {
  DEFAULT_PROMPTS,
  buildSidebarCommands,
  filterSidebarCommands,
} from "../../../src/modules/sidebar/app/commandRegistry.ts";
import type { SidebarState } from "../../../src/modules/sidebar/app/types.ts";
import {
  DEFAULT_SKILLS,
  createSkillViews,
} from "../../../src/modules/sidebar/skillRegistry.ts";

describe("sidebar command registry", function () {
  it("builds commands across the required product categories", function () {
    const commands = buildSidebarCommands(createState());
    const categories = new Set(commands.map((command) => command.category));

    assert.deepEqual([...categories].sort(), [
      "attachment",
      "prompt",
      "reader",
      "session",
      "skill",
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

  it("makes prompts and context-ready skills available", function () {
    const commands = buildSidebarCommands(
      createState({
        skills: createSkillViews(
          { "skill-literature-map": true },
          { hasWorkspace: true, hasReader: true },
        ),
      }),
    );

    assert.isTrue(
      commands.find((command) => command.id === "prompt.prompt-critique")
        ?.available,
    );
    assert.isTrue(
      commands.find((command) => command.id === "skill.skill-literature-map")
        ?.available,
    );
  });
});

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
    prompts: DEFAULT_PROMPTS,
    skills: DEFAULT_SKILLS,
    ...patch,
  };
}
