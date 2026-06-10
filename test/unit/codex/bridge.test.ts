import { assert } from "chai";
import { buildCodexAppServerArguments } from "../../../src/codex/appServerConfig.ts";

describe("CodexBridge", function () {
  it("starts app-server with Zotero conflict isolation config", function () {
    const args = buildCodexAppServerArguments();

    assert.deepEqual(args.slice(0, 2), ["app-server", "--stdio"]);
    assert.include(args, 'plugins."zotero@openai-curated".enabled=false');
    assert.include(args, "mcp_servers.llm_for_zotero.enabled=false");
  });
});
