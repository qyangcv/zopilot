import { assert } from "chai";
import {
  readSubprocessStream,
  waitForSubprocessResult,
} from "../../../src/runtime/process/subprocess.ts";

describe("subprocess utilities", function () {
  it("drains stream chunks until an empty read", async function () {
    const stream = createStream(["alpha", " beta", ""]);

    assert.equal(await readSubprocessStream(stream), "alpha beta");
  });

  it("returns empty text when a stream read fails", async function () {
    const stream = {
      readString: async () => {
        throw new Error("read failed");
      },
    };

    assert.equal(await readSubprocessStream(stream), "");
  });

  it("collects exit code, stdout, and stderr", async function () {
    const result = await waitForSubprocessResult({
      wait: async () => ({ exitCode: 2 }),
      stdout: createStream(["out", ""]),
      stderr: createStream(["err", ""]),
    });

    assert.deepEqual(result, {
      exitCode: 2,
      stdout: "out",
      stderr: "err",
    });
  });

  it("kills and returns a timeout result when the process hangs", async function () {
    let killedWith: number | undefined;
    const result = await waitForSubprocessResult(
      {
        wait: async () => new Promise<{ exitCode: number }>(() => undefined),
        stdout: createHangingStream(),
        stderr: createHangingStream(),
        kill: async (timeout?: number) => {
          killedWith = timeout;
          return { exitCode: 0 };
        },
      },
      { timeoutMs: 1, killTimeoutMs: 500 },
    );

    assert.deepEqual(result, {
      exitCode: 124,
      stdout: "",
      stderr: "",
    });
    assert.equal(killedWith, 500);
  });
});

function createStream(chunks: string[]) {
  return {
    readString: async () => chunks.shift() || "",
  };
}

function createHangingStream() {
  return {
    readString: async () => new Promise<string>(() => undefined),
  };
}
