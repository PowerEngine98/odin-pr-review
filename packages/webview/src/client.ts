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
      if (card.classList.contains("active")) clearHighlight();
      else highlightNode(card.dataset.id);
      notifyHost("open", { path: card.dataset.path });
    });
  });

  viewport.addEventListener("click", function (event) {
    if (event.target.closest(".card") || event.target.closest("path.hit")) return;
    clearHighlight();
  });

  /* --------------------------------------------------------------- tooltip */

  function showTooltip(event, id) {
    var edge = data.edges.find(function (e) { return e.id === id; });
    if (!edge) return;
    tooltip.innerHTML =
      '<div class="target">' + escapeHtml(edge.label || edge.symbol || "") + "</div>" +
      '<div class="meta">' + escapeHtml(edge.fromPath) + ":" + edge.fromLine +
      " &rarr; " + escapeHtml(edge.toPath) + ":" + edge.toLine +
      "  &middot; " + edge.change + " &middot; " + edge.confidence + "</div>";
    tooltip.classList.add("visible");
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

    edgeGroups.forEach(function (g) {
      var isImport = g.classList.contains("import");
      var isUnchanged = g.classList.contains("unchanged");
      var hidden = (isImport && !showImports) || (isUnchanged && !showUnchanged);
      g.classList.toggle("hidden", hidden);
    });
  }

  ["filter-imports", "filter-unchanged"].forEach(function (id) {
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
