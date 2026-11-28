import { spawn } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { daemonRuns, isShell, launched, listening, parsePs, ProcessWatch, runnable, seconds, shellLine, statusOf, techOf, withColour } from "../src/processes.js";

function until(what: () => boolean, ms = 15_000): Promise<void> {
  const stop = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const look = () => {
      if (what()) resolve();
      else if (Date.now() > stop) reject(new Error("gave up waiting"));
      else setTimeout(look, 100);
    };
    look();
  });
}

describe("the processes an agent starts", () => {
  it("are read from ps, elapsed times included", () => {
    expect(seconds("05")).toBe(5);
    expect(seconds("01:05")).toBe(65);
    expect(seconds("02:01:05")).toBe(7265);
    expect(seconds("1-00:00:01")).toBe(86401);
    expect(parsePs("  10     1 Ss   01:00  0.0  1.5  20480 /bin/zsh -c ./gradlew bootRun\n")).toEqual([
      { pid: 10, ppid: 1, stat: "Ss", seconds: 60, cpu: 0, mem: 1.5, rss: 20480 * 1024, command: "/bin/zsh -c ./gradlew bootRun" },
    ]);
  });

  it("are what runs under the shells the agent opens, not the shells, and not its own helpers", () => {
    const rows = parsePs(
      [
        "100 1 S 10:00 0.0 0.1 1000 claude",
        "101 100 S 10:00 0.0 0.1 1000 node /mcp/server.js",
        "102 100 S 00:30 0.0 0.1 1000 /bin/zsh -c -l eval 'yarn dev'",
        "103 102 S 00:30 0.0 0.1 1000 node /repo/node_modules/.bin/yarn dev",
        "104 103 S 00:29 9.0 0.1 1000 node /repo/node_modules/.bin/vite",
        "105 100 S 00:10 0.0 0.1 1000 bash -c sleep 5; true",
        "106 105 S 00:10 0.0 0.1 1000 sleep 5",
      ].join("\n"),
    );
    expect(isShell("/bin/zsh -c x")).toBe(true);
    expect(isShell("node x")).toBe(false);
    expect(launched(rows, [100]).map((row) => row.pid)).toEqual([103, 106]);
  });

  it("wear the icon of the technology they run, looking through to what they start", () => {
    expect(techOf(["node yarn dev", "node /repo/node_modules/.bin/vite"])).toBe("vite");
    expect(techOf(["./gradlew bootRun", "java -cp gradle-wrapper.jar org.gradle.wrapper.GradleWrapperMain bootRun"])).toBe("spring");
    expect(techOf(["mvn spring-boot:run"])).toBe("spring");
    expect(techOf(["java -cp /lib/spring-boot-3.3.0.jar:/app com.shop.Main"])).toBe("spring");
    expect(techOf(["java -jar app.jar"])).toBe("java");
    expect(techOf(["./gradlew test"])).toBe("gradle");
    expect(techOf(["node server.js"])).toBe("nodejs");
    expect(techOf(["python3 -m http.server"])).toBe("python");
    expect(techOf(["sleep 5"])).toBe("console");
  });

  it("say which ports they listen on, read from lsof", () => {
    expect([...listening("p501\nf12\nn*:8080\np502\nf20\nn127.0.0.1:5173\nf21\nn[::1]:5173\n")]).toEqual([
      [501, [8080]],
      [502, [5173]],
    ]);
  });

  it("are running while they print or work, idle when quiet, and terminated once gone", () => {
    expect(statusOf(true, "S", 0, 1000, 5000)).toBe("running");
    expect(statusOf(true, "S", 3, 0, 60_000)).toBe("running");
    expect(statusOf(true, "S", 0, 0, 60_000)).toBe("idle");
    expect(statusOf(true, "T", 0, 0, 60_000)).toBe("stopped");
    expect(statusOf(false, "S", 0, 0, 60_000)).toBe("terminated");
  });
});

describe.skipIf(process.platform === "win32")("a real process an agent started in the background", () => {
  it("is found, its output followed into its tab, its badge pulsed on each line, and killed with what it started", async () => {
    const dir = mkdtempSync(join(tmpdir(), "odin-proc-"));
    const out = join(dir, "out.txt");
    const shell = spawn("sh", ["-c", `node -e 'require("http").createServer().listen(0);let n=0;setInterval(()=>console.log("tick "+(n++)),300)' > '${out}'; true`], { stdio: "ignore" });
    const posted: { type?: string; lists?: Record<string, { pid: number; icon: string; status: string; beat: number; readable: boolean; ports: number[] }[]>; data?: string }[] = [];
    const watch = new ProcessWatch(
      () => new Map([["claude", [process.pid]]]),
      (message) => posted.push(message as never),
      (name) => `data:${name}`,
    );
    try {
      let found: { pid: number; icon: string; status: string; beat: number; readable: boolean; ports: number[] } | undefined;
      await until(() => {
        void watch.poll();
        const lists = [...posted].reverse().find((one) => one.type === "processes")?.lists;
        found = lists?.claude?.find((one) => one.icon === "nodejs");
        return Boolean(found && found.readable && found.beat > 1 && found.ports.length > 0);
      });
      expect(found!.status).toBe("running");
      expect(found!.ports[0]).toBeGreaterThan(0);
      watch.attach(found!.pid);
      const replay = posted.find((one) => one.type === "procReplay") as { data?: string } | undefined;
      expect(replay?.data).toMatch(/tick \d+/);
      await until(() => {
        void watch.poll();
        return posted.some((one) => one.type === "procData" && /tick/.test(one.data ?? ""));
      });
      await watch.kill(found!.pid);
      await until(() => {
        void watch.poll();
        const lists = [...posted].reverse().find((one) => one.type === "processes")?.lists;
        return lists?.claude?.find((one) => one.pid === found!.pid)?.status === "terminated";
      });
      expect(readFileSync(out, "utf8")).toMatch(/tick 0/);
    } finally {
      watch.stop();
      shell.kill("SIGKILL");
    }
  }, 40_000);
});

describe("the processes strip in an agent's console", () => {
  const read = (path: string) => readFileSync(join(__dirname, "../../webview/src/app/hud", path), "utf8");

  it("takes the place of the CLI's conversation bar, which now only appears to start again", () => {
    const cli = read("Cli.svelte");
    expect(cli).not.toMatch(/Continuing Odin's conversation/);
    expect(cli).toMatch(/\{#if state === "ended"\}\s*<div class="cli-bar">/);
  });

  it("shows each process as an avatar with a state badge that pulses with each write, a tab of its own, and an x that kills and removes it", () => {
    const terminal = read("Terminal.svelte");
    expect(terminal).toMatch(/\{#key proc\.beat\}\s*<span class="proc-badge \{proc\.status\}" class:pulse=/);
    expect(terminal).toMatch(/onclick=\{\(\) => \(tab = `proc:\$\{proc\.pid\}`\)\}/);
    expect(terminal).toMatch(/notify\("procRemove", \{ pid \}\)/);
    expect(terminal).toMatch(/<Proc agent=\{id\} proc=\{opened\} \/>/);
    const proc = read("Proc.svelte");
    expect(proc).toMatch(/PID \{proc\.pid\}/);
    expect(proc).toMatch(/notify\("procKill", \{ pid \}\)/);
    expect(proc).toMatch(/notify\("procAttach", \{ pid \}\)/);
  });

  it("is fed by the host from the agent's CLI and its Log runs", () => {
    const panel = readFileSync(join(__dirname, "../src/panel.ts"), "utf8");
    expect(panel).toMatch(/for \(const \[agent, pid\] of this\.paired\?\.runPids\(\) \?\? \[\]\) add\(agent, pid\);/);
    expect(panel).toMatch(/for \(const agent of this\.terminals\?\.agents\(\) \?\? \[\]\) add\(agent, this\.terminals\?\.pidOf\(agent\)\);/);
  });
});

describe("a Spring server's icon", () => {
  it("is the Spring leaf, in Spring's green, packed with the rest at build", () => {
    const packed = join(__dirname, "../dist/media/file-icons.json");
    const svgs = (JSON.parse(readFileSync(packed, "utf8")) as { svgs: Record<string, string> }).svgs;
    expect(svgs.spring).toMatch(/^<svg fill="#6DB33F" role="img" viewBox="0 0 24 24"/);
    expect(svgs.spring).toMatch(/<title>Spring<\/title>/);
  });
});

describe("a process avatar", () => {
  it("is a round avatar the size of the faces in the drawing's corner, never squashed, with its ports, CPU and RAM in its tooltip", () => {
    const terminal = readFileSync(join(__dirname, "../../webview/src/app/hud/Terminal.svelte"), "utf8");
    expect(terminal).toMatch(/\.proc-avatar \{[^}]*width: 28px;\s*height: 28px;/);
    expect(terminal).toMatch(/\.proc-face \{[^}]*overflow: hidden;\s*border-radius: 50%;/);
    expect(terminal).toMatch(/<span class="proc-face">[\s\S]*?<\/span>\s*\{#key proc\.beat\}/);
    expect(terminal).toMatch(/\{proc\.ports\.length \? ` · port \$\{proc\.ports\.join\(", "\)\}` : ""\}/);
    expect(terminal).toMatch(/\.procs \{\s*display: flex;\s*flex: 0 0 auto;/);
    expect(terminal).toMatch(/<span class="proc-label">\s*<span class="proc-name">\{shortCommand\(proc\.command\)\}<\/span>/);
    expect(terminal).toMatch(/\.proc-label \{[^}]*max-width: 0;[^}]*opacity: 0;[^}]*transition:/);
    expect(terminal).toMatch(/\.proc:hover \.proc-label,\s*\.proc:focus-within \.proc-label \{\s*max-width: 260px;\s*opacity: 1;/);
  });
});

describe("the processes strip, as it fills", () => {
  const rows = (lines: string[]) => lines.join("\n");

  it("orders processes by the memory they and what they started hold, largest first, and drops one ten seconds after it ends", async () => {
    let ps = rows([
      "100 1 S 10:00 0.0 0.1 1000 claude",
      "102 100 S 00:30 0.0 0.0 900 /bin/zsh -c x",
      "103 102 S 00:30 1.0 0.5 10000 node small.js",
      "104 102 S 00:30 2.0 2.0 50000 java -jar big.jar",
      "105 104 S 00:30 3.0 1.0 30000 java child",
    ]);
    const posted: { lists?: Record<string, { pid: number; cpu: number; memPercent: number; memBytes: number; status: string }[]> }[] = [];
    const watch = new ProcessWatch(() => new Map([["claude", [100]]]), (message) => posted.push(message as never), () => undefined, async () => ps);
    await watch.poll();
    const first = posted.at(-1)!.lists!.claude!;
    expect(first.map((one) => one.pid)).toEqual([104, 103]);
    expect(first[0]).toMatchObject({ cpu: 5, memPercent: 3, memBytes: 80000 * 1024 });
    ps = rows(["100 1 S 10:00 0.0 0.1 1000 claude", "102 100 S 00:30 0.0 0.0 900 /bin/zsh -c x", "103 102 S 00:30 1.0 0.5 10000 node small.js"]);
    await watch.poll();
    expect(posted.at(-1)!.lists!.claude!.find((one) => one.pid === 104)?.status).toBe("terminated");
    const real = Date.now;
    Date.now = () => real() + 11_000;
    try {
      await watch.poll();
    } finally {
      Date.now = real;
    }
    expect(posted.at(-1)!.lists!.claude!.map((one) => one.pid)).toEqual([103]);
  });

  it("shows CPU and memory, as values and shares, in the tooltip and the process's tab", () => {
    const store = readFileSync(join(__dirname, "../../webview/src/app/hud/processes.svelte.ts"), "utf8");
    expect(store).toMatch(/return `CPU \$\{proc\.cpu\}% · RAM \$\{sizeOf\(proc\.memBytes\)\} \(\$\{proc\.memPercent\}%\)`;/);
    expect(readFileSync(join(__dirname, "../../webview/src/app/hud/Proc.svelte"), "utf8")).toMatch(/\{usageOf\(proc\)\}/);
    expect(readFileSync(join(__dirname, "../../webview/src/app/hud/Terminal.svelte"), "utf8")).toMatch(/&#10;\{usageOf\(proc\)\}"/);
  });
});

describe("the processes an agent started, after the window reloads", () => {
  it("are picked up again from what was saved: a process still running the same command since the same moment, and the agent's tree walked again", async () => {
    let saved: unknown;
    const memory = { read: () => saved as never, write: (one: unknown) => (saved = JSON.parse(JSON.stringify(one))) };
    const before = [
      "100 1 S 10:00 0.0 0.1 1000 claude",
      "102 100 S 00:30 0.0 0.0 900 /bin/zsh -c x",
      "103 102 S 00:30 1.0 0.5 10000 java -jar app.jar",
    ].join("\n");
    const first = new ProcessWatch(() => new Map([["claude", [100]]]), () => undefined, () => undefined, async () => before, memory);
    await first.poll();
    expect((saved as { procs: { pid: number }[] }).procs.map((one) => one.pid)).toEqual([103]);
    expect((saved as { roots: Record<string, number[]> }).roots).toEqual({ claude: [100] });

    const after = [
      "103 1 S 00:32 1.0 0.5 10000 java -jar app.jar",
      "200 1 S 00:31 0.0 0.0 900 /bin/zsh -c y",
      "201 200 S 00:31 0.0 0.0 900 java -jar unrelated.jar",
    ].join("\n");
    const posted: { lists?: Record<string, { pid: number; status: string }[]> }[] = [];
    const reloaded = new ProcessWatch(() => new Map(), (message) => posted.push(message as never), () => undefined, async () => after, memory);
    await reloaded.poll();
    expect(posted.at(-1)!.lists!.claude!.map((one) => [one.pid, one.status])).toEqual([[103, "running"]]);
  });

  it("is never a different process that happens to have been given the same number", async () => {
    const saved = { roots: {}, procs: [{ pid: 103, agent: "claude", command: "java -jar app.jar", startedAt: Date.now() - 3_600_000 }] };
    const posted: { lists?: Record<string, unknown[]> }[] = [];
    const watch = new ProcessWatch(
      () => new Map(),
      (message) => posted.push(message as never),
      () => undefined,
      async () => "103 1 S 00:05 0.0 0.0 900 java -jar app.jar",
      { read: () => saved, write: () => undefined },
    );
    await watch.poll();
    expect(posted.at(-1)?.lists?.claude ?? []).toEqual([]);
  });
});

describe("what an agent's processes print", () => {
  it("is in colour, as in a terminal, even written to a file: the agent's CLI and its runs ask for it, leaving a choice already made alone", () => {
    expect(withColour({ PATH: "/bin" })).toEqual({ PATH: "/bin", FORCE_COLOR: "1", SPRING_OUTPUT_ANSI_ENABLED: "ALWAYS" });
    expect(withColour({ FORCE_COLOR: "0" }).FORCE_COLOR).toBe("0");
    expect(readFileSync(join(__dirname, "../src/panel.ts"), "utf8")).toMatch(/env: \(\) => withColour\(forgeEnv\(\)\),/);
    expect(readFileSync(join(__dirname, "../src/pairing.ts"), "utf8")).toMatch(/cwd: this\.repo,\s*env: withColour\(forgeEnv\(\)\),\s*\.\.\.\(args \? \{ args \} : \{\}\),/);
  });

  it("and its icon follows what it comes to run: yarn dev wears Vite's once Vite starts under it", async () => {
    let ps = ["100 1 S 10:00 0.0 0.1 1000 claude", "102 100 S 00:30 0.0 0.0 900 /bin/zsh -c x", "103 102 S 00:30 0.0 0.1 1000 node /bin/yarn dev"].join("\n");
    const posted: { lists?: Record<string, { icon: string }[]> }[] = [];
    const watch = new ProcessWatch(() => new Map([["claude", [100]]]), (message) => posted.push(message as never), () => undefined, async () => ps);
    await watch.poll();
    expect(posted.at(-1)!.lists!.claude![0]!.icon).toBe("yarn");
    ps += "\n104 103 S 00:20 5.0 1.0 9000 node /repo/node_modules/vite/bin/vite.js";
    await watch.poll();
    expect(posted.at(-1)!.lists!.claude![0]!.icon).toBe("vite");
  });
});

describe("rerunning a process", () => {
  it("runs the shell line the agent started it with, the script whole", () => {
    expect(shellLine("/bin/zsh -c -l source /gone.sh && eval 'cd api && ./gradlew bootRun'")).toEqual({
      program: "/bin/zsh",
      args: ["-c", "-l", "source /gone.sh && eval 'cd api && ./gradlew bootRun'"],
    });
    expect(shellLine("sh -c node server.js > out.txt; true")).toEqual({ program: "sh", args: ["-c", "node server.js > out.txt; true"] });
    expect(shellLine("node server.js")).toBeUndefined();
    expect(shellLine("/bin/zsh -l")).toBeUndefined();
    expect(runnable("source /no/such/snapshot.sh && eval 'yarn dev'")).toBe("eval 'yarn dev'");
  });

  it("finds what runs under a shell given as the walk's own root", () => {
    const rows = parsePs(["300 1 S 00:05 0.0 0.0 900 sh -c node server.js", "301 300 S 00:05 0.0 0.0 900 node server.js"].join("\n"));
    expect(launched(rows, [300]).map((row) => row.pid)).toEqual([301]);
  });
});

describe.skipIf(process.platform === "win32")("a real process rerun from its tab", () => {
  it("is stopped, started again from the same line into the same output, and its tab moves to the new one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "odin-rerun-"));
    const out = join(dir, "out.txt");
    const fd = openSync(out, "a");
    const shell = spawn("sh", ["-c", `node -e 'console.log("run "+process.pid);setInterval(()=>{},1000)'; true`], { stdio: ["ignore", fd, fd] });
    closeSync(fd);
    const posted: { type?: string; from?: number; to?: number; lists?: Record<string, { pid: number; rerunnable: boolean }[]> }[] = [];
    const watch = new ProcessWatch(() => new Map([["claude", [process.pid]]]), (message) => posted.push(message as never), () => undefined);
    let first: number | undefined;
    try {
      await until(() => {
        void watch.poll();
        const found = [...posted].reverse().find((one) => one.type === "processes")?.lists?.claude?.find((one) => one.rerunnable);
        first = found?.pid;
        return Boolean(first);
      });
      await watch.rerun(first!);
      await until(() => {
        void watch.poll();
        return posted.some((one) => one.type === "procReplaced" && one.from === first);
      });
      const swap = posted.find((one) => one.type === "procReplaced")!;
      expect(swap.to).not.toBe(first);
      await until(() => (readFileSync(out, "utf8").match(/run \d+/g) ?? []).length >= 2);
      expect(readFileSync(out, "utf8")).toMatch(/rerun by Odin/);
      await watch.kill(swap.to!);
    } finally {
      watch.stop();
      shell.kill("SIGKILL");
      if (first) {
        try {
          process.kill(first, "SIGKILL");
        } catch {
          void 0;
        }
      }
    }
  }, 60_000);
});

describe("a process tab", () => {
  it("has its stats and its Rerun and Kill at the bottom, and no composer", () => {
    const proc = readFileSync(join(__dirname, "../../webview/src/app/hud/Proc.svelte"), "utf8");
    expect(proc.indexOf('class="proc-screen"')).toBeLessThan(proc.indexOf('class="proc-foot"'));
    expect(proc).toMatch(/notify\("procRerun", \{ pid \}\)/);
    const terminal = readFileSync(join(__dirname, "../../webview/src/app/hud/Terminal.svelte"), "utf8");
    expect(terminal).toMatch(/\{#if tab !== "cli" && !tab\.startsWith\("proc:"\)\}/);
    expect(terminal).toMatch(/message\?\.type === "procReplaced" && message\.agent === id && tab === `proc:\$\{message\.from\}`\) tab = `proc:\$\{message\.to\}`/);
  });
});

describe("a Spring app Gradle's daemon runs for a bootRun the agent started", () => {
  it("counts as the bootRun's own: started by the daemon after it, in the folder it was run from", () => {
    const rows = parsePs(
      [
        "50 1 S 05:00:00 0.1 0.5 9000 java -jar gradle-wrapper.jar org.gradle.wrapper.GradleWrapperMain bootRun",
        "60 1 S 10:00:00 0.1 3.0 90000 java org.gradle.launcher.daemon.bootstrap.GradleDaemon 8.10",
        "61 60 S 04:59:00 120.0 2.0 70000 java -cp app com.shop.Application",
        "62 60 S 09:00:00 50.0 2.0 70000 java -cp old com.shop.Application",
        "63 60 S 04:58:00 30.0 2.0 70000 java -cp other com.other.Application",
      ].join("\n"),
    );
    const now = Date.now();
    const cwd = (pid: number) => ({ 61: "/work/shop", 62: "/work/shop", 63: "/work/other" })[pid];
    expect(daemonRuns(rows, { startedAt: now - 5 * 3600 * 1000, cwd: "/work/shop" }, cwd, now)).toEqual([61]);
    expect(daemonRuns(rows, { startedAt: now - 5 * 3600 * 1000 }, cwd, now)).toEqual([]);
  });
});
