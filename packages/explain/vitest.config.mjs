// The first test in each file compiles the rule pack's patterns, which can
// take a few seconds on a busy four-core runner with every file in parallel.
export default {
  test: {
    testTimeout: 20_000,
  },
};
