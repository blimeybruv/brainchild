// The account page's sign-ins: which providers are linked, unlinking, and the profile setting
// that decides whether the public profile lists them.
//
// Rules (HANDOFF.md, "GitLab sign-in, and linked accounts"):
//   - Linking happens only by completing the other provider's sign-in while signed in (auth.js).
//   - Unlinking is allowed except for the last remaining sign-in. Nothing the person made or was
//     credited for changes: lineage, comments and badges belong to the account, not the sign-in.
//   - The public profile lists linked accounts only if the person opts in.

import { privateJson, isSameOrigin } from "./http.js";

function bad(error, status = 400) { return privateJson({ error }, status); }

// GET /api/my/identities
export async function myIdentities(env, session) {
  if (!session) return bad("not_signed_in", 401);
  const { results } = await env.DB.prepare("SELECT provider, handle, linked_at FROM identities WHERE user_id = ? ORDER BY provider").bind(session.userId).all();
  const u = await env.DB.prepare("SELECT show_identities FROM users WHERE id = ?").bind(session.userId).first();
  return privateJson({
    identities: results.map((r) => ({ provider: r.provider, handle: r.handle, linked_at: r.linked_at,
      connected: r.provider === "github" ? !!session.access : !!session.glAccess })), // this session holds a token for it
    show_identities: !!(u && u.show_identities)
  });
}

// POST /api/my/identities/<provider>/unlink
export async function unlinkIdentity(request, env, session, provider) {
  if (!isSameOrigin(request)) return bad("forbidden", 403);
  if (!session) return bad("not_signed_in", 401);
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM identities WHERE user_id = ?").bind(session.userId).first();
  const has = await env.DB.prepare("SELECT 1 FROM identities WHERE user_id = ? AND provider = ?").bind(session.userId, provider).first();
  if (!has) return bad("not_found", 404);
  if (n.n <= 1) return bad("last_sign_in", 409);
  const tokens = provider === "github"
    ? "gh_access = NULL, gh_access_expires_at = NULL, gh_refresh = NULL, gh_refresh_expires_at = NULL, gh_refresh_lock = NULL"
    : "gl_access = NULL, gl_access_expires_at = NULL, gl_refresh = NULL, gl_refresh_lock = NULL";
  await env.DB.batch([
    env.DB.prepare("DELETE FROM identities WHERE user_id = ? AND provider = ?").bind(session.userId, provider),
    ...(provider === "github" ? [env.DB.prepare("UPDATE users SET github_id = NULL WHERE id = ?").bind(session.userId)] : []),
    env.DB.prepare(`UPDATE sessions SET ${tokens} WHERE user_id = ?`).bind(session.userId)
  ]);
  return privateJson({ ok: true });
}

// POST /api/my/profile  { show_identities: true | false }
export async function saveProfile(request, env, session) {
  if (!isSameOrigin(request)) return bad("forbidden", 403);
  if (!session) return bad("not_signed_in", 401);
  let body = null;
  try { body = await request.json(); } catch { body = null; }
  if (!body || typeof body.show_identities !== "boolean") return bad("invalid_fields");
  await env.DB.prepare("UPDATE users SET show_identities = ? WHERE id = ?").bind(body.show_identities ? 1 : 0, session.userId).run();
  return privateJson({ ok: true, show_identities: body.show_identities });
}
