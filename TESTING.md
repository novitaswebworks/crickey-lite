# Manual test plan (≈30 minutes)

Setup: `npm run build && npm run seed && npm start`. Open `http://localhost:3000` (Riverside Rockets "RIV" v Harbour Hawks "HAW", 20 overs, RIV bat first). On **Overlays** open *Preview all overlays* in a second window (or add the URLs to vMix/OBS). Players: RIV = Aarav Menon, Dev Kapoor, Rohan Iyer…; HAW bowlers = Liam Carter, Noah Bennett, Owen Hughes…

| # | Do | Expect |
|---|----|--------|
| 1 | Live → Start innings 1 (defaults: Aarav striker, Dev non-striker, Liam bowling) | Top bar `RIV 0/0 (0.0/20)`, POWERPLAY badge |
| 2 | Overlays → show *scorebug*, *batters*, *bowler* | Scorebug `0/0`, Aarav `*`, Dev, Liam `0.0-0-0` |
| 3 | Press `1` | `1/0 (0.1)`; strike moves to Dev; names do **not** swap rows on overlays |
| 4 | Press `D`, `Space` (wide) | `2/0`, overs still `0.1`, chip `Wd` |
| 5 | Press `N`, `Space` (no-ball) | `3/0`, overs `0.1`, FREE HIT banner + scorebug badge |
| 6 | Press `W` → delivery Normal | Bowled/Caught/LBW are greyed out; only Run out etc. enabled. Esc |
| 7 | Press `4` | `7/0`, FREE HIT gone, FOUR sting fires and hides after ~5 s |
| 8 | Press `B`, `1`, `Space` (bye) | `8/0`, overs `0.3`, bye counted to extras not batter/bowler |
| 9 | Press `W` → Caught (2) → fielder → crossed No → new batter Rohan | `8/1`, WICKET sting, Rohan in; Aarav (on strike after the bye) out `c … b Liam Carter` |
| 10 | Press `0` `0` `1` quickly | Both dots register, the over completes (board shows `1.0`) and the `1` is ignored; amber banner "Select the new bowler"; scoring blocked; Liam is greyed (consecutive over) |
| 11 | Pick Noah Bennett | Over summary data = last over; chips correct; strike swapped by the end-of-over rule |
| 12 | Score two dots for Noah, then press `U` three times quickly | Both dots and then the bowler selection are undone; the bowler prompt returns at 1.0; scorebug follows within ~0.1 s |
| 13 | Click a past ball in *Recent balls* → change runs → Save | All later totals recompute; a nonsense edit shows a red error and changes nothing |
| 14 | Overlays → *Simulate* 120 balls at 200 ms | Every overlay reacts; Consistency panel never appears |
| 15 | Fix/More → Revised target (after innings break) | Target overlay shows the new target and "(revised)" |
| 16 | *End innings* → break screen → Start innings 2 | Target = innings 1 + 1; target overlay: need / balls left / RRR |
| 17 | Chase to victory (keys `6`) | Match completes the ball the target is passed: "Harbour Hawks won by N wickets (X balls left)"; result overlay shows top scorer and best bowler |
| 18 | History → Scorecard / CSV / JSON | Totals equal sum of batters + extras |
| 19 | Stop the server mid-over, restart | Overlays blank while down, reconnect by themselves, match resumes at the same score |
| 20 | Open the LAN URL from a phone | Operator panel loads; scoring works |
