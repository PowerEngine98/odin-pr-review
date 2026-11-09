import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createInterface } from "node:readline";
import type { ReadableStream } from "node:stream/web";

/**
 * Kokoro, a neural voice that runs on this machine, set up and spoken through.
 *
 * Everything it needs lives in one folder of the extension's own storage, and
 * nothing outside it is touched: removing the folder removes all of it.
 *
 * The setup, in the order it runs:
 *
 * 1. `uv`, Astral's Python manager, downloaded at a pinned version for this
 *    platform. It is what makes the rest possible without asking the reader for
 *    a Python: whatever is installed may be too new or too old for the
 *    packages, and uv fetches a standalone interpreter of its own.
 * 2. A virtual environment on that interpreter, Python 3.12.
 * 3. `kokoro-onnx` installed into it. ONNX rather than the PyTorch package: a
 *    tenth of the size, and it carries its own espeak-ng, which the PyTorch
 *    package expects the system to have.
 * 4. The model and the voices, from the kokoro-onnx releases. Half precision,
 *    which sounds like the full model at half the download.
 * 5. One sentence spoken, to prove the whole chain works before saying so.
 *
 * Each step is skipped when what it makes is already there, so a setup that
 * failed half way resumes rather than starting over. Success is a file written
 * last, and its version is what a later Odin compares against to decide whether
 * to set up again.
 */

const SETUP_VERSION = 1;
const UV_VERSION = "0.13.7";
const PYTHON_VERSION = "3.12";
const PACKAGE = "kokoro-onnx==0.6.1";
const MODELS = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0";
const MODEL = "kokoro-v1.0.fp16.onnx";
const VOICES = "voices-v1.0.bin";

/** The uv build for this machine, or nothing where there is none. */
function uvAsset(): string | undefined {
  const arch = process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : "";
  if (!arch) return undefined;
  if (process.platform === "darwin") return `uv-${arch}-apple-darwin.tar.gz`;
  if (process.platform === "linux") return `uv-${arch}-unknown-linux-gnu.tar.gz`;
  if (process.platform === "win32" && arch === "x86_64") return "uv-x86_64-pc-windows-msvc.zip";
  return undefined;
}

export interface KokoroOptions {
  voice: string;
  speed: number;
}

export class Kokoro {
  private process: ChildProcess | undefined;
  private loaded: Promise<void> | undefined;
  private readonly waiting = new Map<number, (answer: Spoken) => void>();
  private asked = 0;
  private setting: Promise<boolean> | undefined;

  constructor(
    private readonly root: string,
    private readonly script: string,
    private readonly options: () => KokoroOptions,
  ) {}

  private get python(): string {
    return process.platform === "win32"
      ? join(this.root, "venv", "Scripts", "python.exe")
      : join(this.root, "venv", "bin", "python");
  }

  private get uv(): string {
    return join(this.root, "uv", process.platform === "win32" ? "uv.exe" : "uv");
  }

  static supported(): boolean {
    return uvAsset() !== undefined;
  }

  /** Whether a setup this version of Odin trusts has finished. */
  async ready(): Promise<boolean> {
    try {
      const marker = JSON.parse(await readFile(join(this.root, "ready.json"), "utf8"));
      return marker.version === SETUP_VERSION && existsSync(this.python);
    } catch {
      return false;
    }
  }

  async repair(): Promise<boolean> {
    if (!existsSync(join(this.root, "ready.json")) || existsSync(this.python)) return false;
    await rm(join(this.root, "venv"), { recursive: true, force: true });
    await rm(join(this.root, "ready.json"), { force: true });
    return true;
  }

  static readonly version = SETUP_VERSION;

  /** Sets everything up, once at a time, saying how far it has got. */
  setUp(step: (what: string) => void): Promise<boolean> {
    this.setting ??= this.run(step).finally(() => {
      this.setting = undefined;
    });
    return this.setting;
  }

  private async run(step: (what: string) => void): Promise<boolean> {
    const asset = uvAsset();
    if (!asset) throw new Error(`Kokoro is not available on ${process.platform} ${process.arch}`);
    await mkdir(this.root, { recursive: true });
    const env = {
      ...process.env,
      UV_CACHE_DIR: join(this.root, "cache"),
      UV_PYTHON_INSTALL_DIR: join(this.root, "python"),
      UV_NO_CONFIG: "1",
    };

    if (!existsSync(this.uv)) {
      step("Downloading uv");
      const archive = join(this.root, asset);
      await download(`https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${asset}`, archive);
      const unpacked = join(this.root, "uv-unpacked");
      await rm(unpacked, { recursive: true, force: true });
      await mkdir(unpacked, { recursive: true });
      await run("tar", ["-xf", archive, "-C", unpacked]);
      const binary = await find(unpacked, process.platform === "win32" ? "uv.exe" : "uv");
      if (!binary) throw new Error("uv was not in its archive");
      await mkdir(join(this.root, "uv"), { recursive: true });
      await rename(binary, this.uv);
      await rm(unpacked, { recursive: true, force: true });
      await rm(archive, { force: true });
    }

    if (!existsSync(this.python)) {
      step(`Installing Python ${PYTHON_VERSION}`);
      await run(
        this.uv,
        ["venv", "--managed-python", "--python", PYTHON_VERSION, join(this.root, "venv")],
        env,
      );
    }

    step("Installing Kokoro");
    await run(this.uv, ["pip", "install", "--python", this.python, PACKAGE], env);

    for (const file of [MODEL, VOICES]) {
      const target = join(this.root, file);
      if (existsSync(target)) continue;
      step(`Downloading ${file}`);
      await download(`${MODELS}/${file}`, target);
    }

    step("Trying the voice");
    const tried = await this.speak("Ready.");
    if (!tried.ok) throw new Error(tried.error ?? "Kokoro did not speak");

    await writeFile(join(this.root, "ready.json"), JSON.stringify({ version: SETUP_VERSION }));
    return true;
  }

  /** One sentence as a WAV, base64, or why not. */
  async speak(text: string): Promise<Spoken> {
    try {
      await this.start();
    } catch (error) {
      return { ok: false, error: String(error) };
    }
    const id = ++this.asked;
    const { voice, speed } = this.options();
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.process?.stdin?.write(JSON.stringify({ id, text, voice, speed }) + "\n");
    });
  }

  private start(): Promise<void> {
    if (this.loaded) return this.loaded;
    const { voice, speed } = this.options();
    const child = spawn(
      this.python,
      [this.script, join(this.root, MODEL), join(this.root, VOICES), voice, String(speed)],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    this.process = child;
    let failure = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      failure = (failure + chunk.toString()).slice(-2000);
    });
    this.loaded = new Promise((resolve, reject) => {
      const lines = createInterface({ input: child.stdout! });
      lines.on("line", (line) => {
        let message: { ready?: boolean; id?: number } & Spoken;
        try {
          message = JSON.parse(line);
        } catch {
          return;
        }
        if (message.ready) {
          resolve();
          return;
        }
        const answer = typeof message.id === "number" ? this.waiting.get(message.id) : undefined;
        if (!answer) return;
        this.waiting.delete(message.id!);
        answer({ ok: message.ok, audio: message.audio, error: message.error });
      });
      const ended = (why: string) => {
        if (this.process === child) {
          this.process = undefined;
          this.loaded = undefined;
        }
        reject(new Error(why));
        for (const answer of this.waiting.values()) answer({ ok: false, error: why });
        this.waiting.clear();
      };
      child.once("error", (error) => ended(String(error)));
      child.once("exit", (code) => ended(`Kokoro stopped (${code}). ${failure.trim()}`));
    });
    return this.loaded;
  }

  dispose(): void {
    this.process?.kill();
    this.process = undefined;
    this.loaded = undefined;
  }
}

export interface Spoken {
  ok: boolean;
  audio?: string;
  error?: string;
}

function run(file: string, args: string[], env?: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { env, maxBuffer: 16 * 1024 * 1024 }, (error, _out, err) => {
      if (error) reject(new Error(`${file.split(/[\\/]/).pop()} failed: ${err || error.message}`));
      else resolve();
    });
  });
}

/** A file fetched whole, or not at all: written beside its name, then moved. */
async function download(url: string, target: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`${url} answered ${response.status}`);
  const partial = `${target}.part`;
  await pipeline(
    Readable.fromWeb(response.body as unknown as ReadableStream),
    createWriteStream(partial),
  );
  const expected = Number(response.headers.get("content-length") ?? 0);
  const got = (await stat(partial)).size;
  if (expected > 0 && got !== expected) {
    await rm(partial, { force: true });
    throw new Error(`${url} arrived cut short`);
  }
  await rename(partial, target);
}

async function find(folder: string, name: string): Promise<string | undefined> {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isFile() && entry.name === name) return path;
    if (entry.isDirectory()) {
      const deeper = await find(path, name);
      if (deeper) return deeper;
    }
  }
  return undefined;
}
