# Saltline City

An original 3D open-world crime game that runs in the browser — built for
make.fun's "Make GTA 6" bounty (gta6-01). No Rockstar/GTA names, assets,
maps or music: everything here is original.

Mara Voss was the fastest courier on the coast — until one bad drop put
her in fixer Delgado's pocket. Run his five jobs across a neon coastal
city: courier runs, a stolen gold coupe, a pier fight at the marina, a
three-star heat check, and the Saltline Score. Between jobs, free-roam:
steal cars, dodge the Saltline PD, and beat your best score.

## Play

```sh
node serve.ts          # then open http://localhost:8080
```

Or open `game/index.html` in a desktop browser — the game is fully
offline (three.js is vendored under `game/vendor/`).

**Controls:** WASD move/drive · mouse look · Shift run · **E** enter/steal
car · click shoot · F melee · Space handbrake/jump · H horn · P/Esc pause.

## What's in the city

- Procedural neon coastal city: street grid, tower blocks with lit
  windows, a park, beachfront, marina pier with boats, a lighthouse island
- Traffic that loops the blocks, 48 pedestrians who stroll and flee
- Car stealing, arcade driving, wanted stars, police pursuit cars and
  officers who bail out to chase on foot, a busted meter
- Five story missions with HUD objectives, minimap waypoints and payouts
- Pistol + melee combat against the Tide Kings rival crew
- HUD with live canvas minimap, day/night cycle, synthesised WebAudio
  engine/siren/combat sounds, localStorage save

## Layout

- `game/` — the playable game (static files)
- `game/src/` — one module per system: `city`, `vehicles`, `player`,
  `pedestrians`, `police`, `missions`, `combat`, `hud`, `audio`, `save`,
  `config`, `shots` (the `?shot=` scenes behind `screenshots/`)
- `screenshots/` — four real captures of the game
- `main.ts` — hands the entry in: copies `game/` + `screenshots/` to the
  output directory and writes `dossier.json` via `vendor/makefun-game.ts`

MIT licensed.
