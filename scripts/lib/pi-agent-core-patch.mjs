const HELPER = `
function normalizeFeynmanWebToolArguments(args, action) {
    if (!args || typeof args !== "object" || Array.isArray(args)) {
        return { action };
    }
    const normalized = { ...args, action };
    if (action === "search") {
        if (typeof normalized.query !== "string") {
            if (typeof normalized.q === "string") {
                normalized.query = normalized.q;
                delete normalized.q;
            }
            else if (Array.isArray(normalized.queries) && typeof normalized.queries[0] === "string") {
                normalized.query = normalized.queries[0];
            }
            else if (Array.isArray(normalized.q) && typeof normalized.q[0] === "string") {
                normalized.query = normalized.q[0];
            }
        }
        delete normalized.queries;
        delete normalized.q;
    }
    if (action === "goto") {
        if (typeof normalized.url !== "string") {
            if (Array.isArray(normalized.urls) && typeof normalized.urls[0] === "string") {
                normalized.url = normalized.urls[0];
            }
            else if (Array.isArray(normalized.url) && typeof normalized.url[0] === "string") {
                normalized.url = normalized.url[0];
            }
        }
        delete normalized.urls;
    }
    return normalized;
}

function normalizeFeynmanToolAlias(toolCall, tools) {
    const hasWeb = tools?.some((tool) => tool.name === "web");
    if (!hasWeb) {
        return toolCall;
    }
    const searchAliases = new Set([
        "google:search",
        "google_search",
        "google.search",
        "search_google",
        "search_web",
        "WebSearch",
        "web_search",
    ]);
    const gotoAliases = new Set([
        "fetch",
        "WebFetch",
        "read_url_content",
        "fetch_content",
        "get_search_content",
    ]);
    if (searchAliases.has(toolCall.name)) {
        return {
            ...toolCall,
            name: "web",
            arguments: normalizeFeynmanWebToolArguments(toolCall.arguments, "search"),
        };
    }
    if (gotoAliases.has(toolCall.name)) {
        return {
            ...toolCall,
            name: "web",
            arguments: normalizeFeynmanWebToolArguments(toolCall.arguments, "goto"),
        };
    }
    return toolCall;
}
`;

export function patchPiAgentCoreSource(source) {
	if (source.includes("function normalizeFeynmanToolAlias(")) {
		return source;
	}

	const prepareStart = "async function prepareToolCall(currentContext, assistantMessage, toolCall, config, signal) {\n";
	if (!source.includes(prepareStart)) {
		return source;
	}

	let patched = source.replace(prepareStart, `${HELPER}\n${prepareStart}`);
	patched = patched.replace(
		"async function prepareToolCall(currentContext, assistantMessage, toolCall, config, signal) {\n    const tool = currentContext.tools?.find((t) => t.name === toolCall.name);",
		"async function prepareToolCall(currentContext, assistantMessage, toolCall, config, signal) {\n    const effectiveToolCall = normalizeFeynmanToolAlias(toolCall, currentContext.tools);\n    const tool = currentContext.tools?.find((t) => t.name === effectiveToolCall.name);",
	);
	patched = patched.replace(
		"        const preparedToolCall = prepareToolCallArguments(tool, toolCall);",
		"        const preparedToolCall = prepareToolCallArguments(tool, effectiveToolCall);",
	);
	patched = patched.replace(
		"                toolCall,\n                args: validatedArgs,",
		"                toolCall: preparedToolCall,\n                args: validatedArgs,",
	);
	patched = patched.replace(
		"            toolCall,\n            tool,",
		"            toolCall: preparedToolCall,\n            tool,",
	);
	return patched;
}
