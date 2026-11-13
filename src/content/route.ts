/**
 * Matches the summary page of a workflow run, where GitHub renders the job graph:
 *   /{owner}/{repo}/actions/runs/{runId}
 *   /{owner}/{repo}/actions/runs/{runId}/attempts/{attempt}
 */
const RUN_PAGE = /^\/[^/]+\/[^/]+\/actions\/runs\/\d+(?:\/attempts\/\d+)?\/?$/;

export function isRunPage(pathname: string): boolean {
  return RUN_PAGE.test(pathname);
}
