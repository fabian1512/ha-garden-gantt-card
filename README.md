<p align="center">
  <a href="https://buymeacoffee.com/fabian1512" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me a Coffee" height="50" width="210"></a>
</p>

# Garden Gantt Card

A **year/month Gantt-style** Lovelace card for Home Assistant. It reads the events
of a single `calendar.*` entity live and renders **one row per plant**, with each
activity drawn as a colored bar that carries its own label. Overlapping
activities are stacked into lanes. Ideal for a garden sowing/care plan or any
long-running seasonal schedule.

```
Pflanze              Jan  Feb  Mär  Apr  Mai  Jun  Jul  Aug  Sep  Okt  Nov  Dez
Tomate                    Vorkultur  Auspflanzen  Ausgeizen
                                                    Düngen
                                                    Ernte
```

## Features

- **Live calendar data** — pulls events from the HA calendar REST API, so edits
  in the calendar show up without regenerating anything.
- **One row per subject** — the row (plant) comes from the event `location`,
  falling back to the text before `:` in the summary.
- **Activity colors** — the bar color is derived from the activity text
  (`Pflanzen/Aussaat`, `Pflege`, `Düngen`, `Schnitt`, `Ernte`, `Schutz`).
- **Lane stacking** — overlapping activities in the same row are drawn on
  separate lanes instead of hiding each other.
- **Labels in the bars** — the activity is written into the bar when it is wide
  enough; the description shows on hover.
- **Zoom / horizontal scroll** — `visible_months` shows only that many month
  columns at once and lets the rest scroll sideways; the plant-name column stays
  pinned while scrolling, and the wider scale makes labels fit even in short bars.
- **Taller bars** (configurable), month grid, current month highlighted.
- **Theme-aware**, **no dependencies** — single JS file, no build step.

## Installation (HACS)

1. HACS → Frontend → ⋮ → **Custom repositories**
2. Repository: `https://github.com/fabian1512/ha-garden-gantt-card`, Category: **Lovelace**
3. Install **Garden Gantt Card** and hard-refresh the browser.

### Manual

Copy `dist/garden-gantt-card.js` to `config/www/` and add it as a dashboard resource:

```yaml
url: /local/garden-gantt-card.js
type: module
```

## Usage

```yaml
type: custom:garden-gantt-card
entity: calendar.gartenplan_nextcloud
title: Gartenplan
months: 12
visible_months: 6        # show 6 months at a time, scroll for the rest
label_min_months: 0.3    # draw labels down to ~10-day bars
bar_height: 22
activity_colors:
  pflanzen: "#43a047"
  pflege: "#1e88e5"
  duengen: "#fb8c00"
  schnitt: "#8e24aa"
  ernte: "#e53935"
  schutz: "#00897b"
```

### Event convention

```text
SUMMARY : Pflanzenname: Tätigkeit
LOCATION: Pflanzenname
```

The card reads the row from `location` (or the summary prefix), uses the text
after `:` as the bar label and classifies the label into an activity type for
coloring. A calendar event without a location and without `:` is placed in
`Allgemein`.

## Options

| Option | Type | Default | Description |
| ------ | ---- | ------- | ----------- |
| `entity` | string | **required** | Calendar entity, e.g. `calendar.gartenplan_nextcloud` |
| `title` | string | `Gartenplan` | Card title |
| `start` | string | first of current month | Window start (`YYYY-MM-DD`) |
| `months` | number | `12` | Number of month columns (1–24) |
| `row_field` | string | `location` | Row source: `location` or `summary` |
| `bar_height` | number | `22` | Bar height in px |
| `lane_gap` | number | `3` | Vertical gap between lanes in px |
| `row_gap` | number | `10` | Vertical gap between plants in px |
| `visible_months` | number | `null` | Months visible at once; the rest scrolls sideways (`null` = fit all) |
| `label_min_months` | number | `0.85` | Draw the label once a bar is at least this many months wide |
| `show_labels` | boolean | `true` | Write the activity into the bar |
| `show_legend` | boolean | `true` | Show the activity-type legend |
| `activity_colors` | map | palette | Override color per activity type |
| `activity_keywords` | map | built-in | Override keyword list per activity type |
| `refresh_interval` | number | `300` | Re-fetch interval in seconds (`0` = off) |
| `language` | string | HA locale | Month-name language (`de`/`en`) |

## How it works

The card calls `GET /api/calendars/<entity>?start=…&end=…` and turns every event
into a segment: the row is `location` (or the summary prefix), the label is the
text after `:`, and the activity type is matched by keyword. Segments are packed
into lanes so overlaps don't collide, then positioned on a month grid. All-day
events use the exclusive `end` date, so `Sep 1 – Nov 1` fills Sep and Oct.

## License

MIT