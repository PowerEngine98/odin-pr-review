#!/usr/bin/env bash
# A monorepo whose TypeScript configuration lives below the repository root, in
# the shape the editor's own templates produce: a solution file listing project
# references, a shared base holding the path aliases, and two packages that
# import each other through those aliases rather than by relative path.
#
# The root has no tsconfig.json at all, which is the point. A resolver that
# looks for one there and gives up finds no aliases, and every `@components/…`
# import in the repository resolves to nothing.
set -euo pipefail

DIR="${1:?usage: make-demo-repo-monorepo.sh <dir>}"
rm -rf "$DIR"
mkdir -p "$DIR/frontend/common/src/components" "$DIR/frontend/web/src"
cd "$DIR"

git init -q .
git config user.email "fixture@odin.test"
git config user.name "Odin Fixture"

cat > frontend/tsconfig.base.json <<'JSON'
{
  "compilerOptions": {
    "jsx": "preserve",
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "paths": {
      "@components/*": ["./common/src/components/*"]
    }
  }
}
JSON

# A solution file: it compiles nothing itself and only names the projects that
# do. Read literally it is a project that owns no files.
cat > frontend/web/tsconfig.json <<'JSON'
{
  "files": [],
  "references": [{ "path": "./tsconfig.app.json" }]
}
JSON

cat > frontend/web/tsconfig.app.json <<'JSON'
{
  "extends": "../tsconfig.base.json",
  "include": ["src", "../common/src"]
}
JSON

cat > frontend/common/tsconfig.json <<'JSON'
{
  "extends": "../tsconfig.base.json",
  "include": ["src"]
}
JSON

cat > frontend/common/src/components/Dots.tsx <<'TSX'
export const Dots = ({ count }: { count: number }) => <span>{count}</span>;
TSX

cat > frontend/web/src/Page.tsx <<'TSX'
export const Page = () => <main />;
TSX

git add -A
git commit -qm "before"

# The rename this exists to catch: a component moved and renamed, and its
# consumers pointed at the new name through the alias.
git mv frontend/common/src/components/Dots.tsx \
       frontend/common/src/components/ItemNavigator.tsx
cat > frontend/common/src/components/ItemNavigator.tsx <<'TSX'
export const ItemNavigator = ({ count }: { count: number }) => <span>{count}</span>;
TSX

cat > frontend/web/src/Page.tsx <<'TSX'
import { ItemNavigator } from '@components/ItemNavigator'

export const Page = () => (
  <main>
    <ItemNavigator count={3} />
  </main>
)
TSX

git add -A
git commit -qm "point the page at the renamed component"
