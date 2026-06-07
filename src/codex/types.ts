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
};

export type CodexBridgeStatus =
  | "idle"
  | "starting"
  | "ready"
  | "running"
  | "error";
