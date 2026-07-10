import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

const REDIRECT_URI = "http://127.0.0.1:9876/callback";
const AUTH_ISSUER = "https://api.alphaxiv.org/auth";
const TOKEN_ENDPOINT = `${AUTH_ISSUER}/oauth2/token`;
const USERINFO_ENDPOINT = `${AUTH_ISSUER}/oauth2/userinfo`;

type PendingLogin = {
	clientId: string;
	verifier: string;
	authUrl: string;
};

function getAuthPath(): string {
	const dir = join(homedir(), ".ahub");
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	return join(dir, "auth.json");
}

export function getPendingLoginPath(): string {
	return join(homedir(), ".ahub", "pending-login.json");
}

function readPendingLogin(): PendingLogin | null {
	const path = getPendingLoginPath();
	if (!existsSync(path)) {
		return null;
	}
	try {
		return JSON.parse(readFileSync(path, "utf8")) as PendingLogin;
	} catch {
		return null;
	}
}

function clearPendingLogin(): void {
	try {
		unlinkSync(getPendingLoginPath());
	} catch {
		// ponytail: optional cleanup
	}
}

export function buildOAuthContinueUrl(authUrl: string): string {
	// Better Auth has no Clerk-style /authorize/continue; reopen the authorize URL.
	return authUrl;
}

export function buildOAuthConsentUrl(authUrl: string): string {
	const source = new URL(authUrl);
	const consent = new URL("https://www.alphaxiv.org/oauth/consent");
	for (const [key, value] of source.searchParams.entries()) {
		consent.searchParams.set(key, value);
	}
	return consent.toString();
}

export function buildOAuthSignInUrl(authUrl: string): string {
	const source = new URL(authUrl);
	const signIn = new URL("https://www.alphaxiv.org/signin");
	signIn.searchParams.set("flow", `/oauth/consent${source.search}`);
	return signIn.toString();
}

export async function resolveOAuthStartUrl(authUrl: string): Promise<string> {
	try {
		const res = await fetch(authUrl, {
			redirect: "manual",
			headers: { Accept: "application/json", "user-agent": "feynman" },
		});
		const location = res.headers.get("location");
		if (location) {
			return new URL(location, authUrl).toString();
		}
		const contentType = res.headers.get("content-type") || "";
		if (contentType.includes("application/json")) {
			const data = (await res.json()) as { url?: unknown };
			if (typeof data.url === "string" && data.url) {
				return data.url;
			}
		}
	} catch {
		// fall through to unsigned flow= sign-in URL
	}
	return buildOAuthSignInUrl(authUrl);
}

export function parseAuthorizationCode(input: string): string {
	const trimmed = input.trim();
	if (!trimmed) {
		throw new Error("Missing authorization code or callback URL");
	}
	if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
		const url = new URL(trimmed);
		const code = url.searchParams.get("code");
		if (!code) {
			throw new Error("Callback URL is missing ?code=");
		}
		return code;
	}
	return trimmed;
}

function openBrowser(url: string): void {
	try {
		const plat = platform();
		if (plat === "darwin") {
			execSync(`open "${url}"`);
			return;
		}
		if (plat === "linux") {
			execSync(`xdg-open "${url}"`);
			return;
		}
		if (plat === "win32") {
			execSync(`cmd /c start "" "${url}"`);
		}
	} catch {
		// ponytail: browser open is best-effort; URL is always printed
	}
}

export function reopenPendingConsentUrl(): string {
	const pending = readPendingLogin();
	if (!pending?.authUrl) {
		throw new Error("No pending alphaXiv login. Run `feynman alpha login` first and keep it waiting.");
	}
	const consentUrl = buildOAuthConsentUrl(pending.authUrl);
	console.error("Opening alphaXiv OAuth consent:");
	console.error(consentUrl);
	openBrowser(consentUrl);
	return consentUrl;
}

export async function reopenPendingAuthUrl(): Promise<string> {
	const pending = readPendingLogin();
	if (!pending?.authUrl) {
		throw new Error("No pending alphaXiv login. Run `feynman alpha login` first and keep it waiting.");
	}
	const startUrl = await resolveOAuthStartUrl(pending.authUrl);
	console.error(`Re-opening alphaXiv sign-in:\n${startUrl}`);
	console.error(`If already signed in, run: feynman alpha consent`);
	openBrowser(startUrl);
	return startUrl;
}

export async function finishPendingLogin(callbackInput: string): Promise<{ userInfo: Record<string, unknown> | null }> {
	const pending = readPendingLogin();
	if (!pending?.clientId || !pending?.verifier) {
		throw new Error("No pending alphaXiv login. Run `feynman alpha login` first.");
	}

	const code = parseAuthorizationCode(callbackInput);
	const body = new URLSearchParams({
		grant_type: "authorization_code",
		code,
		redirect_uri: REDIRECT_URI,
		client_id: pending.clientId,
		code_verifier: pending.verifier,
	});

	const tokenRes = await fetch(TOKEN_ENDPOINT, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: body.toString(),
	});
	if (!tokenRes.ok) {
		const text = await tokenRes.text();
		throw new Error(`Token exchange failed (${tokenRes.status}): ${text}`);
	}

	const tokens = (await tokenRes.json()) as {
		access_token: string;
		refresh_token?: string;
		expires_in?: number;
	};

	let userInfo: Record<string, unknown> | null = null;
	const userRes = await fetch(USERINFO_ENDPOINT, {
		headers: { Authorization: `Bearer ${tokens.access_token}` },
	});
	if (userRes.ok) {
		userInfo = (await userRes.json()) as Record<string, unknown>;
	}

	writeFileSync(
		getAuthPath(),
		JSON.stringify(
			{
				client_id: pending.clientId,
				access_token: tokens.access_token,
				refresh_token: tokens.refresh_token,
				expires_at: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : null,
				user_id: userInfo?.sub ?? null,
				user_name: userInfo?.name ?? userInfo?.preferred_username ?? null,
				user_email: userInfo?.email ?? null,
			},
			null,
			2,
		),
		"utf8",
	);
	clearPendingLogin();
	return { userInfo };
}
