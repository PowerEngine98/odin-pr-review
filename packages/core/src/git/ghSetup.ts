export interface GhInstaller {
  manager: string;
  command: string;
}

export const GH_DOWNLOAD = "https://cli.github.com/";

export const GH_SIGN_IN = "gh auth login --hostname github.com --git-protocol https --web";

const BY_PLATFORM: Record<string, readonly GhInstaller[]> = {
  darwin: [
    { manager: "brew", command: "brew install gh" },
    { manager: "port", command: "sudo port install gh" },
  ],
  linux: [
    { manager: "brew", command: "brew install gh" },
    { manager: "apt", command: "sudo apt update && sudo apt install -y gh" },
    { manager: "dnf", command: "sudo dnf install -y gh" },
    { manager: "pacman", command: "sudo pacman -S --noconfirm github-cli" },
    { manager: "zypper", command: "sudo zypper install -y gh" },
    { manager: "snap", command: "sudo snap install gh" },
  ],
  win32: [
    { manager: "winget", command: "winget install --id GitHub.cli -e" },
    { manager: "scoop", command: "scoop install gh" },
    { manager: "choco", command: "choco install gh -y" },
  ],
};

export function ghInstaller(platform: string, has: (manager: string) => boolean): GhInstaller | undefined {
  return (BY_PLATFORM[platform] ?? []).find((one) => has(one.manager));
}

export function ghManagers(platform: string): string[] {
  return (BY_PLATFORM[platform] ?? []).map((one) => one.manager);
}
