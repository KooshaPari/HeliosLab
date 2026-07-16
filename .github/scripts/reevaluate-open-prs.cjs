"use strict";

const PAGE_SIZE = 100;

/**
 * Enumerate every open pull request and dispatch the canonical governance
 * workflow for its current head. API and dispatch failures intentionally
 * propagate so constitution re-evaluation fails closed.
 */
module.exports = async function reevaluateOpenPullRequests({ github, context }) {
	const { owner, repo } = context.repo;
	let page = 1;
	let dispatched = 0;

	while (true) {
		const response = await github.rest.pulls.list({
			owner,
			repo,
			state: "open",
			per_page: PAGE_SIZE,
			page,
		});
		const pulls = response.data;
		if (!Array.isArray(pulls)) {
			throw new Error(`Open pull request inventory page ${page} was not an array`);
		}

		for (const pull of pulls) {
			if (!Number.isInteger(pull.number) || typeof pull.head?.sha !== "string") {
				throw new Error(`Open pull request inventory page ${page} contained invalid data`);
			}

			await github.rest.repos.createDispatchEvent({
				owner,
				repo,
				event_type: "constitution-review-reevaluation",
				client_payload: {
					pr_number: String(pull.number),
					head_sha: pull.head.sha,
					constitution_sha: context.sha,
				},
			});
			dispatched += 1;
		}

		if (pulls.length < PAGE_SIZE) {
			return dispatched;
		}
		page += 1;
	}
};
