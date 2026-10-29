# Drawing file format

Version 1 (reading and writing `site/draw/file.js`; the model `site/draw/document.js`; the checks
`site/draw/check.js`). The interface is in `drawing-ui.md`.

This is the contract between the app and anything that reads or writes its drawings: the app's own
Export, the copy kept in the browser, a GIS, and a file prepared by hand or by a script. §15 is a
short example; §16 lists every default.

## 1. The file

- A **GeoJSON FeatureCollection** (RFC 7946), UTF-8, extension **`.geojson`** (Import also takes
  `.json`). There is no other format of the app's own: any GIS reads the file as it is, and the app
  reads any GeoJSON (§11).
- One drawing per file: its elements (measurements included: they are guides showing their values),
  its groups, its rules (what Distribute along and Connect keep linked), and the view it was made in.
- Each element is a Feature with its real geometry. Its name and its properties (a description, a
  category: properties like any other) are plain GeoJSON properties, its colours in the common style names where they exist.
  Everything else that is the app's is under one property, **`charts`**. The drawing's own (version,
  times, title, view, look, groups, rules) is a foreign member `charts` of the collection.
- The reader is forgiving: missing fields take their defaults, wrong values are repaired or skipped
  with a warning (§11, §12). The writer leaves out every value equal to its default (§9).

## 2. Conventions

| What | How |
|---|---|
| Position | `[longitude, latitude]`, WGS 84 decimal degrees. −180 ≤ lon ≤ 180; \|lat\| ≤ 85.05112878 (the map's limit). A third value (altitude) is dropped. |
| Distance | metres. |
| Angle | degrees clockwise from **true** north, 0 ≤ a < 360. The reader normalises any finite value (`-90` → `270`, with a warning). |
| Colour | `"#rrggbb"`, read in either case, written in lower case. Opacity is separate, 0–1. |
| Stroke width | screen pixels, 0.5–20. |
| Text | any string, kept verbatim, never interpreted. |
| Time | ISO 8601 in UTC, whole seconds: `"2026-10-22T09:30:00Z"`. |
| ID | string, 1–64 characters from `A–Z a–z 0–9 _ -`, unique across the whole drawing (elements, groups and rules alike). A part has none: it is named by its place in its point's list. |

The app makes random 8-character IDs. Any unique IDs will do (`a`, `l1`, `p-main`); the app keeps
them. A feature's `id` given as a number is read as text.

**Order matters.** The order of the features is the order in the panel and the drawing order within a
kind: the first on top (areas among areas, lines among lines, points' shapes among points'). Between
kinds the stacking is fixed (drawing-ui.md §7). The writer writes points, then lines, areas and labels.

## 3. The collection

```json
{
  "type": "FeatureCollection",
  "charts": {
    "format": "charts-drawing",
    "version": 1,
    "created": "2026-10-22T09:30:00Z",
    "modified": "2026-10-22T10:02:11Z",
    "meta": { "title": "", "description": "", "author": "" },
    "view": { … },
    "look": { "text": { "name": true }, "offset": 3 },
    "groups": [],
    "rules": []
  },
  "features": []
}
```

| Field | Notes |
|---|---|
| `charts.format` | `"charts-drawing"`. Written, not checked. |
| `charts.version` | `1`. A file of another version is refused (§12). Missing (or not a number): read as this version. |
| `charts.created`, `charts.modified` | missing or not a time: the time of import |
| `charts.meta` | three free-text fields |
| `charts.view` | §4. Missing: importing leaves the map's view and layers as they are. |
| `charts.look` | the drawing's look (§6): `text.name`, `offset`, `minSize` only, what every element takes unless it says otherwise; any other field is ignored (warning) |
| `charts.groups` | §7.1 |
| `charts.rules` | §8 |

Without a `charts` member the file is still read: it is plain GeoJSON (§11).

## 4. View

```json
"view": {
  "center": [12.5, 41.9],
  "zoom": 7.25,
  "bearing": 0,
  "layers": [ { "id": "…", "variant": "…", "period": "…", "opacity": 0.8 } ],
  "data": { "colour": { "id": "…", "variant": "…" }, "arrows": null, "time": "2026-10-22T09:00:00Z", "depth": 0 },
  "units": "km",
  "bearings": false
}
```

| Field | Notes |
|---|---|
| `center`, `zoom`, `bearing` | the map's view; `zoom` 0–24; `bearing` the map's rotation (0: north up) |
| `layers` | the layers shown, by the app's layer ID; `variant`, `period` and `opacity` (0–1) only where that layer has them |
| `data` | the data layers chosen: what draws colours and what draws arrows (`{ id, variant }` or `null`), the hour shown, and `depth` in metres (one the app offers) |
| `units` | `"km"` or `"nm"` (nautical miles) |
| `bearings` | whether each leg's bearing is shown with its length |

An unknown layer, variant, period, data entry or depth is skipped with a warning.

## 5. Every feature

```json
{
  "type": "Feature",
  "id": "l1",
  "geometry": { "type": "LineString", "coordinates": [[12.4, 41.9], [12.5, 41.88]] },
  "properties": {
    "name": "Line 1",
    "description": "…",
    "ref": "7",
    "stroke": "#1f77b4",
    "stroke-width": 3,
    "charts": { "kind": "line", "group": "g1", "look": { "stroke": { "dash": "dashed" }, "text": { "values": true } } }
  }
}
```

**`id`** is the element's ID.

**Plain properties**, the ones any GIS shows as columns:

| Property | Notes |
|---|---|
| `name` | free text |
| its properties | one column each, in their order, values as text (a description, a category: properties like any other; the totals can count by any key). A key equal to one of the names in this table, or `charts`, is written `p_<key>`; a repeated key `<key>_2`, `<key>_3`… |
| `stroke`, `stroke-width`, `stroke-opacity` | the element's own stroke colour, width and opacity (§6) |
| `fill`, `fill-opacity` | the element's own fill (points and areas) |

Only the element's **own** values are written here: a value it takes from the drawing is not (§6).

**`charts`**, the app's own:

| Field | Notes |
|---|---|
| `kind` | `"point"`, `"line"`, `"area"` or `"label"`. Always written. On reading only `"label"` matters (a `Point` geometry is then a label); otherwise the geometry decides. |
| `group` | the ID of its group, at most one |
| `visible` | `false`: hidden. Hidden elements are not drawn and not exported to GIS data, but they are in the file. A hidden group hides its members. |
| `guide` | supporting geometry: drawn faint and dashed in one colour, left out of totals (not on labels). A guide showing its values is a **measurement**. |
| `look` | the rest of its own look (§6), what no common style name holds: the stroke's `dash`, `text`, `offset` |
| `properties` | the user's properties as `[{ "key", "value" }]`. Written only when a key had to be renamed as a column; the reader then takes this list rather than the columns. |

## 6. The look, the cascade, parts

### The look

How an element is drawn is its **look**: one object, every field optional where it is set.

```json
{ "fill": { "color": "#e8590c", "opacity": 0.15 },
  "stroke": { "color": "#e8590c", "opacity": 1, "width": 1.5, "dash": "solid" },
  "text": { "name": false, "values": false, "size": "medium", "color": "#1f2933", "background": "halo" },
  "offset": 0,
  "minSize": 12 }
```

| Field | Notes |
|---|---|
| `fill`, `stroke` | colours `#rrggbb`; opacities 0–1; width 0.5–20 px; dash `"solid"`, `"dashed"` or `"dotted"`. Lines have no fill. |
| `text.name` | its name drawn on the map (points, lines, areas; a group's: everything in it) |
| `text.values` | its values drawn on the map: a line's legs, an area's area and perimeter, a point's round parts' radii |
| `text.size`, `text.color`, `text.background` | a label's text: `"small"`, `"medium"` or `"large"`; its colour; `"halo"` or `"box"` |
| `offset` | Offset: a line drawn this many pixels beside its geometry, to the right of its direction (negative: the left), −50 to 50; 0: on it. Display only, as QGIS offsets a line symbol. |
| `minSize` | screen pixels, 0–200: an outline whose long side is shorter than this on screen is drawn enlarged (display only, dotted); 0: always real size. The drawing's only. |

Where it is written: an element's colours, opacities and stroke width as the common style names
(§5), the rest in its `charts.look`; the drawing's in `charts.look` (§3: names on the map, offset, minimum size). Only what each sets itself.
A group has no look.

### The cascade

Each field an element leaves out comes from the drawing's (the three it has), else from the defaults (§16):

| Layer, from the top | |
|---|---|
| the element's own | |
| a guide's or a measurement's | a guide: faint and dashed; a measurement: magenta and dashed, its name not drawn |
| the drawing's (`charts.look`) | |
| the defaults | |

A label's colour, set nowhere, is `#1f2933`. `visible` is not part of the look: an element is drawn
only if every group it is in is visible.

A group is only who is in it: joining or leaving one, or a group deleted, changes nothing of an
element. Editing a group's look in the panel sets the value on each element in it (drawing-ui.md §5).

### Part entry

A point's parts (`charts.parts`), a list of entries, each drawn to scale about it:

```json
{ "kind": "sector", "radius": 5000, "aperture": 90, "fill": true, "shown": true, "name": "" }
```

| Field | Notes |
|---|---|
| `kind` | `"circle"`, `"sector"`, or an outline (§7.5) |
| `radius` | a circle's and a sector's, metres, above 0 and below 10 000 km |
| `aperture` | a sector's, degrees (above 0, below 360), centred on the point's `bearing`. Missing, or 360 or more: a circle (warning, but for exactly 360). |
| `length`, `width` | an outline's, metres, above 0: along the point's bearing and across it |
| `fill` | `false`: drawn as an outline only. Default `true`. |
| `shown` | `false`: kept but not drawn. Default `true`. |
| `name` | free text |

A part has no ID: it is named by its place in the list, from 1 ("part 2" in the report); references
name it from 0 (§7.4). A point keeps at most 100 parts (warning). An entry of an unknown kind, or whose size is not a distance in range, is
skipped (warning); the rest of the point loads. Only the sizes its kind needs are kept.

## 7. Elements

### 7.1 Group

Groups are not features: they are listed in the collection's `charts.groups`.

```json
{ "id": "g2", "groupId": "g1", "name": "Group 2", "properties": [], "visible": true }
```

`groupId` is the group it is in (groups nest; absent: at the top). `properties` is a list of
`{ "key", "value" }` here. A group has no look and no parts: those are each element's own (§6). A group without a valid, unused ID is
skipped; an element naming a group that is not there becomes standalone, a group so naming one goes
to the top, as does one that would be inside itself (warnings).

### 7.2 Point

A `Point` geometry. One position, and what is drawn about it:

```json
"charts": {
  "kind": "point",
  "bearing": 45,
  "symbol": "diamond",
  "parts": [ { "kind": "rectangle", "length": 400, "width": 150 }, { "kind": "sector", "radius": 5000, "aperture": 90 } ]
}
```

| Field | Notes |
|---|---|
| `bearing` | one for the point: its outlines' front and its sectors' centre |
| `symbol` | `"diamond"`, `"square"`, `"triangle"`, `"dot"`, `"none"`, drawn at a fixed screen size, never turned. Default: `"none"`, written only when it is another. A point from a feature without `charts` is a `"diamond"`. With no symbol and no outline a small dot still shows the centre; a point with an outline shows none. |
| `parts` | what is drawn about it to scale (§6, part entry), always its own; missing: none |
| `properties` | placed from a preset, the property `preset` names it (`"Rings"`, or one of the user's) |

Circles, rings, sectors and shapes are points: a point with one circle, several, a sector, an outline,
or any of them together. Its kind in the panel is its largest outline's, else Sector, Rings or
Circle by its round parts.

### 7.3 Line

A `LineString` geometry: its start, its vertices in order, its end. A line has one **leg** between each
two of these.

```json
"charts": {
  "kind": "line",
  "start": { "element": "a" },
  "end": { "element": "s", "vertex": 2 },
  "smooth": true,
  "vertices": [ { "name": "bend 1" } ]
}
```

| Field | Notes |
|---|---|
| `start`, `end` | what each end is attached to (§7.4); missing: a free end, where the geometry says |
| `smooth` | `true`: a smooth curve through its vertices; missing or `false`: straight legs |
| `vertices` | one entry per interior position of the geometry, in order: an optional `name`. Vertices have no ID. Written only when one of them has something; matched to the positions by order. |

**Legs.** A straight line's legs are the **geodesics** between its anchors (as the ruler draws
them). A smooth line's (with at least one vertex) are cubic Béziers in the map's projection (Web
Mercator) whose handles are worked out from the anchors (Catmull-Rom: at a vertex parallel to the
chord between its neighbours, a third of each leg; `site/draw/lines.js`), so the curve follows its
vertices. Lengths are always geodesic: a curve's is summed over close samples of it until the sum
settles. A curve is the line itself: its length, the values shown and the GIS export are the
curve's. Lengths are never stored.

The geometry holds the vertices only: other tools show a curved line straight through its vertices,
and its legs straight in longitude and latitude (§13).

### 7.4 References: line ends and label anchors

A line's end and a label's anchor point at a place on an element, the same way, and follow it:

| `start`, `end`, `anchor` | Points at |
|---|---|
| `{ "element": "a" }` | its centre: a point's position, an area's centroid, a line's middle |
| `{ "element": "a", "vertex": 2 }` | vertex 2: a corner of an area or of a point's outline; a line's place (0 its start, then its vertices, the last its end) |
| `{ "element": "a", "edge": 1, "at": 0.25 }` | a place on edge 1 (from vertex 1 to the next; an area's and an outline's close, a line's are its legs, as drawn), a fraction `at` (0–1, 6 decimals) along it, so that it turns and stretches with it |

A bare ID (`"a"`) is read as `{ "element": "a" }`. Indices count from 0. An area's corners are
counted in its own order (§7.6: the geometry's ring reversed when `reversed` is set). An outline's
corners are those of its silhouette in order (`site/draw/outlines.js`): a rectangle's front right,
back right, back left, front left; a triangle's apex, back right, back left. An ellipse's are the
samples of its curve: the app attaches to its edge. On a point with outlines, `"part"` says which
(its place in the point's `parts`); missing: its largest outline.

The position is written in the geometry too, so other tools see the line or the label where it is.
On reading, **the reference wins**: it goes where what it points at is, and the report counts the
line ends moved more than 10⁻⁶° ("the file was edited elsewhere"). One pointing at what is not in the
file, at a vertex or edge it does not have, or (a line's end) at its own line, is free where the
geometry says (warning). When vertices are added to or taken from what a reference points at, it
stays where it was: on the nearest vertex, or the nearest place on an edge.

### 7.5 Outline

An outline part (§6) of a point: `kind` one of `"rectangle"`, `"triangle"`, `"ellipse"`, `"aerial-vehicle"`,
`"surface-vehicle"`, `"underwater-vehicle"`; `length` (metres, above 0) runs along the point's
`bearing`, `width` (above 0) across it. Each kind is a fixed silhouette stretched to them; its points
are geodesic destinations from the centre and its edges geodesics. The triangle is isosceles, its
apex at the front. Drawn small, a point's outlines are enlarged together, by what its largest needs to
reach the minimum display size.

### 7.6 Area

A `Polygon` geometry: one ring, closed, at least three corners. Its edges are geodesics.

The ring is written **counter-clockwise**, as RFC 7946 asks. An area kept clockwise in the app is
written reversed, with `"reversed": true` in `charts`; the reader reverses it back, so corners keep
their numbers (§7.4).

### 7.7 Label

A `Point` geometry where the label points, with `"kind": "label"`:

```json
"charts": {
  "kind": "label",
  "text": "{name}\n{along}",
  "anchor": { "element": "l1", "edge": 0, "at": 0.5 },
  "offset": [40, -40],
  "leader": "arrow",
  "look": { "text": { "size": "large", "background": "box" } }
}
```

- **`anchor`:** a reference (§7.4): a point, a vertex, a place on an edge or a line's leg, an
  element's centre. Missing: a free label, at the geometry's position. A group or a label is not
  pointed at: the label is free where the geometry is (warning).
- **`text`:** free text; `\n` breaks lines. Filled in as drawn, in the display units (one that does
  not apply is left empty): `{name}` (the element's name); `{length}` (its line's length, or the
  side it is on); `{along}` (the distance along its line); `{bearing}` (the side's or leg's);
  `{radius}` (a point's filled radius); `{area}`, `{perimeter}` (an area's, a shape's outline's).
- **`offset`:** the text's centre, in screen pixels from the anchor (x right, y down; ±2000).
- **`leader`:** `"arrow"` (a line from the text to the anchor, an arrow head there) or `"none"`.
- **`look`:** its text's `size` (`"small"`, `"medium"` or `"large"`: 11, 13, 16 px), `color` (set
  nowhere: the drawing's, else the default) and `background` (`"halo"` or `"box"`), as
  any look (§6).

A label has no stroke or fill names in its properties, and no `guide`.

## 8. Rules

What the panel's **Distribute along** and **Connect** make are ordinary points, lines and groups. Their
rules, in the collection's `charts.rules`, keep the link to them so that they can follow and be made
again; each has a `kind`, `"distribute"` or `"connect"` (another: skipped, warning). Their IDs may name
elements deleted since: that is not an error, and such a reference is dropped at the next change.
They are checked loosely: one without a valid, unused `id` is skipped.

### 8.1 Distribute along

```json
{
  "id": "ar1", "kind": "distribute", "groupId": "g5", "copiesId": "g6", "along": { "element": "l9" },
  "count": 3, "startMargin": 500, "endMargin": 500, "offset": 200, "side": "alternate", "radius": 300, "aperture": 120,
  "points": [ { "pointId": "p20", "t": 0.060255231, "left": true, "pos": [12.4060243, 41.9018031] } ]
}
```

| Field | Notes |
|---|---|
| `along` | required: `{ "element" }`, the line the copies are placed along, or the point round whose part they are placed (`"part"`: its place; missing: its first filled round part, else its first), clockwise: a circle's whole round from its bearing, a sector's arc, an outline's ring. Without it the rule is skipped. |
| `groupId` | its own group ("Distribute along" and the name of what it follows), which holds `copiesId`, the group of its copies ("Copies"), and its connection's group |
| `spacing`, `count` | a copy every `spacing` metres from the start margin, or `count` copies evenly between the margins (round a whole circle: evenly, no margins) |
| `startMargin`, `endMargin` | metres left free at each end |
| `offset` | metres to one side |
| `side` | `"left"`, `"right"` or `"alternate"`, facing along the line (round a part, left is outwards) |
| `preset` | what each copy is: missing or `"circle"`, a circle of `radius` (a sector of `aperture`); another built-in kind (`"rings"`, `"rectangle"`…), its parts scaled so that the largest reaches `radius`; `"preset:<name>"`, one of the user's, kept in `copy` |
| `copy` | a user's preset as it was chosen: `{ symbol, parts }` (parts as a point's, §6), its size its own |
| `radius` | metres: the copies' reach, apart from the spacing; missing: 500 when they are made or edited again |
| `aperture` | the circle's sector, this wide, facing away from what it follows; missing: circles |
| `points` | each copy made: `t` its place along (0–1), `left` its side, `pos` where it was last put |

Each copy is an ordinary point: its symbol, parts and look are its own (§7.2). The
panel's **Edit…** makes each copy the rule's again, but one changed by hand (its symbol or parts no
longer the rule's), which keeps its own.

After every change, each copy still at `pos` is placed again along what it follows as it is now (the
same `t`, offset and side, facing away from it). One moved by hand stops following. A rule whose line
or point (or its part) is gone, or all of whose copies are, is dropped.

### 8.2 Connect

```json
{
  "id": "c1", "kind": "connect", "groupId": "g7", "pattern": "tree", "groupSize": "auto", "minBranch": 200,
  "roots": [ { "id": "o1", "weight": 2 } ], "pointIds": ["p20", "p21", "p22"],
  "hubs": [ { "pointId": "h1", "pointIds": ["p20", "p21", "p22"], "rootId": "o1", "pos": [12.45, 41.85] } ],
  "created": ["h1", "l40", "l41", "l42", "l43"]
}
```

| Field | Notes |
|---|---|
| `groupId` | its group ("Connection"), where its lines, hubs and new roots are: in the distribution's own group, or in the points' group for points placed by hand |
| `pattern` | `"tree"`: root → hub → each point; `"chain"`: root → the nearer end point → the next … Anything else is read as `"tree"`. |
| `groupSize` | points at most per tree or chain (an integer; a tree's at most 32), or `"auto"`: any size (a tree of up to 32) |
| `minBranch` | a tree's shortest branch, metres (0 when absent): every hub at least this far from its points and from its root |
| `roots` | the points the lines start from, each `{ "id", "weight" }`; `weight` above 0 (missing: 1, which is not written) |
| `pointIds` | the points connected, in the order they are cut into groups |
| `hubs` | each hub made: its point, its tree's points and root, where it was last put |
| `created` | what it made: hubs and lines (not its points or roots). Connect again removes these and makes them anew. |

Each line it makes is a plain line attached to the points it joins; what it is follows from its ends:
in a tree, a trunk (root to hub) or a branch (hub to point); in a chain, a root link (from a root) or
a link (point to point). A property `part` of `"trunk"`, `"branch"` or `"chain"` on them, which
earlier files have, is dropped on reading. The plan: the points, in order, are
cut into groups of consecutive points, each joined to one root, the cut and the roots chosen together
as the cheapest, the sum of the groups' lengths each divided by its root's weight (a tie: the most
even cut). Every tree has a hub of its own, never one of its points: where the median falls on a
point, its branch is 0 m long. After every change, each hub still at `pos` moves to the geometric
median of its points and its root (kept at least `minBranch` from each of them); one moved by hand
stops following. Deleting one of its roots makes it again with the roots left (one undo step);
deleting the last removes its lines and hubs (its points stay), and its group when nothing is left in
it.

## 9. Writing: only what differs

- Every value equal to its default (§16) is left out, and an object when nothing in it differs: a
  point that is only an ID and a position is written as `"charts": { "kind": "point" }`.
- Rounding: positions 7 decimals (about 1 cm); metres (radii, outline sizes, margins,
  offsets, a distribution's `spacing` and `radius`) 3; angles (bearings, apertures, the view's zoom) 4;
  opacities and widths 3; an edge's `at` 6; a copy's `t` 9.
  The reader takes any precision.
- The text is indented JSON, each position on one line.
- A drawing read back is the same drawing (tested in `test/unit/draw-document.test.mjs`).

## 10. In the browser

- Drawings are kept in the browser's local storage as the file's text, each under its own key
  (`charts.drawing.<id>`), with a small index (`charts.drawings`: title, last change, size) and the
  one open (`charts.drawings.current`). Nothing is sent anywhere.
- When the page opens, the open drawing comes back; its view too when the address has none.
- If the browser refuses to save (storage full or turned off), the panel says so, and Export keeps the
  drawing as a file.
- A drawing kept that this app cannot read (one of another version, §12) is left as it is, never
  saved over: a new drawing opens instead.

## 11. Reading: any GeoJSON, forgiving

The reader takes a FeatureCollection, a single Feature or a bare geometry.

- **Geometry:** `Point` → point (a label when its `charts.kind` is `"label"`), `LineString` → line,
  `Polygon` → area. Each part of a `MultiPoint`, `MultiLineString` or `MultiPolygon` is an element of
  its own: the first keeps the feature's ID, the others get new ones. A Polygon's holes are dropped
  (warning); a ring repeating its first corner at the end is read without the repeat.
- **Foreign features** (no `charts`): a point is a `"diamond"` with no parts; `name` is read from
  `name`, `Name` or `title` (on the app's own features only `name`: a user's property `title` stays
  one); the style from `stroke`, `stroke-width`, `stroke-opacity`, `fill`, `fill-opacity`;
  every other property becomes one of the user's, as text (numbers and booleans as written, objects as
  JSON).
- **Text for nested values:** a GIS may write `charts` back as a JSON string. It is parsed again, the
  collection's and each feature's, and so are `properties`, `start` and `end` within it.
- **IDs:** a missing, malformed or repeated ID is replaced by a new one (warning when it had one).
- **Repairs** with a warning: opacity clamped to 0–1, width to 0.5–20; angles normalised; an own
  colour that is not `#rrggbb`, or an unknown dash, dropped (the drawing's or the default applies); an
  unknown symbol, leader, size or background → the default; a sector without an aperture a circle (§6); a
  name or text given as a number or boolean made text; an unknown group → standalone. Clamped without
  a warning: a minimum display size to 200, a label's offset to ±2000, the view's zoom to 0–24.
- **Unknown fields are ignored** and not kept: writing again drops them. Data to carry goes into the
  user's properties.
- **Attached ends and anchored labels** follow what they are attached to (§7.4, §7.7).

The import report lists what was refused, skipped and repaired, before the drawing is added.

## 12. Reading: refusals and skips

**The whole file is refused** (nothing loads) when it is not JSON; its top level is not an object;
it is not GeoJSON; `charts.version` is a number other than 1; or its lines and areas hold more than
1 000 000 positions together.

**Limits:** past 20 000 elements the rest are skipped; a text is cut to 10 000 characters; past 200
properties on one element and 100 parts on one point the rest are dropped (each with a warning).

**One feature or element is skipped** (the rest loads; the report gives its ID and why) when it is not
a Feature; it has no geometry; its geometry is a GeometryCollection or of another type; a position is
not `[longitude, latitude]` or its latitude out of range (a longitude past ±180° is brought back); a line has fewer than two positions, or more than
100 000; an area fewer than three corners, or more than 100 000. A group or rule without a valid, unused ID is skipped, a rule of another kind, and a
Distribute along without `along`.

## 13. What other tools see

A GIS opening the file sees:

- points, lines and areas with their real positions, and labels as points where they point;
- the name and the properties as columns, and each element's own stroke
  and fill in the common style names (not a style it takes from its group or the defaults);
- each feature's `charts` property, usually as text; it is the app's and can be left as it is. The
  collection's `charts` (view, look, groups, rules) is ignored by most tools.

It does not see radii, sectors, outlines, symbols or a label's text placement (GIS data, §14, has them
drawn); legs as geodesics (a long east-west leg is drawn slightly apart: about 40 m at the middle of a
50 km leg at 40°N); or curves (straight through their vertices).

A file edited elsewhere and read back: attached ends move to what they are attached to (counted in
the report); vertex entries are matched to positions by order; a `charts` turned into text is read
again.

## 14. The GIS export

**GIS data** (a ZIP) carries the drawing's file itself as `drawing.geojson`, to import again, and
beside it `vector/drawings.geojson`: the drawing **as drawn**, for tools that know nothing of the app
(`exportFeatures` in `site/draw/features.js`).

- Only what is shown: hidden elements, members of hidden groups, hidden parts and labels on hidden
  elements are left out. Positions are not rounded.
- A point: a `Point`; each shown part a `Polygon`, with `part_name` and `filled`: an outline `kind`
  `"shape"`, with `outline`, `length_m`, `width_m`, `bearing_deg`, `area_m2`; a round part `kind`
  `"circle"` or `"sector"`, with `radius_m`, `area_m2`, and a sector's `bearing_deg` and
  `aperture_deg`. A circle reaching a pole is left out.
- A line: a `LineString` along its legs as drawn (geodesics and curves densified), with `length_m` and
  `seabed_length_m` (its length along the seabed, from the depths the depth shading draws: a lower
  bound; only for a line whose depth profile was opened as it is now drawn: an export reads no depths).
- An area: a `Polygon`, counter-clockwise, densified, with `area_m2` and `perimeter_m`.
- A label: a `Point` where it points, with `text` (values filled in, in the display units), `anchor`
  (the element's ID, or empty) and `along_m` on a line.
- Every feature has `kind`, `id`, `name`, `group` (the groups' names, outermost first, `A / B`),
  `guide: true` on a guide, then its properties as columns (a key equal to one of these fields
  gets `p_`, a repeated key `_2`, `_3`…). No style, no `charts`.

## 15. Example

A point with a 5 km sector, a rectangle outline, a line from the first's centre to a corner of the
second, an area, and a label along the line. Written by the app (`serialise`), then shortened only in
layout.

```json
{
  "type": "FeatureCollection",
  "charts": {
    "format": "charts-drawing",
    "version": 1,
    "created": "2026-10-22T09:30:00Z",
    "modified": "2026-10-22T09:30:00Z",
    "meta": { "title": "Example" },
    "view": { "center": [12.5, 41.9], "zoom": 9 }
  },
  "features": [
    { "type": "Feature", "id": "a",
      "geometry": { "type": "Point", "coordinates": [12.4, 41.9] },
      "properties": { "name": "A",
        "charts": { "kind": "point", "symbol": "diamond", "bearing": 45,
          "parts": [ { "kind": "sector", "radius": 5000, "aperture": 90 } ] } } },
    { "type": "Feature", "id": "s",
      "geometry": { "type": "Point", "coordinates": [12.6, 41.95] },
      "properties": { "name": "Rectangle 1",
        "charts": { "kind": "point", "bearing": 30, "parts": [ { "kind": "rectangle", "length": 400, "width": 150 } ] } } },
    { "type": "Feature", "id": "l1",
      "geometry": { "type": "LineString", "coordinates": [[12.4, 41.9], [12.5, 41.88], [12.5980106, 41.9487782]] },
      "properties": { "name": "Line 1", "ref": "7",
        "charts": { "kind": "line", "start": { "element": "a" }, "end": { "element": "s", "vertex": 2 } } } },
    { "type": "Feature", "id": "g1",
      "geometry": { "type": "Polygon", "coordinates": [[[12.5, 41.75], [12.55, 41.8], [12.45, 41.8], [12.5, 41.75]]] },
      "properties": { "name": "Area 1", "fill-opacity": 0.3,
        "charts": { "kind": "area", "reversed": true } } },
    { "type": "Feature", "id": "t1",
      "geometry": { "type": "Point", "coordinates": [12.429105, 41.8941893] },
      "properties": { "name": "Label 1",
        "charts": { "kind": "label", "text": "{name}", "anchor": { "element": "l1", "edge": 0, "at": 0.5 } } } }
  ]
}
```

The point `a` says its symbol, a diamond; the shape says none, so it has none (the default). Its
part has no ID: it is part 1 of `a`. The line's end is on vertex 2 (the back left corner) of the rectangle; its coordinates are where
that corner is. The area was drawn clockwise: its ring is written counter-clockwise and says so. The
label's geometry is half way along the line's one leg.

## 16. Every default

What a value is when the file leaves it out. Writing it with this value means the same.

| Where | Field | Default |
|---|---|---|
| collection | `charts` | none: plain GeoJSON |
| collection | `charts.version` | `1` |
| collection | `charts.created`, `charts.modified` | the time of import |
| collection | `charts.meta` | `{ "title": "", "description": "", "author": "" }` |
| collection | `charts.view` | none: the map stays as it is |
| collection | `charts.look` | `{}`: the defaults |
| collection | `charts.groups`, `rules` | `[]` |
| view | `center`, `zoom`, `layers`, `data` | none: the map's |
| view | `bearing`; `units`; `bearings` | `0`; `"km"`; `false` |
| feature | `id` | a new one |
| feature | `name` | `""` |
| feature | user's properties | none |
| feature | `stroke`, `stroke-width`, `stroke-opacity`, `fill`, `fill-opacity`, `charts.look` | none of its own: the drawing's, else the defaults below |
| feature | `charts.kind` | from the geometry |
| feature | `charts.group` | none |
| feature | `charts.visible` | `true` |
| feature | `charts.guide` | `false` |
| default look | fill | `#e8590c`, opacity 0.15 |
| default look | stroke | `#e8590c`, opacity 1, width 1.5, `"solid"` |
| default look | text | `name` `false`, `values` `false`, `size` `"medium"`, `color` none (a label: `#1f2933`), `background` `"halo"` |
| default look | `offset`; `minSize` | `0`; `12` |
| guide style | fill; stroke | `#6b7a86`, opacity 0.05; `#6b7a86`, opacity 1, width 1, `"dashed"` |
| measurement style | fill; stroke | `#b0127a`, opacity 0.08; `#b0127a`, opacity 1, width 2, `"dashed"` |
| group | `name`; `properties`; `visible` | `""`; `[]`; `true` |
| group | `groupId` | `null` (at the top) |
| part | `fill`; `shown`; `name` | `true`; `true`; `""` |
| point | `bearing` | `0` |
| point | `symbol` | `"none"`; `"diamond"` for a feature without `charts` |
| point | `parts` | `[]` |
| line | `start`, `end` | free |
| line | `vertices` | each `{}` |
| vertex | `name` | `""` |
| line | `smooth` | `false` |
| area | `reversed` | `false` |
| label | `text` | `""` |
| label | `anchor` | none: free, at the geometry |
| reference | `at`; `part` | `0`; none: the point's largest outline |
| label | `offset` | `[40, -40]` |
| label | `leader` | `"arrow"` |
| label | `look` | `{}`: as any element's |
| distribute | `groupId`, `copiesId` | `null` |
| distribute | `along.part` | none: its first filled round part |
| distribute | `spacing`, `count` | `null` |
| distribute | `startMargin`, `endMargin`, `offset`; `side`; `radius`; `aperture`; `preset`; `copy`; `points` | `0`; `"left"`; `null` (500 m when made again); `null`; `null` (a circle); `null`; `[]` |
| distribute point | `left` | `false` |
| connect | `groupId`; `pattern`; `groupSize`; `minBranch` | `null`; `"tree"`; `"auto"`; `0` |
| connect | `roots`, `pointIds`, `hubs`, `created` | `[]` |
| connect root | `weight` | `1` |
