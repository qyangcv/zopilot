import { createAbortError } from "../cancellation";

export {
  readSubprocessStream,
  waitForSubprocessResult,
  type SubprocessReadableStream,
  type SubprocessResult,
};

type SubprocessReadableStream = {
  readString(length?: number | null): Promise<string>;
};

type SubprocessLike = {
  stdout?: SubprocessReadableStream;
  stderr?: SubprocessReadableStream;
  wait(): Promise<{ exitCode: number }>;
  kill?(timeout?: number): Promise<unknown>;
};

type SubprocessResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type WaitOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  killTimeoutMs?: number;
  timeoutExitCode?: number;
};

async function readSubprocessStream(
  stream?: SubprocessReadableStream,
): Promise<string> {
  if (!stream) {
    return "";
  }
  let output = "";
  while (true) {
    const chunk = await stream.readString().catch(() => "");
    if (!chunk) {
      return output;
    }
    output += chunk;
  }
}

async function waitForSubprocessResult(
  process: SubprocessLike,
  options: WaitOptions = {},
): Promise<SubprocessResult> {
  const completed = Promise.all([
    process.wait(),
    readSubprocessStream(process.stdout),
    readSubprocessStream(process.stderr),
  ]).then(([waitResult, stdout, stderr]) => ({
    exitCode: waitResult.exitCode,
    stdout,
    stderr,
  }));

  if (!options.timeoutMs && !options.signal) {
    return completed;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  const pending: Array<Promise<SubprocessResult>> = [completed];
  if (options.timeoutMs) {
    pending.push(
      new Promise<SubprocessResult>((resolve) => {
        timer = setTimeout(
          () =>
            void killProcess(process, options.killTimeoutMs).then(() =>
              resolve({
                exitCode: options.timeoutExitCode ?? 124,
                stdout: "",
                stderr: "",
              }),
            ),
          options.timeoutMs,
        );
      }),
    );
  }
  if (options.signal) {
    pending.push(
      new Promise<SubprocessResult>((_resolve, reject) => {
        abortListener = () => {
          void killProcess(process, options.killTimeoutMs).then(() =>
            reject(createAbortError(options.signal)),
          );
        };
        if (options.signal?.aborted) {
          abortListener();
        } else {
          options.signal?.addEventListener("abort", abortListener, {
            once: true,
          });
        }
      }),
    );
  }

  try {
    return await Promise.race(pending);
  } finally {
    if (timer) clearTimeout(timer);
    if (abortListener) {
      options.signal?.removeEventListener("abort", abortListener);
    }
  }
}

async function killProcess(
  process: SubprocessLike,
  timeout?: number,
): Promise<void> {
  await Promise.resolve(process.kill?.(timeout)).catch(() => undefined);
}
