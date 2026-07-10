type SubprocessReadableStream = {
  readString(length?: number | null): Promise<string>;
};

type StdioSubprocess = {
  stdin: {
    write(buffer: string): Promise<unknown>;
    close(force?: boolean): Promise<unknown>;
  };
  stdout: SubprocessReadableStream;
  stderr?: SubprocessReadableStream;
  wait(): Promise<{ exitCode: number }>;
  kill(timeout?: number): Promise<{ exitCode: number }>;
};

type StdioSubprocessModule<TProcess extends StdioSubprocess = StdioSubprocess> =
  {
    call(options: {
      command: string;
      arguments?: string[];
      environment?: Record<string, string>;
      environmentAppend?: boolean;
      stdout?: "ignore" | "pipe";
      stderr?: "ignore" | "stdout" | "pipe";
      workdir?: string;
    }): Promise<TProcess>;
    getEnvironment(): Record<string, string>;
  };

export type {
  StdioSubprocess,
  StdioSubprocessModule,
  SubprocessReadableStream,
};
