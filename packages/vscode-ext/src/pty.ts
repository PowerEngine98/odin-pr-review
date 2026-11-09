import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";

export interface Pty {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(listener: (data: string) => void): void;
  onExit(listener: (code: number) => void): void;
}

export interface PtyOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  cols: number;
  rows: number;
}

interface NodePty {
  spawn(
    file: string,
    args: string[],
    options: { name: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv },
  ): {
    write(data: string): void;
    resize(cols: number, rows: number): void;
    kill(): void;
    onData(listener: (data: string) => void): void;
    onExit(listener: (event: { exitCode: number }) => void): void;
  };
}

let found: NodePty | null | undefined;

export function editorPty(appRoot: string | undefined): NodePty | null {
  if (found !== undefined) return found;
  found = null;
  if (!appRoot) return found;
  const require = createRequire(typeof __filename === "string" ? __filename : join(process.cwd(), "odin.js"));
  for (const where of ["node_modules", "node_modules.asar", "node_modules.asar.unpacked"]) {
    try {
      found = require(join(appRoot, where, "node-pty")) as NodePty;
      return found;
    } catch {
      continue;
    }
  }
  return found;
}

export const PYTHON_PTY = `
import fcntl, os, pty, select, signal, struct, sys, termios
cols, rows = int(sys.argv[1]), int(sys.argv[2])
argv = sys.argv[3:]
def size(fd, c, r):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", r, c, 0, 0))
pid, fd = pty.fork()
if pid == 0:
    size(0, cols, rows)
    try:
        os.execvp(argv[0], argv)
    except OSError as error:
        os.write(2, ("odin: %s\\r\\n" % error).encode())
        os._exit(127)
size(fd, cols, rows)
control = b""
inputs = [fd, 0, 3]
while True:
    try:
        ready, _, _ = select.select(inputs, [], [])
    except InterruptedError:
        continue
    if fd in ready:
        try:
            chunk = os.read(fd, 65536)
        except OSError:
            chunk = b""
        if not chunk:
            break
        os.write(1, chunk)
    if 0 in ready:
        data = os.read(0, 65536)
        if not data:
            inputs.remove(0)
        else:
            os.write(fd, data)
    if 3 in ready:
        data = os.read(3, 4096)
        if not data:
            inputs.remove(3)
        control += data
        while b"\\n" in control:
            line, control = control.split(b"\\n", 1)
            parts = line.split()
            if len(parts) == 2:
                size(fd, int(parts[0]), int(parts[1]))
                os.kill(pid, signal.SIGWINCH)
_, status = os.waitpid(pid, 0)
sys.exit(os.waitstatus_to_exitcode(status) if hasattr(os, "waitstatus_to_exitcode") else status >> 8)
`;

export function pythonPty(file: string, args: string[], options: PtyOptions): Pty {
  const child = spawn("python3", ["-c", PYTHON_PTY, String(options.cols), String(options.rows), file, ...args], {
    cwd: options.cwd,
    env: options.env,
    stdio: ["pipe", "pipe", "pipe", "pipe"],
  });
  const control = child.stdio[3] as NodeJS.WritableStream;
  const data: ((text: string) => void)[] = [];
  const exits: ((code: number) => void)[] = [];
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (text: string) => data.forEach((listener) => listener(text)));
  child.stderr?.on("data", (text: string) => data.forEach((listener) => listener(text)));
  child.on("error", (error) => {
    data.forEach((listener) => listener(`odin: ${error.message}\r\n`));
    exits.forEach((listener) => listener(127));
  });
  child.on("exit", (code) => exits.forEach((listener) => listener(code ?? 0)));
  return {
    write: (text) => {
      child.stdin?.write(text);
    },
    resize: (cols, rows) => {
      control.write(`${cols} ${rows}\n`);
    },
    kill: () => {
      child.kill();
    },
    onData: (listener) => {
      data.push(listener);
    },
    onExit: (listener) => {
      exits.push(listener);
    },
  };
}

export function openPty(file: string, args: string[], options: PtyOptions, appRoot?: string): Pty {
  const native = editorPty(appRoot);
  if (!native) {
    if (process.platform === "win32") {
      throw new Error("An interactive terminal needs the editor's own terminal support, which Odin could not find.");
    }
    return pythonPty(file, args, options);
  }
  const term = native.spawn(file, args, {
    name: "xterm-256color",
    cols: options.cols,
    rows: options.rows,
    cwd: options.cwd,
    env: options.env,
  });
  return {
    write: (text) => term.write(text),
    resize: (cols, rows) => term.resize(cols, rows),
    kill: () => term.kill(),
    onData: (listener) => term.onData(listener),
    onExit: (listener) => term.onExit((event) => listener(event.exitCode)),
  };
}
