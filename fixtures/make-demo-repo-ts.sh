#!/usr/bin/env bash
#
# TypeScript twin of make-demo-repo.sh. Same shape as the reference sketch, but
# in a language the compiler-API resolver understands, so it exercises edges as
# well as vertices:
#
#   addedFile.ts   --(added)---->  myService.ts:function1
#   addedFile.ts   --(added)---->  logger.ts          (phantom: never changed)
#   consumer.ts    --(removed)-->  myService.ts:function2
#   consumer.ts    --(added)---->  myService.ts:function3
#   myService.ts   --(removed)-->  deletedFile.ts:anotherFunction2
#   deletedFile.ts --(removed)-->  myService.ts:function2
#
set -euo pipefail

TARGET="${1:-fixtures/generated/demo-ts}"
rm -rf "$TARGET"
mkdir -p "$TARGET"
cd "$TARGET"

git init --quiet --initial-branch=main
git config user.name "Odin Fixture"
git config user.email "fixture@odin.local"
git config commit.gpgsign false

# Fixed timestamps so the fixture's commit hashes are stable. Anything derived
# from this repository - graph JSON, golden files - would otherwise change on
# every run and stop being comparable.
export GIT_AUTHOR_DATE="2024-01-01T00:00:00Z"
export GIT_COMMITTER_DATE="2024-01-01T00:00:00Z"

mkdir -p src

cat > tsconfig.json <<'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true
  },
  "include": ["src"]
}
EOF

# ---------------------------------------------------------------- base commit

cat > src/logger.ts <<'EOF'
export function log(message: string): void {
  console.log(`[demo] ${message}`);
}
EOF

cat > src/myService.ts <<'EOF'
import { DeletedFile } from "./deletedFile";

export class MyService {
  private readonly deletedFile = new DeletedFile(this);

  function1(): void {
    console.log("one");
  }

  function2(): void {
    console.log("two");
    this.deletedFile.anotherFunction2();
  }
}
EOF

cat > src/deletedFile.ts <<'EOF'
import type { MyService } from "./myService";

export class DeletedFile {
  constructor(private readonly myService: MyService) {}

  anotherFunction(): void {
    this.myService.function2();
  }

  anotherFunction2(): void {
    console.log("legacy");
  }
}
EOF

cat > src/consumer.ts <<'EOF'
import type { MyService } from "./myService";

export class Consumer {
  constructor(private readonly myService: MyService) {}

  aFunction(): void {
    this.myService.function2();
  }
}
EOF

cat > src/oldName.ts <<'EOF'
/** Renamed wholesale on the feature branch; contents are untouched. */
export class OldName {
  untouched(): void {
    console.log("stable");
  }
}
EOF

git add -A
git commit --quiet -m "base: service, consumer, soon-to-be-deleted and renamed files"

# ------------------------------------------------------------- feature branch

git checkout --quiet -b feature/graph

cat > src/myService.ts <<'EOF'
export class MyService {
  function1(): void {
    console.log("one");
  }

  function2(): void {
    console.log("two");
  }

  function3(): void {
    console.log("three");
  }
}
EOF

cat > src/consumer.ts <<'EOF'
import type { MyService } from "./myService";

export class Consumer {
  constructor(private readonly myService: MyService) {}

  aFunction(): void {
    this.myService.function3();
  }
}
EOF

cat > src/addedFile.ts <<'EOF'
import { log } from "./logger";
import type { MyService } from "./myService";

export class AddedFile {
  constructor(private readonly myService: MyService) {}

  myNewFunction(): void {
    log("starting");
    this.myService.function1();
  }
}
EOF

git rm --quiet src/deletedFile.ts
git mv src/oldName.ts src/renamedFile.ts

git add -A
git commit --quiet -m "feat: drop deletedFile, add function3, rename oldName"

echo "demo repo ready at $(pwd)"
echo "  base: main"
echo "  head: feature/graph"
