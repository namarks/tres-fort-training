# Contributor acceptance

The [source license](../LICENSE) permits evaluation and contribution work.
The [contributor terms](../CONTRIBUTOR-TERMS.md) separately grant the rights
needed to include a contribution in the official project. Contributors keep
their copyright. The required `contributor rights` check on each pull request
shows whether everyone who wrote the work has accepted those terms.

## For contributors

1. Read the complete [contributor terms](../CONTRIBUTOR-TERMS.md). Confirm
   that you can grant the stated rights, including any necessary employer or
   other rights-holder permission.
2. Open your pull request. In its description, identify third-party material
   and relevant restrictions, including material AI-generated content.
3. Post this exact sentence, on a line of its own, as a comment on the pull
   request from the GitHub account that authored the commits, using the version number at the top of
   the terms on `main`:

   > I accept the Très Fort Contributor Terms version 1.1.

   To accept on behalf of an employer or other entity, add a line naming it
   in the same comment. A quoted sentence or one inside other text does not
   count.
4. The `contributor rights` check updates within a minute. One acceptance
   covers all your pull requests open at that moment and your later ones under
   the same terms version, so you comment once, not on every pull request.

Each co-author needs to post the same comment. Opening a pull request,
checking a template box or passing CI is not acceptance. Do not post
signatures, legal contact details or employer authorizations publicly; if
something needs to stay private, email **nick@tresfort.app**.

## What the check does

The [`Contributor rights` workflow](../.github/workflows/contributor-rights.yml)
runs from `main` when a pull request opens or changes, when someone comments
on a pull request, when `main` moves, and on the owner's manual run. It never
checks out or runs pull-request code. Each run re-checks every open pull
request and sets the status on its current head commit:

| Situation | Status |
| --- | --- |
| Branch in this repository (only the owner and maintainers can push there) | Passes: the owner's own work. |
| Fork, and every author has posted the acceptance sentence for the current terms version | Passes. |
| Fork, and someone has not accepted yet | Pending, naming who still needs to. |
| An author GitHub can't link to an account, a bot author, a co-author named only by a plain email address, or more than 250 commits | Pending until the owner reviews it. |

Authors are the pull request's author, each commit's GitHub author and each
`Co-authored-by` trailer that uses a GitHub `noreply` address. The acceptance
sentence is matched ignoring case, accents and spacing, and
only comments by people (not bots) on this repository's pull requests count.
Changing the terms' version number makes everyone accept again.

## Owner decisions

For a pull request the check can't settle on its own, or to withdraw a
passing status, the owner runs the workflow manually on `main`:

| Input | Value |
| --- | --- |
| `pr_number` | The pull-request number. |
| `head_sha` | Its exact current head commit, all 40 hexadecimal characters. |
| `decision` | `approve` to pass this head; `revoke` to block it. |
| `confirmation` | Confirm that every author, co-author and relevant rights-holder at this head is covered. |

Only the owner can run it, and only for the pull request's current head. The
decision sticks to that head and terms version: a new push or a new terms
version returns the pull request to the automatic check. Keep any private
evidence behind an approval out of the workflow inputs.

Before merging, the owner still reviews the final head for third-party
material and provenance, as the terms require. A passing status records
acceptance; it does not verify employer authority or ownership.

GitHub documents [required status checks](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches#require-status-checks-before-merging)
and [commit statuses](https://docs.github.com/en/rest/commits/statuses).
