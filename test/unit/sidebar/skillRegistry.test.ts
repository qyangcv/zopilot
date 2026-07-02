import { assert } from "chai";
import {
  createSkillViews,
  loadSkillViews,
  setSkillEnabled,
} from "../../../src/modules/sidebar/skillRegistry.ts";

describe("sidebar skill registry", function () {
  afterEach(function () {
    delete (globalThis as unknown as { Zotero?: unknown }).Zotero;
  });

  it("marks enabled skills as requiring missing context", function () {
    const skills = createSkillViews(
      { "skill-literature-map": true },
      { hasReader: false, hasWorkspace: true },
    );

    assert.equal(
      skills.find((skill) => skill.id === "skill-literature-map")?.status,
      "available",
    );
    assert.equal(
      skills.find((skill) => skill.id === "skill-method-check")?.status,
      "requires-context",
    );
  });

  it("persists skill enabled overrides", function () {
    const prefWrites = installZoteroMock("{}");

    setSkillEnabled("skill-literature-map", true);

    assert.deepEqual(JSON.parse(prefWrites.current), {
      "skill-literature-map": true,
    });
    assert.isTrue(
      loadSkillViews({ hasReader: true, hasWorkspace: true }).find(
        (skill) => skill.id === "skill-literature-map",
      )?.enabled,
    );
  });

  it("ignores invalid stored skill configuration", function () {
    installZoteroMock('{"skill-literature-map":"yes"}');

    assert.isFalse(
      loadSkillViews({ hasReader: true, hasWorkspace: true }).find(
        (skill) => skill.id === "skill-literature-map",
      )?.enabled,
    );
  });
});

function installZoteroMock(initialValue: string): { current: string } {
  const state = { current: initialValue };
  (
    globalThis as typeof globalThis & {
      Zotero: {
        Prefs: {
          get: (key: string) => unknown;
          set: (key: string, value: unknown) => void;
        };
      };
    }
  ).Zotero = {
    Prefs: {
      get(key) {
        return key.endsWith("skills.enabled") ? state.current : undefined;
      },
      set(key, value) {
        if (key.endsWith("skills.enabled")) {
          state.current = String(value);
        }
      },
    },
  };
  return state;
}
