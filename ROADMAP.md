# Roadmap

What is known and not done yet. The app is the reference for what it does; this file
lists only what it does not do, or not well enough.

## Open

- **Phones: the bottom row takes up to three lines** (credits; not for navigation and
  the scale note; the time and the scale).
- **Legends slightly soft at 125% display scale.** They are drawn one canvas pixel per
  screen pixel, but start on a fraction of a screen pixel at that scale.
- **The panel's redraw redraws everything.** `renderMenu` (app.js) also redraws the
  time line, the status marks and the legends, on every change and every zoom: split
  it by what each change touches.

## Parked

- **Measure: editing a drawn measurement** (dragging its points); today it is deleted
  and drawn again.
- **Magnetic bearings.** Bearings are true (°T); magnetic ones need a model of the
  declination by place and year (WMM).
- **A wind forecast.** The wind layer is a satellite observation, a day late;
  Copernicus Marine has no wind forecast, so wind over forecast waves is for past
  hours only. Another keyless source would be needed.
