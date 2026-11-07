const DARK: Record<string, string> = {
  "font-family": '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif',
  "font-size": "13px",
  "editor-font-family": 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
  foreground: "#e6edf3",
  descriptionForeground: "#8d96a0",
  "editor-background": "#0d1117",
  "editor-foreground": "#e6edf3",
  "sideBar-background": "#010409",
  "editorWidget-background": "#161b22",
  "editorLineNumber-foreground": "#6e7681",
  "list-hoverBackground": "#161b22",
  "list-inactiveSelectionBackground": "#1f2428",
  "list-highlightForeground": "#4493f8",
  focusBorder: "#1f6feb",
  "button-background": "#238636",
  "button-foreground": "#ffffff",
  "button-hoverBackground": "#2ea043",
  "textLink-foreground": "#4493f8",
  "progressBar-background": "#1f6feb",
  "input-background": "#0d1117",
  "input-foreground": "#e6edf3",
  "input-border": "#30363d",
  "panel-border": "#30363d",
  "sideBarStickyScroll-border": "#30363d",
  "widget-shadow": "rgba(1, 4, 9, 0.85)",
  "icon-foreground": "#8d96a0",
};

const LIGHT: Record<string, string> = {
  ...DARK,
  foreground: "#1f2328",
  descriptionForeground: "#59636e",
  "editor-background": "#ffffff",
  "editor-foreground": "#1f2328",
  "sideBar-background": "#f6f8fa",
  "editorWidget-background": "#ffffff",
  "editorLineNumber-foreground": "#818b98",
  "list-hoverBackground": "#eef1f4",
  "list-inactiveSelectionBackground": "#e6eaef",
  "list-highlightForeground": "#0969da",
  focusBorder: "#0969da",
  "button-background": "#1f883d",
  "button-hoverBackground": "#1c8139",
  "textLink-foreground": "#0969da",
  "progressBar-background": "#0969da",
  "input-background": "#ffffff",
  "input-foreground": "#1f2328",
  "input-border": "#d1d9e0",
  "panel-border": "#d1d9e0",
  "sideBarStickyScroll-border": "#d1d9e0",
  "widget-shadow": "rgba(31, 35, 40, 0.15)",
  "icon-foreground": "#59636e",
};

export function editorVariables(dark: boolean): string {
  const values = dark ? DARK : LIGHT;
  const lines = Object.entries(values).map(([name, value]) => `--vscode-${name}: ${value};`);
  return `<style>:root{${lines.join("")}}body{margin:0;background:var(--vscode-sideBar-background);color:var(--vscode-foreground);font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);}</style>`;
}

export function rootVariables(dark: boolean): string {
  const values = dark ? DARK : LIGHT;
  const lines = Object.entries(values).map(([name, value]) => `--vscode-${name}: ${value};`);
  return `<style>:root{${lines.join("")}}</style>`;
}
