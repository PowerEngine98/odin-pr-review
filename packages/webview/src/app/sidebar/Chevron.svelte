<!--
  The editor's own chevron.

  Drawn from the codicon path rather than as a typographic triangle, so the
  sidebar's folds look like every other tree in VS Code. Inlined instead of
  loading the codicon font, which a webview would have to be granted access to
  and ship a copy of.
-->
<script lang="ts">
  let {
    open = false,
    size = 16,
    /**
     * Space where a fold would be, for a row that has nothing to fold.
     *
     * Kept rather than dropped so every name in the list starts at the same
     * distance from the edge; a tree whose rows begin at two different
     * indents depending on whether they have children cannot be read down.
     */
    blank = false,
  }: { open?: boolean; size?: number; blank?: boolean } = $props();
</script>

<span
  class="twisty"
  class:open
  class:blank
  style:width="{size}px"
  style:height="{size}px"
>
  <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
    <path
      fill="currentColor"
      d="M10.072 8.024L5.715 3.667l.618-.62L11 7.716v.618L6.333 13l-.618-.619 4.357-4.357z"
    />
  </svg>
</span>

<style>
  .twisty {
    color: var(--vscode-icon-foreground, var(--muted));
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    /* As with the status badge: no line box, so nothing puts the glyph on a
       baseline instead of in the middle of its own square. */
    line-height: 0;
    font-size: 0;
  }
  .twisty svg {
    display: block;
    transition: transform 100ms ease;
  }
  .twisty.open svg { transform: rotate(90deg); }
  .twisty.blank { visibility: hidden; }
</style>
