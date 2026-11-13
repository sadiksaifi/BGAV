<p align="center">
  <img src="assets/icon.svg" width="128" height="128" alt="">
</p>

<h1 align="center">BGAV</h1>

<p align="center">Better GitHub Actions Visualizer. A Chrome extension that redraws GitHub's Actions run graph top-down, so a big pipeline reads like the workflow you wrote.</p>

<p align="center">
  <img src="docs/screenshot.png" width="90%" alt="BGAV drawing a release pipeline top-down">
</p>

## Highlights

- **Top-down layout**: Jobs flow down the page with curved edges, and every job without dependencies starts in the top row.
- **Matrices in place**: Matrix jobs are fetched and listed inside their card, without clicking "Show all jobs".
- **Reusable workflows**: Jobs from the same workflow call sit together in a box you can collapse.
- **Live**: Statuses and durations update as the run progresses, and your zoom and position stay put.
- **Find problems fast**: Status chips jump to failed or running jobs, search finds any job, and hovering a job highlights everything up and downstream.
- **Critical path**: Highlights the chain of jobs that decided how long the run took.
- **Navigation**: Zoom, pan, fit, full screen, an overview map and keyboard shortcuts. The menu lists the keys.
- **GitHub's graph is one click away**: Switch back from the menu at any time. If GitHub changes its markup and BGAV cannot read a page, it shows GitHub's graph instead.

## License

BGAV is open source under the [MIT License](LICENSE). It bundles [elkjs](https://github.com/kieler/elkjs) under [EPL-2.0](https://www.eclipse.org/legal/epl-2.0/) and GitHub's [Octicons](https://github.com/primer/octicons) under MIT.
