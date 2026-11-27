# Development

Senku provides versioned decision profiles through a Worker API. The code is organized around shared request validation, profile contracts, authentication, and provider adapters so that these behaviors can be tested independently.

## Local setup

Install the dependencies with `npm ci`.

## Checks

Run these checks before submitting a change:

```sh
npm run typecheck
npm test
npm run build
```

The test suite uses synthetic requests and mocked provider responses. The local integration harness exercises the service-binding boundary without sending requests to a deployed service:

```sh
npm run test:soyuz-simulator
```

## Contract artifacts

The profile registry is the source for the checked-in response contract artifact. Regenerate it after changing the registry, then verify that generation is reproducible:

```sh
npm run contracts:generate
npm run contracts:check
```

## Contribution guidance

- Keep request parsing, admission control, profile evaluation, and provider transport in separate modules.
- Add focused tests for new behavior, error handling, and boundary conditions.
- Use synthetic inputs and mocked network responses in routine tests.
- Avoid adding environment-specific values or private operational details to source and documentation.
