# Changelog

## 0.10.1 — 2026-11-10

### Bug fixes

- An agent's request for approval, such as leaving plan mode, always appears in its console, even when the reading's panel was replaced while it was working, instead of hanging until the turn times out

## 0.10.0 — 2026-11-10

### New features

- Typing / in an agent's console suggests the agent's own commands (built-ins, custom commands, skills, plugins) and runs any slash command in its interactive CLI, so /resume, /mcp and the rest work as they do in a terminal

## 0.9.0 — 2026-11-09

### New features

- Each agent's console has a CLI tab: the agent's own interactive command, with /mcp, slash commands and everything else it offers, continuing the conversation Odin already has with it

### UI/UX

- The console's tabs no longer touch the edge of their box

## 0.8.1 — 2026-11-09

### Quality of life

- opencode is read from its event stream: tool calls, thinking and answers show up cleanly, and its edits reach the ledger
- opencode carries its conversation from one question to the next, and across a window reload

### Bug fixes

- A failed opencode turn says why instead of showing nothing
- The build compiles the libraries first, and leaves the command line runnable

## 0.8.0 — 2026-11-09

### New features

- Pictures and videos in remarks and feedback upload the way GitHub's own CLI does: they render inline like a browser upload, with no attachment branches or forks left behind

### Quality of life

- The GitHub CLI setup also updates an outdated gh, installing only from sources that ship current releases

### Bug fixes

- Sending feedback without write access to the Odin repository still opens the issue, and says which files to add on the page

## 0.7.5 — 2026-11-09

### Bug fixes

- Migrations, and other files that only point at something far along the graph, sit in the column beside it instead of the first column

## 0.7.4 — 2026-11-09

- Maintenance release.

## 0.7.3 — 2026-11-09

### Quality of life

- Every release says what changed, grouped into new features, UI/UX, quality of life and bug fixes, on GitHub, the VS Code Marketplace and Open VSX

## 0.7.2 — 2026-11-09

- Maintenance release.

## 0.7.1 — 2026-11-09

### Bug fixes

- A browser keeps following a live reading after its frame changes hands

## 0.7.0 — 2026-11-09

### New features

- A step-by-step GitHub CLI setup, and a README with a picture per feature

## 0.6.3 — 2026-11-09

- Maintenance release.

## 0.6.2 — 2026-11-09

### Bug fixes

- A window reload reopens only the readings that were open

## 0.6.1 — 2026-11-09

- Maintenance release.

## 0.6.0 — 2026-11-09

### New features

- Graph and Change graph tabs, a resizable side bar, and Go live from GitHub
- AI pairing in settings, a reminder to pair, and a clearer settings panel

### Bug fixes

- Browser sync picks the right folder, keeps AI pairing on big changes, and clears the start-up cover

## 0.5.0 — 2026-11-09

### New features

- A GitHub access page in Odin's style that creates the token for you
- Read GitHub through VS Code when synced, so private repositories need no token

### Bug fixes

- A pull request with repeated checks opens instead of staying blank

## 0.4.2 — 2026-11-09

- Maintenance release.

## 0.4.1 — 2026-11-08

- Maintenance release.

## 0.4.0 — 2026-11-08

### New features

- The composer is a drop zone, outlined while media is dragged or copied
- Settings open as a centred modal with a backdrop, and show Odin's version
- Support entry with an icon and a description
- Support from the graph, and pictures and videos in remarks
- A connection dot on the VS Code source button
- Say "Synced with: VS Code", and reconnect when VS Code restarts
- "Go live in" a branch, and say what going live allows
- Name the checkout button for what it enables

### Bug fixes

- Attachments sit inside the composer's padding, and their remove button is centred
- The start-up cover ends with the drawing, and the VS Code dot sits in its button

## 0.3.1 — 2026-11-08

### Bug fixes

- The synced reading no longer stays under "refreshing"

## 0.3.0 — 2026-11-08

### New features

- A local script can steer Odin for demos
- An Odin tab on GitHub, synced with VS Code

## 0.2.1 — 2026-11-07

- Maintenance release.

## 0.2.0 — 2026-11-07

### New features

- Ready for the Marketplace, published on every merge to main
- A guided tour of the change, narrated, with agents that keep it true
- The side list keeps its folders in sight and can leave untouched files out
- An agent runs on the model the reader picks
- An audio file's card plays it
- An agent's question is asked, and answered, inside Odin
- An image file's card is the image
- A folder can be marked read, and the list can be taken whole
- The lines that moved in the narrower view wear an orange edge
- A change is read whole, since the last review, or as what is not committed
- A change can be read from the reviewer's last review onwards
- A part of a change is named after the folder its files share
- The file tree marks the file the reader is standing on
- A bar absorbs what the reader cannot presently see
- The files nothing points at are dealt across lanes instead of piled in one
- A folded folder's name moves up into the bar above only while it cannot be seen
- A bar absorbs a folded folder only where that folder is the whole box
- A folder's header can be folded into its parent's, and stays folded
- A folder and the folder inside it are a step apart down the page too
- Two folders standing over different columns share a row
- Folder boxes nest, and their headers stack instead of colliding
- Draw the cards grouped into the folder they live in
- A way back to the newest change, while the reader is behind
- Paths a reader can use, a head that stays, and a ledger that draws what is on screen
- A log says what kind of act each line was, and which file
- The ledger reads in the order things happened
- The ledger is built from what the watcher saw, not from what a tool admitted
- A remark holds on to its code while an agent moves it
- A ledger of what each agent wrote, beside the log of what it did
- Control-V pastes, and a pasted picture stops eating the words
- Drive a real editor, so a question about tabs has an answer
- An untouched file leaves when nothing points at it any more
- Conversations on a file already read stand back
- A conversation says whether it is finished with
- A file that has been read stops saying its name
- A button on the card that comments on the file
- The name menu opens under the line being written
- A named agent looks named
- A second agent's console is a bar, not a sliver
- A reload puts the reader back on the tab they had open
- A picture in the log is a picture
- Roads that go the same way share a lane
- The drawing assembles itself while it is being built
- A picture opens at its own size
- Roads that go around the cards, and bridges where they cross
- Hold the reader off a drawing that is still being worked out
- Draw arrows as roads, and three corrections that came with it
- The editor's own surfaces on the cards, opencode, and a wheel that zooms
- Draw a pasted picture where the remark names it
- Update the checkout you are standing in, and prefer local work to main
- Odin update, which pulls main and installs itself
- Paste a picture into an agent's console
- Show who took a task, and what is stacked behind it
- Show a file's path under its name, without waiting on the browser
- Show what a rebuild changed, on the cards it changed
- Read a branch live from a worktree of its own
- Pair with the agents on this machine while reading a change
- Keep the graph in step with the working tree, incrementally
- Mark a file that ends without a newline
- Offer to reconcile a branch that has wandered from the forge
- One command to build Odin and put it in the editor
- A switch for the parts of the drawing that are not files
- Several references to one place travel as one road
- JOOQ, so generated code lands on the table it came from
- The schema wears a database, and keeps its links
- The schema is a vertex, and migrations point at the table
- SQL, and the parts that are only Postgres
- The author box asks half a second after you stop typing
- Each part of a change gets a stripe of the canvas to itself
- Lay the whole change out in the order its parts are listed
- Read merged and closed pull requests, and ask the forge a narrower question
- The map says which file you are on
- A card too small to read still reads as a split
- Step back to the pull requests and forward to the change list
- Keep unsent drafts across reloads
- Lead the list with what is waiting on you
- Say when a pull request has moved since you read it
- Python and Clojure
- The mark, breathing, while there is no graph yet
- One menu for everything, and each part remembers where you were
- The map follows the reader in, and loses its chrome
- A way back to the file explorer
- Turn each corner of the page off, from the menu or from the corner
- A square map, a frame that never vanishes, and a checkout that knows where it is
- A map of the change in the corner
- A dot at the far end for the way back
- Fold the side bar away from its own title
- Light the lines a thread is about, and park clear of both
- The writer's face on the box, fit on H, and no more hint block
- A keys panel, and F to open the file
- Lay a part out for itself
- The graph's tab wears the extension's mark
- Read a change from the keyboard
- The file list follows the part being read
- One menu for the whole row, and a face on every thread
- What the forge made of the branch, kept current
- Who is on this review, and what they said
- A card's title carries its status mark
- Give the drawing back the row the switches were using
- The header buttons say what they do
- Use the supplied artwork as the extension's icon
- The rail offers the button before it is needed
- Carry the reader to the next file in the chain
- Comments start at the rail, and a pick reads as one block
- Say how much of each part has been read
- Read a large change one blast radius at a time
- Put the plus beside the number it belongs to
- Say when the forge is being asked
- Mark changed rows down both edges of the card
- Hold a card's name in view, and stop the filter matching directories
- Read the change side by side, or in one column
- The way back moves onto the name the arrow lands on
- Box the name an arrow lands on, and refuse comments the forge would
- Two ends of an arrow you can press to travel
- A suggestion previews as a diff, and a closed box keeps its words
- A rendered component is a call
- Colour the code in a comment, and widen the markdown
- Suggest a change from any box, with the forge's own glyph
- Answer a thread, react to it, and act on a single remark
- Mark what the filter matched
- Remarks beside the file, not inside it
- Nothing the change touched is hidden
- A green that carries text, a draft that can be readied, and arrows that
- The reviewer's own theme, and a way back that stays put
- A way out of the pending review panel
- The comment box, where the comment belongs
- Colour the code, with VS Code's own grammars
- The forge's own header, above the graph
- Drive the whole tool from the command line, and teach an agent to
- Draw a line pick the way a diff viewer draws one
- Comment on a passage, and keep the picture sharp when zoomed
- Review from the graph — read comments, write them, submit a verdict
- Choose a pull request from the sidebar
- Show the pull request's title, and divide the toolbar into sections
- Untouched files follow the references that reach them
- Show progress through the change, and who wrote it
- Mark files as reviewed, and use GitHub Desktop's status icons
- Show unreadable files as a warning rather than a note
- Fold imports by default, and fix the gutter
- Expandable gaps, truncated cards, and hide tests by default
- Kotlin resolution, and report what nothing could read
- Detect the base branch, and add an activity bar view

### Quality of life

- Route the arrows once, not once per layer
- Place the cards where their arrows want them
- Publish the cards' measurements together, and say how far through a build is
- Work out the words a card boxes once for the page
- Half the document, and colour runs instead of colour tokens
- Render the cards that are worth rendering
- One box for writing markdown, wherever markdown is written

### Bug fixes

- A player sits inside its card rather than against the edges
- Reading a change live leaves one tab, and it is the live one
- A refreshed reading reaches the side list without replacing it
- A card holding a picture or a player is never narrower than its name
- A merged change read live is measured from where it landed
- Stopping a turn keeps the conversation it was having
- A live reading redraws a picture whose bytes changed
- A refreshed or reopened reading fetches before it redraws
- The reviewed boxes line up down the list, folders and files alike
- The box for a remark stays in the window its card is still in
- A line that moved says so in its sign and number, not only its edge
- Every line that moved wears the orange edge, on the new side
- The orange dot keeps its size on screen as the canvas zooms out
- The orange dot sits centred on the card's rounded corner
- The orange dot on a card is drawn over its corner, where it can be seen
- The button that chooses what to show sits beside the settings
- The orange dot sits in the card's corner and at the end of the row
- A line can be asked about on a live branch that has no pull request
- The offer to begin a remark stands beside the sign, and every gutter arms it
- Pressing a finished change opens that change, not the branch in the tree
- A live card shows the file it is a reading of, and the whole of it
- The tabs are worked out from the arrows the reader can see
- The list of names opens under the @ that summoned it
- A card is as wide as its longest line, with no limit chosen in advance
- A card that grows while an agent edits it grows on the canvas too
- A live reading follows the branch when its history moves
- Unsent remarks are kept per repository, come back after a reload, and say when they cannot be kept
- Copying code off a card no longer brings the diff signs with it
- A remark about a whole file no longer takes the review down with it
- A pinned drawing is the size it is, says what it says, and opens when pressed
- Checking a change out and reading it leaves one tab as well
- Reading a change the other way leaves one tab, not three
- A command in the log is shown whole, not three letters of the walk to it
- A folder keeps its own columns, so its box is the size of what it holds
- An untouched file is a square like the rest when the reader pulls back
- A folder border keeps its distance from a card it does not hold
- A folded folder keeps its header, out of the stack and in its place
- A folded folder is named on its own frame as well as in the bar above
- A box with no bar draws its frame where its contents begin
- Folding the bar under the pointer takes its tip with it
- A box leaves as much room below the box inside it as above
- A folder bar says its own name and nothing else
- A folder drops to the floor above it, the schema sits with its readers, and a box has a foot
- A folded folder keeps a way back, and its name stops outliving it
- A folder box stops fogging the code, and gets room a reader can see
- Stacked folder names close up instead of showing daylight between them
- A folder box is a place the cards are in, not a wash over them
- The list beside the drawing goes when the drawing does
- A folder's name is held on a line worked out in one place, in one set of units
- The database card is filed with the part that actually reads it
- Folder names step by a header's height, in the units a header is measured in
- A folder box is drawn with a solid border
- A folder box keeps its own corners, its name is opaque, and the corridors are corridors
- A folder's name is a bar across its box, and nested boxes have a corridor
- The database node comes back for the changes that actually reach it
- A tool call names the file, and nothing else
- Nothing shows above a held head, and it squares off while it is held
- The ledger's entries have a height, and a passage worth searching for
- A remark still being written follows its code too
- An orphaned conversation is not handed to whichever branch is open
- A conversation belongs to a change, not to a directory
- The first question of a session no longer reloads the change
- An entry in the ledger finds the file it is about
- The composer's buttons wrap instead of leaving the box
- Say which worktree is dirty, and what is in it
- A reading is named by what was asked for, so it opens one tab
- Opening a remote pull request opens one tab, not two
- The agent badge stands back with the face it belongs to
- A mark on a file already read is a trace, not a dimmed portrait
- An agent that could not finish does not settle the thread
- The file tree remembers which folders were shut
- The composer is over the agent logs, not under them
- A file the change never touched cannot join two parts
- Choosing an agent's name writes it into the remark
- The consoles come back, and the hops go
- Both gutters carry a number
- The composer opens again
- No road crosses a card any more
- The pick ends wherever the hand lets go
- A press that means to comment always opens a box
- A road's first and last legs are its own
- A cache that knows the cards have moved
- The dot marks where its own road starts
- Roads sharing a lane are drawn side by side
- A run's slip roads follow its trunk onto the lane
- A lane is drawn only where something travels it
- Every road draws the whole of itself again
- A road only hands its middle to a lane of its own colour
- A lane wears the colour of what travels it
- A lane draws the road they share, and each arrow draws its own ramps
- The picture stays on the screen, and its cross goes with it
- An arrow lands on its row at any distance
- A crowd that one road cannot join is still a crowd
- The cover means what it says
- What makes two lines one road is that nothing stands between them
- Roads that were never planned, and a hover that redrew the drawing
- Three surfaces from the editor, and the vocabulary stays the drawing's
- Wrap a quoted question instead of running it off the edge
- Colour a fenced block by the name people write on it
- Colour each side of a change as the file that side is
- Draw a quoted suggestion as a change, and stop a stray fence eating the answer
- Keep the file list on the part the reader opened
- Keep a types module with the part that is written against it
- Find each project's own tsconfig, not the repository's
- Answer the editor while references are being resolved
- Show files git has never been told about
- Measure a change against the base it is a change to
- Show the waiting mark when a window comes back
- Keep the zoom when a divider is dragged
- Do not lose a review to a connection that broke mid-request
- The installer works on a machine that has never built Odin
- Isolation dims again, and the road can be pointed at
- Following a gathered arrow lights the whole way to its destination
- Box the generated name at the end that writes it
- One box per name, and none for an arrow that is not there
- Never cut a line the change touched, and reveal the ones still cut
- Match an author by any part of their name
- A forge that did not answer is not a forge with nothing to say
- A run of changed lines is one colour at every zoom
- The filter chips answer, and wear the forge's colours
- The tab strip fades at the ends it can still travel to
- The comment button sits on the number, not out in the code
- Put the map's colours under the code's own
- The file list navigates the graph, and opening a file keeps its own tab
- Hold the map behind the mark until it stops moving
- Rule under the settings title, and a quieter map
- Put the comments cross beside its pill, not above the thread list
- Draw the way back over the cards instead of under them
- Cap the dock, and keep the marks under it
- Say where a branch already is instead of relaying git's refusal
- A pick keeps extending once the pointer leaves the rail
- Line the diff counts up down the right
- The line through a lit block was the diff's own seam
- A new remark shows up without a reload
- Park the file where the conversation fits, and paint the lit rows as one
- The progress track is the strip it runs along
- The settings menu opens over the reviewers, not under them
- A thread only ever opens to the left
- The last rule between the header bars
- Make room for the thread, and stop the toolbar losing buttons
- A thread opens beside the file, not over it
- A thread in the list takes you to the line, at a size you can read it
- One edge colour for every floating panel
- Separate the bars by tone, not by rules
- One surface from the bar down to the cards
- Turn the panel's rule the right way round
- Fill the tab in front instead of underlining it
- A check reads in one pass
- Make a check's verdict visible, and say how long it took
- The comments section lists threads, and only where there are any
- Drop the rule, widen fit, and say what the switch hides
- Follow the nearest call, not the first one in the list
- Dash the phantom box in the file list too
- Tidy the dock, and share the file list's status marks
- Centre the ink in a tab's pill, not the line box
- Centre a tab's count in its pill
- Arrive at the top of the next file, and stop hiding files by default
- One bracket down a commented passage, and room around its mark
- No progress until there is progress
- The panel opened without the other mode's measurements
- A part that has not been started says its size, and one that is done says so
- Frame the part being opened, not the drawing it came from
- Make a tab's count legible
- Keep the pick yellow, and find a folded call site by name
- Never write a name on a band that does not hold the line
- Keep the reply in reach, and space the viewed control
- Point a removed reference at the line, not the stretch it is in
- Centre the status marks, and put the folded name where the label ends
- Give the change signs room to breathe
- A cog that reads as a cog, and colour back on unified rows
- Stop the line where the head starts, and name what a fold hides
- Start each wire on the dot's rim, not behind it
- Never hold a changed line behind the bar
- Keep the faces on a refresh, and box both ends of an arrow
- An empty gutter where the line does not exist, and no wrapping
- Print a stand-in line number once, not once per line
- Let the dot receive the click it was drawn for
- Colour a comment's code even when the change has none of that language
- Line numbers in a suggestion, on one line
- Keep the faces, say the time, green the Open pill
- A card grows to reach the line an arrow points at
- Marks you can see and click, and a filter for the tree
- Show the line an arrow points at, rather than the band hiding it
- Centre the tick, and keep the action out of the list's way
- Work out card positions from scratch instead of nudging them
- Stop cards colliding, and use the editor's own chevrons
- Hide tests in the editor too, anchor into folds, group by directory
- Show a reference's whole path instead of clipping it
- Stack the toolbar into columns so it fits a docked panel
- Anchor arrows to the row they name, and colour the sidebar
- Mirror line numbers, fold every gap both ways, keep the chip a chip
- Stop long lines escaping their card, and always draw both gutters

## 0.1.0 — 2026-08-01

### New features

- VS Code extension
- Collapse untouched code into gaps, split line numbers by side
- Interactive renderer, plus committed examples and screenshots
- Deterministic layout and static SVG rendering
- Resolve call-site references into graph edges
- Change-graph model, diff parser, and CLI
