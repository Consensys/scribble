<p align="center">
  <img width="460" height="300" src="logo.png">
</p>


[![Build Status](https://drone.infra.mythx.io/api/badges/ConsenSys/scribble/status.svg)](https://drone.infra.mythx.io/ConsenSys/scribble)
[![Documentation](https://aleen42.github.io/badges/src/gitbook_2.svg)](https://docs.scribble.codes)

A Solidity runtime verification tool for property based testing.

## Principles and Design Goals

The design of the Scribble specification language takes inspiration from several existing
languages and we expect the language to evolve gradually as we gain more experience
in using it. We rely on the following principles and design goals to guide language
evolution:

1) Specifications are easy to understand by developers and auditors
2) Specifications are simple to reason about
3) Specifications can be efficiently checked using off-the-shelf analysis tools
4) A small number of core specification constructs are sufficient to express and reason about more advanced constructs

We are aware that this will make it difficult or impossible to express certain
properties. We encourage users to reach out if they encounter such properties. However, it
is not our itention to support every property imaginable. We consider it a great success if
Scribble is able to capture 95% of the properties that users *want* to express.

## Usage

Install Scribble with npm:
```
npm install -g eth-scribble
```

Use CLI tool with the Solidity source file:

```sh
scribble sample.sol
```

Use `--help` to see all available features.

## Documentation

For more information on the Scribble specification language, and any other documentation, go to: [Scribble Documentation](https://docs.scribble.codes)

## Development installation

-   Install prerequisites:
    -   NodeJS version **10.x** - **12.x**.
    -   NPM version **6.9.0** or newer.
-   Clone repository:
    ```sh
    git clone https://github.com/ConsenSys/scribble.git
    ```
-   Install and link:
    ```sh
    npm install
    npm link
    ```
