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
    // The toolbar stacks into columns, so its height depends on how much it
    // has to say; measuring beats assuming.
    var bar = document.querySelector(".toolbar");
    var top = bar ? bar.getBoundingClientRect().height + 12 : 60;

    var scale = clamp(
      Math.min(
        (rect.width - 80) / data.width,
        (rect.height - top - 60) / data.height,
      ),
      MIN_SCALE,
      1,
    );
    view.scale = scale;
    view.x = (rect.width - data.width * scale) / 2;
    view.y = top + (rect.height - top - data.height * scale) / 2;
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

  /* ----------------------------------------------------------- positioning */

  /**
   * Places every card from scratch.
   *
   * Positions are a function of three things: the arrangement in force, which
   * cards are hidden, and how tall each one currently is. Computing them fresh
   * every time is the whole point — the previous approach nudged cards by a
   * delta per action, and any action that reset positions (switching
   * arrangements) left those nudges recorded but no longer applied, so the next
   * one subtracted the same space twice and stacked cards on top of each other.
   *
   * The arrangement's own coordinates are treated as immutable and never
   * written back to, so there is exactly one source of truth to drift from.
   */
  function recompute() {
    var showTests = document.getElementById("filter-tests").checked;
    var hideViewed = document.getElementById("filter-viewed").checked;
    var arrangement = data.arrangements[showTests ? "withTests" : "withoutTests"];

    // What counts as read: marked by hand, or accounted for by everything that
    // referenced it having been marked.
    implied = impliedRead();

    var columns = {};

    data.nodes.forEach(function (node) {
      var card = document.getElementById("card-" + cssId(node.id));
      if (!card) return;

      var placed = arrangement.nodes[node.id];
      if (!placed) {
        card.classList.add("hidden");
        return;
      }

      card.classList.remove("hidden");
      node.x = placed.x;
      node.column = placed.column;
      card.style.left = node.x + "px";

      var bucket = columns[placed.column] || (columns[placed.column] = []);
      bucket.push({ node: node, card: card, placed: placed });
    });

    Object.keys(columns).forEach(function (key) {
      var entries = columns[key].sort(function (a, b) {
        return a.placed.y - b.placed.y;
      });

      // Cards keep the positions the layout aimed them at; only the difference
      // made by expanding or hiding is carried down the column. A running floor
      // enforces the same clearance the layout engine does, because the shift
      // alone does not: hiding a card subtracts space, and if something above
      // it has grown, the two can meet in the middle.
      var shift = 0;
      var floor = -Infinity;
      entries.forEach(function (entry) {
        var read = isRead(entry.node.id);
        var hidden = hideViewed && read;
        entry.card.classList.toggle("viewed-hidden", hidden);
        entry.card.classList.toggle("is-viewed", read);
        // Implied is not the same as marked, so the box stays as the reader
        // left it; only the card's appearance follows.
        entry.card.classList.toggle("is-implied", !isViewed(entry.node.id) && read);

        var box = entry.card.querySelector(".viewed-box");
        if (box) box.checked = isViewed(entry.node.id);

        if (hidden) {
          shift -= entry.placed.height + data.rowGap;
          return;
        }

        var title = entry.card.querySelector(".card-title");
        var body = entry.card.querySelector(".card-body");
        var height = body
          ? (title ? title.offsetHeight : 0) + body.scrollHeight
          : entry.placed.height;

        var wanted = entry.placed.y + shift;
        entry.node.y = Math.max(wanted, floor);
        entry.node.height = height;
        entry.card.style.top = entry.node.y + "px";
        entry.card.style.height = height + "px";

        floor = entry.node.y + height + data.rowGap;
        shift += height - entry.placed.height;
      });
    });

    var tallest = 0;
    data.nodes.forEach(function (node) {
      var card = document.getElementById("card-" + cssId(node.id));
      if (!card || card.classList.contains("hidden") ||
          card.classList.contains("viewed-hidden")) return;
      tallest = Math.max(tallest, node.y + node.height);
    });

    data.height = tallest + 48;
    canvas.style.height = data.height + "px";
    data.width = arrangement.width;
    canvas.style.width = data.width + "px";

    var svg = document.getElementById("edges");
    if (svg) {
      svg.setAttribute("width", data.width);
      svg.setAttribute("height", data.height);
    }

    rerouteEdges();
  }

  function nodeFor(id) {
    return data.nodes.find(function (n) { return n.id === id; });
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

    // A row inside a closed gap, or below the cap, has no position to point at;
    // the fold that would reveal it does.
    if (!row || row.offsetParent === null) {
      var fold = foldFor(card, row);
      if (!fold) return { y: node.y + node.height / 2, node: node };
      row = fold;
    }

    // The card is the positioned ancestor, so offsetTop already counts the
    // title. Adding the body's offset as well put every arrow a title-height
    // too low — about two rows, which is close enough to look plausible.
    return {
      y: node.y + row.offsetTop + row.offsetHeight / 2,
      node: node,
    };
  }

  /** The visible band or bar standing in for a row that is not on screen. */
  function foldFor(card, row) {
    if (row) {
      for (var previous = row.previousElementSibling; previous;
           previous = previous.previousElementSibling) {
        if (previous.classList.contains("gap") && previous.offsetParent !== null) {
          return previous;
        }
      }
    }
    return card.querySelector(".row.more");
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

  /* ------------------------------------------------------------ expanding */

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

    if (trigger.classList.contains("more")) {
      card.classList.add("expanded");
      trigger.remove();
    } else {
      // Every band toggles both ways, so it stays put rather than dissolving
      // into what it revealed and leaving no way to fold it back.
      setGapOpen(trigger, !trigger.classList.contains("open"));
    }

    recompute();
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

  /* ---------------------------------------------------------------- review */

  // Comments written here but not yet sent. Held together so the forge sees
  // one review carrying a verdict, rather than a notification per remark.
  var drafts = [];

  var composer = document.querySelector(".composer");
  var panel = document.querySelector(".review");
  var reviewButton = document.getElementById("action-review");
  var pending = null;

  /** Marks the lines that already carry a comment, and the ones drafted here. */
  function markCommentedLines() {
    document.querySelectorAll(".row.commented, .row.drafted").forEach(function (row) {
      row.classList.remove("commented", "drafted");
      var badge = row.querySelector(".comment-badge");
      if (badge) badge.remove();
    });

    var byLine = {};
    (data.comments || []).forEach(function (c) {
      var key = c.path + ":" + c.side + ":" + c.line;
      (byLine[key] = byLine[key] || []).push(c);
    });
    drafts.forEach(function (d) {
      var key = d.path + ":" + d.side + ":" + d.line;
      (byLine[key] = byLine[key] || []).push({ draft: true, body: d.body, author: "you" });
    });

    Object.keys(byLine).forEach(function (key) {
      var parts = key.split(":");
      var side = parts[parts.length - 2];
      var line = parts[parts.length - 1];
      var path = parts.slice(0, -2).join(":");

      var node = data.nodes.find(function (n) { return n.path === path; });
      if (!node) return;
      var card = document.getElementById("card-" + cssId(node.id));
      if (!card) return;

      var attribute = side === "LEFT" ? "data-old" : "data-new";
      var row = card.querySelector(".row[" + attribute + '="' + line + '"]');
      if (!row) return;

      var entries = byLine[key];
      var drafted = entries.some(function (e) { return e.draft; });
      row.classList.add(drafted ? "drafted" : "commented");

      var badge = document.createElement("span");
      badge.className = "comment-badge";
      badge.textContent = entries.length > 1 ? String(entries.length) : "";
      badge.title = entries
        .map(function (e) { return (e.author || "?") + ": " + e.body; })
        .join("\n\n");
      row.appendChild(badge);
    });
  }

  /** Opens the composer against a line, positioned beside it. */
  function compose(card, row, event) {
    var node = nodeFor(card.dataset.id);
    if (!node) return;

    var side = row.getAttribute("data-new") ? "RIGHT" : "LEFT";
    var line = row.getAttribute(side === "RIGHT" ? "data-new" : "data-old");
    if (!line) return;

    pending = { path: node.path, line: Number(line), side: side };
    composer.querySelector(".composer-where").textContent =
      node.path.split("/").pop() + ":" + line;
    composer.querySelector(".composer-body").value = "";
    composer.querySelector(".as-suggestion").checked = false;
    composer.hidden = false;

    var box = composer.getBoundingClientRect();
    composer.style.left =
      Math.min(event.clientX + 16, window.innerWidth - box.width - 16) + "px";
    composer.style.top =
      Math.min(event.clientY, window.innerHeight - box.height - 16) + "px";
    composer.querySelector(".composer-body").focus();
  }

  if (composer) {
    composer.querySelector(".composer-cancel").addEventListener("click", function () {
      composer.hidden = true;
      pending = null;
    });

    composer.querySelector(".composer-add").addEventListener("click", function () {
      var text = composer.querySelector(".composer-body").value.trim();
      if (!text || !pending) return;

      // A suggestion is an ordinary comment in a fenced block the forge knows
      // how to offer as a one-click change.
      var suggest = composer.querySelector(".as-suggestion").checked;
      // Written with escapes because this whole script lives inside a template
      // literal, which a literal fence would end.
      var fence = "\u0060\u0060\u0060";
      var body = suggest ? fence + "suggestion\n" + text + "\n" + fence : text;

      drafts.push({ path: pending.path, line: pending.line, side: pending.side, body: body });
      composer.hidden = true;
      pending = null;
      refreshReview();
    });
  }

  function refreshReview() {
    if (reviewButton) {
      reviewButton.hidden = !data.canReview || drafts.length === 0;
      reviewButton.querySelector(".count").textContent = String(drafts.length);
    }
    if (panel) {
      panel.querySelector(".review-count").textContent =
        drafts.length + (drafts.length === 1 ? " comment" : " comments");
      panel.querySelector(".review-list").innerHTML = drafts
        .map(function (d, i) {
          return '<div class="review-item"><span class="where">' +
            escapeHtml(d.path.split("/").pop()) + ":" + d.line +
            '</span><span class="what">' + escapeHtml(d.body.slice(0, 90)) +
            '</span><button class="drop" data-index="' + i + '">remove</button></div>';
        })
        .join("");
      panel.querySelectorAll(".drop").forEach(function (button) {
        button.addEventListener("click", function () {
          drafts.splice(Number(button.dataset.index), 1);
          refreshReview();
          markCommentedLines();
        });
      });
    }
    markCommentedLines();
  }

  if (reviewButton) {
    reviewButton.addEventListener("click", function () {
      panel.hidden = !panel.hidden;
    });
  }

  if (panel) {
    panel.querySelectorAll(".review-submit").forEach(function (button) {
      button.addEventListener("click", function () {
        var body = panel.querySelector(".review-body").value.trim();
        var event = button.dataset.event;
        if (event !== "APPROVE" && !body) {
          panel.querySelector(".review-body").focus();
          return;
        }
        // The host confirms before anything is sent; nothing leaves here on
        // the strength of a single click.
        notifyHost("submitReview", { event: event, body: body, comments: drafts });
      });
    });
  }

  // Lines accept a comment on click, when the host can post one.
  cards.forEach(function (card) {
    card.addEventListener("click", function (event) {
      if (!data.canReview) return;
      if (event.target.closest(".card-title")) return;
      if (event.target.closest(".row.gap, .row.more")) return;
      var row = event.target.closest(".row");
      if (!row) return;
      event.stopPropagation();
      compose(card, row, event);
    });
  });

  /* --------------------------------------------------------------- tooltip */

  function showTooltip(event, id) {
    var edge = data.edges.find(function (e) { return e.id === id; });
    if (!edge) return;
    // File names only. The directory prefix of two files in the same project
    // is mostly identical, so it costs three wrapped lines to say almost
    // nothing; the name is what tells them apart. The full pair stays on the
    // element's title for when it is genuinely ambiguous.
    var name = function (path) {
      return path.slice(path.lastIndexOf("/") + 1);
    };

    // The colon is dimmed so the eye can split "file" from "line" without a
    // pause; run in the same colour they read as one long token.
    var at = function (path, line) {
      return escapeHtml(name(path)) + '<span class="at">:</span>' +
        '<span class="line">' + line + "</span>";
    };

    tooltip.innerHTML =
      '<div class="target">' + escapeHtml(edge.label || edge.symbol || "") + "</div>" +
      '<div class="meta">' + at(edge.fromPath, edge.fromLine) +
      ' <span class="arrow">&rarr;</span> ' +
      at(edge.toPath, edge.toLine) + "</div>" +
      '<div class="facts"><span class="' + edge.change + '">' + edge.change +
      "</span> &middot; " + edge.kind + " &middot; " + edge.confidence + "</div>";
    tooltip.title = edge.fromPath + " → " + edge.toPath;
    // The arrow in the tooltip is the arrow under the cursor, so it carries the
    // same colour: green for a reference the change introduced, red for one it
    // took away.
    tooltip.classList.remove("added", "removed", "unchanged");
    tooltip.classList.add("visible", edge.change);
    moveTooltip(event);
  }

  function moveTooltip(event) {
    // Measured rather than assumed, because a wrapped path makes the height
    // depend on what it says.
    var box = tooltip.getBoundingClientRect();
    var left = Math.min(event.clientX + 14, window.innerWidth - box.width - 12);
    var top = event.clientY + 18;
    if (top + box.height > window.innerHeight - 12) {
      top = Math.max(12, event.clientY - box.height - 12);
    }
    tooltip.style.left = Math.max(12, left) + "px";
    tooltip.style.top = top + "px";
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  /* --------------------------------------------------------------- filters */

  // Which files the reader has marked off. Kept here rather than in the graph:
  // it is a note about the reader's progress, not a fact about the change.
  var viewed = {};

  /** Untouched files settled by their callers rather than by a click. */
  var implied = {};

  function isRead(nodeId) {
    return viewed[nodeId] === true || implied[nodeId] === true;
  }

  function isViewed(nodeId) {
    return viewed[nodeId] === true;
  }

  /**
   * Untouched files whose every reference has been read.
   *
   * Such a file was never part of the change; it is on the canvas only because
   * something in the change reaches it. Once every one of those callers has
   * been marked off, it is answering a question nobody is still asking, so it
   * follows them. Resolved to a fixed point because one untouched file may
   * reach another, and reading the last caller of the first settles the second
   * as well.
   */
  function impliedRead() {
    var implied = {};
    var settled = false;

    while (!settled) {
      settled = true;
      data.nodes.forEach(function (node) {
        if (!node.untouched || viewed[node.id] || implied[node.id]) return;

        var incoming = data.edges.filter(function (e) { return e.to === node.id; });
        // Nothing points at it, so nothing can account for it either.
        if (incoming.length === 0) return;

        var accounted = incoming.every(function (e) {
          return viewed[e.from] === true || implied[e.from] === true;
        });
        if (accounted) {
          implied[node.id] = true;
          settled = false;
        }
      });
    }

    return implied;
  }

  /**
   * Applies every switch, then lets the layout be worked out from scratch.
   *
   * This function decides only what is shown; where it goes is recompute's
   * business. Keeping the two apart is what stopped the cards colliding: when
   * this also moved them, each switch left its own adjustments recorded, and
   * the next one applied them a second time.
   */
  function refreshFilters() {
    var showImports = document.getElementById("filter-imports").checked;
    var showUnchanged = document.getElementById("filter-unchanged").checked;
    var showTests = document.getElementById("filter-tests").checked;
    var hideViewed = document.getElementById("filter-viewed").checked;

    // Settle the implied set before anything reads it: the edge pass below
    // asks what counts as read, and recompute would otherwise update it a step
    // too late, leaving arrows visible into a card that had just gone.
    implied = impliedRead();

    // The imports switch governs the statements as well as the arrows: showing
    // one without the other leaves arrows pointing into a folded band.
    cards.forEach(function (card) {
      card.querySelectorAll(".row.gap.imports").forEach(function (band) {
        setGapOpen(band, showImports);
      });
    });

    var arrangement = data.arrangements[showTests ? "withTests" : "withoutTests"];

    edgeGroups.forEach(function (g) {
      var edge = data.edges.find(function (e) { return e.id === g.dataset.id; });
      var isImport = g.classList.contains("import");
      var isUnchanged = g.classList.contains("unchanged");
      var gone =
        edge &&
        (!arrangement.nodes[edge.from] ||
          !arrangement.nodes[edge.to] ||
          (hideViewed && (isRead(edge.from) || isRead(edge.to))));
      g.classList.toggle(
        "hidden",
        (isImport && !showImports) || (isUnchanged && !showUnchanged) || Boolean(gone),
      );
    });

    recompute();
  }

  /** Sets one file's state, from a click here or from the host. */
  function setViewed(nodeId, marked, tell) {
    viewed[nodeId] = marked;
    refreshFilters();
    if (tell) {
      var node = nodeFor(nodeId);
      if (node) notifyHost("viewed", { path: node.path, viewed: marked });
    }
  }

  cards.forEach(function (card) {
    var box = card.querySelector(".viewed-box");
    if (!box) return;
    box.addEventListener("click", function (event) { event.stopPropagation(); });
    box.addEventListener("change", function () {
      setViewed(card.dataset.id, box.checked, true);
    });
  });

  // The sidebar and the canvas show the same marks, so the host keeps them
  // in step.
  window.addEventListener("message", function (event) {
    var message = event.data;
    if (message && message.type === "reviewSubmitted") {
      drafts = [];
      if (panel) {
        panel.hidden = true;
        panel.querySelector(".review-body").value = "";
      }
      if (message.comments) data.comments = message.comments;
      refreshReview();
      return;
    }
    if (!message || message.type !== "setViewed") return;
    var byPath = {};
    data.nodes.forEach(function (n) { byPath[n.path] = n.id; });
    (message.paths || []).forEach(function (path) {
      if (byPath[path]) viewed[byPath[path]] = message.viewed === true;
    });
    refreshFilters();
  });

  ["filter-imports", "filter-unchanged", "filter-tests", "filter-viewed"].forEach(function (id) {
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
  refreshReview();
  fit();
  window.addEventListener("resize", fit);
})();
`;
