const LEGACY_SUCCESS_HTML = "'<html><body><h2>Logged in to Alpha Hub</h2><p>You can close this tab.</p></body></html>'";
const LEGACY_ERROR_HTML = "'<html><body><h2>Login failed</h2><p>You can close this tab.</p></body></html>'";

const bodyAttr = 'style="font-family:system-ui,sans-serif;text-align:center;padding-top:20vh;background:#050a08;color:#f0f5f2"';
const logo = '<h1 style="font-family:monospace;font-size:48px;color:#34d399;margin:0">feynman</h1>';

const FEYNMAN_SUCCESS_HTML = `'<html><body ${bodyAttr}>${logo}<h2 style="color:#34d399;margin-top:16px">Logged in</h2><p style="color:#8aaa9a">You can close this tab.</p></body></html>'`;
const FEYNMAN_ERROR_HTML = `'<html><body ${bodyAttr}>${logo}<h2 style="color:#ef4444;margin-top:16px">Login failed</h2><p style="color:#8aaa9a">You can close this tab.</p></body></html>'`;

const CURRENT_OPEN_BROWSER = [
	"function openBrowser(url) {",
	"  try {",
	"    const plat = platform();",
	"    if (plat === 'darwin') execSync(`open \"${url}\"`);",
	"    else if (plat === 'linux') execSync(`xdg-open \"${url}\"`);",
	"    else if (plat === 'win32') execSync(`start \"\" \"${url}\"`);",
	"  } catch {}",
	"}",
].join("\n");

const PATCHED_OPEN_BROWSER = [
	"function openBrowser(url) {",
	"  try {",
	"    const plat = platform();",
	"    const isWsl = plat === 'linux' && (Boolean(process.env.WSL_DISTRO_NAME) || Boolean(process.env.WSL_INTEROP));",
	"    if (plat === 'darwin') execSync(`open \"${url}\"`);",
	"    else if (isWsl) {",
	"      try {",
	"        execSync(`wslview \"${url}\"`);",
	"      } catch {",
	"        execSync(`cmd.exe /c start \"\" \"${url}\"`);",
	"      }",
	"    }",
	"    else if (plat === 'linux') execSync(`xdg-open \"${url}\"`);",
	"    else if (plat === 'win32') execSync(`cmd /c start \"\" \"${url}\"`);",
	"  } catch {}",
	"}",
].join("\n");

const LEGACY_WIN_OPEN = "else if (plat === 'win32') execSync(`start \"${url}\"`);";
const FIXED_WIN_OPEN = "else if (plat === 'win32') execSync(`cmd /c start \"\" \"${url}\"`);";

const OAUTH_BROWSER_HELPERS = `
function buildAlphaConsentUrl(authUrl) {
  const source = new URL(authUrl);
  const consent = new URL('https://www.alphaxiv.org/oauth/consent');
  for (const [key, value] of source.searchParams.entries()) {
    consent.searchParams.set(key, value);
  }
  return consent.toString();
}

function buildAlphaSignInUrl(authUrl) {
  const source = new URL(authUrl);
  const signIn = new URL('https://www.alphaxiv.org/signin');
  signIn.searchParams.set('flow', \`/oauth/consent\${source.search}\`);
  return signIn.toString();
}

async function resolveAlphaOAuthStartUrl(authUrl) {
  try {
    const res = await fetch(authUrl, {
      redirect: 'manual',
      headers: { Accept: 'application/json', 'user-agent': 'feynman-alpha-hub' },
    });
    const location = res.headers.get('location');
    if (location) return new URL(location, authUrl).toString();
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await res.json();
      if (data && typeof data.url === 'string' && data.url) return data.url;
    }
  } catch {}
  return buildAlphaSignInUrl(authUrl);
}
`;

const LEGACY_CLERK_AUTH_CONSTANTS = [
	"const CLERK_ISSUER = 'https://clerk.alphaxiv.org';",
	"const AUTH_ENDPOINT = `${CLERK_ISSUER}/oauth/authorize`;",
	"const TOKEN_ENDPOINT = `${CLERK_ISSUER}/oauth/token`;",
	"const REGISTER_ENDPOINT = `${CLERK_ISSUER}/oauth/register`;",
	"const CALLBACK_PORT = 9876;",
	"const REDIRECT_URI = `http://127.0.0.1:${CALLBACK_PORT}/callback`;",
	"const USERINFO_ENDPOINT = `${CLERK_ISSUER}/oauth/userinfo`;",
	"const SCOPES = 'profile email offline_access';",
].join("\n");

const BETTER_AUTH_CONSTANTS = [
	"const CLERK_ISSUER = 'https://api.alphaxiv.org/auth';",
	"const AUTH_ENDPOINT = `${CLERK_ISSUER}/oauth2/authorize`;",
	"const TOKEN_ENDPOINT = `${CLERK_ISSUER}/oauth2/token`;",
	"const REGISTER_ENDPOINT = `${CLERK_ISSUER}/oauth2/register`;",
	"const CALLBACK_PORT = 9876;",
	"const REDIRECT_URI = `http://127.0.0.1:${CALLBACK_PORT}/callback`;",
	"const USERINFO_ENDPOINT = `${CLERK_ISSUER}/oauth2/userinfo`;",
	"const SCOPES = 'openid profile email offline_access';",
].join("\n");

const LEGACY_ACCOUNTS_CONSENT = "https://accounts.alphaxiv.org/oauth-consent";
const BETTER_AUTH_CONSENT = "https://www.alphaxiv.org/oauth/consent";

const LEGACY_REDIRECT_URL_SIGNIN = "signIn.searchParams.set('redirect_url', buildAlphaConsentUrl(authUrl));";

const OPEN_BROWSER_AUTH_URL = "openBrowser(authUrl.toString());";
const OPEN_BROWSER_SIGNIN_URL = "openBrowser(buildAlphaSignInUrl(authUrl.toString()));";
const OPEN_BROWSER_START_URL = "openBrowser(startUrl);";

const AUTH_URL_LOG = "process.stderr.write(`Opening browser for alphaXiv login...\\nAuth URL: ${authUrl.toString()}\\n`);";
const SIGNIN_URL_LOG = "process.stderr.write(`Opening browser for alphaXiv login...\\nSign-in URL: ${buildAlphaSignInUrl(authUrl.toString())}\\n`);";
const START_URL_LOG = "process.stderr.write(`Opening browser for alphaXiv login...\\nSign-in URL: ${startUrl}\\n`);";

const OPEN_BROWSER_LOG = "process.stderr.write('Opening browser for alphaXiv login...\\n');";
const OPEN_BROWSER_LOG_WITH_URL = "process.stderr.write(`Opening browser for alphaXiv login...\\nAuth URL: ${authUrl.toString()}\\n`);";

const FS_IMPORT = "import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';";
const FS_IMPORT_WITH_UNLINK = "import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';";

const PENDING_LOGIN_HELPERS = `
function getPendingLoginPath() {
  return join(homedir(), '.ahub', 'pending-login.json');
}

function savePendingLogin(data) {
  writeFileSync(getPendingLoginPath(), JSON.stringify(data, null, 2), 'utf8');
}

function clearPendingLogin() {
  try {
    unlinkSync(getPendingLoginPath());
  } catch {}
}
`;

const VISIT_AUTH_URL = "process.stderr.write(`If browser didn't open, visit:\\n${authUrl.toString()}\\n\\n`);";
const VISIT_SIGNIN_URL = "process.stderr.write(`If browser didn't open, visit:\\n${buildAlphaSignInUrl(authUrl.toString())}\\n\\n`);";
const VISIT_START_URL = "process.stderr.write(`If browser didn't open, visit:\\n${startUrl}\\n\\n`);";

const LOGIN_WAIT_BLOCK = [
	"  const server = await startCallbackServer();",
	"",
	"  process.stderr.write(`Opening browser for alphaXiv login...\\nAuth URL: ${authUrl.toString()}\\n`);",
	"  openBrowser(authUrl.toString());",
	"  process.stderr.write(`If browser didn't open, visit:\\n${authUrl.toString()}\\n\\n`);",
	"  process.stderr.write('Waiting for login...\\n');",
	"",
	"  const code = await waitForCallback(server);",
].join("\n");

const OLD_PATCHED_LOGIN_WAIT_BLOCK = [
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
].join("\n");

const PATCHED_LOGIN_WAIT_BLOCK = [
	"  const server = await startCallbackServer();",
	"",
	"  savePendingLogin({ clientId, verifier, authUrl: authUrl.toString() });",
	"",
	"  const startUrl = await resolveAlphaOAuthStartUrl(authUrl.toString());",
	"  process.stderr.write(`Opening browser for alphaXiv login...\\nSign-in URL: ${startUrl}\\n`);",
	"  openBrowser(startUrl);",
	"  process.stderr.write(`If browser didn't open, visit:\\n${startUrl}\\n\\n`);",
	"  process.stderr.write('Waiting for localhost callback on http://127.0.0.1:9876/callback ...\\n');",
	"  process.stderr.write('Use email sign-in on that page, then Allow on the consent screen if shown.\\n');",
	"  process.stderr.write('If sign-in stalls: feynman alpha consent | feynman alpha complete <callback-url>\\n');",
	"",
	"  const code = await waitForCallback(server);",
].join("\n");

const COMPACT_LOGIN_WAIT_BLOCK = [
	"  const server = await startCallbackServer();",
	"  process.stderr.write(`Opening browser for alphaXiv login...\\nAuth URL: ${authUrl.toString()}\\n`);",
	"  openBrowser(authUrl.toString());",
	"  process.stderr.write(`If browser didn't open, visit:\\n${authUrl.toString()}\\n\\n`);",
	"  process.stderr.write('Waiting for login...\\n');",
	"  const code = await waitForCallback(server);",
].join("\n");

const OLD_PATCHED_COMPACT_LOGIN_WAIT_BLOCK = [
	"  const server = await startCallbackServer();",
	"  savePendingLogin({ clientId, verifier, authUrl: authUrl.toString() });",
	"  process.stderr.write(`Opening browser for alphaXiv login...\\nSign-in URL: ${buildAlphaSignInUrl(authUrl.toString())}\\n`);",
	"  openBrowser(buildAlphaSignInUrl(authUrl.toString()));",
	"  process.stderr.write(`If browser didn't open, visit:\\n${buildAlphaSignInUrl(authUrl.toString())}\\n\\n`);",
	"  process.stderr.write('Waiting for localhost callback on http://127.0.0.1:9876/callback ...\\n');",
	"  process.stderr.write('Use email sign-in on that page, not Google. Google login skips the CLI OAuth redirect.\\n');",
	"  process.stderr.write('If sign-in stalls: feynman alpha consent | feynman alpha complete <callback-url>\\n');",
	"  const code = await waitForCallback(server);",
].join("\n");

const PATCHED_COMPACT_LOGIN_WAIT_BLOCK = [
	"  const server = await startCallbackServer();",
	"  savePendingLogin({ clientId, verifier, authUrl: authUrl.toString() });",
	"  const startUrl = await resolveAlphaOAuthStartUrl(authUrl.toString());",
	"  process.stderr.write(`Opening browser for alphaXiv login...\\nSign-in URL: ${startUrl}\\n`);",
	"  openBrowser(startUrl);",
	"  process.stderr.write(`If browser didn't open, visit:\\n${startUrl}\\n\\n`);",
	"  process.stderr.write('Waiting for localhost callback on http://127.0.0.1:9876/callback ...\\n');",
	"  process.stderr.write('Use email sign-in on that page, then Allow on the consent screen if shown.\\n');",
	"  process.stderr.write('If sign-in stalls: feynman alpha consent | feynman alpha complete <callback-url>\\n');",
	"  const code = await waitForCallback(server);",
].join("\n");

const LEGACY_LOGIN_WAIT_BLOCK = [
	"  process.stderr.write('Opening browser for alphaXiv login...\\n');",
	"  openBrowser(authUrl.toString());",
	"  process.stderr.write(`If browser didn't open, visit:\\n${authUrl.toString()}\\n\\n`);",
	"  process.stderr.write('Waiting for login...\\n');",
	"",
	"  const code = await waitForCallback(server);",
].join("\n");

export function patchAlphaHubAuthSource(source) {
	let patched = source;

	if (patched.includes(LEGACY_CLERK_AUTH_CONSTANTS)) {
		patched = patched.replace(LEGACY_CLERK_AUTH_CONSTANTS, BETTER_AUTH_CONSTANTS);
	}
	if (patched.includes(LEGACY_ACCOUNTS_CONSENT)) {
		patched = patched.replaceAll(LEGACY_ACCOUNTS_CONSENT, BETTER_AUTH_CONSENT);
	}

	if (patched.includes(LEGACY_SUCCESS_HTML)) {
		patched = patched.replace(LEGACY_SUCCESS_HTML, FEYNMAN_SUCCESS_HTML);
	}
	if (patched.includes(LEGACY_ERROR_HTML)) {
		patched = patched.replace(LEGACY_ERROR_HTML, FEYNMAN_ERROR_HTML);
	}
	if (patched.includes(CURRENT_OPEN_BROWSER)) {
		patched = patched.replace(CURRENT_OPEN_BROWSER, PATCHED_OPEN_BROWSER);
	}
	if (patched.includes(LEGACY_WIN_OPEN)) {
		patched = patched.replace(LEGACY_WIN_OPEN, FIXED_WIN_OPEN);
	}
	if (patched.includes(OPEN_BROWSER_LOG)) {
		patched = patched.replace(OPEN_BROWSER_LOG, OPEN_BROWSER_LOG_WITH_URL);
	}
	if (patched.includes(FS_IMPORT) && !patched.includes("unlinkSync")) {
		patched = patched.replace(FS_IMPORT, FS_IMPORT_WITH_UNLINK);
	}
	if (patched.includes(LEGACY_REDIRECT_URL_SIGNIN)) {
		// Better Auth resumes OAuth via ?flow=/oauth/consent..., not Clerk redirect_url.
		if (!patched.includes("const source = new URL(authUrl);") || patched.includes(LEGACY_REDIRECT_URL_SIGNIN)) {
			patched = patched.replace(
				[
					"function buildAlphaSignInUrl(authUrl) {",
					"  const signIn = new URL('https://www.alphaxiv.org/signin');",
					"  signIn.searchParams.set('redirect_url', buildAlphaConsentUrl(authUrl));",
					"  return signIn.toString();",
					"}",
				].join("\n"),
				[
					"function buildAlphaSignInUrl(authUrl) {",
					"  const source = new URL(authUrl);",
					"  const signIn = new URL('https://www.alphaxiv.org/signin');",
					"  signIn.searchParams.set('flow', `/oauth/consent${source.search}`);",
					"  return signIn.toString();",
					"}",
				].join("\n"),
			);
		}
	}
	if (!patched.includes("function resolveAlphaOAuthStartUrl(authUrl)")) {
		const resolveHelper = `
async function resolveAlphaOAuthStartUrl(authUrl) {
  try {
    const res = await fetch(authUrl, {
      redirect: 'manual',
      headers: { Accept: 'application/json', 'user-agent': 'feynman-alpha-hub' },
    });
    const location = res.headers.get('location');
    if (location) return new URL(location, authUrl).toString();
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await res.json();
      if (data && typeof data.url === 'string' && data.url) return data.url;
    }
  } catch {}
  return buildAlphaSignInUrl(authUrl);
}
`;
		if (patched.includes("function buildAlphaSignInUrl(authUrl)")) {
			patched = patched.replace(
				"export async function login() {",
				`${resolveHelper}\nexport async function login() {`,
			);
		}
	}
	if (!patched.includes("function savePendingLogin(data)") || !patched.includes("function buildAlphaSignInUrl(authUrl)")) {
		let helpers = "";
		if (!patched.includes("function savePendingLogin(data)")) {
			helpers += PENDING_LOGIN_HELPERS;
		}
		if (!patched.includes("function buildAlphaSignInUrl(authUrl)")) {
			helpers += OAUTH_BROWSER_HELPERS;
		}
		patched = patched.replace("export async function login() {", `${helpers}\nexport async function login() {`);
	}
	if (patched.includes(OLD_PATCHED_LOGIN_WAIT_BLOCK)) {
		patched = patched.replace(OLD_PATCHED_LOGIN_WAIT_BLOCK, PATCHED_LOGIN_WAIT_BLOCK);
	} else if (patched.includes(OLD_PATCHED_COMPACT_LOGIN_WAIT_BLOCK)) {
		patched = patched.replace(OLD_PATCHED_COMPACT_LOGIN_WAIT_BLOCK, PATCHED_COMPACT_LOGIN_WAIT_BLOCK);
	}
	if (patched.includes(PATCHED_LOGIN_WAIT_BLOCK)) {
		// already patched with Better Auth start URL resolution
	} else if (patched.includes(PATCHED_COMPACT_LOGIN_WAIT_BLOCK)) {
		// already patched
	} else if (patched.includes(LOGIN_WAIT_BLOCK)) {
		patched = patched.replace(LOGIN_WAIT_BLOCK, PATCHED_LOGIN_WAIT_BLOCK);
	} else if (patched.includes(COMPACT_LOGIN_WAIT_BLOCK)) {
		patched = patched.replace(COMPACT_LOGIN_WAIT_BLOCK, PATCHED_COMPACT_LOGIN_WAIT_BLOCK);
	} else if (patched.includes(LEGACY_LOGIN_WAIT_BLOCK)) {
		const legacyBlock = [
			"  const server = await startCallbackServer();",
			"",
			LEGACY_LOGIN_WAIT_BLOCK,
		].join("\n");
		patched = patched.replace(legacyBlock, PATCHED_LOGIN_WAIT_BLOCK);
	}
	if (!patched.includes("clearPendingLogin();")) {
		const loginSuccessTail = [
			[
				"  saveAuth({",
				"    client_id: clientId,",
				"    access_token: tokens.access_token,",
				"    refresh_token: tokens.refresh_token,",
				"    expires_at: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : null,",
				"    user_id: userInfo?.sub || null,",
				"    user_name: userInfo?.name || userInfo?.preferred_username || null,",
				"    user_email: userInfo?.email || null,",
				"  });",
				"",
				"  return { tokens, userInfo };",
			].join("\n"),
			[
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
			].join("\n"),
		];
		const loginSuccessReplacement = [
			[
				"  saveAuth({",
				"    client_id: clientId,",
				"    access_token: tokens.access_token,",
				"    refresh_token: tokens.refresh_token,",
				"    expires_at: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : null,",
				"    user_id: userInfo?.sub || null,",
				"    user_name: userInfo?.name || userInfo?.preferred_username || null,",
				"    user_email: userInfo?.email || null,",
				"  });",
				"",
				"  clearPendingLogin();",
				"",
				"  return { tokens, userInfo };",
			].join("\n"),
			[
				"  saveAuth({",
				"    client_id: clientId,",
				"    access_token: tokens.access_token,",
				"    refresh_token: tokens.refresh_token,",
				"    expires_at: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : null,",
				"    user_id: userInfo?.sub || null,",
				"    user_name: userInfo?.name || userInfo?.preferred_username || null,",
				"    user_email: userInfo?.email || null,",
				"  });",
				"  clearPendingLogin();",
				"  return { tokens, userInfo };",
			].join("\n"),
		];
		for (let index = 0; index < loginSuccessTail.length; index += 1) {
			if (patched.includes(loginSuccessTail[index])) {
				patched = patched.replace(loginSuccessTail[index], loginSuccessReplacement[index]);
				break;
			}
		}
	}

	if (patched.includes(AUTH_URL_LOG) && !patched.includes("const startUrl = await resolveAlphaOAuthStartUrl")) {
		patched = patched.replaceAll(AUTH_URL_LOG, SIGNIN_URL_LOG);
	}
	if (patched.includes(VISIT_AUTH_URL) && !patched.includes("const startUrl = await resolveAlphaOAuthStartUrl")) {
		patched = patched.replaceAll(VISIT_AUTH_URL, VISIT_SIGNIN_URL);
	}
	if (patched.includes(OPEN_BROWSER_AUTH_URL) && !patched.includes("const startUrl = await resolveAlphaOAuthStartUrl")) {
		patched = patched.replaceAll(OPEN_BROWSER_AUTH_URL, OPEN_BROWSER_SIGNIN_URL);
	}
	if (patched.includes(SIGNIN_URL_LOG) && patched.includes("const startUrl = await resolveAlphaOAuthStartUrl")) {
		patched = patched.replaceAll(SIGNIN_URL_LOG, START_URL_LOG);
	}
	if (patched.includes(VISIT_SIGNIN_URL) && patched.includes("const startUrl = await resolveAlphaOAuthStartUrl")) {
		patched = patched.replaceAll(VISIT_SIGNIN_URL, VISIT_START_URL);
	}
	if (patched.includes(OPEN_BROWSER_SIGNIN_URL) && patched.includes("const startUrl = await resolveAlphaOAuthStartUrl")) {
		patched = patched.replaceAll(OPEN_BROWSER_SIGNIN_URL, OPEN_BROWSER_START_URL);
	}
	if (patched.includes("Login timed out after 120 seconds")) {
		patched = patched.replace("Login timed out after 120 seconds", "Login timed out after 10 minutes");
	}
	if (patched.includes(", 120000);")) {
		patched = patched.replace(", 120000);", ", 600000);");
	}

	return patched;
}
