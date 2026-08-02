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
  var chromeBar = document.querySelector(".chrome");

  /*
   * Which way the change is being read: side by side, or one column.
   *
   * Both are in the document. Split is the default because it is the only one
   * where a line and the line that replaced it sit on the same row, and so the
   * only one where both gutters carry a real number against the same code.
   */
  /*
   * Which part of the change is being read, as a set of file ids.
   *
   * Empty means all of it. A large pull request is usually several changes
   * pushed together, and a reviewer who has finished one of them should be able
   * to set it down rather than keep scrolling past it.
   */
  var focused = null;

  var splitMode = readMode();
  document.body.classList.toggle("split", splitMode);

  function readMode() {
    try {
      var saved = window.localStorage.getItem("odin.diff-mode");
      if (saved === "unified") return false;
      if (saved === "split") return true;
    } catch (e) {}
    return !data.unified;
  }

  // Scoped to the strip: the markdown editor has tabs of its own, and a bare
  // .tab caught its Write and Preview buttons too.
  var tabs = Array.prototype.slice.call(document.querySelectorAll(".parts .part-tab"));

  var view = { x: 0, y: 0, scale: 1 };
  // Low enough that a part of a large change fits on screen. A tall card is
  // thousands of pixels; a floor of 0.15 meant "fit" still left most of a part
  // below the fold, which is the one thing fit is for.
  var MIN_SCALE = 0.04;
  var MAX_SCALE = 3;

  /*
   * Sharpness while zoomed.
   *
   * The canvas is a single transformed layer, and a promoted layer is drawn
   * once at the scale it was promoted at and then stretched — which is why
   * zoomed-in code looked like an enlarged screenshot rather than larger text.
   * Promotion is only worth having while the view is in motion, so it is taken
   * for the gesture and handed back once the view has settled; the browser then
   * redraws the glyphs and the edge geometry at the scale actually on screen.
   *
   * On settle the translation is also landed on whole device pixels. Half a
   * pixel of offset costs nothing in position and a visible amount in
   * crispness, because every glyph edge in the picture is then straddling two
   * pixels instead of filling one.
   */
  var settle = 0;

  function apply(hold) {
    canvas.classList.add("moving");
    window.clearTimeout(settle);
    settle = window.setTimeout(rest, hold || 140);
    paint();
  }

  function paint() {
    canvas.style.transform =
      "translate(" + view.x + "px," + view.y + "px) scale(" + view.scale + ")";
    // Everything pinned to a line moves with it: the composer, the open thread,
    // and the marks in the margin. The marks especially — they are placed from
    // screen coordinates, so a view that moves without telling them leaves them
    // behind, or hidden off the edge as if they did not exist.
    placeComposer();
    placeThread();
    placeMarks();
    pinTitles();
  }

  /**
   * Keeps each card's name in view while the card itself runs off the top.
   *
   * A long file is taller than the window, and once its title has scrolled past
   * the bar there is nothing on screen saying which file the code belongs to —
   * the one question a reader of a graph asks most often. The forge solves this
   * with a sticky header; here there is no scrolling ancestor to be sticky
   * inside, because the canvas is one transformed layer, so the title is moved
   * down its own card by hand.
   *
   * It stops at the foot of the card rather than following the bar forever, so
   * a title never outlives the code it names: as the card leaves, its name
   * slides out with it and the next card's takes over.
   */
  function pinTitles() {
    // Called from every paint, including the first, which happens before the
            // card list has been collected.
    if (!cards) return;
    var top = chromeBar ? chromeBar.getBoundingClientRect().bottom : 0;
    // Where the bar sits in the drawing's own coordinates. Everything below is
    // arithmetic on the card's placed position, not measurement of the DOM.
    // A pixel above the bar rather than level with it. Level leaves a hairline
    // of code showing between the two once the canvas scale turns whole pixels
    // into fractions; a pixel of overlap disappears under an opaque bar.
    var line = (top - 1 - view.y) / view.scale;

    cards.forEach(function (card) {
      var title = card.querySelector(".card-title");
      if (!title || card.offsetParent === null) return;

      var cardTop = parseFloat(card.style.top) || 0;
      var height = parseFloat(card.style.height) || card.offsetHeight;
      var titleHeight = title.offsetHeight;

      // Measured to the title's own top inside the card, not the card's outer
      // edge: the border between them is a pixel, and a pixel of the code
      // showing above a pinned header reads as a gap in the chrome. Rounded
      // down so what is left of it goes under the bar rather than beside it.
      var offset = Math.floor(line - cardTop - (title.offsetTop || 0));
      if (offset <= 0 || height <= titleHeight) {
        if (title.style.transform) {
          title.style.transform = "";
          title.classList.remove("pinned");
        }
        return;
      }

      offset = Math.min(offset, height - titleHeight);
      title.style.transform = "translateY(" + offset + "px)";
      title.classList.add("pinned");
    });
  }

  function rest() {
    var dpr = window.devicePixelRatio || 1;
    view.x = Math.round(view.x * dpr) / dpr;
    view.y = Math.round(view.y * dpr) / dpr;
    paint();
    canvas.classList.remove("moving");
  }

  /* ------------------------------------------------------------ pan & zoom */

  var panning = false;
  var origin = null;

  viewport.addEventListener("pointerdown", function (event) {
    // A mark is not part of the drawing you drag. Capturing the pointer here
    // would redirect the rest of the gesture to the viewport, and the click
    // would never reach the mark at all — which is why the threads stopped
    // opening.
    if (
      event.target.closest(".card") ||
      event.target.closest("path.hit") ||
      event.target.closest(".mark") ||
      event.target.closest(".port")
    ) return;
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

  /**
   * Frames what is actually on the canvas.
   *
   * Measured from the cards that are showing rather than from the drawing's
   * full extent: with a part open, or tests hidden, most of that extent is the
   * space the others left behind, and fitting to it puts a handful of cards in
   * a corner of the screen surrounded by nothing.
   */
  function shown() {
    var left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;

    cards.forEach(function (card) {
      if (card.classList.contains("hidden") ||
          card.classList.contains("viewed-hidden")) return;
      var node = nodeFor(card.dataset.id);
      if (!node) return;
      left = Math.min(left, node.x);
      top = Math.min(top, node.y);
      right = Math.max(right, node.x + node.width);
      bottom = Math.max(bottom, node.y + node.height);
    });

    if (left === Infinity) {
      return { x: 0, y: 0, width: data.width, height: data.height };
    }
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  function fit() {
    var rect = viewport.getBoundingClientRect();
    // The header stacks into columns and wraps, so its height depends on how
    // much it has to say; measuring beats assuming.
    var bar = document.querySelector(".chrome") || document.querySelector(".toolbar");
    var top = bar ? bar.getBoundingClientRect().height + 12 : 60;
    var box = shown();

    var scale = clamp(
      Math.min(
        (rect.width - 80) / box.width,
        (rect.height - top - 60) / box.height,
      ),
      MIN_SCALE,
      1,
    );
    view.scale = scale;
    view.x = (rect.width - box.width * scale) / 2 - box.x * scale;
    view.y = top + (rect.height - top - box.height * scale) / 2 - box.y * scale;
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
    // Hold the promotion for the whole flight, or the layer would be given
    // back mid-animation and the browser would repaint every frame of it.
    apply(400);
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
      // Follows the reference on the canvas and nothing more. Opening an editor
      // here took the screen away from the picture the reader was reading; the
      // button on a card's header is where opening a file is asked for.
      centerOn(edge.to);
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
    clearSelection();
    closeThread();
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
  /**
   * The positions for the way the change is currently being read.
   *
   * A card is a different width and height split than it is unified, so the
   * mode picks a whole arrangement rather than a stylesheet. Falls back to the
   * one the page was rendered in when the other was never computed.
   */
  function arrangementFor(showTests) {
    var primary = splitMode === !data.unified;
    var key = showTests ? "withTests" : "withoutTests";
    var other = showTests ? "otherWithTests" : "otherWithoutTests";
    return data.arrangements[primary ? key : other] || data.arrangements[key];
  }

  /** The body showing the change the way it is currently being read. */
  function visibleBody(card) {
    return card.querySelector(splitMode ? ".card-body.split-view" : ".card-body.unified-view");
  }

  function recompute() {
    var showTests = document.getElementById("filter-tests").checked;
    var hideViewed = document.getElementById("filter-viewed").checked;
    var arrangement = arrangementFor(showTests);

    // What counts as read: marked by hand, or accounted for by everything that
    // referenced it having been marked.
    implied = impliedRead();

    var columns = {};

    data.nodes.forEach(function (node) {
      var card = document.getElementById("card-" + cssId(node.id));
      if (!card) return;

      var placed = arrangement.nodes[node.id];
      if (!placed || (focused && !focused[node.id])) {
        card.classList.add("hidden");
        return;
      }

      card.classList.remove("hidden");
      node.x = placed.x;
      node.column = placed.column;
      card.style.left = node.x + "px";
      if (placed.width) {
        node.width = placed.width;
        card.style.width = placed.width + "px";
      }

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
        // A file the change touched stays on the canvas whatever happens to it.
        // It goes quiet when it has been read — dimmed, its box ticked — but it
        // does not leave: the picture is of this change, and a change with its
        // read files removed is a picture of something else. What the switch
        // takes away is the untouched files, which are only here because
        // something pointed at them, and which have nothing left to say once
        // everything pointing at them has been read.
        var hidden = hideViewed && read && entry.node.untouched;
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
        var body = visibleBody(entry.card);
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
    placeMarks();
  }

  function nodeFor(id) {
    return data.nodes.find(function (n) { return n.id === id; });
  }

  /**
   * The visible row showing a definition, when the side asked for has none.
   *
   * A card is mostly head-side material: the diff's own lines, plus whatever
   * was fetched around them, and what is fetched is fetched from the head
   * checkout. A removed call resolves against the base checkout, so it asks for
   * a base line the card was never given a row for, and the arrow fell back to
   * the band standing in for that stretch — pointing at "somewhere in here"
   * when the line it means is on screen a row or two below, with its own
   * number, because nothing about the definition changed.
   *
   * Searched by name rather than by number because the two checkouts number the
   * same line differently, and the name is what the arrow is about.
   */
  function definitionRow(body, symbol) {
    if (!symbol) return null;

    var rows = body.querySelectorAll(".row.split, .row.flat");
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (row.offsetParent === null) continue;
      var texts = row.querySelectorAll(".text");
      for (var t = 0; t < texts.length; t++) {
        if (texts[t].textContent.indexOf(symbol) >= 0) return row;
      }
    }
    return null;
  }

  function anchorFor(nodeId, side, line, fileLevel, symbol) {
    var card = document.getElementById("card-" + cssId(nodeId));
    var node = nodeFor(nodeId);
    if (!card || !node) return null;

    // An import names the file, so it meets the card at its title.
    if (fileLevel) {
      var titleEl = card.querySelector(".card-title");
      return { y: node.y + (titleEl ? titleEl.offsetHeight / 2 : 17), node: node };
    }

    var attribute = side === "base" ? "data-old" : "data-new";
    // Both readings of the change are in the card and one of them is hidden, so
    // every question about where a line sits is asked of the visible one.
    var body = visibleBody(card) || card;
    var row = body.querySelector('.row[' + attribute + '="' + line + '"]');

    // A row inside a closed gap, or below the cap, has no position to point at;
    // the fold that would reveal it does.
    if (!row || row.offsetParent === null) {
      // The line itself, if it is on screen under the other side's number,
      // before the band that would only say which stretch it is in.
      var named = definitionRow(body, symbol);
      var fold = named || foldFor(body, row, side, line);
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

  /**
   * The visible band or bar standing in for a row that is not on screen.
   *
   * A band between two hunks has no rows behind it — those lines were never
   * read — so there is nothing in the document to walk back from. Each band
   * carries the range it hides instead, which is the only way to find the one
   * covering a line that was never rendered. Without it an arrow aimed at such
   * a line fell through to the truncation bar or the middle of the card, and
   * claimed a position it had no reason to claim.
   */
  /** The visible band that says it stands in for this line, or nothing. */
  function bandCovering(root, side, line) {
    var from = side === "base" ? "data-base-from" : "data-head-from";
    var to = side === "base" ? "data-base-to" : "data-head-to";

    var bands = root.querySelectorAll(".row.gap[" + from + "]");
    for (var i = 0; i < bands.length; i++) {
      var band = bands[i];
      if (band.offsetParent === null) continue;
      if (line >= Number(band.getAttribute(from)) && line <= Number(band.getAttribute(to))) {
        return band;
      }
    }
    return null;
  }

  function foldFor(root, row, side, line) {
    var covering = bandCovering(root, side, line);
    if (covering) return covering;

    // Held back by the card's height rather than by a fold. The bar at the foot
    // is the honest place to point: it says there is more below and opens it.
    // The nearest band above would say "in this stretch of unchanged code",
    // which is a different claim, and a false one.
    if (row && row.classList.contains("beyond-cap")) {
      var bar = root.querySelector(".row.more");
      if (bar) return bar;
    }

    // A row that exists but is folded away: the band above it is the one.
    if (row) {
      for (var previous = row.previousElementSibling; previous;
           previous = previous.previousElementSibling) {
        if (previous.classList.contains("gap") && previous.offsetParent !== null) {
          return previous;
        }
      }
    }
    return root.querySelector(".row.more");
  }

  function mixPoint(a, b, t) {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }

  function curvePoint(p, t) {
    var a = mixPoint(p[0], p[1], t);
    var b = mixPoint(p[1], p[2], t);
    var c = mixPoint(p[2], p[3], t);
    return mixPoint(mixPoint(a, b, t), mixPoint(b, c, t), t);
  }

  /**
   * The curve with its last few pixels taken off, cut with de Casteljau.
   *
   * Stepping back along the end tangent instead would land off the line: the
   * curve is at its most bent exactly where it arrives.
   */
  function shortenCurve(p, back) {
    var steps = 96;
    var seen = [];
    for (var i = 0; i <= steps; i++) seen.push(curvePoint(p, i / steps));

    var travelled = 0;
    var t = 0;
    for (var j = steps; j > 0; j--) {
      var step = Math.hypot(seen[j].x - seen[j - 1].x, seen[j].y - seen[j - 1].y);
      // Between two samples, not at one of them: on a long arrow one step is
      // tens of pixels, and stopping at the near end of it leaves the head
      // floating that far off the end of the line.
      if (travelled + step >= back) {
        t = (j - 1 + (travelled + step - back) / (step || 1)) / steps;
        break;
      }
      travelled += step;
    }

    var a = mixPoint(p[0], p[1], t);
    var b = mixPoint(p[1], p[2], t);
    var c = mixPoint(p[2], p[3], t);
    var d = mixPoint(a, b, t);
    var e = mixPoint(b, c, t);
    return [p[0], a, d, mixPoint(d, e, t)];
  }

  function bezierPath(p) {
    return "M " + p[0].x + " " + p[0].y + " C " + p[1].x + " " + p[1].y + ", " +
           p[2].x + " " + p[2].y + ", " + p[3].x + " " + p[3].y;
  }

  function rerouteEdges() {
    data.edges.forEach(function (edge) {
      var group = document.querySelector('g.edge[data-id="' + edge.id + '"]');
      if (!group) return;

      // The name matters at both ends: a call site whose row is folded away is
      // found the same way its definition is, rather than falling back to the
      // band and leaving the arrow to start from a stretch of unchanged code.
      var from = anchorFor(edge.from, edge.fromSide, edge.fromLine, false, edge.symbol);
      var to = anchorFor(
        edge.to, edge.toSide, edge.toLine, edge.kind === "import", edge.symbol,
      );
      if (!from || !to) return;

      var goesRight = to.node.x + to.node.width / 2 >= from.node.x + from.node.width / 2;
      var fromX = goesRight ? from.node.x + from.node.width : from.node.x;
      var toX = goesRight ? to.node.x : to.node.x + to.node.width;
      var dx = Math.max(40, Math.abs(toX - fromX) * 0.45);
      var c1 = goesRight ? fromX + dx : fromX - dx;
      var c2 = goesRight ? toX - dx : toX + dx;

      // The wire begins on the dot's rim, at the point facing where it is
      // headed, rather than at the card behind it. Drawn from the card it ran
      // straight through the dot and out again, which read as a bead on a
      // string instead of the arrow leaving from there.
      var portX = fromX + (goesRight ? 9 : -9);
      // Started at the dot's radius, the middle of its ring rather than the
      // outside: ending cleanly at the outer edge leaves a hairline of
      // background between the two, so the end tucks under the ring.
      var reach = Math.hypot(toX - portX, to.y - from.y) || 1;
      var startX = portX + ((toX - portX) / reach) * 4.5;
      var startY = from.y + ((to.y - from.y) / reach) * 4.5;

      var points = [
        { x: startX, y: startY },
        { x: c1, y: from.y },
        { x: c2, y: to.y },
        { x: toX, y: to.y },
      ];
      var cut = shortenCurve(points, 13);

      // Three paths: the whole curve to press, the stem that stops where the
      // head begins, and the segment the head is drawn on. A stem carried on
      // underneath the filled triangle shows as a lump at the join.
      var hit = group.querySelector("path.hit");
      if (hit) hit.setAttribute("d", bezierPath(points));
      var stem = group.querySelector("path.wire");
      if (stem) stem.setAttribute("d", bezierPath(cut));
      var head = group.querySelector("path.head");
      if (head) {
        head.setAttribute("d", "M " + cut[3].x + " " + cut[3].y + " L " + toX + " " + to.y);
      }

      // The dot rides the tail of the arrow, the dashes carry on past its head.
      var dot = group.querySelector("circle.port");
      if (dot) {
        // Clear of the card, not on its edge: half a dot under the border is a
        // smudge, and this one is meant to be pressed.
        dot.setAttribute("cx", portX);
        dot.setAttribute("cy", from.y);
      }
      markSymbol(edge, "in");
      markSymbol(edge, "out");

      // Where each end wants the camera, remembered rather than recomputed on
      // the click: by then the view has moved and the numbers would be stale.
      group.dataset.fromX = fromX;
      group.dataset.fromY = from.y;
      group.dataset.toX = toX;
      group.dataset.toY = to.y;
    });
  }

  /**
   * Draws a box around the name at one end of an arrow.
   *
   * The arrow reaches a line; the box says which word on it — at the far end
   * the definition it resolved to, and at the near end the call that resolved.
   * Placed by arithmetic rather than by measuring the browser's text, using the
   * same character width the layout engine used: the two have to agree, and
   * asking the browser would be asking a different question.
   *
   * Pressing either takes you to the other end, which is the same journey the
   * dot makes, offered from wherever the reader happens to be looking.
   */
  function markSymbol(edge, role) {
    if (!edge.symbol || edge.kind === "import") return;

    var here = role === "out" ? edge.from : edge.to;
    var side = role === "out" ? edge.fromSide : edge.toSide;
    var line = role === "out" ? edge.fromLine : edge.toLine;

    var card = document.getElementById("card-" + cssId(here));
    if (!card) return;

    var attribute = side === "base" ? "data-old" : "data-new";
    var body = visibleBody(card) || card;
    var row = body.querySelector(".row[" + attribute + '="' + line + '"]');

    // The line the arrow lands on may be folded away — a deleted call inside a
    // collapsed run, most often. The arrow already points at the band standing
    // in for it, and the band says how many lines it holds but not what is in
    // them. The name goes on the band, so a reference is never invisible only
    // because the code around it is.
    if (!row || row.offsetParent === null) {
      // Same answer the arrow reached: the line under the other side's number
      // when it is on screen, and only then the band standing in for it.
      var named = definitionRow(body, edge.symbol);
      if (named) {
        row = named;
      } else {
        // Only a band that says it holds this line. foldFor falls back to the
        // nearest one and then to the truncation bar, which is the right answer
        // for aiming an arrow -- an arrow must land somewhere -- and the wrong
        // one for a name: a name on a band the line is not in is a claim about
        // where the code is, and it would be false.
        var band = bandCovering(body, side, line);
        if (band) foldedSymbol(band, edge, role);
        return;
      }
    }

    // Split puts the base and head of the change in panes of their own, so the
    // word being boxed is in the pane belonging to this end's side. Falls back
    // to the row's only pane, which is what unified and a one-sided file have.
    var pane = row.querySelector(".side." + (side === "base" ? "base" : "head") + " .text");
    var text = pane || row.querySelector(".text");
    if (!text) return;
    var at = text.textContent.indexOf(edge.symbol);
    if (at < 0) return;

    var selector = '.symbol-box[data-edge="' + edge.id + '"][data-role="' + role + '"]';
    var box = row.querySelector(selector);
    if (!box) {
      box = chrome("symbol-box", "");
      box.dataset.edge = edge.id;
      box.dataset.role = role;
      box.title = role === "out"
        ? "Go to the definition this points at"
        : "Go back to where this is called from";
      box.addEventListener("click", function (event) {
        event.stopPropagation();
        travel(edge.id, role === "out");
      });
      row.appendChild(box);
    }
    box.dataset.change = edge.change;

    // A character of room on the left, so the box does not sit on the first
    // glyph it is meant to be pointing out. The right edge stays where it was.
    // Measured from where this pane's code actually starts rather than from a
    // fixed offset: which column the text begins in depends on the mode and,
    // in split, on which pane the word is in.
    box.style.left = (text.offsetLeft + (at - 1) * data.charWidth) + "px";
    box.style.width = ((edge.symbol.length + 1) * data.charWidth) + "px";
  }

  /**
   * The same box, on the band that hides the line instead of on the line.
   *
   * It carries the name, since there is no code under it to point at, and sits
   * after the band's own label. Several arrows can land on one band, so they
   * are laid out in a row rather than on top of one another.
   */
  function foldedSymbol(band, edge, role) {
    var selector = '.symbol-box[data-edge="' + edge.id + '"][data-role="' + role + '"]';
    var box = band.querySelector(selector);
    if (!box) {
      box = chrome("symbol-box folded", edge.symbol);
      box.dataset.edge = edge.id;
      box.dataset.role = role;
      box.title = (role === "out"
        ? "Go to the definition this points at"
        : "Go back to where this is called from") + " — folded away here";
      box.addEventListener("click", function (event) {
        event.stopPropagation();
        travel(edge.id, role === "out");
      });
      band.appendChild(box);
    }
    box.dataset.change = edge.change;

    // Measured off the label rather than counted in characters: a band is set a
    // size smaller than the code around it, so multiplying its length by the
    // code's character width left the box floating well clear of the words it
    // follows. The header at the far end gives way while boxes are present,
    // since what is hidden in the fold matters more than which hunk it is.
    var label = band.querySelector(".text");
    var x = label ? label.offsetLeft + label.offsetWidth + 8 : data.textLeft;
    var boxes = band.querySelectorAll(".symbol-box.folded");
    boxes.forEach(function (each) {
      var width = (each.textContent.length + 1) * data.charWidth;
      each.style.left = x + "px";
      each.style.width = width + "px";
      x += width + 6;
    });

    var header = band.querySelector(".header");
    if (header) header.hidden = boxes.length > 0;
  }

  /** Moves the camera to one end of an arrow, and lights the arrow. */
  function travel(edgeId, forward) {
    var group = document.querySelector('g.edge[data-id="' + edgeId + '"]');
    var edge = data.edges.find(function (e) { return e.id === edgeId; });
    if (!group || !edge) return;

    highlightEdge(edgeId);
    centerPoint(
      Number(group.dataset[forward ? "toX" : "fromX"]),
      Number(group.dataset[forward ? "toY" : "fromY"]),
      forward ? edge.to : edge.from,
    );
  }

  /**
   * Puts a point on the canvas in the middle of the screen.
   *
   * Following a reference is the gesture the whole tool is built around, and on
   * a change of any size doing it by eye means finding the other end by hand
   * and then finding your way home the same way.
   */
  function centerPoint(x, y, flashNodeId) {
    var rect = viewport.getBoundingClientRect();
    view.x = rect.width / 2 - x * view.scale;
    view.y = rect.height / 2 - y * view.scale;
    canvas.style.transition = "transform 320ms cubic-bezier(.22,.61,.36,1)";
    apply(400);
    window.setTimeout(function () { canvas.style.transition = ""; }, 340);

    if (!flashNodeId) return;
    var card = document.getElementById("card-" + cssId(flashNodeId));
    if (!card) return;
    card.classList.remove("flash");
    void card.offsetWidth;
    card.classList.add("flash");
  }

  document.querySelectorAll("#edges g.edge .port").forEach(function (port) {
    port.addEventListener("click", function (event) {
      event.stopPropagation();
      var group = port.closest("g.edge");
      var edge = data.edges.find(function (e) { return e.id === group.dataset.id; });
      if (!edge) return;

      travel(edge.id, true);
    });
  });

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

  /* ----------------------------------------------------------- the parts */

  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      var part = (data.parts || []).find(function (p) {
        return p.id === tab.dataset.part;
      });

      focused = null;
      if (part) {
        focused = {};
        part.nodes.forEach(function (id) { focused[id] = true; });
      }

      tabs.forEach(function (other) {
        other.classList.toggle("on", other === tab);
      });

      refreshFilters();
      refreshTally();
      // The part fills the view it was opened into; leaving the camera where it
      // was would open a part and show the space the rest of them left behind.
      fit();
    });
  });
  if (tabs[0]) tabs[0].classList.add("on");

  /* -------------------------------------------------------- diff settings */

  var settingsButton = document.getElementById("diff-settings");
  var settingsPanel = document.querySelector(".settings-panel");

  if (settingsButton && settingsPanel) {
    settingsPanel.querySelectorAll("input[name=diff-mode]").forEach(function (radio) {
      radio.checked = (radio.value === "split") === splitMode;
      radio.addEventListener("change", function () {
        if (!radio.checked) return;
        setDiffMode(radio.value === "split");
      });
    });

    settingsButton.addEventListener("click", function (event) {
      event.stopPropagation();
      settingsPanel.hidden = !settingsPanel.hidden;
    });
    // Clicking anywhere else puts it away, the way every other panel here does.
    document.addEventListener("click", function (event) {
      if (settingsPanel.hidden) return;
      if (settingsPanel.contains(event.target) || settingsButton.contains(event.target)) return;
      settingsPanel.hidden = true;
    });
  }

  /**
   * Switches between reading the change side by side and reading it in one
   * column.
   *
   * Both bodies are already in the document, so this is a change of which one
   * is shown and which set of positions applies — cards are a different width
   * and height in each. The arrows are then re-routed rather than moved: they
   * are anchored to rows, and the rows have just changed places.
   */
  function setDiffMode(split) {
    if (split === splitMode) return;
    splitMode = split;
    document.body.classList.toggle("split", splitMode);
    try {
      window.localStorage.setItem("odin.diff-mode", splitMode ? "split" : "unified");
    } catch (e) {}

    recompute();
    buildMarks();
  }

  /* ---------------------------------------------------------------- review */

  // Comments written here but not yet sent. Held together so the forge sees
  // one review carrying a verdict, rather than a notification per remark.
  var drafts = [];

  var composer = document.querySelector(".composer");
  var panel = document.querySelector(".review");
  var reviewButton = document.getElementById("action-review");
  var pending = null;
  /** The row the composer is pinned under, and the code it is about. */
  var anchorRow = null;
  var anchorLines = [];

  /**
   * Marks the lines that already carry a comment, and the ones drafted here.
   *
   * A comment can cover a span, so every row it reaches is marked and the two
   * ends are told apart, which is what lets the margin draw one bracket down
   * the passage instead of a stripe per line. The badge sits on the first row:
   * the forge hangs the thread under the last one, but the reader's eye enters
   * the passage at the top, and that is where the mark has to be to be seen.
   */
  function markCommentedLines() {
    document
      .querySelectorAll(".row.commented, .row.drafted")
      .forEach(function (row) {
        row.classList.remove("commented", "drafted", "span-start", "span-end");
        var badge = row.querySelector(".comment-badge");
        if (badge) badge.remove();
      });

    // Grouped by the exact span, so two remarks on the same passage share one
    // badge while two on overlapping passages stay separate.
    var spans = {};
    var add = function (c, draft) {
      var start = c.startLine || c.line;
      var key = c.path + " " + c.side + " " + start + " " + c.line;
      var span = spans[key];
      if (!span) {
        span = spans[key] = {
          path: c.path, side: c.side, start: start, end: c.line, entries: [],
        };
      }
      span.entries.push({
        draft: draft,
        body: c.body,
        author: draft ? "you" : c.author || "?",
      });
    };
    (data.comments || []).forEach(function (c) { add(c, false); });
    drafts.forEach(function (d) { add(d, true); });

    Object.keys(spans).forEach(function (key) {
      var span = spans[key];
      var node = data.nodes.find(function (n) { return n.path === span.path; });
      if (!node) return;
      var card = document.getElementById("card-" + cssId(node.id));
      if (!card) return;

      var attribute = span.side === "LEFT" ? "data-old" : "data-new";
      var marked = [];
      for (var line = span.start; line <= span.end; line++) {
        var row = (visibleBody(card) || card).querySelector(".row[" + attribute + '="' + line + '"]');
        // Lines folded into a gap have no row of their own; the span is drawn
        // across whatever of it is on screen.
        if (row) marked.push(row);
      }
      if (marked.length === 0) return;

      var drafted = span.entries.some(function (e) { return e.draft; });
      marked.forEach(function (row) {
        row.classList.add(drafted ? "drafted" : "commented");
      });
      if (marked.length > 1) {
        marked[0].classList.add("span-start");
        marked[marked.length - 1].classList.add("span-end");
      }

      // A remark already on the pull request has a mark of its own beside the
      // card now, so the row keeps the bracket that says which lines are being
      // discussed and gives up the badge. Drafts keep theirs: they exist
      // nowhere else yet.
      if (!drafted) return;

      var where = span.start === span.end
        ? String(span.end)
        : span.start + "–" + span.end;
      var badge = document.createElement("span");
      badge.className = "comment-badge";
      badge.textContent = span.entries.length > 1
        ? String(span.entries.length)
        : "";
      badge.title = span.entries
        .map(function (e) { return e.author + " (" + where + "): " + e.body; })
        .join("\n\n");
      marked[0].appendChild(badge);
    });
  }

  /** What a half-written comment is filed under: the span it is about. */
  function composerKey(where) {
    return "c:" + where.path + ":" + where.side + ":" +
      (where.startLine || where.line) + "-" + where.line;
  }

  /** The line a row carries on one side, or null when it has none. */
  function lineOn(row, side) {
    var value = row.getAttribute(side === "RIGHT" ? "data-new" : "data-old");
    return value ? Number(value) : null;
  }

  /**
   * Opens the composer against a line or a span of them, positioned beside it.
   *
   * The side comes from the first row picked, and the extent is read off every
   * row in between rather than off the two ends: an added line has no left
   * number and a removed one no right, so taking the ends alone would fail on
   * any selection that happens to start or finish on the wrong kind of line.
   */
  function compose(card, rows, event) {
    var node = nodeFor(card.dataset.id);
    if (!node) return;

    var side = rows[0].getAttribute("data-new") ? "RIGHT" : "LEFT";
    var lines = rows
      .map(function (row) { return lineOn(row, side); })
      .filter(function (line) { return line !== null; });
    if (lines.length === 0) return;

    var start = Math.min.apply(null, lines);
    var end = Math.max.apply(null, lines);

    pending = { path: node.path, line: end, startLine: start, side: side };

    // The forge's own way of saying where: R for the head side, L for the base,
    // which is the only notation that distinguishes line 40 of the file as it
    // was from line 40 of the file as it will be.
    var mark = side === "RIGHT" ? "R" : "L";
    composer.querySelector(".composer-where").textContent =
      start === end
        ? "Add a comment on line " + mark + end
        : "Add a comment on lines " + mark + start + "–" + mark + end;

    rememberOn(composer, composerKey(pending));
    setTab(composer, "write");
    composer.hidden = false;

    // Pinned under the last line it is about that is actually on screen. A row
    // folded inside a closed gap has no position, and hanging the box off one
    // would put it wherever zero happens to be.
    anchorRow = rows[rows.length - 1];
    for (var r = rows.length - 1; r >= 0; r--) {
      if (rows[r].getBoundingClientRect().height > 0) { anchorRow = rows[r]; break; }
    }
    anchorLines = rows.map(function (row) { return row.querySelector(".text").textContent; });
    placeComposer();
    bodyOf(composer).focus();
  }

  /**
   * Puts the composer under the line it belongs to, and keeps it there.
   *
   * Called on every view change rather than once, because the canvas moves and
   * a box that stayed where it was would end up talking about whatever line had
   * drifted under it. Its own size does not scale with the canvas: text that
   * shrinks to nothing at low zoom is not a comment field.
   */
  function placeComposer() {
    if (!composer || composer.hidden || !anchorRow) return;
    var card = anchorRow.closest(".card");
    if (!card) return;

    var row = anchorRow.getBoundingClientRect();
    var box = card.getBoundingClientRect();
    var size = composer.getBoundingClientRect();

    // Wide enough for the tools to sit in one row, and no wider than the file
    // it belongs to unless that file is narrower than the tools.
    var width = Math.max(520, Math.min(box.width, 680));
    composer.style.width = width + "px";
    composer.style.left =
      Math.round(Math.min(Math.max(8, box.left), window.innerWidth - width - 8)) + "px";
    // Below the line where there is room for it, above where there is not.
    var below = row.bottom + 6;
    var top = below + size.height > window.innerHeight - 8
      ? Math.max(8, row.top - size.height - 6)
      : below;
    composer.style.top = Math.round(top) + "px";
  }

  /* ------------------------------------------------------- writing the words */

  /** The field inside a box, whichever box it is. */
  function bodyOf(root) {
    return root && root.querySelector(".editor-body");
  }

  function setTab(root, which) {
    if (!root) return;
    var writing = which !== "preview";
    root.querySelectorAll(".tab").forEach(function (tab) {
      tab.classList.toggle("is-on", tab.dataset.tab === (writing ? "write" : "preview"));
    });
    var field = bodyOf(root);
    var preview = root.querySelector(".editor-preview");
    if (!field || !preview) return;

    field.hidden = !writing;
    preview.hidden = writing;
    if (!writing) {
      preview.innerHTML = field.value.trim()
        ? renderMarkdown(field.value, contextFor(root))
        : '<span class="empty">Nothing to preview</span>';
      colourBlocks(preview);
    }
  }

  /** Wires one box: its two tabs and its markdown buttons. */
  function initEditor(root) {
    if (!root) return;
    root.querySelectorAll(".tab").forEach(function (tab) {
      tab.addEventListener("click", function (event) {
        event.preventDefault();
        setTab(root, tab.dataset.tab);
      });
    });
    root.querySelectorAll(".md").forEach(function (button) {
      button.addEventListener("click", function (event) {
        event.preventDefault();
        applyMarkdown(root, button.dataset.md);
      });
    });
  }

  document.querySelectorAll(".editor").forEach(initEditor);

  /**
   * Markdown, as far as a comment box needs it.
   *
   * A deliberately small subset, and everything is escaped before any of it is
   * applied — the text comes from a person, and this page renders it. Anything
   * unrecognised stays the characters that were typed, which is what the forge
   * will store; a plain line is a better answer than a confident wrong
   * rendering of one.
   */
  function renderMarkdown(source, context) {
    var ctx = context || {};
    var lines = source.split("\n");
    var out = [];
    var i = 0;

    while (i < lines.length) {
      var line = lines[i];

      // Fenced blocks first: nothing inside one is markdown.
      var fence = /^\s*(\`{3,})(.*)$/.exec(line);
      if (fence) {
        var lang = fence[2].trim();
        var body = [];
        i++;
        while (i < lines.length && !new RegExp("^\\s*" + fence[1]).test(lines[i])) {
          body.push(lines[i]);
          i++;
        }
        i++;
        // A suggestion is a change, so it is drawn as one: what it replaces
        // above what it puts there, numbered, the way the forge draws it. A
        // block of green with no idea what it is replacing is half the story.
        if (lang === "suggestion") {
          out.push(suggestionTable(ctx.before || [], body, ctx.startLine || 0, ctx.language));
          continue;
        }

        var label = lang
          ? '<span class="lang">' + escapeHtml(lang) + "</span>"
          : "";
        // Marked for colouring, which happens after the block is in the
        // document: the grammars live with the host, so this is a round trip.
        var id = ++blockCounter;
        out.push(
          '<pre>' + label + '<code data-block="' + id + '" data-lang="' +
          escapeHtml(lang) + '">' + escapeHtml(body.join("\n")) + "</code></pre>",
        );
        continue;
      }

      var heading = /^(#{1,6})\s+(.*)$/.exec(line);
      if (heading) {
        var level = Math.min(3, heading[1].length);
        out.push("<h" + level + ">" + inline(heading[2]) + "</h" + level + ">");
        i++;
        continue;
      }

      if (/^\s*>\s?/.test(line)) {
        var quoted = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          quoted.push(lines[i].replace(/^\s*>\s?/, ""));
          i++;
        }
        out.push("<blockquote>" + inline(quoted.join(" ")) + "</blockquote>");
        continue;
      }

      // A rule, which the forge draws and which otherwise reads as a heading.
      if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) {
        out.push("<hr>");
        i++;
        continue;
      }

      // A table: a header row, a row of dashes, then the body. Recognised by
      // the dashes, because a line with pipes in it is usually just a line.
      if (line.indexOf("|") >= 0 && i + 1 < lines.length &&
          /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
        var cells = function (row) {
          return row.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|")
            .map(function (cell) { return inline(cell.trim()); });
        };
        var head = cells(line);
        i += 2;
        var rows = [];
        while (i < lines.length && lines[i].indexOf("|") >= 0 && lines[i].trim() !== "") {
          rows.push(cells(lines[i]));
          i++;
        }
        out.push(
          "<table><thead><tr>" +
          head.map(function (c) { return "<th>" + c + "</th>"; }).join("") +
          "</tr></thead><tbody>" +
          rows.map(function (r) {
            return "<tr>" + r.map(function (c) { return "<td>" + c + "</td>"; }).join("") + "</tr>";
          }).join("") +
          "</tbody></table>",
        );
        continue;
      }

      if (/^\s*(?:[-*]|\d+\.)\s+/.test(line)) {
        var ordered = /^\s*\d+\./.test(line);
        var items = [];
        while (i < lines.length && /^\s*(?:[-*]|\d+\.)\s+/.test(lines[i])) {
          var item = lines[i].replace(/^\s*(?:[-*]|\d+\.)\s+/, "");
          var task = /^\[([ xX])\]\s*/.exec(item);
          if (task) {
            item = item.slice(task[0].length);
            items.push(
              "<li>" +
              (task[1] === " " ? "☐ " : "☑ ") +
              inline(item) + "</li>",
            );
          } else {
            items.push("<li>" + inline(item) + "</li>");
          }
          i++;
        }
        out.push(
          (ordered ? "<ol>" : "<ul>") + items.join("") + (ordered ? "</ol>" : "</ul>"),
        );
        continue;
      }

      if (line.trim() === "") { i++; continue; }

      var para = [];
      while (
        i < lines.length &&
        lines[i].trim() !== "" &&
        !/^\s*(?:[-*]|\d+\.)\s+/.test(lines[i]) &&
        !/^\s*>/.test(lines[i]) &&
        !/^\s*\`{3,}/.test(lines[i]) &&
        !/^#{1,6}\s/.test(lines[i])
      ) {
        para.push(lines[i]);
        i++;
      }
      out.push("<p>" + inline(para.join(" ")) + "</p>");
    }

    return out.join("");
  }

  /** Escape first, then mark up: nothing typed can become markup by accident. */
  function inline(text) {
    var safe = escapeHtml(text);
    safe = safe.replace(/\`([^\`]+)\`/g, "<code>$1</code>");
    safe = safe.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    safe = safe.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
    safe = safe.replace(/_([^_]+)_/g, "<em>$1</em>");
    // Links are rendered as their text and their target, never as an anchor:
    // a comment box is not a place to make something clickable that a reader
    // has not looked at.
    safe = safe.replace(/~~([^~]+)~~/g, "<del>$1</del>");
    safe = safe.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "$1 (<code>$2</code>)");
    // A bare address is shown as itself. Nothing here becomes clickable: a
    // comment box is not a place to make something a reader has not looked at
    // one click away.
    safe = safe.replace(/(^|\s)(https?:\/\/[^\s<]+)/g, "$1<code>$2</code>");
    return safe;
  }

  /**
   * A suggestion, drawn as the change it is.
   *
   * The lines it replaces are numbered from where they sit in the file; the
   * replacement carries the same numbers, because that is where it will land.
   * Both sides go to the host to be coloured, as one request each, so a two
   * line suggestion costs two round trips rather than four.
   */
  function suggestionTable(before, after, startLine, language) {
    var row = function (kind, marker, number, text, id, index) {
      return '<tr class="' + kind + '">' +
        '<td class="n">' + (number || "") + "</td>" +
        '<td class="m">' + marker + "</td>" +
        '<td class="code" data-of="' + id + '" data-line="' + index + '">' +
        escapeHtml(text) + "</td></tr>";
    };

    var oldId = ++blockCounter;
    var newId = ++blockCounter;
    if (language) {
      suggestionRequests.push({ id: oldId, lang: language, code: before.join("\n") });
      suggestionRequests.push({ id: newId, lang: language, code: after.join("\n") });
    }

    var rows = before
      .map(function (text, i) {
        return row("del", "−", startLine ? startLine + i : "", text, oldId, i);
      })
      .concat(after.map(function (text, i) {
        return row("add", "+", startLine ? startLine + i : "", text, newId, i);
      }))
      .join("");

    return '<div class="suggestion"><div class="suggestion-head">Suggested change</div>' +
      "<table>" + rows + "</table></div>";
  }

  /**
   * Words typed but not yet sent, by the thing they were typed about.
   *
   * Closing a box is not the same as discarding what is in it. A reviewer who
   * shuts a composer to look at the code again, or a thread to check another
   * file, has not changed their mind about the sentence they were half way
   * through — and losing it is the kind of small betrayal that teaches people
   * to draft somewhere else first.
   */
  var unsent = {};

  function rememberOn(root, key) {
    var field = bodyOf(root);
    if (!field) return;
    field.dataset.key = key;
    field.value = unsent[key] || "";
  }

  function forget(key) { delete unsent[key]; }

  document.addEventListener("input", function (event) {
    var field = event.target;
    if (!field || !field.dataset || !field.dataset.key) return;
    if (field.value.trim()) unsent[field.dataset.key] = field.value;
    else forget(field.dataset.key);
  });

  var blockCounter = 0;
  var pendingBlocks = {};
  var suggestionRequests = [];

  /**
   * Colours the code blocks in some rendered markdown.
   *
   * The grammars and the theme live with the host — they are the same ones the
   * cards are drawn with, which is the point: a Kotlin snippet in a comment
   * should look like Kotlin in the file above it. So this is a round trip, and
   * a page with no host simply keeps the plain text it already has.
   */
  function colourBlocks(root) {
    var asked = suggestionRequests;
    suggestionRequests = [];
    if (!host || !root) return;

    root.querySelectorAll("code[data-block]").forEach(function (block) {
      var lang = block.dataset.lang || "";
      if (!lang) return;
      pendingBlocks[block.dataset.block] = block;
      notifyHost("highlight", {
        id: Number(block.dataset.block),
        lang: lang,
        code: block.textContent,
      });
    });

    asked.forEach(function (request) {
      var cells = root.querySelectorAll('.code[data-of="' + request.id + '"]');
      if (cells.length === 0) return;
      pendingBlocks[request.id] = cells;
      notifyHost("highlight", request);
    });
  }

  /** Tokens coming back from the host, turned into spans. */
  function paintBlock(id, lines) {
    var target = pendingBlocks[id];
    if (!target) return;
    delete pendingBlocks[id];
    if (!lines || lines.length === 0) return;

    var paint = function (tokens) {
      return tokens
        .map(function (token) {
          var text = escapeHtml(token.text);
          return token.color
            ? '<span style="color:' + token.color.replace(/[^#\w(),.% ]/g, "") + '">' + text + "</span>"
            : text;
        })
        .join("");
    };

    // One element holding every line, or one element per line: a fenced block
    // is the first, a suggestion's rows are the second.
    if (target.length !== undefined) {
      Array.prototype.forEach.call(target, function (cell) {
        var line = lines[Number(cell.dataset.line)];
        if (line) cell.innerHTML = paint(line);
      });
      return;
    }

    target.innerHTML = lines.map(paint).join("\n");
  }

  /** What a suggestion in this box replaces, and where those lines live. */
  function contextFor(root) {
    if (composer && composer.contains(root) && pending) {
      return {
        before: anchorLines,
        startLine: pending.startLine || pending.line,
        language: languageOf(pending.path),
      };
    }
    if (threadBox && threadBox.contains(root) && openThread) {
      return contextOf(openThread.root);
    }
    return {};
  }

  /** The same, for a remark already posted. */
  function contextOf(comment) {
    return {
      before: linesOf(comment),
      startLine: comment.startLine || comment.line,
      language: languageOf(comment.path),
    };
  }

  function languageOf(path) {
    var node = data.nodes.find(function (n) { return n.path === path; });
    return (node && node.language) || "";
  }

  /** The rows a remark covers, read back off the card it points at. */
  function linesOf(comment) {
    var node = data.nodes.find(function (n) { return n.path === comment.path; });
    var card = node && document.getElementById("card-" + cssId(node.id));
    if (!card) return [];

    var attribute = comment.side === "LEFT" ? "data-old" : "data-new";
    var out = [];
    for (var line = comment.startLine || comment.line; line <= comment.line; line++) {
      var row = (visibleBody(card) || card).querySelector(".row[" + attribute + '="' + line + '"]');
      if (row) out.push(row.querySelector(".text").textContent);
    }
    return out;
  }

  /**
   * The lines a suggestion in this box would replace.
   *
   * The composer knows them from the pick. A reply knows them from the thread
   * it belongs to, which names a file and a span — the rows are read back off
   * that card rather than remembered, so they are whatever is on screen. A box
   * with no lines behind it, like a review summary, gets an empty block to fill
   * in: better an empty fence than a fence full of the wrong file.
   */
  function suggestionLines(root) {
    if (composer && composer.contains(root)) return anchorLines;

    if (threadBox && threadBox.contains(root) && openThread) {
      var found = linesOf(openThread.root);
      return found.length > 0 ? found : [""];
    }

    return [""];
  }

  /**
   * What each markdown button does to the field.
   *
   * Wrapping styles keep the selection selected afterwards, and prefixing ones
   * apply to every line the selection touches, because that is what someone
   * who has selected three lines and pressed the list button means.
   */
  function applyMarkdown(root, kind) {
    var field = bodyOf(root);
    if (!field) return;
    var start = field.selectionStart;
    var end = field.selectionEnd;
    var value = field.value;
    var selected = value.slice(start, end);

    var wrap = function (before, after) {
      var text = selected || "";
      field.value = value.slice(0, start) + before + text + after + value.slice(end);
      field.selectionStart = start + before.length;
      field.selectionEnd = start + before.length + text.length;
    };

    var prefix = function (make) {
      var from = value.lastIndexOf("\n", start - 1) + 1;
      var to = value.indexOf("\n", end);
      if (to === -1) to = value.length;
      var block = value.slice(from, to) || "";
      var marked = block.split("\n").map(make).join("\n");
      field.value = value.slice(0, from) + marked + value.slice(to);
      field.selectionStart = from;
      field.selectionEnd = from + marked.length;
    };

    if (kind === "bold") wrap("**", "**");
    else if (kind === "italic") wrap("_", "_");
    else if (kind === "code") {
      var tick = "\u0060";
      var fence3 = tick + tick + tick;
      if (selected.indexOf("\n") >= 0) wrap(fence3 + "\n", "\n" + fence3);
      else wrap(tick, tick);
    } else if (kind === "link") wrap("[", "](url)");
    else if (kind === "heading") prefix(function (line) { return "### " + line; });
    else if (kind === "quote") prefix(function (line) { return "> " + line; });
    else if (kind === "ul") prefix(function (line) { return "- " + line; });
    else if (kind === "task") prefix(function (line) { return "- [ ] " + line; });
    else if (kind === "ol") {
      var n = 0;
      prefix(function (line) { n++; return n + ". " + line; });
    } else if (kind === "suggest") {
      // Filled with the lines being commented on. A suggestion has to be the
      // whole replacement for the span it covers, and retyping it from memory
      // is how the wrong indentation gets in.
      var fence = "\u0060\u0060\u0060";
      var lines = suggestionLines(root);
      var block = fence + "suggestion\n" + lines.join("\n") + "\n" + fence;
      var body = field.value.trim();
      field.value = body ? body + "\n\n" + block : block;
      // Inside the fence, where the replacement is written.
      var caret = field.value.length - (fence.length + 1);
      field.selectionStart = field.selectionEnd = caret;
    }

    field.focus();
    setTab(root, "write");
  }

  if (composer) {
    composer.querySelector(".composer-cancel").addEventListener("click", function () {
      composer.hidden = true;
      pending = null;
      // The pick survives: cancelling is usually a change of wording, not a
      // change of mind about which lines. Escape or a click away drops it.
    });

    composer.querySelector(".composer-add").addEventListener("click", function () {
      // The fence, when there is one, is already in the text: the suggestion
      // button puts it there along with the lines it replaces, so what goes to
      // the forge is what the reviewer read back before pressing this.
      var body = bodyOf(composer).value.trim();
      if (!body || !pending) return;

      forget(composerKey(pending));
      drafts.push({
        path: pending.path,
        line: pending.line,
        // Carried only for a real span: the forge rejects a start equal to the
        // end, and a one-line comment is not a span.
        startLine: pending.startLine < pending.line ? pending.startLine : undefined,
        side: pending.side,
        body: body,
      });
      composer.hidden = true;
      pending = null;
      clearSelection();
      refreshReview();
    });
  }

  function refreshReview() {
    // The forge's wording, and it earns its place: the first remark starts
    // something, the rest join it, and a reviewer who has forgotten whether
    // they already have a review going can read the answer off the button.
    var add = composer && composer.querySelector(".composer-add");
    if (add) {
      add.textContent = drafts.length === 0 ? "Start a review" : "Add review comment";
    }
    if (reviewButton) {
      // Present from the start, the way the forge's own button is: hiding it
      // until something is drafted keeps the one thing a reviewer came to do
      // out of sight until they have already worked out how to do it.
      reviewButton.hidden = !data.canReview;
      var count = reviewButton.querySelector(".count");
      count.hidden = drafts.length === 0;
      count.textContent = String(drafts.length);
    }
    if (panel) {
      panel.querySelector(".review-count").textContent =
        drafts.length + (drafts.length === 1 ? " comment" : " comments");
      panel.querySelector(".review-list").innerHTML = drafts
        .map(function (d, i) {
          var where = d.startLine && d.startLine < d.line
            ? d.startLine + "–" + d.line
            : String(d.line);
          return '<div class="review-item"><span class="where">' +
            escapeHtml(d.path.split("/").pop()) + ":" + where +
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
    var summary = bodyOf(panel);
    if (summary) {
      summary.dataset.key = "review";
      summary.value = unsent["review"] || "";
    }
    var close = panel.querySelector(".review-close");
    if (close) {
      close.addEventListener("click", function () { panel.hidden = true; });
    }

    panel.querySelectorAll(".review-submit").forEach(function (button) {
      button.addEventListener("click", function () {
        var body = bodyOf(panel).value.trim();
        var event = button.dataset.event;
        if (event !== "APPROVE" && !body) {
          bodyOf(panel).focus();
          return;
        }
        // The host confirms before anything is sent; nothing leaves here on
        // the strength of a single click.
        notifyHost("submitReview", { event: event, body: body, comments: drafts });
      });
    });
  }

  /*
   * Picking the lines to talk about.
   *
   * A click takes one line; dragging down the card takes the passage, as does
   * shift-clicking a second line after a first. Both exist because they are
   * used in different moods — dragging while reading, shift-clicking after
   * having read — and neither is discoverable enough to be the only one.
   *
   * The rows in between are collected from the DOM rather than counted, so a
   * fold or a hidden import inside the selection simply is not part of it.
   */
  // The pick outlives the gesture: it is the span currently chosen, so that a
  // shift-click afterwards extends it instead of starting again. Dragging is
  // true only between our own pointerdown and the pointerup that ends it,
  // which is what keeps a click on the composer from being read as a new pick.
  var picking = null;
  var dragging = false;

  /** The commentable rows of a card, in the order they are shown. */
  function rowsOf(card) {
    return Array.prototype.filter.call(
      card.querySelectorAll(".row"),
      function (row) {
        return !row.classList.contains("gap") && !row.classList.contains("more");
      },
    );
  }

  function rowsBetween(card, a, b) {
    var rows = rowsOf(card);
    var first = rows.indexOf(a);
    var last = rows.indexOf(b);
    if (first < 0 || last < 0) return [];
    return rows.slice(Math.min(first, last), Math.max(first, last) + 1);
  }

  function paintSelection(card, rows) {
    clearMarks();
    card.classList.add("picking");
    rows.forEach(function (row) {
      row.classList.add("picked");
      row.appendChild(chrome("pick-edge", ""));
    });
    // A handle at each end. One row is one end, not two, so it gets one.
    rows[0].appendChild(chrome("pick-plus", "+"));
    if (rows.length > 1) {
      rows[rows.length - 1].appendChild(chrome("pick-plus", "+"));
    }
  }

  function chrome(className, text) {
    var span = document.createElement("span");
    span.className = className;
    span.textContent = text;
    return span;
  }

  function clearMarks() {
    document.querySelectorAll(".row.picked").forEach(function (row) {
      row.classList.remove("picked");
    });
    document.querySelectorAll(".pick-edge, .pick-plus").forEach(function (mark) {
      mark.remove();
    });
    document.querySelectorAll(".card.picking").forEach(function (card) {
      card.classList.remove("picking");
    });
  }

  /** Forgets the span as well as the marks. Called once it has been spoken for. */
  function clearSelection() {
    clearMarks();
    picking = null;
  }

  /** The row a comment gesture is on, or null if this is not one. */
  function commentableRow(event) {
    if (!data.canReview) return null;
    if (event.target.closest(".card-title")) return null;
    if (event.target.closest(".row.gap, .row.more")) return null;

    // Only lines the forge can see. A card also carries source fetched so that
    // an arrow has somewhere to land, and a comment on one of those would be
    // refused — after the reviewer had written it, which is the worst moment to
    // find out.
    var row = event.target.closest(".row");
    if (!row || !row.classList.contains("in-diff")) return null;

    // Only from the rail: the strip carrying the marker and the line number,
    // which is where the forge puts its own + button. Anywhere-on-the-row meant
    // a stray press while reading opened a composer over the code, and the way
    // out of that was to notice it had happened.
    // The hint button belongs to the rail even though it is drawn past its
    // edge: it is the rail saying what pressing it does.
    if (event.target.closest(".pick-hint")) return row;

    var pane = event.target.closest(".side") || row;
    var x = (event.clientX - pane.getBoundingClientRect().left) / (view.scale || 1);
    return x <= data.gutterWidth ? row : null;
  }

  /*
   * The button that says a comment can start here.
   *
   * One element for the whole page, moved to whatever rail is under the
   * pointer. A button per row would be tens of thousands of them, and the rail
   * without one is a rule nobody can see -- which is how a restriction reads as
   * a thing that stopped working.
   */
  var pickHint = chrome("pick-hint", "+");
  pickHint.hidden = true;

  document.addEventListener("pointerover", function (event) {
    var rail = event.target.closest(".num, .marker, .pick-hint");
    var row = rail && rail.closest(".row");
    var card = row && row.closest(".card");

    if (!rail || !row || !row.classList.contains("in-diff") ||
        !card || card.classList.contains("is-viewed") || !data.canReview) {
      if (pickHint.parentNode && !event.target.closest(".pick-hint")) {
        pickHint.hidden = true;
      }
      return;
    }

    // Placed from the pane the rail belongs to, so on a split card it lands in
    // the half the reader is pointing at rather than always in the left one.
    var pane = rail.closest(".side");
    var left = (pane ? pane.offsetLeft : 0) + data.gutterWidth + 3;
    pickHint.style.left = left + "px";
    pickHint.hidden = false;
    if (pickHint.parentNode !== row) row.appendChild(pickHint);
  });

  document.addEventListener("pointerdown", function (event) {
    if (event.target.closest(".pick-hint")) return;
    pickHint.hidden = true;
  }, true);

  cards.forEach(function (card) {
    card.addEventListener("pointerdown", function (event) {
      // The handle belongs to the pick already made; pressing it must not be
      // read as the start of a new one. Nor must the box on a name an arrow
      // lands on, which belongs to the arrow.
      if (event.target.closest(".pick-plus") || event.target.closest(".symbol-box")) {
        event.stopPropagation();
        return;
      }

      var row = commentableRow(event);
      if (!row || event.button !== 0) return;

      // Extending the open pick rather than starting a new one.
      if (event.shiftKey && picking && picking.card === card) picking.to = row;
      else picking = { card: card, from: row, to: row };

      dragging = true;
      paintSelection(card, rowsBetween(card, picking.from, picking.to));
    });

    // Clicking a handle says the same thing the gesture did: talk about this.
    // It is what the reader reaches for after cancelling and changing their
    // mind, when the pick is still lit but the composer has gone.
    card.addEventListener("click", function (event) {
      if (!event.target.closest(".pick-plus") || !picking) return;
      event.stopPropagation();
      compose(picking.card, rowsBetween(picking.card, picking.from, picking.to), event);
    });

    card.addEventListener("pointermove", function (event) {
      if (!dragging || !picking || picking.card !== card) return;
      // Buttons, not button: pointermove reports what is still held down.
      if (!(event.buttons & 1)) return;
      var row = commentableRow(event);
      if (!row || row === picking.to) return;
      picking.to = row;
      paintSelection(card, rowsBetween(card, picking.from, row));
    });
  });

  document.addEventListener("pointerup", function (event) {
    if (!dragging || !picking) return;
    dragging = false;
    var rows = rowsBetween(picking.card, picking.from, picking.to);
    if (rows.length === 0) { clearSelection(); return; }
    compose(picking.card, rows, event);
    // The pick stays lit under the composer, so the span being talked about is
    // visible while the words are being chosen.
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

    var arrangement = arrangementFor(showTests);

    edgeGroups.forEach(function (g) {
      var edge = data.edges.find(function (e) { return e.id === g.dataset.id; });
      var isImport = g.classList.contains("import");
      var isUnchanged = g.classList.contains("unchanged");
      var gone =
        edge &&
        (!arrangement.nodes[edge.from] ||
          !arrangement.nodes[edge.to] ||
          (focused && (!focused[edge.from] || !focused[edge.to])) ||
          (hideViewed && (isRead(edge.from) || isRead(edge.to))));
      g.classList.toggle(
        "hidden",
        (isImport && !showImports) || (isUnchanged && !showUnchanged) || Boolean(gone),
      );
    });

    recompute();
    refreshTally();
  }

  /**
   * How much of the change has been read, said the way the forge says it.
   *
   * Counts what can actually be ticked. A file nothing changed has no box, so
   * counting it would leave the tally short of full however much was read and
   * make finishing look impossible. Files this page inferred as read are left
   * out too: the number has to mean the same thing here as it does in the
   * browser, or comparing them is worse than not having it.
   */
  function refreshTally() {
    var bar = document.querySelector(".viewed-count");
    if (!bar) return;

    var total = 0;
    var done = 0;
    data.nodes.forEach(function (node) {
      if (node.untouched) return;
      total++;
      if (viewed[node.id] === true) done++;
    });

    bar.querySelector(".tally").textContent = done + " / " + total;

    var arc = bar.querySelector(".arc");
    if (arc) {
      // 2πr for r = 6.2, to the precision a 13px circle can show.
      var circumference = 38.96;
      var filled = total ? (done / total) * circumference : 0;
      arc.setAttribute(
        "stroke-dasharray",
        filled.toFixed(2) + " " + (circumference - filled).toFixed(2),
      );
    }

    refreshParts(done, total);
  }

  /**
   * How much of each part has been read, and of whatever part is open.
   *
   * A count of files says how much there is; a count of files read says how
   * much is left, which is the question being asked of a strip of tabs. The bar
   * along the bottom of the chrome answers the same question for the part in
   * front, so it can be seen without reading anything.
   */
  function refreshParts(doneAll, totalAll) {
    var counted = {};

    tabs.forEach(function (tab) {
      var part = (data.parts || []).find(function (p) {
        return p.id === tab.dataset.part;
      });

      var done = doneAll;
      var total = totalAll;
      if (part) {
        done = 0;
        total = 0;
        part.nodes.forEach(function (id) {
          var node = nodeFor(id);
          // Untouched files carry no box, so counting them would leave every
          // tally short of full however much was read.
          if (!node || node.untouched) return;
          total++;
          if (viewed[id] === true) done++;
        });
      }

      var readEl = tab.querySelector(".done");
      var sepEl = tab.querySelector(".sep");
      var totalEl = tab.querySelector(".total");
      var tickEl = tab.querySelector(".tick");
      var complete = total > 0 && done === total;

      if (readEl) {
        readEl.textContent = done;
        readEl.hidden = done === 0 || complete;
      }
      if (sepEl) sepEl.hidden = done === 0 || complete;
      if (totalEl) {
        totalEl.textContent = total;
        totalEl.hidden = complete;
      }
      if (tickEl) tickEl.hidden = !complete;

      counted[tab.dataset.part] = { done: done, total: total };
      tab.classList.toggle("finished", complete);
    });

    var open = tabs.filter(function (tab) { return tab.classList.contains("on"); })[0];
    var fill = document.querySelector(".done-bar span");
    if (!fill) return;
    var shown = (open && counted[open.dataset.part]) || { done: doneAll, total: totalAll };
    fill.style.width = shown.total ? (shown.done / shown.total) * 100 + "%" : "0";
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
      // Reading a file finishes with a question -- what does this reach? -- and
      // the answer is the next file along the chain. Carried there rather than
      // left to be found again on a canvas that has just rearranged itself.
      if (box.checked) goToNext(card.dataset.id);
    });
  });

  /**
   * The next file to read after this one.
   *
   * Down the chain first: something this file calls, since that is the question
   * a reader has just finished asking of it. Failing that, the nearest unread
   * file still on the canvas, top to bottom, because a part with its chains
   * exhausted is still a list of files to get through.
   *
   * Nothing happens when there is nothing left, which is its own answer.
   */
  function goToNext(fromId) {
    var open = function (id) {
      var card = document.getElementById("card-" + cssId(id));
      if (!card || card.classList.contains("hidden")) return false;
      if (card.classList.contains("viewed-hidden")) return false;
      return !isRead(id);
    };

    var downstream = data.edges
      .filter(function (e) { return e.from === fromId && e.to !== fromId && open(e.to); })
      .map(function (e) { return e.to; });

    var next = downstream[0];
    if (!next) {
      var rest = data.nodes
        .filter(function (n) { return n.id !== fromId && open(n.id); })
        .sort(function (a, b) { return a.column - b.column || a.y - b.y; });
      next = rest[0] && rest[0].id;
    }

    if (next) centerOn(next);
  }

  // The sidebar and the canvas show the same marks, so the host keeps them
  // in step.
  /**
   * Comments arriving from the host, in the shape the page draws.
   *
   * The page is built with an avatar field and the host sends an avatarUrl,
   * so every refresh after a reaction quietly replaced the faces with initials
   * — the pictures were there all along, under another name.
   */
  function normalise(comments) {
    return (comments || []).map(function (c) {
      if (c.avatar || !c.avatarUrl) return c;
      return Object.assign({}, c, { avatar: c.avatarUrl });
    });
  }

  window.addEventListener("message", function (event) {
    var message = event.data;
    if (message && message.type === "reviewSubmitted") {
      drafts = [];
      if (panel) {
        panel.hidden = true;
        bodyOf(panel).value = "";
      }
      if (message.comments) data.comments = normalise(message.comments);
      forget("review");
      refreshReview();
      buildMarks();
      return;
    }
    // Clicking a file in the sidebar brings its card to the middle. The list
    // and the picture are two views of one change, and choosing a file in one
    // should not leave the other showing somewhere else entirely.
    if (message && message.type === "highlighted") {
      paintBlock(message.id, message.lines);
      return;
    }
    if (message && message.type === "comments") {
      data.comments = normalise(message.comments);
      var was = openThread && openThread.root.id;
      buildMarks();
      // Back to the conversation the reader was in, now that it has changed.
      if (was) {
        var again = marks.find(function (m) { return m.thread.root.id === was; });
        if (again) showThread(again.thread, again.el);
        else closeThread();
      }
      return;
    }
    if (message && message.type === "focus") {
      var target = data.nodes.find(function (n) { return n.path === message.path; });
      if (target) {
        highlightNode(target.id);
        centerOn(target.id);
      }
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

  /* ------------------------------------------------------------- the remarks */

  /*
   * Comments already on the pull request, drawn beside the file.
   *
   * A remark is about a line but it is not part of the code: threading it
   * through the diff pushes the code around to make room for something the
   * reader has not asked to read yet. The mark sits in the margin at the height
   * of its line, and the thread opens under it when asked.
   *
   * Marks live on the canvas, so they pan and zoom with the file they belong
   * to; the thread does not, because prose at a tenth of its size is not prose.
   */
  var threadBox = document.querySelector(".thread");
  var markLayer = document.querySelector(".marks");
  var marks = [];
  var openMark = null;
  var openThread = null;

  function threadsOf(comments) {
    var byId = {};
    comments.forEach(function (c) { byId[c.id] = c; });

    // A reply belongs to whatever it answers, however deep the chain goes.
    var rootOf = function (c) {
      var seen = {};
      var current = c;
      while (current.inReplyTo && byId[current.inReplyTo] && !seen[current.id]) {
        seen[current.id] = true;
        current = byId[current.inReplyTo];
      }
      return current;
    };

    var groups = {};
    var order = [];
    comments.forEach(function (c) {
      var root = rootOf(c);
      if (!groups[root.id]) { groups[root.id] = { root: root, comments: [] }; order.push(root.id); }
      groups[root.id].comments.push(c);
    });

    return order.map(function (id) {
      var group = groups[id];
      group.comments.sort(function (a, b) {
        return String(a.createdAt).localeCompare(String(b.createdAt));
      });
      return group;
    });
  }

  function buildMarks() {
    marks.forEach(function (m) { m.el.remove(); });
    marks = [];
    if (!markLayer || !(data.comments || []).length) { refreshRemarkCounts(); return; }

    threadsOf(data.comments).forEach(function (thread) {
      var node = data.nodes.find(function (n) { return n.path === thread.root.path; });
      if (!node) return;

      var el = document.createElement("div");
      el.className = "mark";
      el.title = thread.root.author + ": " + thread.root.body.slice(0, 120);
      el.appendChild(chrome("tail", ""));
      el.appendChild(face(thread.root, "face"));
      if (thread.comments.length > 1) {
        el.appendChild(chrome("bubble", String(thread.comments.length)));
      }

      el.addEventListener("click", function (event) {
        event.stopPropagation();
        showThread(thread, el);
      });

      markLayer.appendChild(el);
      marks.push({ el: el, thread: thread, nodeId: node.id });
    });

    placeMarks();
    refreshRemarkCounts();
  }

  /** The author's picture, or their initials when the page has none. */
  function face(comment, className) {
    if (comment.avatar) {
      var img = document.createElement("img");
      img.className = className;
      img.src = comment.avatar;
      img.alt = comment.author;
      return img;
    }
    var span = document.createElement("span");
    span.className = className + " initials";
    span.textContent = (comment.author || "?")
      .replace(/[^a-zA-Z0-9]/g, " ")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map(function (part) { return part.charAt(0).toUpperCase(); })
      .join("");
    return span;
  }

  /**
   * Puts every mark beside the line it is about.
   *
   * Positions come from the same anchoring the arrows use, so a remark on a
   * folded line lands on the band standing in for it rather than guessing.
   */
  function placeMarks() {
    if (!markLayer) return;
    var top = document.querySelector(".chrome");
    var ceiling = top ? top.getBoundingClientRect().height : 0;

    marks.forEach(function (mark) {
      var node = nodeFor(mark.nodeId);
      var card = document.getElementById("card-" + cssId(mark.nodeId));
      if (!node || !card) return;

      var gone = card.classList.contains("hidden") ||
        card.classList.contains("viewed-hidden");
      if (gone) { mark.el.hidden = true; return; }

      var side = mark.thread.root.side === "LEFT" ? "base" : "head";
      var anchor = anchorFor(mark.nodeId, side, mark.thread.root.line, false);
      if (!anchor) { mark.el.hidden = true; return; }

      // Screen coordinates, not canvas ones. A face drawn at a tenth of its
      // size is not a face, and a target seven pixels across is not a target —
      // the mark keeps its size and follows the card instead of scaling with
      // it. To the left of the file, because arrows leave a card on its right
      // and a mark over that traffic is both hard to see and hard to click.
      // Between a legible minimum and a face, not a portrait. Reading a change
      // closely is when a picture is worth its size; at the zoom a whole change
      // is taken in at, the mark is a dot beside a file and should stay one.
      var size = Math.max(26, Math.min(76, Math.round(28 * view.scale)));
      mark.el.style.setProperty("--mark-size", size + "px");

      var box = card.getBoundingClientRect();
      var y = view.y + anchor.y * view.scale;
      var offScreen = y < ceiling || y > window.innerHeight ||
        box.right < 0 || box.left > window.innerWidth;
      mark.el.hidden = offScreen;
      if (offScreen) return;

      mark.el.style.left = Math.round(box.left - size - 8) + "px";
      mark.el.style.top = Math.round(y - size / 2) + "px";
    });
  }

  function showThread(thread, el) {
    if (!threadBox) return;
    closeMenus();
    if (openMark) openMark.classList.remove("is-open");
    openThread = thread;
    openMark = el;
    el.classList.add("is-open");

    var root = thread.root;
    var where = root.path.split("/").pop() +
      ":" + (root.startLine && root.startLine < root.line
        ? root.startLine + "–" + root.line
        : root.line);
    threadBox.querySelector(".thread-where").textContent = where;

    var body = threadBox.querySelector(".thread-body");
    body.innerHTML = "";
    thread.comments.forEach(function (comment) {
      var remark = document.createElement("div");
      remark.className = "remark";
      remark.appendChild(face(comment, "face"));

      var said = document.createElement("div");
      said.className = "said";
      var head = document.createElement("div");
      head.appendChild(chrome("who", comment.author || "?"));
      var when = chrome("when", ago(comment.createdAt));
      when.title = exactly(comment.createdAt);
      head.appendChild(when);
      if (comment.outdated) head.appendChild(chrome("outdated", "outdated"));
      said.appendChild(head);

      if (host) said.firstChild.appendChild(actionsButton(comment, thread));

      var text = document.createElement("div");
      text.className = "text";
      text.innerHTML = renderMarkdown(comment.body || "", contextOf(comment));
      colourBlocks(text);
      said.appendChild(text);
      said.appendChild(reactionRow(comment));

      remark.appendChild(said);
      body.appendChild(remark);
    });

    // Answering belongs to the thread, not to the line: a second remark beside
    // the first is how one conversation becomes two.
    var reply = threadBox.querySelector(".thread-reply");
    if (reply) {
      reply.hidden = !host;
      rememberOn(reply, "t:" + thread.root.id);
      setTab(reply, "write");
    }

    threadBox.hidden = false;
    placeThread();
  }

  /** What is already on a remark, and the way to add to it. */
  function reactionRow(comment) {
    var row = document.createElement("div");
    row.className = "reactions";

    (comment.reactions || []).forEach(function (reaction) {
      var pill = document.createElement("button");
      pill.className = "pill";
      pill.title = reaction.content;
      pill.innerHTML = "";
      pill.appendChild(chrome("emoji", EMOJI[reaction.content] || "?"));
      pill.appendChild(chrome("n", String(reaction.count)));
      if (host) {
        pill.addEventListener("click", function (event) {
          event.stopPropagation();
          notifyHost("react", { id: comment.id, content: reaction.content });
        });
      }
      row.appendChild(pill);
    });

    if (host) {
      var add = document.createElement("button");
      add.className = "add";
      add.title = "Leave a reaction";
      // Drawn rather than typed: the smiley character renders at whatever size
      // and weight the font feels like, which beside a 14-pixel emoji is a
      // speck. Static markup, no text from anywhere in it.
      add.innerHTML = SMILEY;
      add.addEventListener("click", function (event) {
        event.stopPropagation();
        showPicker(comment, add);
      });
      row.appendChild(add);
    }
    return row;
  }

  var SMILEY =
    '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">' +
    '<circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor" stroke-width="1.4"/>' +
    '<circle cx="5.8" cy="6.6" r="0.95" fill="currentColor"/>' +
    '<circle cx="10.2" cy="6.6" r="0.95" fill="currentColor"/>' +
    '<path d="M5.2 9.6a3.2 3.2 0 0 0 5.6 0" fill="none" stroke="currentColor" ' +
    'stroke-width="1.4" stroke-linecap="round"/></svg>';

  var EMOJI = {
    "+1": "👍", "-1": "👎", laugh: "😄", hooray: "🎉",
    confused: "😕", heart: "❤️", rocket: "🚀", eyes: "👀",
  };

  var picker = null;

  function showPicker(comment, near) {
    closeMenus();
    picker = document.createElement("div");
    picker.className = "picker";
    Object.keys(EMOJI).forEach(function (content) {
      var button = document.createElement("button");
      button.textContent = EMOJI[content];
      button.title = content;
      button.addEventListener("click", function (event) {
        event.stopPropagation();
        closeMenus();
        notifyHost("react", { id: comment.id, content: content });
      });
      picker.appendChild(button);
    });
    picker.addEventListener("click", function (event) { event.stopPropagation(); });
    document.body.appendChild(picker);

    var at = near.getBoundingClientRect();
    var box = picker.getBoundingClientRect();
    picker.style.left =
      Math.round(Math.min(at.left, window.innerWidth - box.width - 8)) + "px";
    picker.style.top = Math.round(Math.max(8, at.top - box.height - 6)) + "px";
  }

  /**
   * A remark's own actions.
   *
   * Copying and quoting happen here, because they need nothing from the forge.
   * Editing and deleting are offered only on your own remarks — the forge would
   * refuse anyone else's, and a menu item that always fails is worse than one
   * that is not there.
   */
  function actionsButton(comment, thread) {
    var button = document.createElement("button");
    button.className = "more-actions";
    button.title = "More actions";
    button.setAttribute("aria-label", "More actions");
    button.textContent = "···";
    button.addEventListener("click", function (event) {
      event.stopPropagation();
      showMenu(comment, thread, button);
    });
    return button;
  }

  var menu = null;

  function showMenu(comment, thread, near) {
    closeMenus();
    menu = document.createElement("div");
    menu.className = "menu";

    var item = function (label, run, danger) {
      var entry = document.createElement("button");
      entry.textContent = label;
      if (danger) entry.className = "danger";
      entry.addEventListener("click", function (event) {
        event.stopPropagation();
        closeMenus();
        run();
      });
      menu.appendChild(entry);
    };

    item("Copy link", function () { copyText(comment.url || ""); });
    item("Copy Markdown", function () { copyText(comment.body || ""); });
    item("Quote reply", function () {
      var field = bodyOf(threadBox.querySelector(".thread-reply"));
      if (!field) return;
      var quoted = (comment.body || "")
        .split("\n")
        .map(function (line) { return "> " + line; })
        .join("\n");
      field.value = quoted + "\n\n";
      field.focus();
      field.selectionStart = field.selectionEnd = field.value.length;
    });

    if (data.viewer && comment.author === data.viewer) {
      menu.appendChild(chrome("divider", ""));
      item("Edit", function () { startEdit(comment); });
      item("Delete", function () {
        notifyHost("deleteComment", { id: comment.id });
      }, true);
    }

    menu.addEventListener("click", function (event) { event.stopPropagation(); });
    document.body.appendChild(menu);

    var at = near.getBoundingClientRect();
    var box = menu.getBoundingClientRect();
    menu.style.left =
      Math.round(Math.min(at.right - box.width, window.innerWidth - box.width - 8)) + "px";
    menu.style.top =
      Math.round(Math.min(at.bottom + 4, window.innerHeight - box.height - 8)) + "px";
  }

  /** Rewriting a remark reuses the reply box, which is already the right shape. */
  function startEdit(comment) {
    var reply = threadBox.querySelector(".thread-reply");
    var field = reply && bodyOf(reply);
    var send = reply && reply.querySelector(".reply-send");
    if (!field || !send) return;

    editing = comment.id;
    field.value = comment.body || "";
    send.textContent = "Save";
    field.focus();
  }

  var editing = null;

  function closeMenus() {
    if (picker) { picker.remove(); picker = null; }
    if (menu) { menu.remove(); menu = null; }
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function () {});
    }
  }

  /** Under the mark that opened it, and inside the window. */
  function placeThread() {
    if (!threadBox || threadBox.hidden || !openMark) return;
    var mark = openMark.getBoundingClientRect();
    var box = threadBox.getBoundingClientRect();
    var left = Math.min(Math.max(8, mark.left - 8), window.innerWidth - box.width - 8);
    var below = mark.bottom + 8;
    var top = below + box.height > window.innerHeight - 8
      ? Math.max(8, mark.top - box.height - 8)
      : below;
    threadBox.style.left = Math.round(left) + "px";
    threadBox.style.top = Math.round(top) + "px";
  }

  function closeThread() {
    if (!threadBox) return;
    closeMenus();
    editing = null;
    var send = threadBox.querySelector(".reply-send");
    if (send) send.textContent = "Reply";
    threadBox.hidden = true;
    if (openMark) openMark.classList.remove("is-open");
    openMark = null;
  }

  if (threadBox) {
    threadBox.addEventListener("click", function (event) {
      event.stopPropagation();
      closeMenus();
    });
    threadBox.querySelector(".thread-close").addEventListener("click", closeThread);

    var send = threadBox.querySelector(".reply-send");
    if (send) {
      send.addEventListener("click", function () {
        var field = bodyOf(threadBox.querySelector(".thread-reply"));
        var text = field.value.trim();
        if (!text || !openThread) return;
        if (editing !== null) {
          notifyHost("editComment", { id: editing, body: text });
          editing = null;
          send.textContent = "Reply";
        } else {
          notifyHost("reply", { id: openThread.root.id, body: text });
        }
        forget("t:" + openThread.root.id);
        field.value = "";
      });
    }
    // Anywhere else puts it away. The thread and the marks stop their own
    // clicks, so this only ever fires for a click that meant something else.
    document.addEventListener("click", closeThread);
  }

  /**
   * How long ago, said the way a reader would say it.
   *
   * Minutes matter in a conversation: "today" on a remark written four minutes
   * ago tells you nothing about whether the person is still there. The exact
   * time goes on the title, for when the relative one is not enough.
   */
  function ago(iso) {
    var then = Date.parse(iso);
    if (!then) return "";
    var seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));

    if (seconds < 45) return "just now";
    var minutes = Math.round(seconds / 60);
    if (minutes < 60) return minutes + (minutes === 1 ? " minute ago" : " minutes ago");
    var hours = Math.round(minutes / 60);
    if (hours < 24) return hours + (hours === 1 ? " hour ago" : " hours ago");
    var days = Math.round(hours / 24);
    if (days === 1) return "yesterday";
    if (days < 30) return days + " days ago";
    var months = Math.round(days / 30);
    if (months < 12) return months + (months === 1 ? " month ago" : " months ago");
    var years = Math.round(months / 12);
    return years + (years === 1 ? " year ago" : " years ago");
  }

  /** The moment itself, in the reader's own locale. */
  function exactly(iso) {
    var then = new Date(iso);
    return isNaN(then.getTime()) ? "" : then.toLocaleString();
  }

  /* ------------------------------------------------------- the draft state */

  var stateButton = document.querySelector(".state.pressable");
  var stateList = document.querySelector(".state-list");
  if (stateButton && stateList) {
    stateButton.addEventListener("click", function (event) {
      event.stopPropagation();
      stateList.hidden = !stateList.hidden;
    });
    stateList.addEventListener("click", function (event) {
      var item = event.target.closest(".state-item");
      if (!item) return;
      stateList.hidden = true;
      // The host confirms and reports. Taking a pull request out of draft asks
      // the whole team to look, so nothing about it happens on one click here.
      notifyHost("setDraft", { draft: item.dataset.ready !== "1" });
    });
    // Anywhere else puts it away, which is what every menu does.
    document.addEventListener("click", function () { stateList.hidden = true; });
  }

  var fitButton = document.getElementById("action-fit");
  if (fitButton) fitButton.addEventListener("click", fit);

  // Copying the branch name is what the forge's header is for half the time —
  // it is how a reviewer gets from reading the change to checking it out.
  var copyRef = document.querySelector(".copy-ref");
  if (copyRef) {
    copyRef.addEventListener("click", function () {
      var ref = copyRef.dataset.ref || "";
      var done = function () {
        copyRef.classList.add("done");
        window.setTimeout(function () { copyRef.classList.remove("done"); }, 1200);
      };

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(ref).then(done, fallback);
      } else {
        fallback();
      }

      // Webviews do not always grant the clipboard API. A hidden field and the
      // old command work where it is refused, and saying nothing at all would
      // leave the reviewer pasting whatever was there before.
      function fallback() {
        var field = document.createElement("textarea");
        field.value = ref;
        field.setAttribute("readonly", "");
        field.style.position = "fixed";
        field.style.opacity = "0";
        document.body.appendChild(field);
        field.select();
        try {
          if (document.execCommand("copy")) done();
        } catch (e) {
          /* nothing left to try; the name is on screen to be read */
        }
        field.remove();
      }
    });
  }

  document.addEventListener("keydown", function (event) {
    if (event.target instanceof HTMLInputElement) return;
    if (event.target instanceof HTMLTextAreaElement) {
      // Escape leaves the composer without writing anything, but the lines
      // stay picked so the handles can reopen it.
      if (event.key === "Escape" && composer && !composer.hidden) {
        composer.hidden = true;
        pending = null;
      }
      return;
    }
    if (event.key === "f") fit();
    if (event.key === "Escape") { clearHighlight(); clearSelection(); closeThread(); }
  });

  /* ------------------------------------------------------- the card's header */

  /**
   * Puts a string on the clipboard, or as close as the host allows.
   *
   * Webviews do not always grant the clipboard API, and saying nothing at all
   * would leave the reader pasting whatever was there before.
   */
  function copyText(value, mark) {
    var done = function () {
      if (!mark) return;
      mark.classList.add("done");
      window.setTimeout(function () { mark.classList.remove("done"); }, 1200);
    };

    var fallback = function () {
      var field = document.createElement("textarea");
      field.value = value;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      try {
        if (document.execCommand("copy")) done();
      } catch (e) {
        /* nothing left to try */
      }
      field.remove();
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(done, fallback);
    } else {
      fallback();
    }
  }

  cards.forEach(function (card) {
    var copy = card.querySelector(".copy-path");
    if (copy) {
      copy.addEventListener("click", function (event) {
        event.stopPropagation();
        copyText(card.dataset.path || "", copy);
      });
    }

    var unfold = card.querySelector(".unfold");
    if (unfold) {
      unfold.addEventListener("click", function (event) {
        event.stopPropagation();
        // Everything the card is holding back, in one go: what is past its
        // height cap and what is behind every band. Pressed again it returns
        // the card to the shape the layout gave it.
        var open = !card.classList.contains("expanded");
        card.classList.toggle("expanded", open);
        card.querySelectorAll(".row.gap.expandable").forEach(function (band) {
          setGapOpen(band, open);
        });
        recompute();
      });
    }

    var remarks = card.querySelector(".remarks");
    if (remarks) {
      remarks.addEventListener("click", function (event) {
        event.stopPropagation();
        // Straight to the first thing anybody said about this file, which is
        // what a count is asking to be pressed for.
        var first = marks.filter(function (mark) {
          return mark.thread.root.path === card.dataset.path;
        })[0];
        if (first) showThread(first.thread, first.el);
      });
    }
  });

  /** The count on each card's header, kept level with what is on the page. */
  function refreshRemarkCounts() {
    var totals = {};
    marks.forEach(function (mark) {
      var path = mark.thread.root.path;
      totals[path] = (totals[path] || 0) + mark.thread.comments.length;
    });

    cards.forEach(function (card) {
      var button = card.querySelector(".remarks");
      if (!button) return;
      var count = totals[card.dataset.path] || 0;
      button.hidden = count === 0;
      button.querySelector(".tally").textContent = count;
    });
  }

  /* ------------------------------------------------------------ host bridge */

  // Present when hosted in an editor webview; absent in a plain browser, where
  // the graph is still fully explorable, just not able to open files.
  var host =
    typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : null;

  // Jumping to the file needs somewhere to jump from; without a host there is
  // nothing to ask, so the button never appears rather than appearing dead.
  if (host) {
    cards.forEach(function (card) {
      var jump = card.querySelector(".jump");
      if (!jump) return;
      jump.hidden = false;
      jump.addEventListener("click", function (event) {
        event.stopPropagation();
        notifyHost("open", { path: card.dataset.path });
      });
    });
  }

  function notifyHost(type, payload) {
    if (host) host.postMessage({ type: type, payload: payload });
  }

  refreshFilters();
  refreshReview();
  buildMarks();
  fit();
  window.addEventListener("resize", fit);
})();
`;
