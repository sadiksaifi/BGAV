# BGAV

Better GitHub Actions Visualizer.

GitHub draws workflow runs as a left-to-right graph. That works for a handful of jobs. It falls apart on a real release pipeline with matrix builds across platforms, parallel branches, and jobs that wait on five others. You end up scrolling sideways and tracing lines with your finger.

BGAV is a Chrome extension that redraws that graph top-down, so the run reads like the pipeline you wrote: stages flow down the page, matrix jobs group together, and converging paths stay easy to follow. You can zoom, pan, and fit the whole run on screen, and every job keeps its name, status, and duration in view.

It only acts on workflow run pages (`github.com/<owner>/<repo>/actions/runs/<id>`).

## Status

Early. The project scaffold is in place and the graph is being built.

## Development

You need [mise](https://mise.jdx.dev), which installs the pinned Node.js and pnpm from `.mise.toml`.

```sh
mise install
pnpm install
pnpm dev
```

Then load the extension in Chrome:

1. Open `chrome://extensions` and turn on Developer mode.
2. Click "Load unpacked" and pick the `dist` folder.

`pnpm dev` rebuilds on save. `pnpm build` makes a production build in `dist`.

Before you push, run `pnpm check`. It typechecks, lints with oxlint, checks formatting with oxfmt, and runs the tests.
