import { describe, expect, it } from "vitest";

import {
  budgetFor,
  frameSeconds,
  locate,
  parseTour,
  roman,
  titled,
  topicSeconds,
  tourPrompt,
  unshown,
} from "../src/tour/tour.js";

const good = {
  version: 1,
  title: "Orders",
  topics: [
    {
      id: "placing-an-order",
      title: "Placing an order",
      summary: "How a click becomes a saved order.",
      frames: [
        { kind: "go", file: "web/Checkout.tsx", say: "It starts at the checkout button." },
        { kind: "highlight", file: "web/Checkout.tsx", code: "<Button onClick={place}>", label: "the trigger" },
        { kind: "pause", seconds: 3 },
      ],
    },
  ],
};

describe("a tour the agent wrote", () => {
  it("is accepted inside a fenced block", () => {
    const parsed = parseTour("Here:\n```json\n" + JSON.stringify(good) + "\n```", ["web/Checkout.tsx"]);
    expect(parsed.ok).toBe(true);
  });

  it("is refused when it names a file outside the change", () => {
    const parsed = parseTour(JSON.stringify(good), ["web/Other.tsx"]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors[0]).toContain("not in the change");
  });

  it("is refused for a frame kind it does not know", () => {
    const bad = structuredClone(good);
    (bad.topics[0]!.frames as unknown[]).push({ kind: "dance" });
    expect(parseTour(JSON.stringify(bad)).ok).toBe(false);
  });

  it("has a running time", () => {
    expect(topicSeconds(good.topics[0] as never)).toBeGreaterThan(5);
  });

  it("lets an arrow point at a whole file", () => {
    const pointing = structuredClone(good);
    (pointing.topics[0]!.frames as unknown[]).push({
      kind: "arrow",
      from: { file: "web/Checkout.tsx", code: "<Button onClick={place}>" },
      to: { file: "api/OrderService.ts" },
    });
    expect(parseTour(JSON.stringify(pointing), ["web/Checkout.tsx", "api/OrderService.ts"]).ok).toBe(true);
  });

  it("gives an arrow between files the time its stops take", () => {
    const say = "The button hands the order over.";
    const across = { kind: "arrow", say, label: "submits", from: { file: "a.ts", code: "x" }, to: { file: "b.ts" } };
    const within = { ...across, to: { file: "a.ts", code: "y" } };
    expect(frameSeconds(across as never)).toBeGreaterThan(frameSeconds(within as never) + 3);
  });
});

describe("narration that names a file", () => {
  const files = ["web/Checkout.tsx", "api/OrderService.ts"];
  const topic = (frames: unknown[]) => ({ id: "t", title: "T", summary: "S", frames }) as never;

  it("is warned about when the file is not on screen", () => {
    const found = unshown(
      topic([{ kind: "go", file: "web/Checkout.tsx", say: "The order goes to the OrderService next." }]),
      "topics[0]",
      files,
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("api/OrderService.ts");
  });

  it("is fine when an arrow points at it, even named in words", () => {
    const found = unshown(
      topic([
        { kind: "go", file: "web/Checkout.tsx" },
        {
          kind: "arrow",
          from: { file: "web/Checkout.tsx", code: "place()" },
          to: { file: "api/OrderService.ts" },
          say: "Placing calls the order service.",
        },
      ]),
      "topics[0]",
      files,
    );
    expect(found).toEqual([]);
  });

  it("forgets a mark the next frame cleared", () => {
    const found = unshown(
      topic([
        { kind: "go", file: "web/Checkout.tsx" },
        { kind: "highlight", file: "api/OrderService.ts", code: "save()" },
        { kind: "say", say: "So the order service saves it." },
      ]),
      "topics[0]",
      files,
    );
    expect(found).toHaveLength(1);
  });
});

describe("a diagram frame", () => {
  const drawn = structuredClone(good);
  (drawn.topics[0]!.frames as unknown[]).push({
    kind: "diagram",
    mermaid: "flowchart LR\n  Button --> save --> Order",
    near: "web/Checkout.tsx",
    say: "The click ends in the order.",
  });

  it("is accepted with its mermaid and the file it stands beside", () => {
    expect(parseTour(JSON.stringify(drawn), ["web/Checkout.tsx"]).ok).toBe(true);
  });

  it("needs its mermaid, and stands only beside a file in the change", () => {
    const empty = structuredClone(drawn);
    (empty.topics[0]!.frames.at(-1) as { mermaid: string }).mermaid = "";
    expect(parseTour(JSON.stringify(empty), ["web/Checkout.tsx"]).ok).toBe(false);
    const elsewhere = structuredClone(drawn);
    (elsewhere.topics[0]!.frames.at(-1) as { near: string }).near = "web/Gone.tsx";
    const parsed = parseTour(JSON.stringify(elsewhere), ["web/Checkout.tsx"]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors.join()).toContain("near");
  });
});

describe("several marks in one frame", () => {
  const many = structuredClone(good);
  (many.topics[0]!.frames as unknown[]).push(
    {
      kind: "highlight",
      file: "web/Checkout.tsx",
      code: "<Button onClick={place}>",
      also: [{ file: "web/Checkout.tsx", code: "const place = () => save();", label: "the handler" }],
    },
    {
      kind: "arrow",
      from: { file: "web/Checkout.tsx", code: "save()" },
      to: { file: "web/Checkout.tsx" },
      also: [{ from: { file: "web/Checkout.tsx", code: "load()" }, to: { file: "web/Checkout.tsx" } }],
    },
  );

  it("is accepted with its extra boxes and arrows", () => {
    expect(parseTour(JSON.stringify(many), ["web/Checkout.tsx"]).ok).toBe(true);
  });

  it("holds every extra place to the same rules", () => {
    const bad = structuredClone(many);
    (bad.topics[0]!.frames[4] as { also: { from: { file: string } }[] }).also[0]!.from.file = "web/Gone.tsx";
    const parsed = parseTour(JSON.stringify(bad), ["web/Checkout.tsx"]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors.join()).toContain("also[0].from.file");
  });
});

describe("finding an anchor's lines", () => {
  const file = ["class Order {", "  total() {", "    return this.items.sum();", "  }", "}"];

  it("finds them whatever their indentation", () => {
    expect(locate(file, "total() {\n return this.items.sum();")).toMatchObject({ start: 2, end: 3 });
  });

  it("still finds a line that was renamed a little", () => {
    expect(locate(file, "return this.lines.sum();")?.start).toBe(3);
  });

  it("finds nothing rather than something wrong", () => {
    expect(locate(file, "delete everything")).toBeNull();
  });
});

describe("the request", () => {
  it("scales its budget with the change and names every file", () => {
    const context = {
      base: "abc123",
      worktree: true,
      files: [{ path: "a.ts", additions: 2000, deletions: 300 }, { path: "b.ts", additions: 1, deletions: 0 }],
    };
    expect(budgetFor(context).topics).toBeLessThanOrEqual(8);
    expect(tourPrompt(context)).toContain("b.ts (+1 -0)");
  });
});

describe("roman", () => {
  it("numbers topics the way a book numbers parts", () => {
    expect([1, 2, 3, 4, 5, 9, 14, 40].map(roman)).toEqual(["I", "II", "III", "IV", "V", "IX", "XIV", "XL"]);
  });
});

describe("titled", () => {
  it("opens every topic with its title, read aloud, and only once", () => {
    const tour = parseTour(JSON.stringify(good));
    if (!tour.ok) throw new Error(tour.errors.join("; "));
    const once = titled(tour.tour);
    once.topics.forEach((topic, at) => {
      expect(topic.frames[0]).toEqual({ kind: "title", say: topic.title });
      expect(topic.frames.length).toBe(tour.tour.topics[at]!.frames.length + 1);
    });
    expect(titled(once)).toEqual(once);
    expect(tour.tour.topics[0]!.frames[0]!.kind).not.toBe("title");
  });

  it("is never accepted from the agent", () => {
    const sent = { ...good, topics: [{ ...good.topics[0], frames: [{ kind: "title", say: "Hi" }] }] };
    expect(parseTour(JSON.stringify(sent)).ok).toBe(false);
  });
});
