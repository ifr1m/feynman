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
	const input = [
		"function buildAlphaSignInUrl(authUrl) { return authUrl; }",
		"async function resolveAlphaOAuthStartUrl(authUrl) { return authUrl; }",
		"export async function login() {",
		"  const server = await startCallbackServer();",
		"",
		"  savePendingLogin({ clientId, verifier, authUrl: authUrl.toString() });",
		"",
		"  process.stderr.write(`Opening browser for alphaXiv login...\\nSign-in URL: ${buildAlphaSignInUrl(authUrl.toString())}\\n`);",
		"  openBrowser(buildAlphaSignInUrl(authUrl.toString()));",
		"  process.stderr.write(`If browser didn't open, visit:\\n${buildAlphaSignInUrl(authUrl.toString())}\\n\\n`);",
		"  process.stderr.write('Waiting for localhost callback on http://127.0.0.1:9876/callback ...\\n');",
		"  process.stderr.write('Use email sign-in on that page, not Google. Google login skips the CLI OAuth redirect.\\n');",
		"  process.stderr.write('If sign-in stalls: feynman alpha consent | feynman alpha complete <callback-url>\\n');",
		"",
		"  const code = await waitForCallback(server);",
		"}",
	].join("\n");

	const patched = patchAlphaHubAuthSource(input);

	assert.match(patched, /const startUrl = await resolveAlphaOAuthStartUrl\(authUrl\.toString\(\)\)/);
	assert.match(patched, /Sign-in URL: \$\{startUrl\}/);
	assert.match(patched, /openBrowser\(startUrl\)/);
});

test("patchAlphaHubAuthSource migrates Clerk OAuth hosts to Better Auth", () => {
	const input = [
		"const CLERK_ISSUER = 'https://clerk.alphaxiv.org';",
		"const AUTH_ENDPOINT = `${CLERK_ISSUER}/oauth/authorize`;",
		"const TOKEN_ENDPOINT = `${CLERK_ISSUER}/oauth/token`;",
		"const REGISTER_ENDPOINT = `${CLERK_ISSUER}/oauth/register`;",
		"const CALLBACK_PORT = 9876;",
		"const REDIRECT_URI = `http://127.0.0.1:${CALLBACK_PORT}/callback`;",
		"const USERINFO_ENDPOINT = `${CLERK_ISSUER}/oauth/userinfo`;",
		"const SCOPES = 'profile email offline_access';",
		"const consent = new URL('https://accounts.alphaxiv.org/oauth-consent');",
	].join("\n");

	const patched = patchAlphaHubAuthSource(input);

	assert.match(patched, /https:\/\/api\.alphaxiv\.org\/auth/);
	assert.match(patched, /\$\{CLERK_ISSUER\}\/oauth2\/authorize/);
	assert.match(patched, /\$\{CLERK_ISSUER\}\/oauth2\/register/);
	assert.match(patched, /openid profile email offline_access/);
	assert.match(patched, /https:\/\/www\.alphaxiv\.org\/oauth\/consent/);
	assert.equal(patched.includes("clerk.alphaxiv.org"), false);
	assert.equal(patched.includes("accounts.alphaxiv.org"), false);
});

test("patchAlphaHubAuthSource Better Auth migration is idempotent", () => {
	const input = [
		"const CLERK_ISSUER = 'https://clerk.alphaxiv.org';",
		"const AUTH_ENDPOINT = `${CLERK_ISSUER}/oauth/authorize`;",
		"const TOKEN_ENDPOINT = `${CLERK_ISSUER}/oauth/token`;",
		"const REGISTER_ENDPOINT = `${CLERK_ISSUER}/oauth/register`;",
		"const CALLBACK_PORT = 9876;",
		"const REDIRECT_URI = `http://127.0.0.1:${CALLBACK_PORT}/callback`;",
		"const USERINFO_ENDPOINT = `${CLERK_ISSUER}/oauth/userinfo`;",
		"const SCOPES = 'profile email offline_access';",
	].join("\n");

	const once = patchAlphaHubAuthSource(input);
	const twice = patchAlphaHubAuthSource(once);
	assert.equal(twice, once);
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
	assert.match(patched, /const startUrl = await resolveAlphaOAuthStartUrl\(authUrl\.toString\(\)\)/);
	assert.match(patched, /openBrowser\(startUrl\)/);
	assert.match(patched, /clearPendingLogin\(\);[\s\S]*return \{ tokens, userInfo \}/);
});
