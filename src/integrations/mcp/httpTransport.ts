type McpHttpRequest = {
  method: string;
  headers: Record<string, string>;
  data: unknown;
};

type McpHttpResponse = {
  status: number;
  headers: Record<string, string>;
  body?: string;
};

function validateRequestSecurity(
  request: McpHttpRequest,
  token: string,
): string | undefined {
  const authorization = getHeader(request.headers, "authorization");
  if (authorization !== `Bearer ${token}`) {
    return "Invalid MCP Authorization header.";
  }
  const host = getHeader(request.headers, "host");
  if (host && !isAllowedHost(host)) {
    return `Rejected MCP Host header: ${host}`;
  }
  const origin = getHeader(request.headers, "origin");
  if (origin && !isAllowedOrigin(origin)) {
    return `Rejected MCP Origin header: ${origin}`;
  }
  return undefined;
}

function toWebRequest(request: McpHttpRequest, url: string): Request {
  const body =
    request.method === "GET" || request.method === "HEAD"
      ? undefined
      : typeof request.data === "string"
        ? request.data
        : JSON.stringify(request.data);
  return new Request(url, {
    method: request.method,
    headers: request.headers,
    body,
  });
}

async function fromWebResponse(response: Response): Promise<McpHttpResponse> {
  const body = await response.text();
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    headers[name] = value;
  });
  return {
    status: response.status,
    headers,
    body: body || undefined,
  };
}

function errorResponse(status: number, message: string): McpHttpResponse {
  return {
    status,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ error: message }),
  };
}

function getHeader(
  headers: Record<string, string>,
  name: string,
): string | undefined {
  const direct = headers[name];
  if (direct !== undefined) return direct;
  const foundKey = Object.keys(headers).find(
    (key) => key.toLowerCase() === name.toLowerCase(),
  );
  return foundKey ? headers[foundKey] : undefined;
}

function isAllowedHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return (
    normalized.startsWith("127.0.0.1:") || normalized.startsWith("localhost:")
  );
}

function isAllowedOrigin(origin: string): boolean {
  if (origin === "null") return true;
  try {
    const parsed = new URL(origin);
    return (
      parsed.protocol === "http:" &&
      (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost")
    );
  } catch {
    return false;
  }
}

export {
  errorResponse,
  fromWebResponse,
  toWebRequest,
  validateRequestSecurity,
};
export type { McpHttpRequest, McpHttpResponse };
