# Tools: the interface

How drawing and measuring behave: what the screen shows is not repeated here, only what it cannot
show (the layout's rules, snapping and attaching, order, the look's cascade, the rules, keys,
storage). The file is in `drawing-format.md`.

Code: `site/frame.js` the frame; `site/draw/`: `panel.js` the inspector, `tree.js`, `tools.js`,
`files.js` (the bar's file group), `drawing.js` the map side, `snap.js`, `attach.js`, `drag.js`,
`features.js` what the map draws and its handles, `generator.js` the rules, `clipboard.js`,
`presets.js`, `place.js` what Point and Shape place; `site/keys.js`.

## 1. The layout

One layout at every width (`site/frame.js`).

- **The bar**, across the top: the file group, **Open** (the drawings in this browser, + New, **Open
  a file…**), **Download** (the drawing's GeoJSON, a
  picture, GIS data, the presets), **Copy link**; **Layers** and **Elements** (the left panel's
  tabs); **Undo**, **Redo** (history, not tools); **Select** and **Box select**; **Point**, **Line**,
  **Shape**, **Label**; **Measure**; at its end **find a place** (a field; / goes to it), **About**
  and the **Properties** toggle. The drawing is named in Elements' first row and its Properties.
  With a finger under 1,280 px (a tablet), as on a phone: **☰** in place of Open holds the
  file group and About, find a place is behind its lens with the map's controls. With a mouse and room (a window from 1,280 px), a tool's kinds are buttons in the bar in its place (Shape's ten), each the tool on with that kind.
  Otherwise the tool's one button shows the kind in use and a corner mark; its kinds are a row under
  it as it goes on, shut once one is picked or the map is clicked. Its key again: the next kind.
- **Box select** (B): the next drag on the map, a mouse's or a finger's, draws a box; what lies
  inside is selected, then Select again. A drag with Select moves the map; Shift-drag is the box too.
- **The left panel**: **Layers** (`menu=1` in the address) or **Elements** (the tree, §4), as its
  button in the bar (or **L**, **E**) chose: pressed again, it closes. At first it is open on Layers;
  Layers' button turns while the map's layers load.
- **Properties** (the inspector, §5), on the right: a switch of the user's (its toggle, **I**, or a
  double-click on an element). While on, it shows what is selected (or the drawing, its row
  clicked) and goes when nothing is; selecting never turns it on. Its head: what it shows, then
  **Zoom to**, **Duplicate**, **Group**, **Delete**.
- Each panel is as wide as dragged at its inner edge (left 200–480 px, right 260–600; a
  double-click: 260 and 320); widths, the tab and the switch are remembered in this browser. Where
  both would leave less than 480 px of map, Properties, while shown, takes the room and the left
  panel comes back after; the first time in a visit a note says so, and Layers or Elements (or L,
  E) then brings it back, Properties off.
- **The map's foot**: one strip above the bottom row, between the panels (a phone: above its sheet).
  At its left, stacked: the legends, the touch row; at its right **the map's controls**: my
  position, zoom in and out, north (only when turned). Nothing else sits there, so nothing overlaps.
  The bottom row between the panels: credits, the time shown (a chip: a click opens its calendar,
  and the depth when a layer has one), the cursor's position, the scale (a click switches km and NM).
- **Copy link** carries the view, the layers and the display settings (`u=nm`, `brg=1`, `pm=km`), never the
  drawing. The drawing goes out as a file (**Download** › **Drawing (GeoJSON)**, with the view) and
  comes in by **Open a file…** or a file dropped on the map, after a report (what it holds, what was skipped and
  why); a presets file adds its presets (§9).
- **The note**, a chip under the bar at the centre, says for a few seconds what the screen cannot
  show: a value not applied and why, a file not read, what was copied, why a click or a box did
  nothing, a root not used, a panel that made way. What is visible (a deletion, a copy selected, a
  rule's result) is not said.

**On a phone** (under 720 px) the bar holds **☰** (Open's menu with Download's, Copy link and About),
Layers, Elements and the tools; Select (Back), Box, Undo and Properties are in the touch row, find
a place with the map's controls; a tool's kinds wrap rather than leave the screen. The panels are one bottom
sheet at a time (half the screen; as tall as its grip is dragged, short of the bar, the map's foot and
some map; closed when dragged to the bottom).
Both start closed. Zoom to and a place found are fitted to the map the bar and the panels leave.

**With a finger**: a row over the map's foot: **Done** (a line, polygon or measurement being drawn),
**Back** (one level, as Esc), **Delete** and **Duplicate** (a selection), **Snap** (a tool on; off
places exactly where tapped, as Alt), **Undo** and **Properties** (a phone: a selection, Properties off). Handles are 14 px, grabbed within 22 px; snapping reaches 16 px; a + only on legs over 80 px; a
second finger during a drag puts it back and lets the map pinch.

**Colours and sizes**: pressed is blue, a panel shown pale blue, yellow the marks on the map (bands,
targets, +), handles white edged in ink, magenta the map's own (measurements,
the search's pin). With a mouse the bar is 35 px (28 px buttons), rows 24 px, heads 30 px; with a
finger every target is 44 px. Text: 11, 12, 13, 14, 16 px (a × glyph 18 or 20).

## 2. Tools

One tool is on at a time, and stays on after each placement; its button again, or Select, turns it
off. Its key works from anywhere; again, while it is on, it moves to its next kind.

| Tool | Kinds | Makes |
|---|---|---|
| Point | symbol, the user's presets without extent | a point: a marker, the same size at every zoom |
| Line | none | a line |
| Shape | circle, rings, sector, rectangle, ellipse, triangle, polygon, three vehicles, the user's presets with extent | a point with parts and no symbol (a polygon: an area), named after its kind, its preset kept as the property `preset` |
| Label | none | a label |
| Measure | none | nothing, unless kept (§3) |

### 2.1 Placing and drawing

- **Shape**: the centre, then the size as the pointer moves (a circle's radius, rings' outermost, an
  outline's front: 100 × 50, a triangle equilateral). It faces north; its bearing is a second step
  (the stalk, or Bearing). A **rectangle** or **ellipse** goes corner to corner instead (**Shift**: a
  square, a circle). The second click on the first: the default size. A preset of the user's keeps
  its size: one click.
- **Line**: a click per vertex; a click on something it can attach to ends it there, attached; Enter
  or a double-click ends it at the last vertex, free. Backspace takes back a vertex.
- **Polygon**: a click per corner; a click on the first corner, Enter or a double-click closes it.
- **Sector**: the centre; the radius and one edge; the other edge, clockwise (back on the first: a
  circle). Esc goes one click back.
- **Label**: points at what snapping finds (else an area's centre, a place on a line), or is free
  text where clicked; its text selected, ready to type. It has no name of its own: the tree and
  Properties show it by its text as it reads (a name typed wins).
- What is drawn or dragged shows its values on the map (legs, total, area, radius). Exact lengths and
  bearings are typed afterwards, in the points' and corners' tables (§5).
- **Shift**: 15° steps from the leg before (from north for the first). **Alt**: nothing snapped or
  attached.
- **Esc** or a right-click steps back one level: what is half drawn, else the
  tool, else Attach to… waiting, else the selection.

### 2.2 Snapping and attaching

Clicks and drags snap within **6 px**. The nearest target of the first kind found wins: a **vertex**
(a point's centre, a corner of an outline or area, a line's vertex or free end), then a **crossing**
of two edges or legs, then an **edge**. Hidden elements are not snapped to. The target is marked: a
ring on a vertex, a cross on a crossing, a dot on an edge.

A line's end (and a label's anchor) attaches to what it snaps to and follows it: a point's
**centre** (never its round parts), a **vertex**, a place along an **edge** or a leg (turning and
stretching with it, no vertex added), or another line's **free end** (a dot point is made there, both
ends attached). A crossing gives a position only. An end whose target goes is free where it was; an
edit of what it is on keeps it on the nearest vertex or edge.

## 3. Measure

Measure: a click per point, snapped; each leg and the total shown. Enter or a double-click ends it; a
click on its first point closes it (area and perimeter). What it measured goes in the drawing,
selected, as a line "Distance 1" or an area: a guide showing its values, magenta and dashed. Saved,
printed and exported with the drawing; Delete (or Undo) removes it; unticking Guide makes it part of
the drawing.

## 4. The tree

- Its first row is the drawing: its title ("Untitled drawing" while it has none; a click selects it:
  Properties, when on, show it; a double-click renames it, as any row), how many elements it
  holds, and an eye for everything listed.
- Then groups first, what is in each one step further in (a group folds), then the rest. A row: the
  element's icon (a point by what it looks like), its name (else its kind and place), a short value
  (size, radius, length, area, text, a group's count), its eye.
- **Order**: the first of a kind is drawn on top; between kinds the stacking is fixed (§7). A row
  dragged onto a group goes into it; onto a row of its kind, before it and into its group; onto
  another, into its group. Ctrl/⌘ ] and [ move the selection a step up or down among its kind.
- Selecting: a click (Shift: a range; Ctrl/⌘: add or remove), ↑ ↓, or on the map (the tree follows);
  hovering a row outlines its element. **Box select** (or Shift-drag) on the map adds what lies
  entirely inside the box. Past 30 elements a filter appears (names and property values), with **Select all
  shown**. Double-click a name, or F2, renames.

## 5. Properties

It shows one element, several (its head counts them by kind; what they share, set on all at once;
one Look for all; how far apart two points are, and the bearing from the first to the second;
**Connect…**), a group, or the drawing (title, description, author;
**Display**, the drawing's look; **Totals** by group or by a property, Copy). A field applies on Enter
or when left, one undo step; a value that does not read stays marked and is not applied; Esc puts it
back. ↑ ↓ nudge a number by its last digit (Shift: ten). Distances show to the decimetre (m), the
metre (km) or about 2 m (NM); what is typed is kept as typed. Properties is updated in place as the
drawing changes (a field being typed in keeps its text and the focus; Tab and a click go where they
go), and follows a drag on the map as it moves.

One grammar, top to bottom: what it is (the rule that made it, its name), its geometry, its lists,
its **actions** (one row of buttons: Edit… and Select all for what a rule made, Distribute along…,
Save as preset…, Select members, Connect…), its **Look**, then its foot (**In group**, **Guide**,
**Data**). Every number is 12 px, of one width; a unit stands beside its value in grey (a distance
field shows its number, its unit next to it or in the column's head: typed with another unit, it is
read in that one).

- **Rows**: a label, one value or a pair (latitude · longitude, colour · opacity), and a last column
  for an action (detach, attach, ↺). A box ticked is a row like any other.
- **Lists** (parts, a line's points, an area's corners, data, the totals, a connection's roots): one
  kind of table, none wider than the panel's 320 px. A long one scrolls in its own box, its head
  kept. The row clicked is current, its
  actions (and what did not fit the columns) in a bar over the list, shown only then, and on keys
  (Insert, Ctrl/⌘ Delete); ↑ ↓ and Enter keep the column. Past 100 rows, a page at a time. **Copy**
  gives every row, tab-separated, for a spreadsheet. Numbers are right-aligned, with fixed decimals:
  degrees to 6 (a decimetre), distances in the column's unit (km or NM, in its head) to 3, bearings
  to 1.
- **Sections** have the heads of Layers' groups, the arrow at the right where one folds: **Data**, open while it has properties of the user's;
  **Depth profile**, read when opened; **Totals**, open to start with.
- **A line's points**, 1 (its start) to N (its end): Lat, Lon; the **leg** from the point before,
  its length and bearing (typed: that point alone moves, the legs either side of it change). The row
  current says how far **along** the line its point is and holds a vertex's name. An end attached
  shows what to, its leg as it is; its row's bar has **Attach to…** (pressed while the next click
  chooses) and **Detach** (it stays where it is). An area's **corners** the same, 1 to n, corner 1's
  edge from the last. The row current is ringed on the map; a point pressed on the map makes its row
  current, on its page.
- **What several share** (two or more selected, or a group's members under **Each member**): every
  row two or more of them have, "mixed" where they differ; a value set there goes to each that has
  it. Points: Position each axis alone (a latitude typed puts them all on that parallel, their
  longitudes kept), Bearing, Symbol (those without an outline), and their **Parts** part by part,
  every row two or more points have: its kind (changed, each keeps its reach), size (each round
  part's radius and each outline's length at once), across (a sector's aperture, an outline's width,
  each where two or more have one), fill. Lines: Path. Points, lines and areas: Guide. Labels: Leader.
- **The look's cascade:** an element's own value, else the drawing's Display, else the default; **↺**
  gives a field back. Fill and Stroke are rows (a colour, its opacity in %), Width (px) and Dash
  their own. Where several differ a field says "mixed" and a change writes only that field. A group
  is only who is in it: joining or leaving changes nothing of an element; its Look sets each member.
  A hidden group hides everything in it. **Min. size** is the drawing's only: shapes shorter than it
  on screen are drawn enlarged, dotted.
- A line's **Path**: straight, or smooth (a curve through the vertices, following them).
  **Depth profile**: the depth along it from the depth shading's grid (at most 1,000 places), its
  extremes, a chart linked to the map both ways, its length along the seabed, CSV.
- A point's **Parts** are its own: circles, sectors, outlines; a table of Kind, **Size** (a radius, an
  outline's length), **Across** (a sector's aperture in °, an outline's width), in m or km (a click
  on the head switches; with NM, NM), and Fill; the row
  current has its name and **Shown** in the bar. One way to add one: the table's empty last row. A
  part's handle pressed on the map makes its row current. All parts share the point's Bearing (a
  sector centred on it, an outline facing it).
  **Distribute along…** goes round the part whose row is current (the form can choose another).
  **Data**: its properties as keys and values.
- A **label**: its text, with value codes ({name}, {along}…: **+ name** and the like insert them) and,
  while it has any, what it **reads** under it; **Attached to** what and where (a line's point or leg,
  an area's or outline's corner or edge, as the tables number them), or its **Position**; **Along**, on
  a line; **Text offset**, where its text was dragged to (↺: back); **Leader**, when attached. Look:
  text size, colour, background (halo or box).
- A **group**: **Members** as the tree counts them (everything in it, its subgroups' too) and its
  subgroups, with an eye for all of them; **Totals** as the drawing's, its members only, by subgroup
  (Copy); **Select members**; **Look · sets each member** (a group has no look of its own); its foot
  as every element's.
- **Guide** (points, lines, areas): faint and dashed, left out of the totals.

## 6. Distribute along and Connect: rules

Both are **rules** (`generator.js`): what they make stays linked to them, follows what it was made
from, and can be edited again. What a rule makes is in a group of its own; anything it made shows a
**Made by** row ("Distribute along Line 2 · 12 copies, connected to 1 root") with **Edit…** and
**Select all**.

**Distribute along…** (a line, or a point round one of its parts, clockwise: a circle's whole round
from its bearing, a sector's arc, an outline's ring) opens a form in Properties (any tool goes off: a
click on the map picks a root):

- **By** spacing or count; **Margins** at the start and the end; **Offset** left, right or
  alternating (Out, In round a part); **Copy**, a built-in kind or a preset of yours; **Radius**
  (500 m to start with; a preset keeps its size); **Sector** (none, 90°, 180°, 270°, facing away);
  **In group**.
- It makes a group "Distribute along" and the name, holding **Copies** and, when connected,
  **Connection**.
- **Connect to roots**: **Tree** (root → hub → each point) or **Chain** (root → point → next
  point); **Group size** Auto (the cheapest cut; trees up to 32 points) or a number; **Min. branch**
  (a tree's hubs at least this far from their points and root); **Roots**, each with a **weight**.
  While roots are picked a click places a new root, or takes or drops a point. The plan cuts the
  points, in order along the line, into groups of consecutive points, each joined to one root, the
  cut and the roots chosen together as the cheapest (each group's length divided by its root's
  weight; a tie goes to the cut whose largest group is smallest). The summary says the groups, the
  roots used and the total length; a root that wins nothing is reported unused.
- A faint preview follows the settings; **Create** makes it all in one undo step. Copies follow what
  they lie along, hubs their points; one moved by hand stops following.
- **Edit…**: the same count moves the copies (one changed by hand keeps its own, with **↺** for the
  rule's); another count makes them anew (warned first), and their connection with them. Unticking
  Connect removes its lines and hubs (the roots stay).
- **Connect…** (two or more points placed by hand): the Connect half alone, in the order selected.
- **Deleting a root** makes its connection again with the roots left, in the same undo step; the
  last one removes the connection's lines and hubs.

## 7. On the map

- **Stacking**, bottom to top: points' circles and sectors, areas, lines (guides under), shapes'
  outlines, symbols, names and values, labels; within each, the drawing order (§4).
- **Marks** are yellow cased in white, seen on the sea's blue as on the chart: half strength for hovering (a band just outside the
  element), full for the selection and for targets. The one element selected shows its handles; among
  several, dots at their key points. What is not made yet is dashed and dark. Selecting never moves the
  map; Zoom to does.
- **Clicks**, no tool on: the topmost element; the same place again, the next one down.
- **Dragging** a selected element moves it (several together); one undo step; Esc puts it back;
  positions snap (Alt: free; Shift: 15° steps). **Handles**: a round part's radius; a sector's two
  ends; the stalk (bearing); an outline's corners (resize, the opposite kept; Shift: proportions; Alt:
  the centre) and sides; a line's vertices and ends (an end on a point's centre moves the point) and a
  **+** halfway along a leg; an area's corners and a **+** on each edge; a label's text and, free or
  on a line, its point. Outlines drawn enlarged are only moved.
- **Display only** (never in lengths or exports): **Offset**, a line drawn beside itself (−50 to 50
  px, as QGIS offsets a line symbol; ⇉ in the tree), and the enlarged small shapes. Names collide
  away; labels are always drawn.

## 8. Keys

| Key | Does |
|---|---|
| / | search |
| L, E | the left panel on Layers, on Elements, or closed |
| I | Properties on or off |
| P, G, S, T, M | point, line, shape, label, measure |
| a tool's key again | its next kind |
| B, Shift-drag | Box select: a box, what lies inside added to the selection |
| Enter, double-click | finishes |
| Backspace | takes back a point |
| Esc, right-click | steps back one level |
| ↑ ↓ | previous, next element in the tree |
| Delete (Mac: also ⌘ Backspace) | deletes the selection |
| F2 | rename |
| Ctrl/⌘ Z, Ctrl/⌘ Shift Z (or Ctrl Y) | undo, redo |
| Ctrl/⌘ C, V, D | copy, paste, duplicate |
| Ctrl/⌘ ], [ | the selection up or down in the drawing order |

None act while typing in a field, except Esc and Enter. About lists them from `site/keys.js`.

**Copy, paste, duplicate:** a copy keeps its group, look and properties, gets new numbered names and
keeps the attachments between the elements copied together (an end on one left behind is free). Paste
puts its middle at the pointer; Duplicate 20 px beside. One undo step; the copy selected. The clipboard
lives in this page, so it pastes into another drawing opened in it.

## 9. Presets

**Save as preset…** (a point's Properties) keeps its symbol, parts, fill and stroke under a name. One
with parts joins Shape's kinds, one without Point's. Placing one makes a point named after it, with
the preset's name as a property; a right-click on it among the kinds renames or deletes it. Presets
live in this browser only; **Download** › **Presets (JSON)** and **Open a file…** move them.

## 10. Deleting, and drawings in this browser

- Delete goes at once (Undo brings it back). Lines attached to what goes stay, their ends free
  where they were; labels on it stay, free. A group with members asks first: the group only (what is
  in it goes to the group above), or everything in it.
- Each drawing is saved as it changes, never sent anywhere; the open one comes back with the page.
  **Open** lists the drawings in this browser (last change, size): a click opens one where it was
  drawn, a bin deletes it for good (asked first); **+ New drawing** adds one.
- When the browser refuses to save, Properties says so (Download › Drawing keeps it as a file); when
  another tab saved the same drawing, it says so, with **Reload**.
