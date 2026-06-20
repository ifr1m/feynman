import { getWebToolStatus } from "../pi/web-tool.js";
import { printInfo } from "../ui/terminal.js";

export function printSearchStatus(appRoot: string): void {
	const status = getWebToolStatus(appRoot);
	printInfo("Managed by: extensions/web (kdriver-cli)");
	printInfo(`Extension: ${status.extensionPath}${status.extensionExists ? "" : " (missing)"}`);
	printInfo(`kdriver-cli: ${status.kdriverReady ? "ready" : "missing on PATH"}`);
	printInfo(`Runtime: ${status.runtime} (set PI_WEB_KDRIVER_RUNTIME=local|container)`);
	if (!status.kdriverReady) {
		printInfo("Install kdriver-cli and ensure it is on PATH before using the web tool.");
	}
}
