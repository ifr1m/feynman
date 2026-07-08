import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

const REDIRECT_URI = "http://127.0.0.1:9876/callback";
const TOKEN_ENDPOINT = "https://clerk.alphaxiv.org/oauth/token";
const USERINFO_ENDPOINT = "https://clerk.alphaxiv.org/oauth/userinfo";

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
	const source = new URL(authUrl);
	const cont = new URL("https://clerk.alphaxiv.org/oauth/authorize/continue");
	for (const [key, value] of source.searchParams.entries()) {
		cont.searchParams.set(key, value);
	}
	return cont.toString();
}

export function buildOAuthConsentUrl(authUrl: string): string {
	const source = new URL(authUrl);
	const consent = new URL("https://accounts.alphaxiv.org/oauth-consent");
	for (const [key, value] of source.searchParams.entries()) {
		consent.searchParams.set(key, value);
	}
	return consent.toString();
}

export function buildOAuthSignInUrl(authUrl: string): string {
	const signIn = new URL("https://www.alphaxiv.org/signin");
	signIn.searchParams.set("redirect_url", buildOAuthConsentUrl(authUrl));
	return signIn.toString();
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
	const continueUrl = buildOAuthContinueUrl(pending.authUrl);
	console.error("Paste this in the SAME browser tab where you signed in with Google:");
	console.error(continueUrl);
	console.error("Do not open accounts.alphaxiv.org/oauth-consent directly; Cloudflare blocks it cold.");
	openBrowser(continueUrl);
	return continueUrl;
}

export function reopenPendingAuthUrl(): string {
	const pending = readPendingLogin();
	if (!pending?.authUrl) {
		throw new Error("No pending alphaXiv login. Run `feynman alpha login` first and keep it waiting.");
	}
	const signInUrl = buildOAuthSignInUrl(pending.authUrl);
	console.error(`Re-opening alphaXiv sign-in:\n${signInUrl}`);
	console.error(`If already signed in, run: feynman alpha consent`);
	openBrowser(signInUrl);
	return signInUrl;
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
