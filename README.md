# Crickey Lite

_Developed by [Novitas WebWorks](https://novitasweb.works)._

Crickey Lite is a local sports scoring and broadcast operations app for **cricket and field hockey**. It provides match setup, live scoring, a live Control Room, broadcast overlays for **OBS Studio and vMix**, and pre- and post-broadcast Operations tools. It is designed to run on a local network (LAN); it does not require a cloud service or internet connection during a broadcast.

## Requirements

- Node.js 20 or newer
- OBS Studio or vMix for on-air graphics (optional)
- Devices running the operator panel and video mixer must be able to reach the server over the same LAN

## Start the app

```bash
npm install
npm run dev
```

In development, the panel is at `http://localhost:5173` and the API and overlays are served at `http://localhost:3000`. Vite reloads panel changes in the browser; `tsx watch` restarts the API when server TypeScript changes. Keep overlay browser sources pointed at port `3000`.

For a production-style run:

```bash
npm run build
npm start
```

The panel, API, and overlays are then served from `http://localhost:3000`. The server listens on `0.0.0.0` and prints its LAN addresses at startup. Open the printed LAN address from the operator computer and from OBS/vMix if they run on another machine. If a source does not pick up changed overlay files, refresh that browser source.

Optional demo data:

```bash
npm run seed
```

This creates demo teams and a demo cricket match and makes that match active. Do not run it against a data directory you want to keep unchanged.

## Typical match workflow

1. **Teams:** choose Cricket or Hockey, create teams, then add their players. Cricket player roles include Batter, Bowler, Wicketkeeper, and All-rounder. Hockey positions include Goalkeeper, Defender, Midfielder, Forward, and Utility. Team rosters are separate by sport; logos, player photos, shirt numbers, and captain markings can be added where applicable.
2. **Match setup:** select two teams and their players. Cricket setup includes overs and toss details. Hockey setup includes starting players and period format/duration. Creating a match makes it active.
3. **Live Control Room:** use the Broadcast controls workspace for score/clock status, overlay cues, output connection indicators, graphic preview, cue history, and dismiss controls. Switch to Live match scoring for the sport's scoring controls. Hockey includes its match clock and hockey events; cricket includes innings scoring and its scoring tools.
4. **Operations:** schedule a match, prepare its sport-specific rundown and technical preflight checklist, record incidents, and print/save a call sheet. After a match is completed, generate and review a report draft from match events and linked incidents. Approve the report after review; changes to the event history or incidents make it stale.
5. **Overlays:** configure graphic URLs and themes, preview the graphics, and check connected browser-source counts. Use the Control Room or Overlays page to show, fire, and dismiss graphics.

Operations records are stored locally with the match data. They are separate from live scoring and overlay control. Critical preflight checks must pass or be marked not applicable before a broadcast can be marked ready or on air.

## OBS Studio setup

1. In OBS, add a **Browser Source** for each graphic you need. Use the LAN URL printed by the server, for example `http://192.168.x.x:3000/overlays/hockey/scorebug.html`.
2. Set the browser source width and height to **1920 × 1080** and enable transparency if shown in your OBS version.
3. Turn **Shutdown source when not visible** off and **Refresh browser when scene becomes active** off, so sources remain connected to the live overlay feed.
4. Add the graphics as browser sources in your Main Live scene; you can also place them in dedicated scenes if that suits your production. Keep the sources loaded and use Crickey Lite's Control Room or Overlays page to show, fire, and hide the graphics.
5. Open the Control Room and check its browser source connection counts. Use **Preview** there to inspect a graphic without putting it on air.

OBS scene auto-switching is optional and configured under **Settings → OBS** through obs-websocket v5. It can switch to a configured scene for supported cricket events and return after the configured duration. It is not required for browser-source overlays.

## vMix setup

### Browser overlays

Add an **Input → Web Browser** for each graphic. Use the server's LAN URL, set it to **1920 × 1080**, and enable transparency. Keep inputs available and use the Control Room or Overlays page to control the graphic state.

URL pattern:

```text
http://<server-lan-ip>:3000/overlays/<overlay-name>.html?match=<match-id>&theme=neon
```

The `match` parameter is optional; if omitted, the overlay follows the active match. Supported themes are `classic`, `neon`, and `minimal`. Hockey Starting 11 and Substitutes URLs can include `side=A` or `side=B`, for example:

```text
http://<server-lan-ip>:3000/overlays/hockey/starting11.html?side=A&theme=neon
http://<server-lan-ip>:3000/overlays/hockey/substitutes.html?side=B&theme=neon
```

Team A and Team B URLs let each browser source render the requested side. The Control Room fires one side per cue; each Starting 11 or Substitutes graphic family has one shared on-air state, so both sides of the same family are not independently fired at once.

### vMix data feed and API push

For custom vMix titles, the app exposes live cricket data at:

```text
http://<server-lan-ip>:3000/api/vmix/state.json
http://<server-lan-ip>:3000/api/vmix/state.xml
http://<server-lan-ip>:3000/api/vmix/state.csv
```

Configure a vMix Data Source to refresh at an appropriate interval (typically 500 ms to 1 s). The feed includes cricket match, batter, bowler, score, target, and over fields.

Optional vMix API push is configured under **Settings → vMix**. Enable it, enter the reachable vMix API address, then map title inputs and fields. The Broadcast/Overlays page provides connection testing and a recent push log. The vMix machine must be reachable from the machine running Crickey Lite.

## Overlay behavior and names

Cricket overlay names include `scorebug`, `batters`, `bowler`, `partnership`, `four`, `six`, `wicket`, `new-batter`, `over-summary`, `target`, `scorecard`, `versus`, `result`, `lower-third`, and `milestone`.

Hockey overlay names include `hockey/scorebug`, `hockey/goal`, `hockey/card`, `hockey/penalty-corner`, `hockey/shootout`, `hockey/starting11`, `hockey/substitutes`, and `hockey/scoreboard-banner`.

Persistent graphics stay visible until hidden. Timed cues auto-hide according to **Settings → Overlays**. Event cues temporarily hide a visible scorebug and restore it when the cue ends unless the operator changes the scorebug state during the cue. **Dismiss all graphics** hides all overlay families. Overlay state is shared on the server, so connected sources update together; it is not stored separately per match.

## LAN and operator security

This project is intended for a trusted local network. Keep the server and OBS/vMix machines on the same LAN and use the printed LAN address instead of `localhost` for browser sources running on another computer. Check the machine's firewall if another LAN device cannot connect.

An optional operator PIN can be configured in Settings or set with `PIN=1234 npm start`. The PIN protects write actions; overlay pages and read-only output feeds remain accessible to browser sources. Do not expose the server to an untrusted network. The `Public base URL` setting exists for URL generation but is not needed for the intended LAN workflow.

## Data, build, and checks

Match, team, player, Operations, and settings data are stored locally under `data/`. The app uses SQLite (`better-sqlite3`) when available and falls back to a JSON store at `data/store.json` if the native module cannot load. Back up the data directory before moving or replacing the installation.

```bash
npm run build   # production web build and TypeScript check
npm test        # Vitest test suite
npm run e2e     # end-to-end run; writes screenshots under data/screenshots/
```

## Cricket scoring notes

- Match state is computed from an ordered event log; undo/edit actions update state from that history.
- A chase target is the first innings total plus one. A score one short is a tie.
- Strike changes account for completed runs and overthrows; boundary 4/6 events are not treated as running unless corrected in the ball editor.
- Wides and no-balls use cricket extras and dismissal rules. Free hit state persists through wides and dead balls.
- Bowler-credited dismissals are bowled, caught, lbw, stumped, and hit wicket. DLS is not calculated; enter revised overs/target manually when needed.
- Super Over is available after a tie. Match formats are limited-overs cricket; Test and follow-on formats are not implemented.

Check your competition's playing conditions before using match results or rules on air.

## Known limitations

- Designed for a single operator and a single local server; there are no user accounts or role-based permissions.
- Overlay state is shared by graphic type across connected browser sources and is not isolated per match. Starting 11 and Substitutes use a side parameter and the Control Room fires the selected side, but both sides of one graphic family cannot be independently on air simultaneously.
- Hockey formations use player roles/positions and the Starting 11 graphic; formation coordinates are currently determined by the overlay layout rather than an editable tactical board.
- OBS control is optional and limited to configured scene switching for supported cricket events; the browser overlays work without OBS WebSocket.
- vMix push and OBS WebSocket depend on the configured device, API settings, and LAN reachability. Verify them on the actual production machines before a live event.
- Squads used by a match are locked to preserve match history; edit the team roster before creating the match.

## Design and licences

- Overlay graphics are original project designs and include classic, neon, and minimal themes. Team names, colours, logos, and player images are entered by the operator; use only assets you have permission to broadcast.
- Oswald is bundled locally under the SIL Open Font License 1.1; see `overlays/fonts/OFL-Oswald.txt`. The operator panel uses system fonts and does not fetch fonts at runtime.
- Dependencies are open-source packages listed in `package.json`, each under its own licence. This document is a project summary, not legal advice.

## Troubleshooting

- **Port in use:** start with another port, e.g. `PORT=3100 npm start`.
- **LAN device cannot open the panel/overlay:** use the server's printed LAN IP, confirm both machines share the LAN, and check firewall rules.
- **Blank overlay:** confirm the browser source URL uses the right LAN host and port, inspect its `match`/`side` parameters, verify the graphic is on air in the Control Room/Overlays page, then refresh the source. `&debug=1&force=1` can help inspect the overlay page in a normal browser.
- **Changes are not visible in OBS/vMix:** development server reloads app code, but an already-loaded browser source may need its Refresh action after overlay HTML/CSS edits.
- **SQLite native module fails:** the app falls back to JSON storage; see the server log.
- **Logs:** `data/logs/`; old logs are pruned automatically.

---

Developed by [Novitas WebWorks](https://novitasweb.works).
