// The hourly monitor. Asks the live site whether it is up and whether each service it depends on is answering.
// Exits with an error when something is wrong, which fails the workflow run and makes GitHub email the owner.
const SITE = process.env.WARRIOR_SITE || 'https://WARRIOR_HOST';
const problems = [];
try {
  const page = await fetch(SITE, { signal: AbortSignal.timeout(15000) }); if (!page.ok) problems.push(`The site answered ${page.status}.`);
  const policy = page.headers.get('content-security-policy') ?? ''; if (!policy.includes("script-src 'self'")) problems.push('The page lockdown header is missing or changed.');
  const r = await fetch(`${SITE}/api/health`, { signal: AbortSignal.timeout(20000) }); if (!r.ok) problems.push(`The health check answered ${r.status}.`);
  else { const h = await r.json(); for (const p of h.parts ?? []) { console.log(`${p.ok ? 'ok  ' : 'DOWN'} ${p.name} (${p.ms} ms)${p.ok ? '' : `: ${p.problem}`}`); if (!p.ok) problems.push(`${p.name} is not answering: ${p.used} will wait.`); } }
  const card = await fetch(`${SITE}/scorecard.json`, { signal: AbortSignal.timeout(15000) }); if (!card.ok) problems.push('The scorecard file is missing from the site.');
  else { const c = await card.json(), age = (Date.now() - Date.parse(c.updatedAt)) / 3_600_000; console.log(`scorecard last updated ${age.toFixed(1)} hours ago`); if (!(age < 6)) problems.push(`The scorecard on the site has not updated for ${age.toFixed(0)} hours.`); }
} catch (e) { problems.push(`The site could not be reached (${e.message}).`); }
if (problems.length) { console.error(`\nWarrior monitor found ${problems.length} problem(s):\n- ${problems.join('\n- ')}`); process.exit(1); }
console.log('Warrior monitor: the site and every service it depends on are answering.');
