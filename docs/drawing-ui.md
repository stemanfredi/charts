# Tools: the interface

How drawing and measuring look and behave. The file is in `drawing-format.md`.

Code: `site/draw/` (`panel.js` the panel, `drawing.js` the map side, `snap.js`, `attach.js`,
`drag.js`, `features.js` what the map draws and its handles, `generator.js` Distribute along and Connect,
`clipboard.js`, `presets.js`, `place.js` what Point and Shape place),
`site/keys.js`.

## 1. The rail and the panel

- The rail on the right: **Layers**, **Tools**, **Import**, **Export**, **About**. Layers and Tools
  switch the one side panel. The Tools panel is 400 px wide on a desktop, Layers 340. Addresses with
  `menu=draw` open Tools.
- **Import** picks a `.geojson` or `.json` file. A drawing's file (or any GeoJSON) gets a report: what
  it holds, what was skipped and why, the warnings; **Import** adds it to the drawings in this browser
  and opens it with its view. A presets file adds its presets instead (§9).
- **Export** is a menu: **Copy link** (the view and layers, and the display settings: units `u=nm`,
  bearings `brg=1`; never the drawing), **Picture (PNG)**, **GIS data (ZIP)**, **Drawing (GeoJSON)**
  (the file, with the view), **Presets (JSON)**.
- Units (km or NM) are switched beside the scale; bearings beside lengths in the drawing's **Display**
  (§5). Both apply to every value shown.

**From 1024 px wide**, while Tools is open, three things, side by side:

- the **Elements** panel on the left (§4), under the search; its toggle (a panel icon) is at the
  top of the tool strip and in its own head, and **E** works too; it starts closed, and whether it is
  open is remembered in this browser;
- the **tool strip**, a column of icons beside the Tools panel: the Elements toggle, the tools that
  make, Select, Undo and Redo; a tool's kinds open in a column to its left, level with its top;
- the **Tools panel**, the inspector only (§5): its title row says what it shows ("Line · Line 1",
  "3 elements selected", "Drawing") and holds the actions on it: **Zoom to**, **Duplicate**,
  **Group**, **Delete** (with nothing selected, Zoom to the whole drawing). A tool on changes none of
  it. Under the inspector, a note says for a few seconds what just happened (with **Undo** where it
  applies).

**Narrower**, the Tools panel holds it all, top to bottom: the tools row, the sub-rail of the tool
on, the list, a divider (dragged, or ↑ ↓ when focused; its place remembered in this browser), the
inspector, and the note; its header has **Undo**, **Redo** and the compact button.

**Compact** (narrower than 1024 px): only the tools, the list and the inspector folded away. A tool
started makes the panel compact and its end makes it whole again (Label keeps it whole: a label's
text is typed in the inspector); a button switches by hand: whole, in the panel's header; compact,
at the start of the tools. The tools and the kinds are rows, each one line, scrolled sideways on a
phone; compact, the tools hold everything, in groups set apart by dividers: the button back to the
whole panel, the tools that make, Select, Undo and Redo.

**On a phone** the panel is a sheet at one of three heights: compact, half the screen, or full (as
tall as its content, up to 85 %). Its handle dragged up or down moves one height; down from the lowest
closes it. Something selected on the map while only the tools show raises it to half. Zoom to and a
place found are fitted to the part of the map the panel leaves free.

**With a finger** (any screen): a row under the tools with **Done** (a line or polygon being drawn), **Back** (what is half drawn, else the
tool, else the selection), **Delete** and **Duplicate** (with a selection), **Snap** (while a tool is
on; off places exactly where tapped, as Alt). Handles are drawn at 14 px and grabbed within 22 px;
snapping reaches 16 px; a + is added only along legs over 80 px; a second finger during a drag puts
it back and lets the map pinch.

## 2. Tools

The row: **Point** (P), **Line** (G), **Shape** (S), **Label** (T), **Measure** (M), then, after a
divider, **Select** (A: Select area, a box dragged on the map). **Undo** and **Redo** (greyed when
there is nothing to undo or redo) are in the panel's header. One tool is on at a time; it stays on after
each placement. A tool's button pressed again turns it off. A tool's key works from anywhere and
opens the panel (not on a phone).

A tool with two or more kinds shows them in a **sub-rail** under the row, as icons with tooltips. The
tool remembers the kind chosen last; its key pressed again, while it is on, moves to the next kind.

| Tool | Kinds | Makes |
|---|---|---|
| Point | symbol, then the user's presets without extent | a point with a symbol: a marker, the same size at every zoom |
| Line | none | a line (Guide is a switch on any element, §5) |
| Shape | circle, rings, sector, rectangle, ellipse, triangle, polygon, aerial vehicle, surface vehicle, underwater vehicle, then the user's presets with extent | see below |
| Label | none | a label |
| Measure | distance, area, ring | a guide showing its values (§3) |

- **Shape**: built-in presets, as the user's are (`place.js`): a circle (1 km), rings (1, 2 and 3 km,
  the first filled), a sector (three clicks, below), an outline to scale about a centre (100 × 50 m;
  a triangle 100 m a side); and a polygon (an area, drawn corner by corner). Each is a point with its
  parts (circles, sectors, outlines) and no symbol, named after what it is ("Circle 2"), the preset
  it came from kept as its property `preset` ("Rings").

### 2.1 Placing and drawing

- **Point**: a click places one where it snaps, and selects it.
- **Shape**: the centre, then its size, shown as the pointer moves. It faces north: its bearing is
  a second step (the stalk beyond a sector's arc or an outline's front, or Bearing in the inspector;
  a circle or rings have no bearing), so that it does not swing while it is sized. The second click sets its largest part's reach, every part scaled with
  it: a circle's radius; rings' outermost (the others at a third and two thirds of it); an outline's
  front (half its length, its width in proportion: 100 × 50; a triangle equilateral). The second
  click on the first places the default size. A preset of the user's keeps its size: one click
  places it. Exact sizes are typed in the inspector.
- A tool's button pressed from the keyboard places a point, a shape (at its default size) or a label
  at the map's centre.
- **Line**: the first click is its start; each click after adds a vertex. A click on something a line
  can attach to ends it there, attached (not on its own start with nothing in between). Enter or a
  double-click ends it at the last vertex, free. Backspace takes back the last vertex (with none, the
  start). The snap marker shows what a click would attach to.
- **Polygon** (Shape): a click per corner; Enter or a double-click closes it (three corners at least).
- **Sector** (Shape), in three clicks: the centre; the radius and one edge; the other edge, clockwise.
  Esc or **Back** goes one click back. A third click back
  on the first edge makes a full circle.
- **Label**: a click points a new label at what snapping finds there (a point's centre, a vertex, a
  place on an edge or a line's leg); else on an area, at its centre; on a line, where it is clicked;
  elsewhere, free text there. Its text is selected, ready to type.
- **Values while drawing:** every line, polygon and shape being drawn shows its values on the map, as
  a measurement does: each leg's length, the total, an area and perimeter, a radius.
- **Exact legs are typed after drawing,** in the inspector: each leg's length and bearing in the
  line's vertex table, each edge's in the polygon's corner table (§5). Nothing is shown beside the
  search while drawing: what is drawn shows its values on the map, and what is dragged shows its
  values while it moves.
- **Shift** turns the leg being drawn in 15° steps from the leg before (from north for the first, and
  for a sector's edges). **Alt** places freely: nothing snapped, nothing attached.
- Esc or a right-click (not a right-drag) drops what is half drawn; else ends the tool; else cancels
  **Attach to…** waiting for a click; else clears the selection (the Tools panel open or not).

### 2.2 Snapping and attaching

Clicks and drags snap to what is drawn within **6 px** on screen. The nearest target of the first
kind found wins, in this order: a **vertex** (a point's centre, a corner of an outline or of an area,
a line's vertex or free end), a **crossing** of two edges or legs, an **edge** (of an outline or an
area, or a line's leg). Hidden elements are not snapped to. The target is marked: a ring on a vertex,
a cross at a crossing, a dot on an edge. While the Line tool is on, every point and free end is
ringed, and every vertex with a smaller ring.

A line's end attaches to what it snaps to, and follows it from then on (a label's anchor points the
same way):

- a point's **centre** (never its round parts: a circle's line goes to its centre);
- a **vertex**: a corner of an outline or an area, another line's vertex;
- a place along an **edge** of an outline or an area, or along another line's leg (as drawn, curves
  included): it turns and stretches with it, and no vertex is added (an ellipse has no corners, only
  its edge);
- another line's **free end**: a small dot point is made there, and both ends attach to it.

A crossing gives a position only. An end whose target goes is free where it was; when vertices are
added to or taken from what it is on, it stays where it was (the nearest vertex, or edge).

## 3. Measure

Measure is a shortcut: its kinds are the drawing's own tools with **Guide** and **Show values** ticked.
**Distance** is the Line tool (its ends attach as a line's do), **Area** the Polygon, **Ring** a circle
in two clicks (the centre, then the edge; the centre again: 1 km). The result is an ordinary element:
a line "Distance 1", an area, a point "Ring 1" with one circle and no symbol, drawn in Measure's
colour (magenta, dashed). Unticking Guide makes it part of the drawing. There is no Measure apart
from this: its values are the drawing's own (§2.1, Values while drawing).

## 4. The list

- The list's head: **Elements**, an eye for every element listed (all shown: a click hides them all;
  else it shows them all), and from 1024 px wide the panel's toggle.
- One row per element: a group's fold, an icon, the name, a short value, and an eye at its end
  (crossed when hidden; with a mouse, a shown element's eye appears on the row pointed at or
  selected). The list is a tree: a group, then its subgroups and members one step further in; a
  group folds open and closed. At the top, the groups, then the rest. Deleting is the title row's
  or the Delete key's, not the row's.
- Names and icons say what an element is: a point is a **Point**, **Circle**, **Rings**, **Sector**,
  or its outline's name (**Rectangle**, **Ellipse**…); an area is an **Area**; then **Line**,
  **Label**, **Group**. An unnamed one shows as its kind and place.
- The value: a shape's size ("shown ×7.0" when drawn enlarged), its first filled round part's radius (and a
  sector's aperture), an area's area, a line's length ("guide" when it is one), a label's text, a
  group's count of elements (everything in it, its subgroups' too; the whole count in its tooltip).
- **Select** (the tool, A): drag a box on the map: what lies entirely inside is selected, a point by
  its centre, a shape by its whole outline; Shift adds; Esc or a right-click ends it.
- Past 30 elements a filter appears (names and property values), with **Select all shown** (Shift:
  adds).
- A row selects on the map, and the reverse (the list scrolls to it); hovering a row outlines the
  element. Shift-click selects a range, Ctrl/⌘-click adds or removes. Double-click a name, or F2, to
  rename; ↑ ↓ move the selection.

## 5. The inspector

It shows what is selected: one element, several, or nothing (the drawing). A field applies on Enter
or when it loses focus, one undo step; a value that does not read stays marked and is not applied;
Esc in a field puts its value back.

**Common parts**, in this order: the header (kind · name, **Zoom to**; from 1024 px wide, the panel's
title row instead, §1); **Name**; **Group** (none, or a group,
shown with the groups it is in, "A › B"; a group never offered to itself or a group inside it; **New
group…**: a group of it in the group it is in); what it is (below); **Look**; then **Guide** (drawn
faint and dashed, left out of the totals; on points, lines and areas), **Visible**, **Delete** (from 1024 px wide, the title row's). Near the foot, **Data**: its
properties, keys and values (a description, a category: properties like any other), a list whose
empty last row ("add a key…") adds one. Folded while it has nothing of the user's (the arrow by its
heading opens it); a point placed from a preset says so under it ("from preset Rings").

**Lists** (parts, vertices, corners, data): fixed columns, the first ones kept
in place while a wide list scrolls sideways; a row clicked or typed in is the current one, its
actions in a bar under the list (Insert after, Delete, Split, Distribute along it…), and on keys
(Insert, Ctrl/⌘ Delete); ↑, ↓ and Enter go to the same column in the row above or below. **Copy** on
a list's heading puts its rows on the clipboard, tab-separated, a header first, every column (metres
and degrees), for a spreadsheet. Places pasted into a vertex's or a corner's latitude (several lines,
a latitude then a longitude on each, in any format a coordinate field reads; a copied list's Lat and
Lon columns) replace the places from that row on, in one undo step: past the last one the line or
area grows; an attached end is never moved (the paste stops before it); a line not read leaves it all
as it was. The note says what was done. A line's free start and end have their own latitude and
longitude in its list.

**Look**, one section for one element, several, a group or the drawing, showing only the fields their
kinds have: **Fill** (colour, opacity; not on lines); **Stroke** (colour, opacity; width, dash);
**Text** (labels: size S, M, L; colour on Halo or Box); **Name on the map**; **Show values** (its
lengths, area and perimeter, or radii on the map); **Offset** (lines; §7);
**Min. size** (shapes: drawn enlarged, dotted, when shorter than this on screen). A field shows what
they are drawn with; where several differ it says "mixed", and a change writes only that field.

**Rows**: a property grid, ruled across the panel, 28 px with a mouse (44 with a finger): each a
label, one value or a pair read as one (latitude · longitude, colour · opacity, start · end…), and a
last column for × or ↺; a row never wraps. A field shows no box until it is pointed at or typed in;
lists are tables of the same cells. In a value row
↑ and ↓ nudge a distance, an angle or a number by one unit of its last digit (Shift: ten), each step
applied.

**The cascade:** an element is drawn with its own value where it has one, else its group's, else that
group's group's, and so on up, else the drawing's (its Display), else the default; a group likewise.
**↺** beside a field gives it back to the group (or the drawing). A hidden group hides everything in
it.

- **Point:** Position, Bearing (its outlines' front, its sectors' centre), Symbol (diamond, square,
  triangle, dot, none: with none and no outline a small dot still marks the centre), then its
  **Parts**, always its own, a list: each its place, its kind (circle, sector, an outline; changing it
  keeps its reach), its size (a radius, a sector's with its aperture; an outline's length × width, its
  area in the tooltip), **Fill**, **Shown**, its own stroke colour and dash, a name. The empty last row
  ("add a part…") adds one (a round one twice the last round one's radius); its bar: **Distribute
  along it…**, **Delete**. When outlines are drawn enlarged, it says so.
  With parts: **Distribute along…** (§6). Then **Save as preset…** (§9).
- **Area:** area and perimeter; its corners (latitude, longitude; from corner 2 on, the **Edge** from
  the corner before, its length and bearing: typed, that corner and those after it move together, the
  closing edge following; its bar: **Insert after** (halfway to the next), **Delete** (while more than
  three are left)).
- **Line:** **Start** and **End** (attached: what to, and which vertex or edge, with **Attach to…**
  (the next click on the map chooses again; Esc or a right-click cancels) and a broken link, which detaches it: the end stays
  where it is; free: its position, and **Attach to…**); Length (the drawn line's, curves
  included) with **Distribute along…** (§6); **Depth profile** (pressed: the depth along
  the line, as the depth shading has it (GEBCO, cut to the coast), sampled at the grid's spacing, at
  most 1,000 places; the shallowest and the deepest; a chart whose place pointed at shows on the map,
  and the line pointed at on the map shows on the chart; its length along the seabed, a lower bound;
  **CSV**); Curve (**Smooth**, **Straighten**); its vertices (latitude, longitude; the **Leg** from the place
  before, its length and bearing, typed: that vertex and those after it move together, the legs after
  it unchanged, an attached end staying attached; name, distance along;
  its bar: **Insert after** (halfway to the next), **Delete**, **Split** (the vertex becomes a point both
  parts attach to)), with
  **Handles** for each vertex's curve (metres east and north, in and out).
- **Label:** Text, with **Insert** for the live values that apply to what it points at: name, length,
  distance along, bearing, radius, area, perimeter; **Attached to** (a link, which vertex or edge)
  with **Attach to…** and the broken link (detach), as a line's end; Along (typed) for a label on a line, or the
  position of a free one; **Leader**
  (Arrow, Dot, Line, None); its Look; Placement and **Reset**.
- **Group:** the group it is in; Members (its own, and how many groups in it; **Select members**
  selects everything in it, its subgroups' too), **Shown** (one box for everything in it, as the list's header), Totals (everything in it); a rule's
  group, **Made by** (§6); its Look, which everything in it takes unless it sets its own. A group
  has no parts: those are each point's own.
- **Several:** the count, **Zoom to**, chips (one per element, a click selects it alone, × takes it
  out; past 12, "+N more"), the kinds selected; two points give the distance and bearing between
  them; **Connect…** (two or more points, §6), **Group** (a new group of them, in the nearest group
  they are all in: a subgroup of it; a group among them goes in whole), the group menu, the labels'
  Leader, one Look for all of them, Visible, **Delete all** (from 1024 px wide, Zoom to, Group and
  Delete are the title row's, §1).
- **The drawing** (nothing selected): Title, Description, Author; **Drawings in this browser** (§10);
  **Display**, the drawing's look, which every element takes unless it or a group sets its own:
  Names on the map, Offset (and where Offset is set otherwise, each a link), Min. size; then Bearings beside lengths, for values shown;
  **Totals**, a table in three sections: **Lines** by group (or **By** any property key the drawing
  uses, one row per value and one for those without it), each line listed under its group with its
  length, but for the lines a connection made, which are summed by what they are (a tree's trunks,
  root → hub, and branches, hub → point; a chain's root → first point links and its links between
  points); a group's row folds its lines; then **Areas** (area and perimeter each, and in all) and
  **Points** (by kind). A name selects the element. **Copy** gives every row tab-separated, in
  metres, for a spreadsheet. Guides and measurements are left out; hidden elements are counted and
  said so.

## 6. Distribute along and Connect: rules

Both are **rules** (`generator.js`): what they make stays linked to them, follows what it was made
from, and can be edited again. What a rule makes is in a group of its own; anything it made (a copy,
a hub, a line, its groups) shows a first row in its inspector, **Made by** ("Distribute along Line 2 ·
12 copies, connected to 1 root") with **Edit…** (its form) and **Select all** (everything it made).

**Distribute along…** opens a form in the inspector, headed **Distribute along** and the name of what
it is along: a line, or a point, round one of its parts (**Part**, when it has several; to start with,
its first filled round part), clockwise: a circle's whole round from its bearing, a sector's arc from
one end to the other, an outline's ring.

- Settings: **By** spacing or count; **Margins** at the start and the end (not round a whole part);
  **Offset** to the left, the right or alternating (Out, In, Alternate round a part); **Copy**: what
  each copy is, a built-in kind (a circle to start with: a point with a diamond and one circle) or a
  preset of yours; **Radius**, the copies' reach, apart from the spacing (500 m to start with; they
  may overlap; a preset of yours keeps its size, shown); **Sector** (the circle only) none, 90°, 180°
  or 270°, facing away from the line or outwards; **In group** (where its own group goes: at the top
  to start with).
- It makes its own group, "Distribute along" and the name, holding **Copies** and, when connected,
  **Connection**: each looked at, hidden or styled apart.
- **Connect to roots**, in the same form: **Tree · Chain** (Tree: root → hub → each point; Chain:
  root → point → next point; Tree to start with); **Group size** Auto (any size: the cheapest cut,
  trees of up to 32 points) or Set, a number (3 to start with; a tree's up to 32); **Min. branch** (Tree only: 0 m to
  start with; every hub at least this far from its points and from its root; at 0 a hub may sit on a
  point, a branch of 0 m, and can be dragged off it); **Roots**, listed with a **weight** each (1 to
  start with), × dropping one. While roots are picked the cursor is a crosshair, where a click places
  a new root (made with the rest), or a pointer over a point, which a click takes as a root or drops.
  The plan: the points, in order along the line, are cut into groups of consecutive points, each
  joined to one root, the cut and the roots chosen together as the cheapest: the sum of the groups'
  lengths, each divided by its root's weight (a root weighted 2 wins groups as if it were half as
  far); a tie goes to the cut whose largest group is smallest. The summary says the trees or chains and their sizes, the
  roots used and the total length of the lines; a root that wins no group is reported unused.
- A faint preview shows the copies, the lines and the roots (ringed) as the settings change.
  **Create** makes it all in one undo step and selects its group (another selection closes the
  form). The copies follow what they lie along; hubs follow their points; one moved by hand stops
  following.
- **Edit…** opens the same form, headed **Edit, distributed along** and the name. The same count
  moves the copies and makes each the rule's again, but one changed by hand (its parts or symbol): it
  keeps its own, and its inspector offers **↺** for the rule's. Another count makes them anew (it
  warns first), and their connection with them. A changed connection is made again; unticking Connect
  removes its lines and hubs (the roots stay).
- **Connect…** (two or more points selected, placed by hand): the Connect half alone, the points taken
  in the order selected; its lines, hubs and new roots go in a **Connection** group in the points'
  group. **Edit…** makes it anew; lines edited by hand are replaced (Undo brings them back).
- **Inflate**, on the **Made by** row of anything a tree connection made: a slider, 0 to 100 %, drawing
  its trees bowed, display only (§7): each branch bows away from its hub's dominant direction (the
  mean of its branches'), the more the farther off it heads, one along it staying straight; the trunk
  arrives at the hub along that direction. Lines, hubs and points stay where they are; a line edited
  by hand (a vertex added) is drawn as it is. Live while the slider moves, one undo step when let go.
- **Deleting a root** makes its connection again with the roots left, in the same undo step as the
  delete; deleting the last one removes the connection's lines and hubs (the copies stay). A root
  moved by hand: its lines and hubs follow; nothing is planned again until Edit….

## 7. On the map

- **Selection:** the one element selected shows its handles, its own stroke untouched (what one
  aligns to); a point a small white dot at its centre. Among several selected (a group, Select all),
  each shows such dots at its key points instead of handles: a point's centre, an outline's or an
  area's corners, a line's ends and vertices. Hovering a row shows a yellow band just outside the
  element (a point's outermost round part, or its largest outline; both sides of a line; a ring
  round a point's centre). Selecting never moves the map; Zoom to does.
- **Clicks:** with no tool on, a click selects the topmost element; the same place again, the next
  one down. Shift or Ctrl/⌘-click adds or removes.
- **Dragging** (select first): a selected element moves, or several together; labels alone move their
  text. Each drag is one undo step; the element dragged shows its values while it moves; Esc during it
  puts everything back.
  Dragged positions snap (Alt: free; Shift: 15° steps where there is a leg before).
- **Handles:**
  - a **radius** (a circle's four, at its cardinal points; a sector's one at the middle of its arc):
    sets that part's radius only;
  - a **sector's two ends**: each moves alone, the other kept, the point's bearing their middle (Shift: 15° steps);
  - the **stalk** beyond a sector's arc, or beyond an outline's front: turns it (its bearing; Shift:
    15° steps);
  - an outline's four **corners**: resize it, the opposite corner kept (Shift keeps proportions, Alt
    keeps the centre; on a point with other parts, always the centre); the middle of each **side**:
    moves that side alone, the opposite one kept (Alt: the centre kept); outlines drawn enlarged are
    only moved;
  - a line's **vertices** and **ends**: an end attached to a point's centre moves the point; any other
    end moves itself and attaches where it is dropped; a **+** halfway along a leg adds a vertex;
    with Handles on, each curve handle;
  - an area's **corners**, and a **+** halfway along each edge adds one;
  - a label's text (its offset) and, for a free label or one on a line, its point.
- **Display only** (never in lengths or exports): **Offset** (a line drawn this many pixels beside
  where it is, to the right of its direction, or to the left when negative, −50 to 50, as QGIS
  offsets a line symbol; a line or group setting it shows ⇉ in the list); **Inflate** (a connection's
  trees drawn bowed, §6); **Min. size** (a shape too small on screen drawn enlarged, dotted).
  Names on the map are left out where they collide; labels are always drawn.

## 8. Keys

| Key | Does |
|---|---|
| / | search |
| L, D | Layers, Tools |
| E | the Elements panel (from 1024 px wide) |
| P, G, S, T, M, A | point, line, shape, label, measure, select area |
| a tool's key again | its next kind |
| Enter, double-click | finishes |
| Backspace | takes back a point |
| Esc, right-click | steps back one level |
| ↑ ↓ | previous and next element in the list |
| Delete (Mac: also ⌘ Backspace) | deletes the selection |
| F2 | rename |
| Ctrl/⌘ Z, Ctrl/⌘ Shift Z (or Ctrl Y) | undo, redo |
| Ctrl/⌘ C, V, D | copy, paste, duplicate |

None act while typing in a field, except Esc and Enter. About lists them from `site/keys.js`.

**Copy, paste, duplicate:** Ctrl/⌘ C copies the selection (for a group, everything in it); Ctrl/⌘ V
pastes it with its middle at the pointer (else the map's centre); Ctrl/⌘ D duplicates it 20 px beside
itself. One undo step; the copy is selected. A copy keeps its group, look and properties, gets new
numbered names, and keeps the attachments between the elements copied together; ends attached to an
element left behind are free. The clipboard is kept in this browser, so it pastes into another drawing.

## 9. Presets

**Save as preset…** (a point's inspector) keeps what is drawn about it under a name: symbol, parts,
fill and stroke. A preset with parts joins the Shape sub-rail, after the built-in ones, one without
joins Point's; it becomes the tool's kind. Placing one makes a point with all of it, named
after it, with the preset's name as a property. A right-click on it in the sub-rail renames or deletes
it. Presets live in this browser only, never in a drawing's file; **Export › Presets (JSON)** and
**Import** move them to another browser (one of the same name is replaced).

## 10. Deleting, and drawings in this browser

- Delete goes at once; the note says so, with **Undo**. Lines attached to what goes stay, their ends
  free where they were (the note counts them). Labels on it stay, free where they pointed.
  Deleting a root of a connection makes the connection again with the roots left (§6).
- A group with members asks first: delete the group only (its members and subgroups go to the group
  above it, or to none, with their look), or the group and everything in it.
- Each drawing is saved as it changes, never sent anywhere; the open one comes back with the page.
  **Drawings in this browser** lists each (title, last change, size): a click opens it where it was
  drawn; **+ New** adds an empty one; × deletes for good, asked first.
- When the browser refuses to save, the drawing's inspector says so (Export › Drawing keeps it as a
  file); when another tab saved the same drawing, it says so, with **Reload**.
