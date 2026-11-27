# Release readiness checklist

Use this checklist when preparing a release. It is intentionally environment-agnostic; platform-specific values belong in access-controlled configuration maintained outside this repository.

## Before a release

- Review the change and its versioned contracts.
- Run the type checks, automated tests, and build described in the development guide.
- Confirm the target environment is configured through the maintainers' standard release process.
- Check that the change has appropriate health, timeout, and resource-limit behavior for its intended use.

## During rollout

- Promote only a revision that passed the required checks.
- Follow the established release process to verify service health and compatibility with its consumers.
- Use the existing recovery procedure if the new revision does not meet its readiness criteria.

## After a release

- Review aggregate service health and error trends using approved observability tools.
- Record follow-up work in the project's normal tracking process.
- Keep environment-specific identifiers, hostnames, credentials, and account details out of public source and documentation.
