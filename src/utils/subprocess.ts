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

  if (!options.timeoutMs) {
    return completed;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<SubprocessResult>((resolve) => {
    timer = setTimeout(
      () =>
        void Promise.resolve(process.kill?.(options.killTimeoutMs))
          .catch(() => undefined)
          .then(() =>
            resolve({
              exitCode: options.timeoutExitCode ?? 124,
              stdout: "",
              stderr: "",
            }),
          ),
      options.timeoutMs,
    );
  });

  const result = await Promise.race([completed, timeout]);
  if (timer) {
    clearTimeout(timer);
  }
  return result;
}
