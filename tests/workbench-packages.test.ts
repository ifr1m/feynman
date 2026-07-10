import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { updateWorkbenchPackageSettings } from "../src/workbench/package-settings.js";
import { buildWorkbenchState } from "../src/workbench/scan.js";

function writePackage(root: string, name: string, manifest: Record<string, unknown>): void {
	const packageRoot = join(root, ".feynman", "npm", "node_modules", ...name.split("/"));
	mkdirSync(packageRoot, { recursive: true });
	writeFileSync(join(packageRoot, "package.json"), JSON.stringify({
		name,
		...manifest,
	}, null, 2));
}

test("workbench connector resources expose package state and lifecycle metadata", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-workbench-packages-"));
	try {
		mkdirSync(join(root, ".feynman"), { recursive: true });
		writeFileSync(join(root, ".feynman", "settings.json"), JSON.stringify({
			packages: [
				"npm:pi-docparser",
			],
		}, null, 2));
		writePackage(root, "pi-docparser", {
			version: "3.0.1",
			description: "Document parsing for local PDFs.",
			pi: {
				extensions: ["./extensions/docparser/index.ts"],
				skills: ["./skills"],
			},
		});

		const state = buildWorkbenchState({ workingDir: root });
		const connectors = state.resources.find((group) => group.id === "connectors")?.resources ?? [];
		const docparser = connectors.find((resource) => resource.name === "pi-docparser");
		const webTool = connectors.find((resource) => resource.name === "web");
		const alphaHub = connectors.find((resource) => resource.name === "alpha-hub");
		const memory = connectors.find((resource) => resource.name === "pi-memory");

		assert.equal(docparser?.status, "configured");
		assert.equal(docparser?.source, "Pi core package");
		assert.equal(docparser?.packageAction, "disable");
		assert.deepEqual(docparser?.packageSources, ["npm:pi-docparser"]);
		assert.match(docparser?.detail ?? "", /v3\.0\.1/);
		assert.match(docparser?.detail ?? "", /1 extensions, 1 skills/);
		assert.ok(docparser?.tags.includes("installed"), "expected installed package tag");
		assert.ok(docparser?.diagnostics?.some((item) => item.includes(".feynman/settings.json")), "expected project config diagnostic");
		assert.ok(docparser?.diagnostics?.some((item) => item.includes(".feynman/npm/node_modules/pi-docparser")), "expected install path diagnostic");
		assert.ok(docparser?.diagnostics?.some((item) => item.includes("project trust gates loading")), "expected Pi trust boundary diagnostic");

		assert.equal(webTool?.status, "configured");
		assert.equal(webTool?.source, "Feynman extension");
		assert.match(webTool?.detail ?? "", /extensions\/web/);
		assert.ok(webTool?.tags.includes("web"), "expected bundled web tool tag");

		assert.equal(alphaHub?.status, "disabled");
		assert.equal(alphaHub?.packageAction, "enable");
		assert.ok(alphaHub?.diagnostics?.some((item) => item.includes("core package is known but not enabled")), "expected disabled core diagnostic");

		assert.equal(memory?.status, "available");
		assert.equal(memory?.source, "Pi optional package");
		assert.equal(memory?.packageAction, "enable");
		assert.ok(memory?.diagnostics?.some((item) => item.includes("available preset")), "expected optional preset diagnostic");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("workbench package setting updates enable and disable project package sources", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-workbench-package-settings-"));
	try {
		mkdirSync(join(root, ".feynman"), { recursive: true });
		const settingsPath = join(root, ".feynman", "settings.json");
		writeFileSync(settingsPath, JSON.stringify({
			packages: ["npm:pi-docparser", "npm:@samfp/pi-memory"],
		}, null, 2));

		updateWorkbenchPackageSettings(root, "disable", ["npm:pi-docparser"]);
		assert.deepEqual(JSON.parse(readFileSync(settingsPath, "utf8")).packages, ["npm:@samfp/pi-memory"]);

		updateWorkbenchPackageSettings(root, "enable", ["npm:pi-btw"]);
		assert.deepEqual(JSON.parse(readFileSync(settingsPath, "utf8")).packages, [
			"npm:@samfp/pi-memory",
			"npm:pi-btw",
		]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
