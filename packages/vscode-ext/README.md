# Odin PR Review

[![Marketplace version](https://img.shields.io/github/package-json/v/PowerEngine98/odin-pr-review?filename=packages%2Fvscode-ext%2Fpackage.json&label=VS%20Code%20Marketplace&color=1e3a8a&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI%2BPHBhdGggZmlsbD0iI2ZmZmZmZiIgZD0iTTIzLjE1IDIuNTg3TDE4LjIxLjIxYTEuNDk0IDEuNDk0IDAgMCAwLTEuNzA1LjI5bC05LjQ2IDguNjMtNC4xMi0zLjEyOGEuOTk5Ljk5OSAwIDAgMC0xLjI3Ni4wNTdMLjMyNyA3LjI2MUExIDEgMCAwIDAgLjMyNiA4Ljc0TDMuODk5IDEyIC4zMjYgMTUuMjZhMSAxIDAgMCAwIC4wMDEgMS40NzlMMS42NSAxNy45NGEuOTk5Ljk5OSAwIDAgMCAxLjI3Ni4wNTdsNC4xMi0zLjEyOCA5LjQ2IDguNjNhMS40OTIgMS40OTIgMCAwIDAgMS43MDQuMjlsNC45NDItMi4zNzdBMS41IDEuNSAwIDAgMCAyNCAyMC4wNlYzLjkzOWExLjUgMS41IDAgMCAwLS44NS0xLjM1MnptLTUuMTQ2IDE0Ljg2MUwxMC44MjYgMTJsNy4xNzgtNS40NDh2MTAuODk2eiIvPjwvc3ZnPg%3D%3D)](https://marketplace.visualstudio.com/items?itemName=powerengine98.odin-pr-review)
[![Open VSX version](https://img.shields.io/open-vsx/v/powerengine98/odin-pr-review?label=Open%20VSX&color=a60ee5&logo=eclipseide&logoColor=white)](https://open-vsx.org/extension/powerengine98/odin-pr-review)
[![Open VSX downloads](https://img.shields.io/open-vsx/dt/powerengine98/odin-pr-review?label=downloads&color=a60ee5)](https://open-vsx.org/extension/powerengine98/odin-pr-review)
[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/jghenlmadcfkcmfmnlmegogfjbbeafci?label=Chrome%20Web%20Store&color=1a73e8&logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/odin-pr-review/jghenlmadcfkcmfmnlmegogfjbbeafci)
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
- **Pictures and videos in remarks.** Attach images or videos to a comment, a
  reply or a review summary: paste them, drop them on the box, or pick them.
  GitHub has no API for attachments, so Odin commits them to a branch of their
  own, `odin-attachments/<reviewed branch>/<you>`, in the pull request's
  repository (or in your fork when you cannot push there), and links them in
  the remark.
- **Support from the graph.** Settings → *Support* opens a composer for a bug,
  a suggestion or a feature request. It becomes an issue on this repository,
  labelled accordingly, posted through your own `gh` session, with any media
  attached; a notice in the corner links to it.
- **Odin on GitHub.** A companion browser extension adds a **Graph** tab to
  GitHub's pull requests, and a **Change graph** tab to the repository. Paired
  with this extension, the Graph tab shows the same
  reading as the editor — arrows, AI pairing, tours, narration and reviews, all
  run here. VS Code finds the repository among the folders it knows, asks which
  when there are several, and offers to clone it when there is none.

## Requirements

- **git**, and a repository checked out locally.
- **[GitHub CLI](https://cli.github.com)** (`gh`), signed in with
  `gh auth login`, for pull requests, threads, checks and reviews. Missing or
  signed out, Odin opens a step-by-step setup that installs it with your package
  manager and signs you in through GitHub's own page; the key stays with gh, in
  your keychain, never with Odin. Without it Odin still draws local branches
  and uncommitted work.
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
| **Odin: Set Up the GitHub CLI** | Walks you through installing gh and signing in |
| **Odin: Connect the Browser Extension** | Lets Odin's GitHub tab draw arrows from the repositories open here |
| **Odin: Disconnect the Browser Extension** | Forgets the browser extension and stops answering it |

## The browser extension

Add **Odin for GitHub** from the
[Chrome Web Store](https://chromewebstore.google.com/detail/odin-pr-review/jghenlmadcfkcmfmnlmegogfjbbeafci)
(Chrome, Edge, Brave, Opera). In a pull request's **Graph** tab, choose
**Enable all features → Sync with the VS Code extension** and allow the
connection here. VS Code then answers it on `127.0.0.1` only, and only with the
token it was given; it reads GitHub for the tab through your `gh` session, so
private repositories need no token in the browser.

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
