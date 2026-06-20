import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { resolveExecutable } from "../system/executables.js";

export type WebToolStatus = {
	extensionPath: string;
	extensionExists: boolean;
	kdriverReady: boolean;
	runtime: string;
};

export function getWebExtensionPath(appRoot: string): string {
	return resolve(appRoot, "extensions", "web", "index.ts");
}

export function getWebToolStatus(appRoot: string): WebToolStatus {
	const extensionPath = getWebExtensionPath(appRoot);
	return {
		extensionPath,
		extensionExists: existsSync(extensionPath),
		kdriverReady: Boolean(resolveExecutable("kdriver-cli")),
		runtime: process.env.PI_WEB_KDRIVER_RUNTIME?.trim() || "container",
	};
}

export function formatWebToolDoctorLines(status: WebToolStatus): string[] {
	return [
		"web tool: extensions/web (kdriver-cli)",
		`  extension: ${status.extensionPath}${status.extensionExists ? "" : " (missing)"}`,
		`  kdriver-cli: ${status.kdriverReady ? "ready" : "missing on PATH"}`,
		`  runtime: ${status.runtime}`,
	];
}
