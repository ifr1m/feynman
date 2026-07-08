import test from "node:test";
import assert from "node:assert/strict";

import { patchAlphaHubAuthSource } from "../scripts/lib/alpha-hub-auth-patch.mjs";

test("patchAlphaHubAuthSource fixes browser open logic for WSL and Windows", () => {
	const input = [
		"function openBrowser(url) {",
		"  try {",
		"    const plat = platform();",
		"    if (plat === 'darwin') execSync(`open \"${url}\"`);",
		"    else if (plat === 'linux') execSync(`xdg-open \"${url}\"`);",
		"    else if (plat === 'win32') execSync(`start \"\" \"${url}\"`);",
		"  } catch {}",
		"}",
	].join("\n");

	const patched = patchAlphaHubAuthSource(input);

	assert.match(patched, /const isWsl = plat === 'linux'/);
	assert.match(patched, /wslview/);
	assert.match(patched, /cmd\.exe \/c start/);
	assert.match(patched, /cmd \/c start/);
});

test("patchAlphaHubAuthSource opens the alphaXiv sign-in URL", () => {
	const input = "process.stderr.write('Opening browser for alphaXiv login...\\n');";

	const patched = patchAlphaHubAuthSource(input);

	assert.match(patched, /Sign-in URL: \$\{buildAlphaSignInUrl\(authUrl\.toString\(\)\)\}/);
});

test("patchAlphaHubAuthSource is idempotent", () => {
	const input = [
		"function openBrowser(url) {",
		"  try {",
		"    const plat = platform();",
		"    if (plat === 'darwin') execSync(`open \"${url}\"`);",
		"    else if (plat === 'linux') execSync(`xdg-open \"${url}\"`);",
		"    else if (plat === 'win32') execSync(`start \"\" \"${url}\"`);",
		"  } catch {}",
		"}",
		"process.stderr.write('Opening browser for alphaXiv login...\\n');",
	].join("\n");

	const once = patchAlphaHubAuthSource(input);
	const twice = patchAlphaHubAuthSource(once);

	assert.equal(twice, once);
});

test("patchAlphaHubAuthSource persists pending login during OAuth", () => {
	const input = [
		"import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';",
		"export async function login() {",
		"  const server = await startCallbackServer();",
		"  process.stderr.write(`Opening browser for alphaXiv login...\\nAuth URL: ${authUrl.toString()}\\n`);",
		"  openBrowser(authUrl.toString());",
		"  process.stderr.write(`If browser didn't open, visit:\\n${authUrl.toString()}\\n\\n`);",
		"  process.stderr.write('Waiting for login...\\n');",
		"  const code = await waitForCallback(server);",
		"  saveAuth({",
		"    client_id: clientId,",
		"    access_token: tokens.access_token,",
		"    refresh_token: tokens.refresh_token,",
		"    expires_at: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : null,",
		"    user_id: userInfo?.sub || null,",
		"    user_name: userInfo?.name || userInfo?.preferred_username || null,",
		"    user_email: userInfo?.email || null,",
		"  });",
		"  return { tokens, userInfo };",
		"}",
	].join("\n");

	const patched = patchAlphaHubAuthSource(input);

	assert.match(patched, /function savePendingLogin\(data\)/);
	assert.match(patched, /savePendingLogin\(\{ clientId, verifier, authUrl: authUrl\.toString\(\) \}\)/);
	assert.match(patched, /openBrowser\(buildAlphaSignInUrl\(authUrl\.toString\(\)\)\)/);
	assert.match(patched, /clearPendingLogin\(\);[\s\S]*return \{ tokens, userInfo \}/);
});
