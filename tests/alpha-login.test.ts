import test from "node:test";
import assert from "node:assert/strict";

import { buildOAuthConsentUrl, buildOAuthSignInUrl, parseAuthorizationCode } from "../src/alpha/login.js";

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
		"https://clerk.alphaxiv.org/oauth/authorize?client_id=abc&redirect_uri=http%3A%2F%2F127.0.0.1%3A9876%2Fcallback&response_type=code&scope=profile+email+offline_access&code_challenge=xyz&code_challenge_method=S256&state=123";
	const signInUrl = buildOAuthSignInUrl(authUrl);
	const consentUrl = buildOAuthConsentUrl(authUrl);

	assert.equal(signInUrl.startsWith("https://www.alphaxiv.org/signin?redirect_url="), true);
	assert.equal(decodeURIComponent(signInUrl.split("redirect_url=")[1] ?? ""), consentUrl);
	assert.match(consentUrl, /^https:\/\/accounts\.alphaxiv\.org\/oauth-consent\?/);
});
