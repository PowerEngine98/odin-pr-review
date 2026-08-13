<!--
  The change as a list.

  A webview rather than the editor's own tree, and the reason is colour: a tree
  item's description is plain text, and a file decoration can only tint a whole
  row one colour. That is not enough here — the counts need the diff's green and
  red, and a file nothing could read needs a warning beside counts that are not
  warnings. What the native tree's affordances buy in exchange is that the
  sidebar and the canvas are drawn from the same palette, by the same
  components.
-->
<script lang="ts">
  import Folder from "./Folder.svelte";
  import Head from "./Head.svelte";
  import type { ChangeView } from "./model.js";

  let { change }: { change: ChangeView } = $props();
</script>

<Head {change} />
<Folder folder={change.tree} depth={0} />
