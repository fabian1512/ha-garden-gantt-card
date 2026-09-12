# Garden Gantt Card

A **year/month Gantt-style** Lovelace card for Home Assistant. It reads the events
of a single `calendar.*` entity live and renders them as colored bars across a
12-month grid — ideal for a garden sowing/care plan, project timelines, or any
long-running seasonal schedule.

```
Aufgabe                    Jan Feb Mär Apr Mai Jun Jul Aug Sep Okt Nov Dez
Kartoffel: Vorkeimen        ██  ██
Kartoffel: Pflanzen             ██  ██
Kartoffel: Ernte                            ██  ██  ██  ██
Kartoffel: Ernte Lagerkartoffeln            ██  ██  ██  ██
```

## Features

- **Live calendar data** — pulls events from the HA calendar REST API, so edits
  in the calendar show up without regenerating anything.
- **12-month grid** (configurable 1–24), month columns with current month highlighted.
- **Grouping & colors** — group rows by plant/category via a simple `groups` map,
  each group gets its own color (overridable).
- **Tooltips** — the event description is shown on hover.
- **Theme-aware** — uses Home Assistant CSS variables (light/dark).
- **No dependencies** — single JS file, no build step.

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
entity: calendar.gartenplan
title: Gartenplan
start: "2026-09-01"   # optional; default = first day of the current month
months: 12
groups:              # optional: map event title prefix (before ":") -> group
  Kartoffel: Gemüse
  Tomate: Gemüse
  Erdbeere: Obst
  Rose: Zierpflanze
group_colors:         # optional
  Gemüse: "#4caf50"
  Obst: "#e91e63"
  Zierpflanze: "#9c27b0"
```

## Options

| Option | Type | Default | Description |
| ------ | ---- | ------- | ----------- |
| `entity` | string | **required** | Calendar entity, e.g. `calendar.gartenplan` |
| `title` | string | `Gartenplan` | Card title |
| `start` | string | first of current month | Window start (`YYYY-MM-DD`) |
| `months` | number | `12` | Number of month columns (1–24) |
| `groups` | map | `{}` | Map of event prefix (text before `:`) → group label |
| `group_colors` | map | palette | Map of group label → color |
| `show_legend` | boolean | `true` | Show the group legend |
| `refresh_interval` | number | `300` | Re-fetch interval in seconds (`0` = off) |
| `language` | string | HA locale | Month-name language (`de`/`en`) |

If an event has a `location`, it is used as the group when no `groups` mapping
matches. Events without a group are collected under **Aufgaben**.

## How it works

The card calls `GET /api/calendars/<entity>?start=…&end=…` over the Home
Assistant WebSocket/ REST bridge (`hass.callApi`) and lays out each event as a
row of month cells. All-day events use the exclusive `end` date, so a
single-day event spans one cell and a `Sep 1 – Nov 1` event fills Sep and Oct.

## License

MIT
