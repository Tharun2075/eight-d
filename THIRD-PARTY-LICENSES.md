# Third-party licences

Eight-D is MIT-licensed (see LICENSE). It uses the components below. Full licence
texts ship inside each package in `node_modules/<name>/LICENSE*`.

## Runtime (bundled into the deployed app)

| Component | Version | Licence | Notes |
|---|---|---|---|
| @forge/api, @forge/kvs, @forge/resolver | 6.x, 1.x, 1.x | Atlassian Developer Terms | Platform SDK; the target platform's own licence permits use in Forge apps. |
| @forge/bridge | 5.x | Atlassian Developer Terms | Same as above (Custom UI bridge). |
| react, react-dom | 18.3.1 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| Transitive runtime deps (scheduler, loose-envify, js-tokens) | - | MIT | |

## Build time only (not shipped in the app bundle)

| Component | Licence |
|---|---|
| vite, @vitejs/plugin-react, esbuild, rollup, babel | MIT |
| Other build tooling (transitive) | MIT, ISC, BSD-2/3-Clause, 0BSD, Apache-2.0, BlueOak-1.0.0 |
| caniuse-lite (browser data) | CC-BY-4.0 (data, build-time only) |
| argparse | Python-2.0 (build-time only) |

## Reference material (no code copied verbatim)

| Source | Licence | Used for |
|---|---|---|
| atlassian/forge-teamwork-graph-examples (Bitbucket) | Apache-2.0, Copyright Atlassian | Shape of the `rovo:agent`, `action` and `graph:connector` manifest entries. |

No GPL, AGPL, non-commercial or unlicensed code is included.
