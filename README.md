# Crickey Lite

_Developed by [Novitas WebWorks](https://novitasweb.works)._

Live cricket scoring for ONE operator, plus broadcast graphics for **vMix** (primary) and **OBS**. One process, one command, no Docker, no database server, no logins.

## 5-minute quick start

```bash
npm install
npm run build      # builds the operator UI and type-checks the server
npm start          # http://localhost:3000
npm run seed       # optional: two demo teams + a demo T20 match (becomes the active match)
```

Node 20+. `npm start` runs the TypeScript server through `tsx` (no separate server compile step). On start it prints the operator URL, your LAN URLs and every overlay URL.

1. **Teams** – add two teams (name, 3–4 letter short name, colour, optional logo) and paste players one per line. Order = batting order.
2. **Match setup** – pick teams, overs, players per side (2–11), toss, playing XI → *Create match*. It becomes the active match.
3. **Live scoring** – *Start innings*, choose openers and bowler, then score.
4. **Overlays** – copy URLs, put overlays on air, fire stings, run the simulator. Theme, position, scale, follow mode and the preview page's size are stored in the server settings, so they survive reloads and restarts (and are shared by the Overlays page and `preview.html`).

`npm run dev` runs server + Vite with hot reload (UI on http://localhost:5173). `npm test` runs engine, API, WebSocket and vMix-push tests. `npm run e2e` boots a throw-away server, plays a match and screenshots every overlay and page into `data/screenshots/`.

Storage is SQLite (`better-sqlite3`) in `data/`. If the native module cannot load, the app falls back to a JSON file store (`data/store.json`) behind the same interface. The match is an ordered list of events; all state is recomputed from them, so undo, edit and restart-recovery are exact.

## Going live with vMix

Overlay URL pattern: `http://<host>:3000/overlays/<name>.html?match=<id>&theme=classic|neon|minimal&position=bottom|top&scale=1&debug=1`
(`match` is optional – without it overlays follow the active match.) Names: `scorebug batters bowler partnership four six wicket new-batter over-summary target scorecard versus result lower-third milestone`.

**Mode 1 – Browser input (recommended).** vMix → *Add Input → Web Browser*, paste the URL, width 1920, height 1080, tick *Transparent*. One input per overlay. Leave the inputs on permanently in an overlay layer: Crickey Lite shows/hides the graphics with its own animations (the *On air* buttons on the Overlays page). Alternatively drive them with vMix's own overlay buttons. *Copy all vMix URLs* and *Print overlay URL table* are on the Overlays page.

**Mode 2 – Data sources (for your own GT/NewBlue titles).** vMix → *Settings → Data Sources → Add → XML / JSON / CSV* with
`http://<host>:3000/api/vmix/state.json` (also `.xml`, `.csv`), refresh 500 ms–1 s. Keys include `team_a_name team_a_score batting_team_short score wickets overs crr striker_name striker_runs striker_balls nonstriker_* bowler_name bowler_overs bowler_runs bowler_wkts bowler_figures this_over target need_runs balls_left rrr chase_text status_text free_hit powerplay result_text`.

**Mode 3 – API push (optional).** Settings → vMix: enable, set the address (default `http://localhost:8088`), map title fields (`Input`, `Field.Text`, value = a feed key like `striker_name` or a template like `{batting_team_short} {score}`) and optionally map four/six/wicket to `OverlayInput<N>In`, *In then Out*, or toggle. Only changed values are sent; failures retry with back-off and never block scoring. *Test connection* and a debug log are on the Overlays page.

## Going live with OBS

Add *Browser Source* with the same URLs: width 1920, height 1080, **Shutdown source when not visible: off**, **Refresh browser when scene becomes active: off**. Optional (Settings → OBS, off by default): obs-websocket v5 (port 4455 + password) to switch scene on wicket/four/six for N seconds and return.

## Remote client access

* **LAN:** the server binds to `0.0.0.0`; the Overlays page shows LAN URLs and a QR code for the operator panel.
* **Over the internet:** `cloudflared tunnel --url http://localhost:3000` (or `ngrok http 3000`), then set **Public base URL** in Settings so *Copy URL* generates correct links.
* **PIN (optional):** set in Settings or `PIN=1234 npm start`. Writes need it; overlays and read-only data feeds stay open so vMix can load them. CORS is open for read endpoints only.

## Match-day checklist

- [ ] `npm run build && npm start`, operator panel opens, "Server connected" is green
- [ ] Teams, logos and players correct; match created and active
- [ ] Overlay inputs added in vMix/OBS; Overlays page shows "● n" next to each connected overlay
- [ ] Preview page (`/overlays/preview.html`) looks right in the chosen theme
- [ ] Fire *Four*, *Six*, *Wicket* once from the Overlays page; *Hide all*
- [ ] Laptop on power, sleep disabled; second device can open the LAN URL
- [ ] Practise Undo and the *Swap strike* safety net

## Keyboard shortcuts

`0–6` runs · `W` wicket · `D` wide · `N` no-ball · `B` bye · `L` leg bye · `S` swap strike · `U` / `Ctrl/Cmd+Z` undo · `Space`/`Enter` confirm · `Esc` cancel · `1–9` pick in wizards · `Enter` reopens a dismissed new-bowler / new-batter picker · `?` cheat sheet. Disabled while typing and while a required prompt is open. A whole innings can be scored from the keyboard. Keyboard presses are never debounced (two quick `0`s are two dot balls); mouse clicks ignore an identical repeat within 250 ms. A last-wicket dismissal asks for one extra *Confirm wicket* press. Tie, no-result and team-won results, and *End innings*, ask for a browser confirm. The ball-edit dialog shows the effect on the totals (or the reason it is refused) before you save, and disables *Save* for refused edits.

## How the rules were interpreted (please double-check)

* **Innings order:** the side that did not bat in the previous innings bats next (the engine rejects the same side twice, except for the first Super Over innings).
* **Chase target** = innings 1 total + 1; the chase ends when runs ≥ target. Runs = target − 1 is a tie.
* **Strike** swaps on the runs *run* (bat runs, byes, leg byes, wide additional runs, plus overthrows). A 4 or 6 hit to the boundary is not "run" (untick via the edit dialog if all four were run). End-of-over swap is applied after that.
* **Run out / caught crossing:** the new batter takes the dismissed batter's end after the completed runs. A *"batters crossed?"* toggle (caught and run out) flips the ends; *Swap strike* is the safety net.
* **Wide** = 1 + additional runs, all charged to the bowler; **no-ball** = 1 + bat runs to bowler (byes/leg-byes off a no-ball go to extras only) and the ball counts as faced; free hit follows and survives wides and dead balls.
* **Dismissals allowed:** wide – stumped, run out, hit wicket; no-ball and free hit – run out, obstructing, handled, hit twice; timed out / retired out are recorded as dead balls. Retired hurt is not a wicket and the batter may return.
* **Bowler credit:** bowled, caught, lbw, stumped, hit wicket. Max overs = max(ceil(overs/5), ceil(overs/bowlers)), switchable off.
* **Maiden** = a full over by one bowler with no runs charged to them. Forced short overs (*End over*) are counted as an over; bowler "overs" figures then use 6-ball arithmetic.
* **Super Over:** after a tie, *Start Super Over*: 1 over, 2 wickets, the side that batted second bats first.
* **Penalty runs** go to the batting side. **No DLS maths:** type a revised target/overs.
* Hat-trick = three consecutive legal deliveries by one bowler all taking bowler-credited wickets.
* Storage uses a generic `docs` table plus real `events` and `kv` tables instead of one table per entity.

## Known limitations

* Single operator, single machine; no accounts or roles.
* One shared on-air state for all overlays (per-match overlay state is not separate).
* Limited-overs, two-innings cricket only (no Tests/follow-on).
* Squads of teams used in a match are locked (rename instead of delete).
* Bowler "overs" for manually shortened overs are approximate.
* Wicket-wizard and picker digit hotkeys cover the first 9 (fielders: 10) players; later players are picked by click or Tab.
* The *Result* overlay shows "MATCH SO FAR" with both scores (no result sentence) until the match is completed.
* The operator UI was hand-checked in the built-in browser at about 800×600 and 1024×768; wider screens were checked through screenshots only.
* vMix push, OBS control, LAN access from a second device and remote tunnels were tested against mocks/offline only – not a live vMix/OBS install, not a second device, not a tunnel.

## Design and licences

* **Original graphics.** The overlay look is drawn from scratch for this project: floating rounded modules with gaps, team-coloured spines, rounded-square badges and ball beads, wicket pips, a ball-dot strike marker, and stings with a line that counts down to auto-hide. It does not reproduce any broadcaster's, league's or board's graphics package, colours or layout. The three themes are *classic* (warm charcoal-green with a clay accent), *neon* (near-black with a lime edge) and *minimal* (warm off-white with a rust accent); the names stay the same so existing URLs keep working.
* **No third-party marks.** There are no league, tournament, sponsor or broadcaster logos or names anywhere in the app; team names, colours and logos come only from what the operator enters. If you add real team or competition logos, you are responsible for having the right to broadcast them.
* **Fonts.** Overlays use Oswald (SIL Open Font License 1.1, copy in `overlays/fonts/OFL-Oswald.txt`), bundled locally. The operator UI uses the system font stack; nothing is fetched at runtime.
* **Code.** Dependencies are the open-source packages listed in `package.json` under their own licences. Cricket terms and laws are not copyrightable, but check the rules of your own competition before using the result wording on air.
* This is a good-faith summary, not legal advice.

## Troubleshooting

* *Port busy:* `PORT=3100 npm start`.
* *Overlay blank in vMix:* open the same URL with `&debug=1&force=1` in a browser; check the Overlays page "On air" state; the overlay stays transparent by design while disconnected.
* *Native SQLite fails to build:* the app logs it and uses the JSON store automatically.
* *Logs:* `data/logs/` (7 days kept).

---
Developed by [Novitas WebWorks](https://novitasweb.works).
