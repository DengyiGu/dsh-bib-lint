// Stand-in for @deepseek-ai/dsh-tools, used only by test/plugin.test.js.
// The real defineTool validates and wraps; here we need the definition back
// unchanged so the test can call execute() directly.
export function defineTool(spec) {
  return spec
}
