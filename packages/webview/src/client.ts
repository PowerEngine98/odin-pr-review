/**
 * Browser-side behaviour, emitted inline so a rendered graph is a single file
 * that opens from disk with no server and no network access.
 *
 * The script never lays anything out. Positions arrive already computed, which
 * is what keeps the browser, the static SVG and the editor webview in
 * agreement, and what makes the picture the same every time it is opened.
 */
export const CLIENT_SCRIPT = String.raw`
(function () {
  var data = window.__ODIN__;
  var viewport = document.querySelector(".viewport");
  var canvas = document.querySelector(".canvas");
  var tooltip = document.querySelector(".tooltip");

  var view = { x: 0, y: 0, scale: 1 };
  var MIN_SCALE = 0.15;
  var MAX_SCALE = 3;

  function apply() {
    canvas.style.transform =
      "translate(" + view.x + "px," + view.y + "px) scale(" + view.scale + ")";
  }

  /* ------------------------------------------------------------ pan & zoom */

  var panning = false;
  var origin = null;

  viewport.addEventListener("pointerdown", function (event) {
    if (event.target.closest(".card") || event.target.closest("path.hit")) return;
    panning = true;
    origin = { x: event.clientX - view.x, y: event.clientY - view.y };
    viewport.classList.add("panning");
    viewport.setPointerCapture(event.pointerId);
  });

  viewport.addEventListener("pointermove", function (event) {
    if (!panning || !origin) return;
    view.x = event.clientX - origin.x;
    view.y = event.clientY - origin.y;
    apply();
  });

  function endPan(event) {
    panning = false;
    origin = null;
    viewport.classList.remove("panning");
    if (event && event.pointerId !== undefined) {
      try { viewport.releasePointerCapture(event.pointerId); } catch (e) {}
    }
  }
  viewport.addEventListener("pointerup", endPan);
  viewport.addEventListener("pointercancel", endPan);

  viewport.addEventListener("wheel", function (event) {
    event.preventDefault();

    // Trackpad two-finger scroll pans; pinch and ctrl+wheel zoom. Matching the
    // platform convention matters more here than any cleverness, because this
    // canvas is meant to be navigated without thinking about it.
    if (!event.ctrlKey && !event.metaKey) {
      view.x -= event.deltaX;
      view.y -= event.deltaY;
      apply();
      return;
    }

    var rect = viewport.getBoundingClientRect();
    var px = event.clientX - rect.left;
    var py = event.clientY - rect.top;
    var next = clamp(view.scale * Math.exp(-event.deltaY / 320), MIN_SCALE, MAX_SCALE);

    // Keep whatever is under the cursor under the cursor.
    view.x = px - (px - view.x) * (next / view.scale);
    view.y = py - (py - view.y) * (next / view.scale);
    view.scale = next;
    apply();
  }, { passive: false });

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  /* --------------------------------------------------------------- framing */

  function fit() {
    var rect = viewport.getBoundingClientRect();
    var scale = clamp(
      Math.min((rect.width - 80) / data.width, (rect.height - 140) / data.height),
      MIN_SCALE,
      1,
    );
    view.scale = scale;
    view.x = (rect.width - data.width * scale) / 2;
    view.y = 60 + (rect.height - 60 - data.height * scale) / 2;
    apply();
  }

  function centerOn(nodeId, scale) {
    var node = data.nodes.find(function (n) { return n.id === nodeId; });
    if (!node) return;
    var rect = viewport.getBoundingClientRect();
    if (scale) view.scale = clamp(scale, MIN_SCALE, MAX_SCALE);
    view.x = rect.width / 2 - (node.x + node.width / 2) * view.scale;
    view.y = rect.height / 2 - (node.y + node.height / 2) * view.scale;
    canvas.style.transition = "transform 320ms cubic-bezier(.22,.61,.36,1)";
    apply();
    window.setTimeout(function () { canvas.style.transition = ""; }, 340);

    var card = document.getElementById("card-" + cssId(nodeId));
    if (!card) return;
    card.classList.remove("flash");
    void card.offsetWidth;
    card.classList.add("flash");
  }

  function cssId(id) {
    return id.replace(/[^a-zA-Z0-9_-]/g, "_");
  }

  /* ---------------------------------------------------- highlight & travel */

  var edgeGroups = Array.prototype.slice.call(document.querySelectorAll("g.edge"));
  var cards = Array.prototype.slice.call(document.querySelectorAll(".card"));

  function clearHighlight() {
    edgeGroups.forEach(function (g) { g.classList.remove("dim", "active"); });
    cards.forEach(function (c) { c.classList.remove("dim", "active"); });
  }

  function highlightEdge(id) {
    var edge = data.edges.find(function (e) { return e.id === id; });
    if (!edge) return;
    edgeGroups.forEach(function (g) {
      var match = g.dataset.id === id;
      g.classList.toggle("active", match);
      g.classList.toggle("dim", !match);
    });
    cards.forEach(function (c) {
      var match = c.dataset.id === edge.from || c.dataset.id === edge.to;
      c.classList.toggle("active", match);
      c.classList.toggle("dim", !match);
    });
  }

  function highlightNode(nodeId) {
    var touching = data.edges.filter(function (e) {
      return e.from === nodeId || e.to === nodeId;
    });
    var ids = {};
    var neighbours = {};
    neighbours[nodeId] = true;
    touching.forEach(function (e) {
      ids[e.id] = true;
      neighbours[e.from] = true;
      neighbours[e.to] = true;
    });

    edgeGroups.forEach(function (g) {
      var match = !!ids[g.dataset.id];
      g.classList.toggle("active", match);
      g.classList.toggle("dim", !match);
    });
    cards.forEach(function (c) {
      var match = !!neighbours[c.dataset.id];
      c.classList.toggle("active", c.dataset.id === nodeId);
      c.classList.toggle("dim", !match);
    });
  }

  document.querySelectorAll("path.hit").forEach(function (hit) {
    var group = hit.parentNode;
    var id = group.dataset.id;

    hit.addEventListener("mouseenter", function (event) {
      highlightEdge(id);
      showTooltip(event, id);
    });
    hit.addEventListener("mousemove", moveTooltip);
    hit.addEventListener("mouseleave", function () {
      clearHighlight();
      tooltip.classList.remove("visible");
    });

    // Following an edge is the core gesture: click the arrow, land on what it
    // points at, with the destination line flashed so the eye finds it.
    hit.addEventListener("click", function (event) {
      event.stopPropagation();
      var edge = data.edges.find(function (e) { return e.id === id; });
      if (!edge) return;
      centerOn(edge.to);
      notifyHost("navigate", edge);
    });
  });

  cards.forEach(function (card) {
    var title = card.querySelector(".card-title");
    if (!title) return;
    title.addEventListener("click", function (event) {
      event.stopPropagation();

      // Plain click isolates; a modifier opens the file. Opening an editor on
      // every filename click would fight the reviewer for the screen.
      if (event.metaKey || event.ctrlKey) {
        notifyHost("open", { path: card.dataset.path });
        return;
      }

      if (card.classList.contains("active")) clearHighlight();
      else highlightNode(card.dataset.id);
    });
  });

  viewport.addEventListener("click", function (event) {
    if (event.target.closest(".card") || event.target.closest("path.hit")) return;
    clearHighlight();
    tooltip.classList.remove("visible");
  });

  /* ------------------------------------------------------------ expanding */

  // Card geometry arrives already computed, and expanding is the one thing that
  // changes it. Rather than duplicate the layout engine here, the card is grown
  // in place, the cards below it in the same column are pushed down by the same
  // amount, and every arrow is re-anchored from where its row actually sits.
  // Row heights are fixed by the stylesheet, so measuring is exact.

  function nodeFor(id) {
    return data.nodes.find(function (n) { return n.id === id; });
  }

  function reflow(card, delta) {
    if (!delta) return;
    var node = nodeFor(card.dataset.id);
    if (!node) return;

    node.height += delta;
    card.style.height = node.height + "px";
    Object.keys(data.arrangements).forEach(function (name) {
      var placed = data.arrangements[name].nodes[node.id];
      if (placed) placed.height += delta;
    });

    // Only this column moves: ranks are horizontal, so nothing in another
    // column can collide with a card that grew.
    data.nodes.forEach(function (other) {
      if (other.id === node.id) return;
      if (other.x !== node.x) return;
      if (other.y < node.y) return;
      other.y += delta;
      Object.keys(data.arrangements).forEach(function (name) {
        var placed = data.arrangements[name].nodes[other.id];
        if (placed && placed.y > node.y) placed.y += delta;
      });
      var el = document.getElementById("card-" + cssId(other.id));
      if (el) el.style.top = other.y + "px";
    });

    data.height += delta;
    canvas.style.height = data.height + "px";
    var svg = document.getElementById("edges");
    if (svg) svg.setAttribute("height", data.height);

    rerouteEdges();
  }

  function anchorFor(nodeId, side, line, fileLevel) {
    var card = document.getElementById("card-" + cssId(nodeId));
    var node = nodeFor(nodeId);
    if (!card || !node) return null;

    // An import names the file, so it meets the card at its title.
    if (fileLevel) {
      var titleEl = card.querySelector(".card-title");
      return { y: node.y + (titleEl ? titleEl.offsetHeight / 2 : 17), node: node };
    }

    var attribute = side === "base" ? "data-old" : "data-new";
    var row = card.querySelector('.row[' + attribute + '="' + line + '"]');
    // A row inside a closed gap, or below the cap, has no position to point at.
    if (!row || row.offsetParent === null) {
      return { y: node.y + node.height / 2, node: node };
    }
    // The card is the positioned ancestor, so offsetTop already counts the
    // title. Adding the body's offset as well put every arrow a title-height
    // too low — about two rows, which is close enough to look plausible.
    return {
      y: node.y + row.offsetTop + row.offsetHeight / 2,
      node: node,
    };
  }

  function rerouteEdges() {
    data.edges.forEach(function (edge) {
      var group = document.querySelector('g.edge[data-id="' + edge.id + '"]');
      if (!group) return;

      var from = anchorFor(edge.from, edge.fromSide, edge.fromLine, false);
      var to = anchorFor(edge.to, edge.toSide, edge.toLine, edge.kind === "import");
      if (!from || !to) return;

      var goesRight = to.node.x + to.node.width / 2 >= from.node.x + from.node.width / 2;
      var fromX = goesRight ? from.node.x + from.node.width : from.node.x;
      var toX = goesRight ? to.node.x : to.node.x + to.node.width;
      var dx = Math.max(40, Math.abs(toX - fromX) * 0.45);
      var c1 = goesRight ? fromX + dx : fromX - dx;
      var c2 = goesRight ? toX - dx : toX + dx;

      var d = "M " + fromX + " " + from.y + " C " + c1 + " " + from.y + ", " +
              c2 + " " + to.y + ", " + toX + " " + to.y;
      group.querySelectorAll("path").forEach(function (path) {
        path.setAttribute("d", d);
      });
    });
  }

  /** Opens or closes one band, without measuring or moving anything. */
  function setGapOpen(band, open) {
    band.classList.toggle("open", open);
    var row = band.nextElementSibling;
    while (row && row.classList.contains("in-gap")) {
      row.classList.toggle("open", open);
      row = row.nextElementSibling;
    }
  }

  function expand(trigger) {
    var card = trigger.closest(".card");
    if (!card) return;
    var before = card.querySelector(".card-body").scrollHeight;

    if (trigger.classList.contains("more")) {
      card.classList.add("expanded");
      trigger.remove();
    } else {
      // Every band toggles both ways, so it stays put rather than dissolving
      // into what it revealed and leaving no way to fold it back.
      setGapOpen(trigger, !trigger.classList.contains("open"));
    }

    var after = card.querySelector(".card-body").scrollHeight;
    reflow(card, after - before);
  }

  /**
   * Applies a height change to every card at once.
   *
   * Cards are settled from the top of each column down, because growing one
   * pushes everything below it, and doing them out of order would compound the
   * shifts onto cards that had already moved.
   */
  function settle(measure) {
    var pending = [];
    cards.forEach(function (card) {
      var body = card.querySelector(".card-body");
      if (!body) return;
      var before = body.scrollHeight;
      measure(card);
      pending.push({ card: card, delta: body.scrollHeight - before });
    });

    pending
      .filter(function (entry) { return entry.delta !== 0; })
      .sort(function (a, b) {
        var na = nodeFor(a.card.dataset.id);
        var nb = nodeFor(b.card.dataset.id);
        return na.x - nb.x || na.y - nb.y;
      })
      .forEach(function (entry) { reflow(entry.card, entry.delta); });
  }

  document.querySelectorAll(".row.more, .row.gap.expandable").forEach(function (trigger) {
    trigger.addEventListener("click", function (event) {
      event.stopPropagation();
      expand(trigger);
    });
    trigger.addEventListener("keydown", function (event) {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      expand(trigger);
    });
  });

  /* --------------------------------------------------------------- tooltip */

  function showTooltip(event, id) {
    var edge = data.edges.find(function (e) { return e.id === id; });
    if (!edge) return;
    // Enough path to identify the file, not enough to wrap the tooltip across
    // the card behind it. The full path is on the card itself.
    var shorten = function (path) {
      var parts = path.split("/");
      return parts.slice(-2).join("/");
    };

    tooltip.innerHTML =
      '<div class="target">' + escapeHtml(edge.label || edge.symbol || "") + "</div>" +
      '<div class="meta">' + escapeHtml(shorten(edge.fromPath)) + ":" + edge.fromLine +
      ' <span class="arrow">&rarr;</span> ' +
      escapeHtml(shorten(edge.toPath)) + ":" + edge.toLine + "</div>" +
      '<div class="meta">' + edge.change + " &middot; " + edge.kind +
      " &middot; " + edge.confidence + "</div>";
    tooltip.title = edge.fromPath + " → " + edge.toPath;
    // The arrow in the tooltip is the arrow under the cursor, so it carries the
    // same colour: green for a reference the change introduced, red for one it
    // took away.
    tooltip.classList.remove("added", "removed", "unchanged");
    tooltip.classList.add("visible", edge.change);
    moveTooltip(event);
  }

  function moveTooltip(event) {
    tooltip.style.left = Math.min(event.clientX + 14, window.innerWidth - 470) + "px";
    tooltip.style.top = event.clientY + 18 + "px";
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  /* --------------------------------------------------------------- filters */

  function refreshFilters() {
    var showImports = document.getElementById("filter-imports").checked;
    var showUnchanged = document.getElementById("filter-unchanged").checked;
    var showTests = document.getElementById("filter-tests").checked;

    // The imports switch governs the statements as well as the arrows: showing
    // one without the other leaves arrows pointing into a folded band.
    settle(function (card) {
      card.querySelectorAll(".row.gap.imports").forEach(function (band) {
        setGapOpen(band, showImports);
      });
    });

    // Positions come from whichever arrangement was computed for this choice;
    // there is no layout engine here to work them out.
    var arrangement = data.arrangements[showTests ? "withTests" : "withoutTests"];
    var hiddenNodes = {};

    data.nodes.forEach(function (node) {
      var placed = arrangement.nodes[node.id];
      var card = document.getElementById("card-" + cssId(node.id));
      if (!card) return;

      if (!placed) {
        hiddenNodes[node.id] = true;
        card.classList.add("hidden");
        return;
      }

      card.classList.remove("hidden");
      node.x = placed.x;
      node.y = placed.y;
      card.style.left = node.x + "px";
      card.style.top = node.y + "px";
    });

    data.width = arrangement.width;
    data.height = arrangement.height;
    canvas.style.width = data.width + "px";
    canvas.style.height = data.height + "px";
    var svg = document.getElementById("edges");
    if (svg) {
      svg.setAttribute("width", data.width);
      svg.setAttribute("height", data.height);
    }

    edgeGroups.forEach(function (g) {
      var edge = data.edges.find(function (e) { return e.id === g.dataset.id; });
      var isImport = g.classList.contains("import");
      var isUnchanged = g.classList.contains("unchanged");
      var touchesHidden =
        edge && (hiddenNodes[edge.from] || hiddenNodes[edge.to]);
      var hidden =
        (isImport && !showImports) ||
        (isUnchanged && !showUnchanged) ||
        Boolean(touchesHidden);
      g.classList.toggle("hidden", hidden);
    });

    rerouteEdges();
  }

  ["filter-imports", "filter-unchanged", "filter-tests"].forEach(function (id) {
    var input = document.getElementById(id);
    if (input) input.addEventListener("change", refreshFilters);
  });

  var fitButton = document.getElementById("action-fit");
  if (fitButton) fitButton.addEventListener("click", fit);

  document.addEventListener("keydown", function (event) {
    if (event.target instanceof HTMLInputElement) return;
    if (event.key === "f") fit();
    if (event.key === "Escape") clearHighlight();
  });

  /* ------------------------------------------------------------ host bridge */

  // Present when hosted in an editor webview; absent in a plain browser, where
  // the graph is still fully explorable, just not able to open files.
  var host =
    typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : null;

  function notifyHost(type, payload) {
    if (host) host.postMessage({ type: type, payload: payload });
  }

  refreshFilters();
  fit();
  window.addEventListener("resize", fit);
})();
`;
