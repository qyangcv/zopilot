import type { ThreadRunInput } from "../../domain/thread";
import { createPaperBindingHeaders } from "./workspaceBinding";
import { startMcpHttpServer } from "./httpServer";

export {
  buildZopilotMcpConnection,
  type ZopilotMcpConnection,
  type ZopilotMcpConnectionResult,
};

type ZopilotMcpConnection = {
  url: string;
  headers: Record<string, string>;
  serverName: string;
  acceptsImages: boolean;
  timeoutMs: number;
};

type ZopilotMcpConnectionResult =
  | { status: "ready"; connection: ZopilotMcpConnection }
  | {
      status: "disabled";
      diagnostic: { code: string; message: string };
    };

async function buildZopilotMcpConnection(
  binding: Pick<ThreadRunInput, "workspace" | "context">,
  options: {
    acceptsImages: boolean;
    timeoutMs: number;
  },
): Promise<ZopilotMcpConnectionResult> {
  const server = await startMcpHttpServer();
  if (server.status === "disabled") return server;
  return {
    status: "ready",
    connection: {
      url: server.url,
      serverName: server.name,
      headers: {
        Authorization: `Bearer ${server.token}`,
        ...createPaperBindingHeaders(binding, {
          acceptsImages: options.acceptsImages,
        }),
      },
      acceptsImages: options.acceptsImages,
      timeoutMs: options.timeoutMs,
    },
  };
}
