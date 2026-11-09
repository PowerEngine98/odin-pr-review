export interface GhInstaller {
  manager: string;
  install: string;
  upgrade: string;
}

export const GH_DOWNLOAD = "https://cli.github.com/";

export const GH_SIGN_IN = "gh auth login --hostname github.com --git-protocol https --web";

const APT_REPO = [
  "(type -p wget >/dev/null || (sudo apt update && sudo apt install -y wget))",
  "sudo mkdir -p -m 755 /etc/apt/keyrings",
  "wget -nv -O- https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null",
  "sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg",
  'echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null',
  "sudo apt update",
  "sudo apt install -y gh",
].join(" && ");

const RPM_REPO = "https://cli.github.com/packages/rpm/gh-cli.repo";

const BY_PLATFORM: Record<string, readonly GhInstaller[]> = {
  darwin: [{ manager: "brew", install: "brew install gh", upgrade: "brew update && brew upgrade gh" }],
  linux: [
    { manager: "brew", install: "brew install gh", upgrade: "brew update && brew upgrade gh" },
    { manager: "apt", install: APT_REPO, upgrade: APT_REPO },
    {
      manager: "dnf",
      install: `sudo dnf config-manager addrepo --from-repofile=${RPM_REPO} || sudo dnf config-manager --add-repo ${RPM_REPO}; sudo dnf install -y gh --repo gh-cli`,
      upgrade: `sudo dnf config-manager addrepo --from-repofile=${RPM_REPO} || sudo dnf config-manager --add-repo ${RPM_REPO}; sudo dnf upgrade -y gh --repo gh-cli`,
    },
    {
      manager: "zypper",
      install: `sudo zypper addrepo ${RPM_REPO}; sudo zypper --gpg-auto-import-keys refresh && sudo zypper install -y gh`,
      upgrade: `sudo zypper addrepo ${RPM_REPO}; sudo zypper --gpg-auto-import-keys refresh && sudo zypper update -y gh`,
    },
    { manager: "pacman", install: "sudo pacman -Sy --noconfirm github-cli", upgrade: "sudo pacman -Sy --noconfirm github-cli" },
  ],
  win32: [
    { manager: "winget", install: "winget install --id GitHub.cli -e", upgrade: "winget upgrade --id GitHub.cli -e" },
    { manager: "scoop", install: "scoop install gh", upgrade: "scoop update gh" },
    { manager: "choco", install: "choco install gh -y", upgrade: "choco upgrade gh -y" },
  ],
};

export function ghInstaller(platform: string, has: (manager: string) => boolean): GhInstaller | undefined {
  return (BY_PLATFORM[platform] ?? []).find((one) => has(one.manager));
}

export function ghManagers(platform: string): string[] {
  return (BY_PLATFORM[platform] ?? []).map((one) => one.manager);
}
