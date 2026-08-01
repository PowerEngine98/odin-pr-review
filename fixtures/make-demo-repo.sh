#!/usr/bin/env bash
#
# Builds a throwaway git repository whose feature branch reproduces the
# reference sketch: an added file, a modified service, a deleted file, a
# renamed file, and a consumer whose call target moves from one function to
# another. Every file status and every edge kind the tool must handle appears
# exactly once, which makes it a useful end-to-end fixture.
#
# Usage: fixtures/make-demo-repo.sh [target-dir]
set -euo pipefail

TARGET="${1:-fixtures/generated/demo}"
rm -rf "$TARGET"
mkdir -p "$TARGET"
cd "$TARGET"

git init --quiet --initial-branch=main
git config user.name "Odin Fixture"
git config user.email "fixture@odin.local"
git config commit.gpgsign false

mkdir -p src

# ---------------------------------------------------------------- base commit

cat > src/MyService.kt <<'EOF'
package demo

class MyService(private val deletedFile: DeletedFile) {

    fun function1() {
        println("one")
    }

    fun function2() {
        println("two")
        deletedFile.anotherFunction2()
    }
}
EOF

cat > src/DeletedFile.kt <<'EOF'
package demo

class DeletedFile(private val myService: MyService) {

    fun anotherFunction() {
        myService.function2()
    }

    fun anotherFunction2() {
        println("legacy")
    }
}
EOF

cat > src/Consumer.kt <<'EOF'
package demo

class Consumer(private val myService: MyService) {

    fun aFunction() {
        myService.function2()
    }
}
EOF

cat > src/OldName.kt <<'EOF'
package demo

/** Renamed wholesale on the feature branch; contents are untouched. */
class OldName {

    fun untouched() {
        println("stable")
    }
}
EOF

git add -A
git commit --quiet -m "base: service, consumer, soon-to-be-deleted and renamed files"

# ------------------------------------------------------------- feature branch

git checkout --quiet -b feature/graph

cat > src/MyService.kt <<'EOF'
package demo

class MyService {

    fun function1() {
        println("one")
    }

    fun function2() {
        println("two")
    }

    fun function3() {
        println("three")
    }
}
EOF

cat > src/Consumer.kt <<'EOF'
package demo

class Consumer(private val myService: MyService) {

    fun aFunction() {
        myService.function3()
    }
}
EOF

cat > src/AddedFile.kt <<'EOF'
package demo

class AddedFile(private val myService: MyService) {

    fun myNewFunction() {
        myService.function1()
    }
}
EOF

git rm --quiet src/DeletedFile.kt
git mv src/OldName.kt src/RenamedFile.kt

git add -A
git commit --quiet -m "feat: drop DeletedFile, add function3, rename OldName"

echo "demo repo ready at $(pwd)"
echo "  base: main"
echo "  head: feature/graph"
