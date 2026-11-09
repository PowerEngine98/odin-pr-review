# Privacy

Odin PR Review — the VS Code extension and the Odin for GitHub browser
extension — collects no telemetry and has no servers of its own.

## The browser extension

- **What it reads.** On github.com pull request pages it reads the pull
  request you open (its files, diff and metadata) to draw the Odin tab.
- **Where data goes.** Only to GitHub (`api.github.com`, `codeload.github.com`)
  to fetch that pull request, and — only if you pair it — to the Odin VS Code
  extension on your own computer at `127.0.0.1`. Nothing is sent anywhere else.
- **What it stores.** In the browser's local extension storage: your settings,
  an optional GitHub token you paste on the options page (sent only to
  `api.github.com`, as the `Authorization` header), and the pairing token for
  your local VS Code. Removing the extension removes all of it.
- **Not shared or sold.** No data is sold, shared with third parties, used for
  advertising, or used for anything other than showing you the pull request.

## The VS Code extension

Pull request data comes from GitHub through your own `gh` session. Agents run
as the command line tools installed on your machine, under your own accounts,
only when you ask them something. Issues you file from Settings → Support are
posted to this repository's public issue tracker under your GitHub account,
with any media committed to a branch you can see.

Questions: open an issue at
https://github.com/PowerEngine98/odin-pr-review/issues.
