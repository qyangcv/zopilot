export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonRpcId = number;

export type JsonRpcRequest = {
  id: JsonRpcId;
  method: string;
  params?: JsonValue;
};

export type JsonRpcNotification = {
  method: string;
  params?: JsonValue;
};

export type JsonRpcResponse = {
  id: JsonRpcId;
  result?: JsonValue;
  error?: {
    code?: number;
    message?: string;
    data?: JsonValue;
  };
};

export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcResponse;

export type CodexSubprocessModule = {
  call(options: {
    command: string;
    arguments?: string[];
    environmentAppend?: boolean;
    stderr?: "ignore" | "stdout" | "pipe";
    workdir?: string;
  }): Promise<CodexSubprocessProcess>;
  getEnvironment(): Record<string, string>;
  pathSearch(
    command: string,
    environment?: Record<string, string>,
  ): Promise<string>;
};

export type CodexSubprocessProcess = {
  stdin: {
    write(buffer: string): Promise<unknown>;
    close(force?: boolean): Promise<unknown>;
  };
  stdout: {
    readString(length?: number | null): Promise<string>;
  };
  stderr?: {
    readString(length?: number | null): Promise<string>;
  };
  wait(): Promise<{ exitCode: number }>;
  kill(timeout?: number): Promise<{ exitCode: number }>;
};

export type CodexAccount =
  | {
      type: "chatgpt";
      email?: string;
      planType?: string;
    }
  | {
      type: "apiKey" | "amazonBedrock";
    };

export type CodexAccountReadResult = {
  account: CodexAccount | null;
  requiresOpenaiAuth: boolean;
};

export type CodexPromptResult = {
  threadId: string;
  turnId?: string;
  text: string;
};

export type CodexPromptOptions = {
  onDelta?: (delta: string, fullText: string) => void;
  onNotice?: (notice: string) => void;
  onToolActivity?: () => void;
};

export type CodexBridgeStatus =
  | "idle"
  | "starting"
  | "ready"
  | "running"
  | "error";
