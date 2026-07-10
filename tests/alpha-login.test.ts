import test from "node:test";
import assert from "node:assert/strict";

import { buildOAuthConsentUrl, buildOAuthContinueUrl, buildOAuthSignInUrl, parseAuthorizationCode } from "../src/alpha/login.js";

test("parseAuthorizationCode accepts raw code", () => {
	assert.equal(parseAuthorizationCode("abc123"), "abc123");
});

test("parseAuthorizationCode extracts code from callback URL", () => {
	assert.equal(
		parseAuthorizationCode("http://127.0.0.1:9876/callback?code=abc123&state=xyz"),
		"abc123",
	);
});

test("parseAuthorizationCode rejects callback URL without code", () => {
	assert.throws(() => parseAuthorizationCode("http://127.0.0.1:9876/callback?state=xyz"), /missing \?code=/);
});

test("buildOAuthSignInUrl wraps consent redirect for alphaXiv sign-in", () => {
	const authUrl =
		"https://api.alphaxiv.org/auth/oauth2/authorize?client_id=abc&redirect_uri=http%3A%2F%2F127.0.0.1%3A9876%2Fcallback&response_type=code&scope=openid+profile+email+offline_access&code_challenge=xyz&code_challenge_method=S256&state=123";
	const signInUrl = buildOAuthSignInUrl(authUrl);
	const consentUrl = buildOAuthConsentUrl(authUrl);

	assert.equal(signInUrl.startsWith("https://www.alphaxiv.org/signin?flow="), true);
	assert.equal(decodeURIComponent(signInUrl.split("flow=")[1] ?? ""), `/oauth/consent${new URL(authUrl).search}`);
	assert.match(consentUrl, /^https:\/\/www\.alphaxiv\.org\/oauth\/consent\?/);
});

test("buildOAuthContinueUrl reuses the Better Auth authorize URL", () => {
	const authUrl = "https://api.alphaxiv.org/auth/oauth2/authorize?client_id=abc";
	assert.equal(buildOAuthContinueUrl(authUrl), authUrl);
});

test("resolveOAuthStartUrl prefers Better Auth signed sign-in redirect", async () => {
	const { resolveOAuthStartUrl } = await import("../src/alpha/login.js");
	const registration = await fetch("https://api.alphaxiv.org/auth/oauth2/register", {
		method: "POST",
		headers: { "Content-Type": "application/json", Accept: "application/json" },
		body: JSON.stringify({
			client_name: "Feynman test",
			redirect_uris: ["http://127.0.0.1:9876/callback"],
			grant_types: ["authorization_code"],
			response_types: ["code"],
			token_endpoint_auth_method: "none",
		}),
	});
	assert.equal(registration.ok, true);
	const { client_id: clientId } = (await registration.json()) as { client_id: string };
	const authUrl = new URL("https://api.alphaxiv.org/auth/oauth2/authorize");
	authUrl.searchParams.set("client_id", clientId);
	authUrl.searchParams.set("redirect_uri", "http://127.0.0.1:9876/callback");
	authUrl.searchParams.set("response_type", "code");
	authUrl.searchParams.set("scope", "openid profile email");
	authUrl.searchParams.set("state", "test");
	authUrl.searchParams.set("code_challenge", "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG");
	authUrl.searchParams.set("code_challenge_method", "S256");

	const startUrl = await resolveOAuthStartUrl(authUrl.toString());
	assert.equal(startUrl.startsWith("https://www.alphaxiv.org/signin?"), true);
	assert.equal(startUrl.includes("sig="), true);
	assert.equal(startUrl.includes("redirect_url="), false);
});
