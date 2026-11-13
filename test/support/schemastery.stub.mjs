// Stand-in for @deepseek-ai/schemastery, used only by test/plugin.test.js.
// The plugin never reads values off the schema at runtime (the host validates and
// fills defaults before calling apply), so the stub only has to support the
// chainable builder calls used in index.js.
function chain() {
  const api = {
    default() {
      return api
    },
    description() {
      return api
    },
    min() {
      return api
    },
    max() {
      return api
    },
    required() {
      return api
    },
    pattern() {
      return api
    },
  }
  return api
}

const Schema = {
  object() {
    return chain()
  },
  string() {
    return chain()
  },
  number() {
    return chain()
  },
  boolean() {
    return chain()
  },
  array() {
    return chain()
  },
  union() {
    return chain()
  },
}

export default Schema
