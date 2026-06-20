import test from "node:test";
import assert from "node:assert/strict";

import { printSearchStatus } from "../src/search/commands.js";

test("printSearchStatus reports bundled web extension status", () => {
	const lines: string[] = [];
	const originalLog = console.log;
	console.log = (...args: unknown[]) => {
		lines.push(args.map(String).join(" "));
	};
	try {
		printSearchStatus(process.cwd());
	} finally {
		console.log = originalLog;
	}
	const output = lines.join("\n");
	assert.match(output, /Managed by: extensions\/web/);
	assert.match(output, /extensions\/web\/index\.ts/);
});
