# Odin PR Review

[![Marketplace version](https://vsmarketplacebadges.dev/version-short/powerengine98.odin-pr-review.svg?label=VS%20Code%20Marketplace&colorB=1e3a8a)](https://marketplace.visualstudio.com/items?itemName=powerengine98.odin-pr-review)
[![Installs](https://vsmarketplacebadges.dev/installs-short/powerengine98.odin-pr-review.svg?colorB=1e3a8a)](https://marketplace.visualstudio.com/items?itemName=powerengine98.odin-pr-review)
[![Open VSX version](https://img.shields.io/open-vsx/v/powerengine98/odin-pr-review?label=Open%20VSX&color=a60ee5)](https://open-vsx.org/extension/powerengine98/odin-pr-review)
[![Publish](https://github.com/PowerEngine98/odin-pr-review/actions/workflows/publish.yml/badge.svg?branch=main)](https://github.com/PowerEngine98/odin-pr-review/actions/workflows/publish.yml)

Review a pull request as a picture of the change. Every changed file is a card
showing its diff; every call the change makes, adds or removes is an arrow from
the exact line that calls to the exact line that is called. Then let an agent
walk you through it.

[![Odin in a minute: the change graph, a narrated tour, pairing with Claude, and the same reading on GitHub](https://raw.githubusercontent.com/PowerEngine98/odin-pr-review/main/docs/demo.gif)](https://github.com/PowerEngine98/odin-pr-review/raw/main/docs/demo.mp4)

*A minute of Odin on its own pull request: the change graph, a narrated tour, pairing with Claude, and the same reading on GitHub. [Watch the video](https://github.com/PowerEngine98/odin-pr-review/raw/main/docs/demo.mp4).*

> **Preview.** Odin is young and moving fast. Feedback and issues are welcome at
> [github.com/PowerEngine98/odin-pr-review](https://github.com/PowerEngine98/odin-pr-review/issues).

## Features

- **The change as a graph.** Files are cards with their diff, coloured by your
  own theme; references are arrows that leave the line making the call and land
  on its definition. Added references are green, removed ones red. Click an
  arrow to follow it.
- **Live readings.** Review your own uncommitted work as you write it: the graph
  follows the working tree, branch switches, merges and rebases.
- **Pull requests from GitHub.** Pick a pull request, see its checks, threads
  and reviews against the lines they were left on, reply, react, mark files as
  viewed, switch draft and ready, and submit a review without leaving the editor.
- **Guided tours.** An agent reads the whole change and writes a tour: topics in
  the order the code runs, each a sequence of frames that fly to the code,
  highlight lines, draw arrows between files and sketch diagrams, with the
  decisions explained the way a senior engineer would. Play it like a video,
  with a timeline, subtitles, chapters, and progress kept per topic.
- **Pair with agents.** Ask Claude, Codex, Gemini, Cursor, opencode, Aider or
  Antigravity about a line, a thread or the whole change, from a console beside
  the graph. Choose how much each one
  may do — read, ask, edit or full — and which model it runs on; approve what it
  asks for from the console; see every file it changed.
- **Argue with the tour.** Attach any frame to the agent's composer to challenge
  it, or ask the agent to reflect on its own change through the tour and come
  back with a plan before it touches anything.
- **Narration.** Answers and tours can be read aloud, with the word being spoken
  boxed as it goes — by the browser, your system's voice, or an optional local
  neural voice (Kokoro).
- **Odin on GitHub.** A companion browser extension adds an **Odin** tab to
  GitHub's pull requests. Paired with this extension, that tab shows the same
  reading as the editor — arrows, AI pairing, tours, narration and reviews, all
  run here. VS Code finds the repository among the folders it knows, asks which
  when there are several, and offers to clone it when there is none.

## Requirements

- **git**, and a repository checked out locally.
- **[GitHub CLI](https://cli.github.com)** (`gh`), signed in with
  `gh auth login`, for pull requests, threads, checks and reviews. Without it
  Odin still draws local branches and uncommitted work.
- **Optional, for agents:** any of the command line tools for
  [Claude Code](https://claude.com/claude-code), Codex, Gemini, Cursor, opencode,
  Aider or Antigravity, installed and signed in. Odin runs the
  ones it finds; it never sends your code anywhere itself.

## Getting started

1. Open a repository in VS Code.
2. Click the Odin icon in the activity bar, or run **Odin: Review Pull Request
   as a Graph** from the command palette.
3. Pick a pull request, or read your current branch live.
4. Open an agent's console and press **Give me a tour**.

## Languages

| Language | Arrows |
| --- | --- |
| TypeScript, JavaScript, React | resolved by the TypeScript compiler |
| Kotlin, Python, Clojure | matched against the repository's declarations |
| SQL, PostgreSQL | matched by name, including the schema as a vertex |
| anything else | the card and its diff, without arrows — and labelled as such |

## Commands

| Command | What it does |
| --- | --- |
| **Odin: Review Pull Request as a Graph** | Opens the change graph for the current branch or pull request |
| **Odin: Review Against a Different Base…** | Compares against a base you pick |
| **Odin: Choose Another Pull Request** | Lists the repository's pull requests |
| **Odin: Choose What to Show** | All changes, since your last review, or uncommitted only |
| **Odin: Export Change Graph as JSON** | Opens the document the graph is drawn from |
| **Odin: Set Up the Kokoro Narrator** | Installs the optional local neural voice |
| **Odin: Connect the Browser Extension** | Lets Odin's GitHub tab draw arrows from the repositories open here |
| **Odin: Disconnect the Browser Extension** | Forgets the browser extension and stops answering it |

## The browser extension

Odin for GitHub is built from this repository; each
[release](https://github.com/PowerEngine98/odin-pr-review/releases) attaches it
as `odin-pr-review-browser.zip` for Chrome, Edge or Brave (unzip it, open
`chrome://extensions`, turn on Developer mode and choose **Load unpacked**).
In its Odin tab, choose **Enable all features → Sync with the VS Code
extension** and allow the connection here. VS Code then answers it on
`127.0.0.1` only, and only with the token it was given.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `odin.baseRef` | detected | Branch a pull request is compared against |
| `odin.includeImports` | `true` | Draw arrows for import statements too |
| `odin.includeContext` | `false` | Also resolve references on unchanged lines |
| `odin.liveReload` | `true` | Keep a live reading in step with the working tree |
| `odin.kokoro.autoSetup` | `false` | Set up the Kokoro voice in the background on start |
| `odin.kokoro.voice` | `af_heart` | Which Kokoro voice reads aloud |
| `odin.kokoro.speed` | `1` | How fast it reads |

## Privacy

Odin collects no telemetry. The browser extension's connection listens on
`127.0.0.1` only, answers only the paired extension, and is off until you pair
it. Reviewing never modifies your repository: the base
is read into a temporary directory, never a worktree. Pull request data comes
from GitHub through your own `gh` session. Agents run as the command line tools
installed on your machine, under your own accounts, and only when you ask them
something. The optional Kokoro voice runs entirely on your machine; setting it
up downloads [uv](https://docs.astral.sh/uv/), a Python runtime and about 300 MB
of voice model into Odin's storage, and only when you run its setup command.

## Limitations

- A review needs the repository on this computer (Odin can clone it for the
  browser extension).
- Kotlin, Python, Clojure and SQL arrows are heuristic, not compiler-resolved.
- Very large pull requests — thousands of files — get heavy.

## License

[MIT](https://github.com/PowerEngine98/odin-pr-review/blob/main/LICENSE)
