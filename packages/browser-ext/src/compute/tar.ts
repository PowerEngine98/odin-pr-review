export interface TarFile {
  path: string;
  data: Uint8Array;
}

const decoder = new TextDecoder();

function text(bytes: Uint8Array, from: number, length: number): string {
  const slice = bytes.subarray(from, from + length);
  const end = slice.indexOf(0);
  return decoder.decode(end < 0 ? slice : slice.subarray(0, end));
}

function octal(bytes: Uint8Array, from: number, length: number): number {
  const value = text(bytes, from, length).trim();
  return value ? parseInt(value, 8) : 0;
}

function paxPath(data: Uint8Array): string | undefined {
  for (const record of decoder.decode(data).split("\n")) {
    const match = /^\d+ path=(.*)$/.exec(record);
    if (match) return match[1];
  }
  return undefined;
}

export function* untar(bytes: Uint8Array): Generator<TarFile> {
  let offset = 0;
  let longName: string | undefined;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const size = octal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 48);
    const prefix = text(header, 345, 155);
    const name = text(header, 0, 100);
    const body = bytes.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;

    if (type === "L") {
      longName = text(body, 0, body.length);
      continue;
    }
    if (type === "x") {
      longName = paxPath(body) ?? longName;
      continue;
    }
    if (type === "g") continue;
    const path = longName ?? (prefix ? `${prefix}/${name}` : name);
    longName = undefined;
    if (type === "0" || type === "\0" || type === "7") yield { path, data: body };
  }
}

export async function gunzip(response: Response): Promise<Uint8Array> {
  const stream = response.body!.pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
