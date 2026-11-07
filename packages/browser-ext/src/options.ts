const input = document.getElementById("token") as HTMLInputElement;
const saved = document.getElementById("saved")!;

void chrome.storage.local.get("token").then((stored) => {
  input.placeholder = typeof stored.token === "string" && stored.token
    ? "A token is saved; paste another to replace it"
    : "github_pat_…";
});

document.getElementById("save")!.addEventListener("click", async () => {
  const token = input.value.trim();
  if (!token) return;
  await chrome.storage.local.set({ token });
  input.value = "";
  input.placeholder = "A token is saved; paste another to replace it";
  saved.textContent = "Saved.";
});

document.getElementById("forget")!.addEventListener("click", async () => {
  await chrome.storage.local.remove("token");
  input.value = "";
  input.placeholder = "github_pat_…";
  saved.textContent = "Forgotten.";
});
