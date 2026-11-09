export interface DriveStep {
  action: "click" | "type" | "key" | "hover" | "point";
  selector?: string;
  text?: string;
  value?: string;
  key?: string;
  near?: number;
}

let pointer: HTMLDivElement | undefined;

function cursor(): HTMLDivElement {
  if (pointer) return pointer;
  pointer = document.createElement("div");
  Object.assign(pointer.style, {
    position: "fixed",
    left: "50%",
    top: "50%",
    width: "22px",
    height: "22px",
    marginLeft: "-11px",
    marginTop: "-11px",
    borderRadius: "50%",
    border: "2px solid rgba(255,255,255,0.95)",
    background: "rgba(56,139,253,0.45)",
    boxShadow: "0 0 0 4px rgba(56,139,253,0.25)",
    zIndex: "2147483647",
    pointerEvents: "none",
    transition: "left 450ms cubic-bezier(.2,.8,.2,1), top 450ms cubic-bezier(.2,.8,.2,1), transform 150ms",
  });
  document.body.append(pointer);
  return pointer;
}

function visible(element: Element): boolean {
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== "hidden";
}

export function find(step: Pick<DriveStep, "selector" | "text">): HTMLElement | undefined {
  const pool = [...document.querySelectorAll<HTMLElement>(step.selector ?? "button, a, input, textarea, [role=button], [role=tab], label, summary, [title]")];
  const wanted = step.text?.toLowerCase();
  const matches = pool.filter((element) => {
    if (!visible(element)) return false;
    if (!wanted) return true;
    const said = `${element.innerText ?? ""} ${element.getAttribute("aria-label") ?? ""} ${element.title ?? ""} ${element.getAttribute("placeholder") ?? ""}`.toLowerCase();
    return said.includes(wanted);
  });
  if (!wanted) return matches[0];
  return matches.sort((a, b) => (a.innerText ?? "").length - (b.innerText ?? "").length)[0];
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function moveTo(element: HTMLElement): Promise<{ x: number; y: number }> {
  const box = element.getBoundingClientRect();
  const x = box.left + Math.min(box.width / 2, 60);
  const y = box.top + box.height / 2;
  const dot = cursor();
  dot.style.left = `${x}px`;
  dot.style.top = `${y}px`;
  await wait(500);
  return { x, y };
}

function pointerAt(element: HTMLElement, type: string, x: number, y: number) {
  const init = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, pointerId: 1, isPrimary: true };
  element.dispatchEvent(type.startsWith("pointer") ? new PointerEvent(type, init) : new MouseEvent(type, init));
}

export async function drive(step: DriveStep): Promise<boolean> {
  if (step.action === "key") {
    const target = (step.selector || step.text ? find(step) : undefined) ?? (document.activeElement as HTMLElement | null) ?? document.body;
    for (const type of ["keydown", "keyup"]) {
      const key = step.key ?? "";
      const code = /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : /^\d$/.test(key) ? `Digit${key}` : key;
      target.dispatchEvent(new KeyboardEvent(type, { key, code, bubbles: true, cancelable: true }));
    }
    return true;
  }
  const element = find(step);
  if (!element) return false;
  element.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  const { x, y } = await moveTo(element);
  if (step.action === "point" || step.action === "hover") {
    pointerAt(element, "pointerover", x, y);
    pointerAt(element, "mouseover", x, y);
    return true;
  }
  const dot = cursor();
  dot.style.transform = "scale(0.7)";
  pointerAt(element, "pointerdown", x, y);
  pointerAt(element, "mousedown", x, y);
  pointerAt(element, "pointerup", x, y);
  pointerAt(element, "mouseup", x, y);
  element.click();
  await wait(150);
  dot.style.transform = "";
  if (step.action === "type") {
    element.focus();
    const field = element as HTMLInputElement | HTMLTextAreaElement;
    const text = step.value ?? "";
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")?.set;
    for (let i = 1; i <= text.length; i++) {
      setter?.call(field, text.slice(0, i));
      field.dispatchEvent(new Event("input", { bubbles: true }));
      await wait(28);
    }
  }
  return true;
}
