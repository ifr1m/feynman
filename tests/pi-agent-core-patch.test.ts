import test from "node:test";
import assert from "node:assert/strict";

import { patchPiAgentCoreSource } from "../scripts/lib/pi-agent-core-patch.mjs";

const SOURCE = `
async function prepareToolCall(currentContext, assistantMessage, toolCall, config, signal) {
    const tool = currentContext.tools?.find((t) => t.name === toolCall.name);
    if (!tool) {
        return {
            kind: "immediate",
            result: createErrorToolResult(\`Tool \${toolCall.name} not found\`),
            isError: true,
        };
    }
    try {
        const preparedToolCall = prepareToolCallArguments(tool, toolCall);
        const validatedArgs = validateToolArguments(tool, preparedToolCall);
        if (config.beforeToolCall) {
            const beforeResult = await config.beforeToolCall({
                assistantMessage,
                toolCall,
                args: validatedArgs,
                context: currentContext,
            }, signal);
        }
        return {
            kind: "prepared",
            toolCall,
            tool,
            args: validatedArgs,
        };
    }
    catch (error) {
        return {
            kind: "immediate",
            result: createErrorToolResult(error instanceof Error ? error.message : String(error)),
            isError: true,
        };
    }
}
`;

test("patchPiAgentCoreSource maps legacy search and fetch aliases to web", () => {
	const patched = patchPiAgentCoreSource(SOURCE);

	assert.match(patched, /function normalizeFeynmanToolAlias/);
	assert.match(patched, /"web_search"/);
	assert.match(patched, /"fetch_content"/);
	assert.match(patched, /normalizeFeynmanWebToolArguments\(toolCall\.arguments, "search"\)/);
	assert.match(patched, /normalizeFeynmanWebToolArguments\(toolCall\.arguments, "goto"\)/);
	assert.match(patched, /const effectiveToolCall = normalizeFeynmanToolAlias\(toolCall, currentContext\.tools\)/);
	assert.match(patched, /t\.name === effectiveToolCall\.name/);
	assert.match(patched, /prepareToolCallArguments\(tool, effectiveToolCall\)/);
	assert.match(patched, /toolCall: preparedToolCall/);
});

test("patchPiAgentCoreSource is idempotent", () => {
	const once = patchPiAgentCoreSource(SOURCE);
	const twice = patchPiAgentCoreSource(once);
	assert.equal(twice, once);
});
