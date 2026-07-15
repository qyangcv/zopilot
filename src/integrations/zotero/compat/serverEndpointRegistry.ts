type ZoteroEndpointConstructor = new () => object;

type EndpointRegistration =
  | { ok: true; alreadyRegistered: boolean }
  | {
      ok: false;
      code: "api_unavailable" | "path_conflict" | "registration_failed";
      message: string;
    };

class ZoteroServerEndpointRegistry {
  private owned?: {
    path: string;
    constructor: ZoteroEndpointConstructor;
  };

  register(
    path: string,
    constructor: ZoteroEndpointConstructor,
  ): EndpointRegistration {
    const endpoints = getEndpoints();
    if (!endpoints) {
      return {
        ok: false,
        code: "api_unavailable",
        message: "Zotero.Server.Endpoints is unavailable",
      };
    }
    const existing = endpoints[path];
    if (existing === constructor) {
      this.owned = { path, constructor };
      return { ok: true, alreadyRegistered: true };
    }
    if (existing !== undefined) {
      return {
        ok: false,
        code: "path_conflict",
        message: `Zotero endpoint path is already registered: ${path}`,
      };
    }
    endpoints[path] = constructor;
    if (endpoints[path] !== constructor) {
      return {
        ok: false,
        code: "registration_failed",
        message: `Zotero endpoint registration was not retained: ${path}`,
      };
    }
    this.owned = { path, constructor };
    return { ok: true, alreadyRegistered: false };
  }

  unregister(): boolean {
    const owned = this.owned;
    this.owned = undefined;
    const endpoints = getEndpoints();
    if (!owned || !endpoints || endpoints[owned.path] !== owned.constructor) {
      return false;
    }
    delete endpoints[owned.path];
    return true;
  }
}

function getEndpoints(): Record<string, unknown> | undefined {
  const server = (globalThis as { Zotero?: { Server?: unknown } }).Zotero
    ?.Server as { Endpoints?: unknown } | undefined;
  return server?.Endpoints && typeof server.Endpoints === "object"
    ? (server.Endpoints as Record<string, unknown>)
    : undefined;
}

export { ZoteroServerEndpointRegistry };
export type { EndpointRegistration, ZoteroEndpointConstructor };
