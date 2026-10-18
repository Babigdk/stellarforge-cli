# Requirements Document

## Introduction

This feature adds a repository conformance check that fails when a GitHub Actions `uses:` reference introduces an external action without an immutable full commit SHA (40-character hexadecimal). The check is implemented as a dependency-light script that scans `.github/workflows/*.yml` files, allows local action references (`./.github/actions/...`) unconditionally, and enforces that every external reference is pinned to a complete, immutable SHA. The check is integrated into CI without elevating workflow permissions, and all existing pinned workflows continue to pass.

## Glossary

- **Checker**: The conformance script that scans workflow YAML files and reports violations.
- **External_Action**: A GitHub Actions `uses:` reference that is not a local path reference (i.e., does not start with `./`).
- **Local_Action**: A GitHub Actions `uses:` reference that begins with `./` and points to a path inside the repository.
- **Full_Commit_SHA**: A 40-character lowercase hexadecimal string that identifies an immutable Git commit object.
- **Mutable_Ref**: A `uses:` reference that resolves to a tag, branch name, or any non-SHA pointer (e.g., `actions/checkout@v4`, `actions/checkout@main`).
- **Workflow_File**: A YAML file located under `.github/workflows/` with a `.yml` or `.yaml` extension.
- **Pinned_Ref**: A `uses:` value whose version component is a Full_Commit_SHA.
- **Version_Component**: The portion of a `uses:` value that follows the `@` character.
- **CI_Job**: A GitHub Actions job that runs the Checker as part of the pull-request or push pipeline.

---

## Requirements

### Requirement 1: Scan Workflow Files for Action References

**User Story:** As a maintainer, I want the Checker to locate and inspect every `uses:` reference in all Workflow_Files, so that no action reference is overlooked.

#### Acceptance Criteria

1. THE Checker SHALL scan all files matching `.github/workflows/*.yml` and `.github/workflows/*.yaml` relative to the repository root path provided as its input argument.
2. WHEN a Workflow_File contains one or more `uses:` fields, THE Checker SHALL extract every occurrence of every referenced value across all jobs and steps for evaluation.
3. WHEN a `uses:` field contains an empty or blank value, THE Checker SHALL classify that reference as a violation.
4. WHEN no Workflow_Files are present in the repository, THE Checker SHALL exit with code zero and emit a diagnostic message to stdout indicating that no files were found.
5. IF a Workflow_File cannot be read due to a filesystem error, THEN THE Checker SHALL emit an error message to stderr that includes the name of the affected file and exit with a non-zero code.

---

### Requirement 2: Permit Local Action References

**User Story:** As a maintainer, I want the Checker to unconditionally allow Local_Actions, so that internal composite actions introduced intentionally are not blocked.

#### Acceptance Criteria

1. WHEN a `uses:` value starts with `./`, THE Checker SHALL classify the reference as a Local_Action and skip SHA validation for that reference.
2. THE Checker SHALL treat all Local_Action references as passing, include them in the references-checked count emitted in the summary, and record each passing Local_Action in the same summary output used for Pinned_Refs, regardless of the path content following `./`.

---

### Requirement 3: Require Full Commit SHA for External Actions

**User Story:** As a maintainer, I want every External_Action reference to be pinned to a Full_Commit_SHA, so that supply-chain substitution via mutable tags or branch pointers is prevented.

#### Acceptance Criteria

1. WHEN a `uses:` value does not start with `./` and contains an `@` character, THE Checker SHALL extract the Version_Component and validate that it is exactly 40 lowercase hexadecimal characters; if validation fails, THE Checker SHALL classify the reference as a Mutable_Ref.
2. WHEN the Version_Component of an External_Action is a Full_Commit_SHA, THE Checker SHALL classify the reference as a Pinned_Ref and record a pass for that reference.
3. WHEN the Version_Component of an External_Action is not a Full_Commit_SHA (including uppercase hex strings, tags, branch names, or any other non-conforming value), THE Checker SHALL classify the reference as a violation.
4. WHEN an External_Action `uses:` value does not contain an `@` character, THE Checker SHALL classify the reference as a violation.
5. WHEN the Checker detects one or more violations, THE Checker SHALL emit a report listing each violation with its file path, line number, and the offending `uses:` value, then exit with code 5.
6. WHEN the Checker detects no violations, THE Checker SHALL emit a summary stating the number of references checked and confirming zero violations, then exit with code zero.

---

### Requirement 4: No Network Lookup Required

**User Story:** As a CI operator, I want the conformance check to operate entirely offline, so that it does not fail due to network conditions or require outbound access.

#### Acceptance Criteria

1. THE Checker SHALL perform all validation using only the local filesystem content of Workflow_Files.
2. THE Checker SHALL not open any TCP, UDP, or other network socket connections during execution.
3. THE Checker SHALL not invoke any external tools whose execution path includes network operations (such as DNS lookups, HTTP requests, or package registry queries).

---

### Requirement 5: CI Integration Without Elevated Permissions

**User Story:** As a security-conscious maintainer, I want the CI job that runs the Checker to operate with the minimum required permissions, so that the check cannot be exploited to access privileged resources.

#### Acceptance Criteria

1. THE CI_Job that executes the Checker SHALL declare exactly one permission key, `contents`, set to `read`, with no additional permission keys present in the job's `permissions` block.
2. THE CI_Job SHALL not request `write` or `admin` permission for any GitHub API scope.
3. THE CI_Job SHALL not reference any value under the `secrets` context other than `GITHUB_TOKEN`, and SHALL not pass any secret as an environment variable or input to the Checker step.
4. WHEN the CI pipeline receives a `pull_request` or `push` event targeting `main`, THE CI_Job SHALL execute the Checker.
5. WHEN the Checker exits with a non-zero code, THE CI_Job SHALL report a job failure.
6. THE Checker SHALL run in a dedicated step with no other commands chained to it, and the step SHALL not use `continue-on-error: true`, `|| true`, `; true`, or any output redirection pattern that would suppress the Checker's exit code.

---

### Requirement 6: Existing Pinned Workflows Pass

**User Story:** As a maintainer, I want all currently pinned workflow files in the repository to pass the Checker without modification, so that introducing this check does not create immediate false failures.

#### Acceptance Criteria

1. WHEN the Checker is run against the `.github/workflows/*.yml` and `.github/workflows/*.yaml` files present in the repository at the time this feature is merged, THE Checker SHALL exit with code zero and report zero violations.
2. THE Checker SHALL classify every `uses:` reference in the current repository workflow files as either a Pinned_Ref (Version_Component is a 40-character lowercase hex string, including references in sub-path actions of the form `owner/repo/path@<sha>`) or a Local_Action (value begins with `./`), with no reference classified as a violation.

---

### Requirement 7: Fixture-Based Validation of Failure Cases

**User Story:** As a developer, I want the test suite to include fixture Workflow_Files that exercise both passing and failing scenarios, so that the Checker's logic is verifiable without modifying production workflows.

#### Acceptance Criteria

1. THE test suite SHALL include at least one fixture Workflow_File stored outside `.github/workflows/` whose `uses:` references are all Full_Commit_SHAs.
2. WHEN the Checker is run against that fixture, THE Checker SHALL report zero violations and exit with code zero.
3. THE test suite SHALL include at least one fixture Workflow_File stored outside `.github/workflows/` containing at least one Mutable_Ref (such as a tag like `@v4` or a branch like `@main`).
4. WHEN the Checker is run against that fixture, THE Checker SHALL report at least one violation and exit with code 5.
5. THE test suite SHALL include at least one fixture Workflow_File stored outside `.github/workflows/` containing a Local_Action reference and no External_Action references.
6. WHEN the Checker is run against that fixture, THE Checker SHALL classify the Local_Action reference as passing and exit with code zero.
7. THE test suite SHALL include at least one fixture Workflow_File stored outside `.github/workflows/` containing an External_Action `uses:` value with no `@` character.
8. WHEN the Checker is run against that fixture, THE Checker SHALL classify that reference as a violation and exit with code 5.
9. IF a fixture file contains only Pinned_Refs and Local_Actions, THEN THE Checker SHALL exit with code zero when run against that fixture (round-trip correctness).
10. IF a fixture file contains at least one Mutable_Ref, THEN THE Checker SHALL exit with a non-zero code when run against that fixture (valid failure detection).
