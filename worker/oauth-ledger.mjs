const ISSUER='https://go-together.pureekangraw.workers.dev';
export function brainOAuthConfig(env){
 const db=env.DB;
 const ledger={
  async consume(key,expiresAt){const now=Math.floor(Date.now()/1000);const r=await db.prepare('INSERT INTO brain_oauth_used (key,expires_at) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET expires_at=excluded.expires_at WHERE brain_oauth_used.expires_at<=?').bind(key,expiresAt,now).run();return r.meta?.changes===1;},
  async blocked(key,now){const r=await db.prepare('SELECT COUNT(*) AS n FROM brain_oauth_failures WHERE key=? AND attempted_at>?').bind(key,now-900).first();return Number(r?.n)>=5;},
  async failure(key,now){await db.prepare('INSERT INTO brain_oauth_failures (key,attempted_at) VALUES (?,?)').bind(key,now).run();},
  async refreshFamilyRevoked(familyId,now){const r=await db.prepare('SELECT expires_at FROM brain_oauth_revoked WHERE family_id=?').bind(familyId).first();return Number(r?.expires_at)>now;},
  async revokeRefreshFamily(familyId,expiresAt){await db.prepare('INSERT INTO brain_oauth_revoked (family_id,expires_at) VALUES (?,?) ON CONFLICT(family_id) DO UPDATE SET expires_at=MAX(expires_at,excluded.expires_at)').bind(familyId,expiresAt).run();},
 };
 return {issuer:ISSUER,resource:ISSUER+'/mcp',signingKey:env.BRAIN_OAUTH_SIGNING_KEY,ownerPasscode:env.BRAIN_OWNER_PASSCODE,ownerId:'BIG',allowCimd:true,requireClientId:true,ledger};
}
