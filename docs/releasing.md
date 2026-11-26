# Releasing BGAV

From an up-to-date `main`, preview and push the first release tag with TagSmith.

```sh
pnpm install --frozen-lockfile
pnpm release --channel stable --version 0.1.0 --dry-run --json
pnpm release --channel stable --version 0.1.0 --push
```

For later releases, use `--bump patch`, `--bump minor`, or `--bump major` in place of `--version 0.1.0`. GitHub Actions validates the tag, runs the checks, and attaches the packaged extension to its GitHub Release. Local builds use the development manifest version `0.0.0.1`.

## First Chrome Web Store submission

Upload `bgav-0.1.0.zip` from the GitHub Release in the [Developer Dashboard](https://chrome.google.com/webstore/devconsole/). Complete the listing and privacy information, add a screenshot and a public GitHub Actions run for reviewers, and submit the item. [First-time publishing guide](https://developer.chrome.com/docs/webstore/publish)

## Enable automated updates

After the first version is published, enable the Chrome Web Store API in Google Cloud. Create a service account and add its email under **Account** in the Chrome Web Store Developer Dashboard. [Chrome Web Store service account setup](https://developer.chrome.com/docs/webstore/service-accounts)

Set up [Workload Identity Federation through the service account](https://github.com/google-github-actions/auth#workload-identity-federation-through-a-service-account). Use this provider attribute condition to restrict access to BGAV's release workflow on version tags.

```text
assertion.repository_id == '1456364993' &&
assertion.workflow_ref.startsWith('sadiksaifi/BGAV/.github/workflows/release.yml@refs/tags/v')
```

Add these repository variables in **Settings → Secrets and variables → Actions**.

| Variable                             | Value                                                                   |
| ------------------------------------ | ----------------------------------------------------------------------- |
| `CHROME_WEB_STORE_IDENTITY_PROVIDER` | Full Workload Identity Provider resource name                           |
| `CHROME_WEB_STORE_SERVICE_ACCOUNT`   | Email of the service account linked to the publisher                    |
| `CHROME_WEB_STORE_PUBLISHER_ID`      | Publisher ID from the Developer Dashboard account page                  |
| `CHROME_WEB_STORE_ITEM_ID`           | BGAV's extension ID from its item page                                  |
| `CHROME_WEB_STORE_ENABLED`           | `true` once the first release is published and the values above are set |

The next stable tag submits the ZIP from its GitHub Release through the Chrome Web Store v2 API. Google publishes the update after approval. If a previous version is still under review, rerun the failed submission job after that review finishes. The retry downloads the same ZIP from the GitHub Release.
