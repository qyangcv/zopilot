import type { PdfHelperInstallProgress } from "./types";
import { sha256Hex } from "../../runtime/crypto/sha256";

export { downloadBytes, downloadJson, sha256Hex };

type ByteStreamReader = {
  read(): Promise<{ done?: boolean; value?: Uint8Array | ArrayBuffer }>;
};

async function downloadJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(
      `PDF helper manifest download failed (${response.status}): ${url}`,
    );
  }
  return (await response.json()) as T;
}

async function downloadBytes(
  url: string,
  expectedSize: number,
  onProgress?: (progress: PdfHelperInstallProgress) => void,
): Promise<Uint8Array> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(
      `PDF helper archive download failed (${response.status}): ${url}`,
    );
  }
  const headerSize = Number(response.headers.get("Content-Length") || 0);
  const total = headerSize || expectedSize;
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    onProgress?.({
      phase: "download",
      loaded: bytes.byteLength,
      total,
      percent: progressPercent(bytes.byteLength, total),
    });
    return bytes;
  }
  const reader = response.body.getReader() as ByteStreamReader;
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value) {
      continue;
    }
    const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
    chunks.push(chunk);
    loaded += chunk.byteLength;
    onProgress?.({
      phase: "download",
      loaded,
      total,
      percent: progressPercent(loaded, total),
    });
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function progressPercent(loaded: number, total: number): number | undefined {
  if (!total || total <= 0) {
    return undefined;
  }
  const downloadPercent = Math.min(loaded / total, 1);
  return Math.max(5, Math.min(90, Math.round(downloadPercent * 90)));
}
