# Tools: the interface

How drawing and measuring behave: what the screen shows is not repeated here, only what it cannot
show (the layout's rules, snapping and attaching, order, the look's cascade, the rules, keys,
storage). The file is in `drawing-format.md`.

Code: `site/frame.js` the frame, `site/draw/` the rest (architecture.md says which file holds what).

## 1. The layout

One layout at every width (`site/frame.js`).

- **The bar**, across the top: the file group, **Open** (the drawings in this browser, + New, **Open
  a file…**), **Download** (the drawing's GeoJSON, a
  picture, GIS data, the presets; apart, **Offline areas…**), **Copy link**; **Layers** and **Elements** (the left panel's
  tabs); **Undo**, **Redo** (history, not tools); **Select** and **Box select**; **Point**, **Line**,
  **Shape**, **Label**; **Measure**; at its end **find a place** (a field; / goes to it), **About**
  and the **Properties** toggle. The drawing is named in Elements' first row and its Properties.
  With a finger under 1,280 px (a tablet), as on a phone: **☰** in place of Open holds the
  file group and About, find a place is behind its lens with the map's controls. A tool with kinds
  is one button showing the kind in use and a corner mark; its kinds are a row under it as it goes
  on, and at a right-click on its button; shut once one is picked or the map is clicked. A tool's
  button or key pressed again turns it off.
- **Box select** (B): the next drag on the map, a mouse's or a finger's, draws a box; what lies
  inside is selected, then Select again. A drag with Select moves the map; Shift-drag is the box too.
  On a phone its button is in the dock.
- **The left panel**: **Layers** or **Elements** (the tree, §4), as its
  button in the bar (or **L**, **E**) chose: pressed again, it closes. At first it is open on Layers;
  Layers' button turns while the map's layers load.
- **Properties** (the inspector, §5), on the right: a switch of the user's (its toggle, **I**, or a
  double-click on an element). While on, it shows what is selected, else the drawing (its title,
  its display, its totals); on a phone it goes when nothing is. The left panel making way for it, or
  a label placed (its text there to be typed), shows or hides it for the moment: the switch comes
  back as it was at its next press. Its head: what it shows, then
  **Zoom to**, **Duplicate**, **Group**, **Delete**.
- Each panel is as wide as dragged at its inner edge (left 200–480 px, right 260–600; a
  double-click: 260 and 320); widths, the tab and the switch are remembered in this browser. Where
  both would leave less than 480 px of map, Properties, while shown, takes the room and the left
  panel comes back after; the first time in a visit a note says so, and Layers or Elements (or L,
  E) then brings it back, Properties off.
- **The map's foot**: one strip above the bottom row, between the panels (a phone: above its sheet).
  At its left, stacked: the legends, the touch row; at its right **the map's controls**: my
  position, zoom in and out (with a mouse: a finger pinches), north (only when turned). Nothing else
  sits there, so nothing overlaps. The bottom row between the panels, one line: credits (what does
  not fit fades at the end and scrolls sideways), the time shown (a chip: a click opens its
  calendar), the depth shown when a layer has one (a chip: a click opens its list), the cursor's
  position, the scale (a click switches km and NM; in orange with "≈" before it where the scale
  varies across the view, the tooltip by how much).
- **Copy link** carries the view, the layers and the display settings (`u=nm`, `brg=1`), never the
  drawing. The drawing goes out as a file (**Download** › **Drawing (GeoJSON)**, with the view) and
  comes in by **Open a file…** or a file dropped on the map, after a report (what it holds, what was skipped and
  why); a presets file adds its presets (§9); an offline area's file (a zip) joins the offline areas.
- **The note**, a chip under the bar at the centre, says for a few seconds what the screen cannot
  show: a value not applied and why, a file not read, what was copied, why a click or a box did
  nothing, a root not used, a panel that made way. What is visible (a deletion, a copy selected, a
  rule's result) is not said.

**On a phone** (under 720 px) the top is for looking, the bottom for doing. The bar holds **☰**
(Open's menu with Download's, Copy link and About), find a place (a field), Layers and Elements. The
**dock**, a bar along the bottom, holds Undo, Redo, Box select and the tools; while one is on: **Back**, Undo,
Redo, the tool (its kinds a row above the dock, sideways) and **Done** (a line or measurement being
drawn).
The panels are one bottom sheet at a time over the dock (half the screen; as tall as its grip is
dragged, short of the bars, the map's foot and some map; closed when dragged to the bottom). What is
selected, while Properties is off and the left panel closed, **peeks**: Properties' head alone (what it
is, Zoom to, Duplicate, Group, Delete); a tap or a drag up on it turns Properties on, a drag down
turns it off again; a tap on the map clears the selection. Both panels start closed. Zoom to and a
place found are fitted to the map the bars and the panels leave.

**With a finger** (a tablet; a phone's are the dock's and the peek's): a row over the map's foot:
**Done** (a line or measurement being drawn), **Back** (one level, as Esc), **Delete** and
**Duplicate** (a selection). Handles are 14 px, grabbed within 22 px; snapping reaches 16 px, always
(to place near something without snapping to it, zoom in); a + only on legs over 80 px; a second
finger during a drag puts it back and lets the map pinch.

**Colours and sizes**: pressed is blue, a panel shown pale blue, yellow the marks on the map (bands,
targets, +), handles white edged in ink, magenta the map's own (measurements,
the search's pin). With a mouse the bar is 39 px (32 px buttons, 20 px icons), rows 24 px, heads 30 px; with a
finger every target is 44 px. Text: 11, 12, 13, 14, 16 px (a × glyph 18 or 20).

## 2. Tools

One tool is on at a time, and stays on after each placement; its button again, or Select, turns it
off. Its key works from anywhere but a panel's control (a button, a box: focus there keeps the letters
for it): on, or off. A right-click on a tool with kinds (Shape; Point with
presets) opens its kinds.

| Tool | Kinds | Makes |
|---|---|---|
| Point | symbol, the user's presets without shapes | a point: a marker, the same size at every zoom |
| Line | none | a line; closed on its first point, a closed line (an area) |
| Shape | circle, rings, sector, rectangle, ellipse, triangle, three vehicles, the user's presets with shapes | a point with no symbol holding its shapes (circles, a sector, or a closed line: the outline's places), named after its kind, its preset kept as the property `preset` |
| Label | none | a label |
| Measure | none | nothing, unless kept (§3) |

### 2.1 Placing and drawing

- **Shape**: the centre, then the size as the pointer moves (a circle's radius, rings' outermost, an
  outline's front: 100 × 50, a triangle equilateral). It makes a point and the shapes it holds: a
  circle each (rings: three, the first filled), a sector, or an outline's places as a closed line,
  each a shape like any other once made. It faces north; its bearing is a second step (the point's
  stalk, or Bearing). A **rectangle** or **ellipse** goes corner to corner instead (**Shift**: a
  square, a circle). The second click on the first: the default size. A preset of the user's keeps
  its size: one click.
- **Line**: as Measure, a click per point, snapped to what is drawn; Enter, a double-click, a
  right-click or Done ends it at its last point, attached when its first or last point snapped to something it can
  attach to; a click on its first point (three or more) closes it: a closed line, "Area 1", filled,
  its last leg back to its first point. Backspace or Undo takes back a point.
- **Sector**: the centre; the radius and one edge; the other edge, clockwise (back on the first: a
  circle): a point holding the sector. Esc goes one click back.
- **Label**: points at what snapping finds (else a closed line's centre, a place on an open line), or is free
  text where clicked; its text selected, ready to type. It has no name of its own: the tree shows
  it by its text as it reads, and renames it by its text.
- What is drawn or dragged shows its values on the map (legs, total, area, radius). Exact lengths and
  bearings are typed afterwards, in the points' tables (§5).
- **Shift**: 15° steps from the leg before (from north for the first). **Alt**: nothing snapped or
  attached.
- **Esc** (or a right-click with nothing to finish) steps back one level: what is half drawn, else
  the tool, else a form open, else Attach to… waiting, else the selection.

### 2.2 Snapping and attaching

Clicks and drags snap within **6 px**. The nearest target of the first kind found wins: a **vertex**
(a point's centre, a circle's, a line's place or an open line's free end), then a **crossing**
of two edges or legs, then an **edge**. Hidden elements are not snapped to. The target is marked: a
ring on a vertex, a cross on a crossing, a dot on an edge.

Any place of a line (its ends, and every place between: dragged or by **Attach to…**), and where a
label points, attaches to what it snaps to and follows it: a point's or a circle's **centre**, a
line's **vertex**, a place along a **leg** (turning and stretching with it, no vertex added), or another line's **free end** (a dot point is made there, both ends attached). A crossing
gives a position only. A place whose target goes is free where it was; an edit of what it is on
keeps it on the nearest vertex or edge.

## 3. Measure

Measure: a click per point, snapped; each leg and the total shown. Enter or a double-click ends it; a
click on its first point closes it (area and perimeter). What it measured goes in the drawing,
selected, as a line "Distance 1" or a closed line "Area 1": a guide showing its values, magenta and dashed. Saved,
printed and exported with the drawing; Delete (or Undo) removes it; unticking Guide makes it part of
the drawing.

## 4. The tree

- Its first row is the drawing: its title ("Untitled drawing" while it has none; a click selects it:
  Properties, when on, show it; a double-click renames it, as any row), how many elements it
  holds, and an eye for everything listed.
- Then groups first, what is in each one step further in (a group folds), then the rest; a point's
  shapes are rows under it, one step further in (a point with shapes folds). A row: the element's
  icon, its name (else its kind and place), a short value (a point's shapes, a radius, length, area,
  text, a group's count), its eye.
- **Order**: the first of a kind is drawn on top; between kinds the stacking is fixed (§7). A row
  dragged onto a group goes into it, a shape's onto a point into that point; onto a row of its kind,
  before it and into its group; onto another, into its group. Ctrl/⌘ ] and [ move the selection a
  step up or down among its kind.
- Selecting: a click (Shift: a range; Ctrl/⌘: add or remove), ↑ ↓, or on the map (the tree follows);
  hovering a row outlines its element. **Box select** (or Shift-drag) on the map adds what lies
  entirely inside the box. Past 30 elements a filter appears (names and property values), with **Select all
  shown**. Double-click a name, or F2, renames.

## 5. Properties

It shows one element, several (its head counts them by kind; what they share, set on all at once;
one Look for all; how far apart two points are, and the bearing from the first to the second;
**Connect…**), a group (**Connect…** on the points in it), or the drawing (title, description, author, when it was created;
**Display**, the drawing's look, the distance units and the leg bearings; **Totals** by group or by a property, Copy). A field applies on Enter
or when left, one undo step; a value that does not read stays marked and is not applied; Esc puts it
back. ↑ ↓ nudge a number by its last digit (Shift: ten). Distances show to the decimetre (m), the
metre (km) or about 2 m (NM); what is typed is kept as typed. Properties is updated in place as the
drawing changes (a field being typed in keeps its text and the focus; Tab and a click go where they
go), and follows a drag on the map as it moves.

One grammar, top to bottom: what it is (the rule that made it, its name), its geometry, its lists,
its **actions** (one row of buttons: Edit… and Select all for what a rule made, Distribute along…,
Save as preset…, Select members, Connect…), its **Look**, then its foot (a shape's **Point**, **In
group**, **Guide**, **Data**). Every number is 12 px, of one width; a unit stands beside its value in grey (a distance
field shows its number, its unit next to it or in the column's head: typed with another unit, it is
read in that one). One rule for every distance: metres below 1 km, else km; with NM, NM. A column
takes one unit by its largest value.

- **Rows**: a label, one value or a pair (latitude · longitude, colour · opacity), and a last column
  for an action (detach, attach, ↺). A box ticked is a row like any other.
- **Lists** (a line's points, data, the totals, a connection's roots): one
  kind of table, none wider than the panel's 320 px. A long one scrolls in its own box, its head
  kept. The row clicked is current, its
  actions (and what did not fit the columns) in a bar over the list, shown only then, and on keys
  (Insert, Ctrl/⌘ Delete); ↑ ↓ and Enter keep the column. Past 100 rows, a page at a time. **Copy**
  gives every row, tab-separated, for a spreadsheet. Numbers are right-aligned, with fixed decimals:
  degrees to 6 (a decimetre), distances in the column's unit (in its head) to the metre, bearings
  to 1.
- **Sections** have the heads of Layers' groups, the arrow at the right where one folds: **Data**, open while it has properties of the user's;
  **Elevation profile**, read when opened; **Totals**, open to start with.
- **A line**: its **Length**; closed, its **Area** and **Perimeter** instead. **Closed** (three
  points or more) joins its last point to its first, unticked opens it again.
- **A line's points**, 1 (its start) to N (its end): Lat, Lon; the **leg** from the point before (a
  closed line's point 1: from its last), its length and bearing (typed: that point alone moves, the
  legs either side of it change). The row current says how far **along** the line its point is and
  holds its name. A point attached shows what to, its leg as it is. Every row's bar has **Attach
  to…** (pressed while the next click chooses) and, attached, **Detach** (it stays where it is);
  **Insert after** (not an open line's last), **Delete** (two are kept; closed, three) and **Split**
  (not an end: two lines, attached to a point made there; on a closed line, any point: it opens
  there, its start and its end at that point). The row current is ringed on the map; a point pressed
  on the map makes its row current, on its page.
- **What several share** (two or more selected, or a group's members under **Each member**): every
  row two or more of them have, "mixed" where they differ; a value set there goes to each that has
  it. Points: Position each axis alone (a latitude typed puts them all on that parallel, their
  longitudes kept) and Bearing, their shapes carried; Symbol. Circles: Radius. Lines: Path. All but
  labels: Guide. Labels: Leader.
- **The look's cascade:** an element's own value, else the drawing's Display, else the default; **↺**
  gives a field back. Fill (a closed line's, not an open one's) and Stroke are rows (a colour, its opacity in %), Width (px) and Dash
  their own. Where several differ a field says "mixed" and a change writes only that field. A group
  is only who is in it: joining or leaving changes nothing of an element; its Look sets each member.
  A hidden group hides everything in it, a hidden point its shapes.
- A line's **Path**: straight, or smooth (a curve through the vertices, following them).
  **Elevation profile**: the elevation along it, as the shadings draw it (the sea's depths below sea
  level, the land's heights above; every 30 m, at most 1,000 places; one that could not be read a
  gap), its lowest and highest, a chart linked to the map both ways, its length along the surface,
  CSV. When none could be read it says so, and reads again when next shown.
- **A point**: its Position and **Bearing** (typed, or its stalk: its shapes move and turn with it,
  each keeping its distance and bearing from it), its Symbol, its **Shapes** (each a link to it).
  **Save as preset…**. Its look is its symbol's colour. **Data**: its properties as keys and values.
- **A circle**: its centre, **Radius**, **Aperture** (a sector that wide, centred on its **Bearing**;
  empty: the whole circle), its **Area**; **Distribute along…**. Its look is its own, as any
  element's: Fill (an opacity of 0: not filled), Stroke, Width, Dash, Show values (its radius).
- **A shape's Point** (a circle or a closed line): the point holding it, and **Detach** (free where it
  is, in the point's group); free, **Attach to…** (the next click on a point makes that point hold
  it). A shape held by a point has no In group: it is in its point's.
- A **label**: its text, with value codes ({name}, {along}…: **+ name** and the like insert them) and,
  while it has any, what it **reads** under it; **Attached to** what and where (a line's point or leg,
  as its table numbers them), or its **Position**; **Along**, on
  a line; **Text offset**, where its text was dragged to (↺: back); **Leader**, when attached. Look:
  text size, colour, background (halo or box).
- A **group**: **Members** as the tree counts them (everything in it, its subgroups' too) and its
  subgroups, with the group's eye (as its row's); **Totals** as the drawing's, its members only, by subgroup
  (Copy); **Select members**; **Look · sets each member** (a group has no look of its own); its foot
  as every element's.
- **Guide** (points, circles, lines): faint and dashed, left out of the totals.

## 6. Distribute along and Connect: rules

Both are **rules** (`generator.js`): what they make stays linked to them, follows what it was made
from, and can be edited again. What a rule makes is in a group of its own; anything it made shows a
**Made by** row ("Distribute along Line 2 · 12 copies", "Connection · trees, 12 points to 1 root")
with **Edit…** (its form again) and **Select all**.

**Distribute along…** (a line, a closed one round its ring from its first point, or a circle,
clockwise: its whole round from its bearing, a sector's arc) opens a form in Properties (any tool
goes off):

- **By** spacing or count; **Margins** at the start and the end (none round a ring); **Offset** left, right or
  alternating (Out, In round a circle); **Copy**, a built-in kind or a preset of yours; **Radius**
  (500 m to start with; a preset keeps its size); **Aperture** (a sector facing away; empty: circles);
  **In group**. Each copy is a point and its shapes, turned to face away.
- It makes a group "Distribute along" and the name, holding **Copies** (and **Connection**, once
  its copies are connected).
- A faint preview follows the settings; **Create** makes it in one undo step. Copies follow what
  they lie along; one moved by hand stops following.
- **Edit…**: the same count and copy moves the copies, as they are (one changed by hand keeps its
  own); another copy makes them anew of it, another count anew as the first copy left is (warned
  first), and their connection with them.

**Connect…** (two or more points selected, or a group holding them: a distribution's own, its
Copies) opens its form (a click on the map picks a root):

- **Tree** (root → hub → each point) or **Chain** (root → point → next point); **Group size** Auto
  (the cheapest cut; trees up to 32 points) or a number; **Min. branch** (a tree's hubs at least
  this far from their points and root); **Roots**, each with a **weight**. While roots are picked a
  click places a new root, or takes or drops a point. The plan cuts the points, in order (a
  distribution's along its line, else as selected), into groups of consecutive points, each joined
  to one root, the cut and the roots chosen together as the cheapest (each group's length divided by
  its root's weight; a tie goes to the cut whose largest group is smallest). The summary says the
  groups, the roots used and the total length; a root that wins nothing is reported unused.
- A faint preview follows the settings; **Connect** makes it in one undo step, in a group
  "Connection" (a distribution's beside its Copies, else in the points' group). Hubs follow their
  points; one moved by hand stops following. **Edit…**: **Connect again**, its lines and hubs made
  anew.
- **Deleting a root** makes its connection again with the roots left, in the same undo step; the
  last one removes the connection's lines and hubs.

## 7. On the map

- **Stacking**, bottom to top: circles and sectors, closed lines' fills, lines (guides under),
  symbols, names and values, labels; within each, the drawing order (§4).
- **Marks** are yellow cased in white, seen on the sea's blue as on the chart: half strength for hovering (a band just outside the
  element), full for the selection and for targets. The one element selected shows its handles; among
  several, the same squares at their key points, inert. What is not made yet is dashed and dark. Selecting never moves the
  map; Zoom to does.
- **Clicks**, no tool on: the topmost element; the same place again, the next one down. A shape a
  point holds: the first click selects its point (with its shapes, marked with it), the next the
  shape alone.
- **Dragging** a selected element moves it (several together); one undo step; Esc puts it back;
  positions snap (Alt: free; Shift: 15° steps). A point moved or turned carries its shapes.
  **Handles**: a circle's radius; a sector's two ends and its stalk (its bearing); a point's stalk,
  beyond its shapes (it turns them with it); a line's points (one attached to a point's centre moves
  the point; another, dropped on something, attaches there) and a **+** halfway along a leg (a closed
  line's last leg too); a label's text and, free or on a line, its point.
- **Display only** (never in lengths or exports): **Offset**, a line drawn beside itself (−50 to 50
  px, as QGIS offsets a line symbol; ⇉ in the tree). A point's symbol keeps its shapes found at any
  zoom: none is drawn larger than it is. Names collide
  away; labels are always drawn.

## 8. Keys

| Key | Does |
|---|---|
| / | search |
| L, E | the left panel on Layers, on Elements, or closed |
| I | Properties on or off |
| P, G, S, T, M | point, line, shape, label, measure; again: off |
| B, Shift-drag | Box select: a box, what lies inside added to the selection |
| Enter, double-click, right-click | finishes |
| Backspace | takes back a point |
| Esc, right-click | steps back one level |
| ↑ ↓ | previous, next element in the tree |
| Delete (Mac: also ⌘ Backspace) | deletes the place current (a line's point: pressed on the map or its row), else the selection |
| F2 | rename |
| Ctrl/⌘ Z, Ctrl/⌘ Shift Z (or Ctrl Y) | undo, redo |
| Ctrl/⌘ C, V, D | copy, paste, duplicate |
| Ctrl/⌘ ], [ | the selection up or down in the drawing order |

None act while typing in a field, except Esc and Enter. About lists them from `site/keys.js`.

**Copy, paste, duplicate:** a copy keeps its group, look and properties, gets new numbered names and
keeps the attachments between the elements copied together (a line's point on one left behind is
free); a point is copied with its shapes, a shape copied alone is free. Paste
puts its middle at the pointer; Duplicate 20 px beside. One undo step; the copy selected. The clipboard
lives in this page, so it pastes into another drawing opened in it.

## 9. Presets

**Save as preset…** (a point's Properties) keeps the point and its shapes as they are (their sizes,
their places and bearings about it, their own looks) under a name, a small drawing of its own;
Distribute along copies all of it. One with shapes joins Shape's kinds, one without Point's. Placing
one makes a copy of it facing north about the place clicked, the point named after it, with the
preset's name as a property; pressed again while current among the kinds (or right-clicked), it is renamed or deleted. Saving one
under a name in use asks before replacing it (a file's replaces). Presets
live in this browser only; **Download** › **Presets (JSON)** and **Open a file…** move them.

## 10. Deleting, and drawings in this browser

- Delete goes at once (Undo brings it back). A point takes its shapes with it. Lines attached to what
  goes stay, their points free where they were; labels on it stay, free. A group with members asks first: the group only (what is
  in it goes to the group above), or everything in it.
- Each drawing is saved as it changes, never sent anywhere; the open one comes back with the page.
  **Open** lists the drawings in this browser (last change, size): a click opens one with its view (where
  it was drawn, its layers, time, depth and units, as an import does), a bin deletes it for good
  (asked first); **+ New drawing** adds one.
- When the browser refuses to save, Properties says so (Download › Drawing keeps it as a file); when
  another tab saved the same drawing, it says so, with **Reload**.
