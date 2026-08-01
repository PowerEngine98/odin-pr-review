#!/usr/bin/env bash
# A small React project whose change renders one component and calls one
# function, so a resolver can be checked against JSX as well as ordinary calls.
set -euo pipefail

DIR="${1:?usage: make-demo-repo-react.sh <dir>}"
rm -rf "$DIR"
mkdir -p "$DIR/src"
cd "$DIR"

git init -q .
git config user.email "fixture@odin.test"
git config user.name "Odin Fixture"

cat > tsconfig.json <<'JSON'
{
  "compilerOptions": {
    "jsx": "preserve",
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true
  }
}
JSON

cat > src/Header.tsx <<'TSX'
export const Header = ({ title }: { title: string }) => <h1>{title}</h1>;
TSX

cat > src/Icons.tsx <<'TSX'
export const Icons = { Chevron: () => <svg /> };
TSX

cat > src/helpers.ts <<'TS'
export function formatTitle(raw: string): string {
  return raw.trim();
}
TS

cat > src/Page.tsx <<'TSX'
export const Page = () => <div />;
TSX

git add -A
git commit -qm "base"

cat > src/Page.tsx <<'TSX'
import { Header } from "./Header";
import { Icons } from "./Icons";
import { formatTitle } from "./helpers";

export const Page = () => (
  <div className="page">
    <Header title={formatTitle(" hello ")} />
    <Icons.Chevron />
    <span>plain html, not a component</span>
  </div>
);
TSX

git add -A
git commit -qm "render the header"
git branch -M main
