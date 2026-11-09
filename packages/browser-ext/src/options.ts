const input = document.getElementById("token") as HTMLInputElement;
const save = document.getElementById("save") as HTMLButtonElement;
const status = document.getElementById("status")!;
const savedCard = document.getElementById("saved-card")!;
const savedAs = document.getElementById("saved-as")!;
const create = document.getElementById("create") as HTMLAnchorElement;

const owner = new URLSearchParams(location.search).get("owner") ?? "";
const template = new URLSearchParams({
  name: "Odin PR Review",
  description: "Read pull requests in Odin's GitHub tab",
  expires_in: "90",
  contents: "read",
  pull_requests: "read",
  ...(/^[\w.-]+$/.test(owner) ? { target_name: owner } : {}),
});
create.href = `https://github.com/settings/personal-access-tokens/new?${template}`;

function tell(text: string, tone: "ok" | "bad" | "" = "") {
  status.textContent = text;
  status.className = `status ${tone}`;
}

async function login(token: string): Promise<string | undefined> {
  const response = await fetch("https://api.github.com/user", {
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" },
  }).catch(() => undefined);
  if (!response?.ok) return undefined;
  return ((await response.json()) as { login?: string }).login;
}

async function showSaved() {
  const stored = await chrome.storage.local.get(["token", "tokenLogin"]);
  const has = typeof stored.token === "string" && Boolean(stored.token);
  savedCard.hidden = !has;
  if (has) savedAs.textContent = stored.tokenLogin ? `Connected as @${stored.tokenLogin}.` : "A token is saved.";
}

input.addEventListener("input", () => {
  save.disabled = !input.value.trim();
  tell("");
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !save.disabled) save.click();
});

save.addEventListener("click", async () => {
  const token = input.value.trim();
  if (!token) return;
  save.disabled = true;
  tell("Checking with GitHub…");
  const who = await login(token);
  if (!who) {
    tell("GitHub did not accept that token. Check it was copied whole.", "bad");
    save.disabled = false;
    return;
  }
  await chrome.storage.local.set({ token, tokenLogin: who });
  input.value = "";
  tell(`Connected as @${who}. Go back to the pull request and reload it.`, "ok");
  await showSaved();
});

document.getElementById("forget")!.addEventListener("click", async () => {
  await chrome.storage.local.remove(["token", "tokenLogin"]);
  tell("Disconnected.");
  await showSaved();
});

void showSaved();
