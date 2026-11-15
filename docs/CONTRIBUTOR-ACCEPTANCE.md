# Contributor acceptance

The [source license](../LICENSE) permits evaluation and contribution work.
The [contributor terms](../CONTRIBUTOR-TERMS.md) separately grant the rights
needed to include a contribution in the official project. Contributors keep
their copyright. The terms are accepted privately, and the maintainer records
coverage for each pull request before merging it.

## For contributors

1. Read the complete contributor terms before submitting work. Confirm that
   you can grant the stated rights, including any necessary employer or other
   rights-holder permission. Identify third-party material and relevant
   restrictions, including material AI-generated content.
2. Contact **nick@tresfort.app** to arrange private acceptance. Include your
   GitHub username and the pull-request URL or proposed contribution. Do not
   send identity documents unless a specific need and secure channel have
   been agreed. Do not post signatures, legal contact details or employer
   authorizations in a public issue or pull request.
3. The maintainer supplies an immutable copy of the agreement, its version and
   SHA-256 hash, and a private signing or affirmative-acceptance process that
   verifies your identity and binds it to your GitHub account. An ordinary
   unverified email is not sufficient identity verification.
4. Accept that exact text and identify the work covered. Acceptance also
   expressly covers your intentional future contributions under the same
   agreement version. A changed agreement requires a new acceptance.

Contacting the maintainer, opening a PR, checking a template box, or passing CI
does not constitute acceptance. You may prepare a PR while acceptance is
being arranged, but the contribution cannot merge until the required record
and rights review are complete.

## Private acceptance record

The maintainer preserves the following outside this public repository and
outside Actions logs or artifacts, with access limited to agreement
administrators and authorized legal successors:

- The accepted agreement version, exact file bytes and SHA-256 hash, plus the
  immutable repository commit from which the text was taken.
- The contributor's verified legal identity; GitHub login and stable numeric
  account ID; represented entity and authority, if applicable; and the method
  used to authenticate and link those identities.
- The affirmative acceptance statement, timestamp and signed record or other
  evidence of acceptance.
- The initial contribution identifiers: repository, PR and relevant commits.
  Identify earlier work explicitly if the acceptance is intended to cover it.
- Any necessary employer or other rights-holder authorization, and third-party
  provenance, licenses and notices reviewed for the contribution.

Use a frozen copy of `CONTRIBUTOR-TERMS.md` from official `main`, not an editable
link or a PR's proposed replacement. Hash the exact UTF-8 file bytes, including
line endings. On macOS, the maintainer can compute the digest with:

```bash
shasum -a 256 CONTRIBUTOR-TERMS.md
```

The following statement is a template for the **private** acceptance record;
the filled statement is not posted in the repository:

> I accept Très Fort Contributor Terms version [version], SHA-256 [digest],
> whose complete text is attached to this record. I accept in my own capacity
> [or as an authorized representative of the named rights-holder]. This
> acceptance covers [identified contribution] and my intentional future
> Contributions under that same accepted version. I confirm the authority
> and disclosures required by those terms.

The process must retain the complete accepted text and identity verification,
not just this statement or a hash. If authority or ownership is uncertain,
resolve it privately before treating the grant as effective.

## Review every final PR head

Before each merge, the maintainer creates a private review receipt containing:

- Repository and PR identity, exact final head SHA, current agreement version
  and hash, review timestamp and reviewer identity.
- Every author, coauthor and relevant rights-holder, with the acceptance or
  other permission covering their contribution. Review actual contribution
  provenance; Git author fields, account names and coauthor trailers alone
  are not proof of identity, authorship or authority.
- Third-party material, its applicable license and required notices, and the
  decision that inclusion and intended distribution are permitted.
- Any needed employer permission, exclusions or separately negotiated grants.

Existing acceptance may cover later intentional work under the same text,
but newly added people or rights-holders need their own coverage. A changed
head requires renewed review even when the author list appears unchanged.
Changes to the agreement text require fresh acceptance under the new version;
do not silently reuse a version number for different text.

For work Nicholas Marks owns, record that authorship and provenance instead
of asking him to license his own work to himself. That does not establish
rights in coauthored, employer-owned, third-party or AI-assisted material.
The initial repository snapshot requires the same existing-rights inventory;
a fresh Git history does not change who owns the underlying work.

## Public coverage status

The required `contributor rights` status records the maintainer's review for
the exact PR head. Only the status and minimal verification metadata are public;
the private record, identities, contact details, signatures and permissions
are never uploaded to a workflow or included in its inputs.

After completing the private review, the owner runs the
[`Contributor rights` workflow](../.github/workflows/contributor-rights.yml)
on `main` with these inputs:

| Input | Value |
| --- | --- |
| `pr_number` | The reviewed pull-request number. |
| `head_sha` | Its exact current head commit, all 40 hexadecimal characters. |
| `terms_sha256` | The SHA-256 digest of the agreement on official `main`. |
| `receipt_sha256` | The SHA-256 digest of the complete private review receipt. |
| `decision` | `approve` to record completed review; `revoke` to withdraw it. |
| `confirmation` | Confirm that every author, coauthor and relevant rights-holder at this head is covered before approving. |

Retain the receipt itself privately; hashing does not substitute for preserving
the evidence. Do not put its contents, a private storage URL or contact details
into workflow inputs. Only the owner can dispatch a decision. The workflow
verifies PR identity, current head and the official agreement digest. It never
runs the contributor's code with permission to issue this status.

Every rights-workflow run first resets coverage for **all open PR heads** to
pending, then an owner approval may clear its one reviewed PR. This conservative
rule prevents a queued or older run from restoring stale coverage. Activity on
another PR, changed terms, or a failed approval attempt can therefore clear an
earlier approval. Approve the PR intended for immediate merge, wait for the
workflow to finish, then verify its current head, current terms and status
before merging. Open PRs sharing the same head must be resolved before approval
because GitHub commit statuses attach to the commit, not a unique PR.

A successful status is an attestation that the private review was completed.
The workflow does not independently verify signatures, employer authority or
ownership and must not be used to bypass missing records. A head or agreement
change requires review again. Confirm the approved head is still current
immediately before merging, together with the other required review and CI
checks. A skipped or incomplete workflow does not provide approval.

GitHub documents [required status checks](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches#require-status-checks-before-merging)
and [commit statuses](https://docs.github.com/en/rest/commits/statuses).
