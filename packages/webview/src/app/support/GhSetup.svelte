<script lang="ts">
  import { notify } from "../state.svelte.js";
  import { closeGhWizard, GH_STEPS, ghWizard, goTo, installGh, signInGh, startGhCheck } from "./gh.svelte.js";

  const status = $derived(ghWizard.status);
  const installed = $derived(status !== null && status.problem !== "missing" && status.problem !== "outdated");
  const outdated = $derived(status?.problem === "outdated");
  const signedIn = $derived(status?.ok === true);
  const where = $derived(
    status?.platform === "darwin" ? "macOS" : status?.platform === "win32" ? "Windows" : "Linux",
  );

  $effect(() => {
    startGhCheck();
  });

  function copy(text: string) {
    void navigator.clipboard?.writeText(text);
  }

  function download() {
    if (status) notify("openExternal", { url: status.download });
  }
</script>

<svelte:window
  onkeydown={(event) => {
    if (ghWizard.open && event.key === "Escape") closeGhWizard(!signedIn);
  }}
/>

{#if ghWizard.open}
  <div class="gh-backdrop" role="presentation"></div>
  <div class="gh-wizard" role="dialog" aria-modal="true" aria-label="Set up the GitHub CLI">
    <header class="gh-head">
      <svg class="gh-mark" viewBox="0 0 16 16" aria-hidden="true">
        <path
          fill="currentColor"
          d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
        />
      </svg>
      <span class="gh-title">Set up the GitHub CLI</span>
    </header>

    <ol class="gh-steps">
      {#each GH_STEPS as name, index (name)}
        <li class="gh-step" class:current={index === ghWizard.step} class:past={index < ghWizard.step}>
          <span class="gh-dot">{index < ghWizard.step ? "✓" : index + 1}</span>
          <span class="gh-step-name">{name}</span>
        </li>
      {/each}
    </ol>

    <div class="gh-body">
      {#if ghWizard.step === 0}
        <h3>Why Odin needs it</h3>
        <p>
          Odin reads pull requests through <strong>gh</strong>, GitHub's official command line tool.
          It is what lists your pull requests and draws their threads, checks and reviews, and what
          posts your comments, attachments and feedback.
        </p>
        <p>
          <strong>Odin never asks for your password or a token.</strong> You sign in to gh once,
          GitHub hands gh its own key, and gh keeps it in your system's keychain. Odin only asks gh
          to make each request, as you.
        </p>
        <p class="gh-quiet">
          Without it you can still review your local branches and uncommitted work.
        </p>
      {:else if ghWizard.step === 1}
        <h3>{outdated ? "Update gh" : "Install gh"}</h3>
        {#if installed}
          <p class="gh-good">✓ gh {status?.version ?? ""} is installed.</p>
        {:else}
          <p>
            Odin needs gh <strong>{status?.needs ?? "2.99.0"}</strong> or newer: the release that can attach
            pictures and videos to comments, which Odin uses for media in remarks and feedback.
            {#if outdated}This machine has {status?.version ?? "an older one"}.{/if}
          </p>
        {/if}
        {#if !installed && status?.install}
          <p>On {where}, this {outdated ? "updates" : "installs"} it from a source that ships the current release:</p>
          <div class="gh-command">
            <code>{status.install}</code>
            <button class="gh-copy" onclick={() => copy(status.install ?? "")}>Copy</button>
          </div>
          <p class="gh-quiet">
            It runs in a VS Code terminal so you can see every step; it may ask for your computer's
            password. This window moves on by itself once gh answers.
          </p>
        {:else if !installed}
          <p>
            No package manager Odin knows was found. Download the installer for {where} from
            cli.github.com, run it, then come back here.
          </p>
        {/if}
        {#if ghWizard.waiting === "install"}
          <p class="gh-wait"><span class="gh-spinner"></span>Waiting for gh {status?.needs ?? "2.99.0"} or newer…</p>
        {/if}
      {:else if ghWizard.step === 2}
        <h3>Sign in to GitHub</h3>
        {#if signedIn}
          <p class="gh-good">✓ Signed in as <strong>@{status?.login}</strong>.</p>
        {:else}
          <ol class="gh-how">
            <li>A terminal runs <code>{status?.signIn ?? "gh auth login"}</code>.</li>
            <li>gh shows a one-time code and opens github.com in your browser.</li>
            <li>Paste the code and approve <strong>GitHub CLI</strong>. That is GitHub's own page.</li>
            <li>gh stores the key in your keychain. Odin never sees it.</li>
          </ol>
          <p class="gh-quiet">
            Sign out any time with <code>gh auth logout</code>; Odin keeps nothing to forget.
          </p>
        {/if}
        {#if ghWizard.waiting === "signIn"}
          <p class="gh-wait"><span class="gh-spinner"></span>Waiting for you to approve on GitHub…</p>
        {/if}
      {:else}
        <h3>You're all set</h3>
        <p class="gh-good">✓ gh is installed and signed in as <strong>@{status?.login}</strong>.</p>
        <p>
          Pull requests, threads, checks and reviews now load in the sidebar and on the graph. Pick
          one from the Odin sidebar to start.
        </p>
      {/if}
    </div>

    <footer class="gh-actions">
      {#if ghWizard.step < 3}
        <button class="gh-skip" onclick={() => closeGhWizard(true)}>Skip for now</button>
      {/if}
      <span class="gh-fill"></span>
      {#if ghWizard.step > 0 && ghWizard.step < 3}
        <button class="gh-back" onclick={() => goTo(ghWizard.step - 1)}>Back</button>
      {/if}
      {#if ghWizard.step === 0}
        <button class="gh-next" onclick={() => goTo(installed ? (signedIn ? 3 : 2) : 1)}>Get started</button>
      {:else if ghWizard.step === 1}
        {#if installed}
          <button class="gh-next" onclick={() => goTo(signedIn ? 3 : 2)}>Next</button>
        {:else if status?.install}
          <button class="gh-next" disabled={ghWizard.waiting === "install"} onclick={installGh}>{outdated ? "Update in terminal" : "Install in terminal"}</button>
        {:else}
          <button class="gh-next" onclick={download}>{outdated ? "Download the update" : "Download gh"}</button>
        {/if}
      {:else if ghWizard.step === 2}
        {#if signedIn}
          <button class="gh-next" onclick={() => goTo(3)}>Next</button>
        {:else}
          <button class="gh-next" disabled={ghWizard.waiting === "signIn"} onclick={signInGh}>Sign in with GitHub</button>
        {/if}
      {:else}
        <button class="gh-next" onclick={() => closeGhWizard(false)}>Start reviewing</button>
      {/if}
    </footer>
  </div>
{/if}

<style>
  .gh-backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-menu);
    background: color-mix(in srgb, #000 55%, transparent);
  }

  .gh-wizard {
    position: fixed;
    top: 50%;
    left: 50%;
    z-index: calc(var(--z-menu) + 1);
    display: flex;
    flex-direction: column;
    width: min(520px, calc(100vw - 32px));
    max-height: min(88vh, 620px);
    transform: translate(-50%, -50%);
    border: 1px solid var(--panel-edge);
    border-radius: 10px;
    background: color-mix(in srgb, var(--bg) 94%, var(--text) 6%);
    box-shadow: 0 14px 40px color-mix(in srgb, #000 50%, transparent);
    font-size: 12px;
    overflow: hidden;
  }

  .gh-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 16px 24px 12px;
  }

  .gh-mark {
    width: 20px;
    height: 20px;
    flex: none;
  }

  .gh-title {
    font-size: 14px;
    font-weight: 600;
  }

  .gh-steps {
    display: flex;
    margin: 0;
    padding: 0 24px 14px;
    list-style: none;
    border-bottom: 1px solid var(--panel-edge);
  }

  .gh-step {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 6px;
    color: var(--muted);
  }

  .gh-step + .gh-step::before {
    content: "";
    flex: 0 0 16px;
    height: 1px;
    margin-right: 6px;
    background: var(--panel-edge);
  }

  .gh-dot {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border: 1px solid var(--panel-edge);
    border-radius: 50%;
    font-size: 11px;
  }

  .gh-step.current {
    color: var(--text);
    font-weight: 600;
  }

  .gh-step.current .gh-dot {
    border-color: var(--vscode-button-background, #238636);
    background: var(--vscode-button-background, #238636);
    color: var(--vscode-button-foreground, #fff);
  }

  .gh-step.past .gh-dot {
    border-color: #2ea043;
    color: #2ea043;
  }

  .gh-body {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 10px;
    min-height: 220px;
    padding: 18px 24px;
    overflow-y: auto;
    line-height: 1.55;
  }

  .gh-body h3 {
    margin: 0;
    font-size: 13px;
  }

  .gh-body p {
    margin: 0;
  }

  .gh-quiet {
    color: var(--muted);
  }

  .gh-good {
    color: #2ea043;
  }

  .gh-how {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0;
    padding-left: 18px;
  }

  .gh-command {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border: 1px solid var(--panel-edge);
    border-radius: 6px;
    background: color-mix(in srgb, var(--bg) 70%, #000 30%);
  }

  .gh-command code {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .gh-wait {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--muted);
  }

  .gh-spinner {
    width: 12px;
    height: 12px;
    flex: none;
    border: 2px solid var(--panel-edge);
    border-top-color: var(--text);
    border-radius: 50%;
    animation: gh-spin 0.8s linear infinite;
  }

  @keyframes gh-spin {
    to {
      transform: rotate(360deg);
    }
  }

  .gh-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 24px 16px;
    border-top: 1px solid var(--panel-edge);
  }

  .gh-fill {
    flex: 1;
  }

  .gh-actions button,
  .gh-copy {
    padding: 5px 12px;
    border-radius: 6px;
    font: inherit;
    cursor: pointer;
  }

  .gh-skip,
  .gh-back,
  .gh-copy {
    border: 1px solid var(--panel-edge);
    background: transparent;
    color: inherit;
  }

  .gh-skip {
    border-color: transparent;
    color: var(--muted);
  }

  .gh-next {
    border: 0;
    background: var(--vscode-button-background, #238636);
    color: var(--vscode-button-foreground, #fff);
  }

  .gh-next:disabled {
    opacity: 0.6;
    cursor: default;
  }
</style>
