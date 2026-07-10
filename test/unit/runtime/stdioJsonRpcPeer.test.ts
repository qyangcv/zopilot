import { assert } from "chai";
import { StdioJsonRpcPeer } from "../../../src/runtime/json-rpc/StdioJsonRpcPeer.ts";
import type { StdioSubprocess } from "../../../src/runtime/process/types.ts";

describe("StdioJsonRpcPeer", function () {
  it("frames stdout, routes requests and notifications, and records stderr", async function () {
    const writes: string[] = [];
    const requests: string[] = [];
    const notifications: string[] = [];
    const stderrLines: string[] = [];
    const process = createProcess({
      writes,
      stdout: [
        '{"method":"notice","params":{"value":"a',
        '"}}\n{"id":7,"method":"parent/call"}\n',
        "",
      ],
      stderr: ["first\nsecond\n", ""],
    });
    const peer = createPeer(process, {
      onRequest: (message) => requests.push(message.method),
      onNotification: (message) => notifications.push(message.method),
      onStderrLine: (line) => stderrLines.push(line),
    });

    peer.start();
    await flush();

    assert.deepEqual(notifications, ["notice"]);
    assert.deepEqual(requests, ["parent/call"]);
    assert.deepEqual(stderrLines, ["first", "second"]);

    const pending = peer.request("model/list", { limit: 10 });
    await flush();
    const request = JSON.parse(writes[0]) as { id: number; method: string };
    assert.equal(request.method, "model/list");
    peer.handleLine(JSON.stringify({ id: request.id, result: ["a"] }));
    assert.deepEqual(await pending, ["a"]);
  });

  it("preserves request timeout and remote error messages", async function () {
    const writes: string[] = [];
    const process = createProcess({ writes });
    const peer = createPeer(process);

    const timedOut = peer.request("slow", undefined, 5);
    await assertRejected(timedOut, "peer timed out: slow");

    const failed = peer.request("model/list");
    await flush();
    const request = JSON.parse(writes.at(-1)!) as { id: number };
    peer.handleLine(
      JSON.stringify({ id: request.id, error: { message: "denied" } }),
    );
    await assertRejected(failed, "model/list: denied");
  });

  it("rejects pending requests when the child process exits", async function () {
    const writes: string[] = [];
    const exit = deferred<{ exitCode: number }>();
    const exited: number[] = [];
    const process = createProcess({ writes, wait: exit.promise });
    const peer = createPeer(process, {
      onExit: (exitCode) => exited.push(exitCode),
    });
    peer.start();
    const pending = peer.request("turn/start");
    await flush();

    exit.resolve({ exitCode: 23 });

    await assertRejected(pending, "peer exited (23)");
    assert.deepEqual(exited, [23]);
  });
});

function createPeer(
  process: StdioSubprocess,
  callbacks: Partial<{
    onRequest: NonNullable<
      ConstructorParameters<typeof StdioJsonRpcPeer>[0]["onRequest"]
    >;
    onNotification: NonNullable<
      ConstructorParameters<typeof StdioJsonRpcPeer>[0]["onNotification"]
    >;
    onStderrLine: NonNullable<
      ConstructorParameters<typeof StdioJsonRpcPeer>[0]["onStderrLine"]
    >;
    onExit: NonNullable<
      ConstructorParameters<typeof StdioJsonRpcPeer>[0]["onExit"]
    >;
  }> = {},
): StdioJsonRpcPeer {
  return new StdioJsonRpcPeer({
    process,
    requestTimeoutMessage: (method) => `peer timed out: ${method}`,
    responseErrorFallback: "peer error",
    exitError: (exitCode) => new Error(`peer exited (${exitCode})`),
    ...callbacks,
  });
}

function createProcess(options: {
  writes: string[];
  stdout?: string[];
  stderr?: string[];
  wait?: Promise<{ exitCode: number }>;
}): StdioSubprocess {
  const stdout = [...(options.stdout || [])];
  const stderr = [...(options.stderr || [])];
  return {
    stdin: {
      write: async (line) => {
        options.writes.push(line);
      },
      close: async () => undefined,
    },
    stdout: {
      readString: async () => stdout.shift() || "",
    },
    stderr: {
      readString: async () => stderr.shift() || "",
    },
    wait: async () => options.wait || new Promise(() => undefined),
    kill: async () => ({ exitCode: 0 }),
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function assertRejected(
  promise: Promise<unknown>,
  expectedMessage: string,
): Promise<void> {
  try {
    await promise;
    assert.fail("Expected promise to reject.");
  } catch (error) {
    assert.include(
      error instanceof Error ? error.message : String(error),
      expectedMessage,
    );
  }
}
