# dsh-niulai-pet

[中文](README.md) | **English**

NiuLai desktop pet — a little cow from the *NiuLai* meme, living in the corner of your
dsh (DeepSeek Harness) web UI. It breathes, blinks, strolls around, naps and gossips in
speech bubbles; the moment your agent finishes a task, it jumps up and shouts
**"Ma~~ma~~"** — with mouth-synced voice, tail note held to the very end.

All functionality lives in the browser (client half); the host half is a no-op
(`index.js`) that exists only so `dsh plugin add` recognizes the package
(`dsh.bundle` manifest). **Updates apply on page refresh — no host restart**.

![Five skins](docs/family.png)

![Demo](docs/demo.gif)

## Skins

| Skin | Artwork | Voice | Signature action |
|---|---|---|---|
| NiuLai 牛来 | cutout + PIL touch-up | original voice lines (denoised) | triple hop |
| Young 小黄 | hornless, brighter variant | same | roll |
| Cow 奶牛 | hand-drawn flat SVG | WebAudio synth moo | roll |
| Panda 熊猫 | hand-drawn | synth squeak | roll |
| Whale 蓝鲸 | hand-drawn (DeepSeek blue, orca eye patch) | synth whale call | breach — spouts at the arc top |

## Behavior

| Interaction | Reaction |
|---|---|
| Idling | breathing; random blinks / hops / strolls / naps / wiggles; occasional quip bubbles |
| Agent session running | elapsed-time bubble "AI has been running for Xm Ys…" |
| Click (poke) | shouts once + bound action |
| Drag | carried along, lands with a bounce; position persisted (localStorage) |
| Right-click | menu: sound / shout-on-done / chatter toggle pills, shout repeat (1–3),<br>action bindings, skin picker, fly-by, shout, about |
| Task done | voice line (repeatable) + bubble + mouth timeline (open-close-open, held through<br>the tail note) + bound action (6s throttle) |

Action library: fly (upward arc), dance, spin, triple hop, roll, breach, cow-sway.
Any skin can bind any action; "signature" follows the current skin, "random" picks live.

Completion is detected from the client runtime's `sessions.list` snapshot subscription:
`running` flipping true→false (foreground session finished) or `completed` newly set
(background session done). On hosts too old to expose the sessions service the pet
degrades to manual interaction only.

## Install

```sh
dsh plugin --profile web add github:whitefirer/dsh-niulai-pet
```

The built `lib/` is committed — installation needs no build step. Restart dsh web once
after the first install; upgrades only need a page refresh.

## Assets

Everything is bundled — install and play. The cow/panda/whale are original hand-drawn
artwork (SVG sources in `tools/drawn/`, free to use).

Want your own look/voice? Overwrite files in `assets/`, then `npm run build` and refresh.
The full asset-regeneration pipeline lives in `tools/` (see AGENTS.md).

## Development

```sh
npm install
npm run build      # outputs lib/client.js (CJS closure + __ModuleLoader__ wrapper)
npm run typecheck
```

Debug inside a profile:

```sh
cd ~/.dsh/profiles/web && pnpm add file:/path/to/dsh-niulai-pet
# restart dsh web once for the market shim; afterwards just build + refresh
```

Append `?petdebug=1` to the page URL to expose the pet handle as `window.__niulai`
(`celebrate` / `poke` / `setBusy` / `destroy`) — handy for playwright-driven checks.

## For maintainers

Architecture (mood state machine, SkinDef registry, mouth timeline, flight paths),
animation pitfalls (WAAPI pause vs cancel, mirrored rotation, coroutine preemption),
the asset pipeline and the demo-video recording recipe are all documented in
[AGENTS.md](AGENTS.md).
