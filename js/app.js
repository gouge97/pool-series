'use strict';

const API_BASE  = 'https://api-web.nhle.com/v1';
const LOGO_BASE = 'https://assets.nhle.com/logos/nhl/svg';

const ROUND_PTS = {
  1: { w: 2, g: 1 },
  2: { w: 4, g: 2 },
  3: { w: 6, g: 3 },
  4: { w: 8, g: 4 },
};
const SC_BONUS = 10;
const ROUND_NAMES = {
  1: 'Ronde 1',
  2: 'Ronde 2',
  3: 'Finales de conférence',
  4: 'Finale de la Coupe Stanley',
};

let G = { config: null, picks: null, nhl: null, scores: null, standings: {} };

// ── Bootstrap ──────────────────────────────────────────────────────────────────

async function init() {
  setLoading(true);

  try {
    [G.config, G.picks] = await Promise.all([
      fetchJSON('./data/config.json'),
      fetchJSON('./data/picks.json'),
    ]);
  } catch (e) {
    showError('Impossible de charger data/config.json ou data/picks.json. Vérifiez que les fichiers existent.');
    setLoading(false);
    return;
  }

  try {
    const raw = await fetchNHL(G.config.season);
    console.log('[NHL API raw response]', raw);
    G.nhl = normalizeNHL(raw);
  } catch (e) {
    console.warn('[NHL API] Fetch failed:', e.message);
    G.nhl = { rounds: {} };
    showError('Les données NHL en direct sont indisponibles — les choix sont affichés sans résultats en temps réel.');
  }

  G.standings = await fetchStandings();

  G.scores = computeScores();
  render();
  document.getElementById('pool-title').textContent = G.config.poolName;
  document.getElementById('last-updated').textContent =
    'Mis à jour à ' + new Date().toLocaleTimeString('fr-CA');
  setLoading(false);
}

async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} — ${url}`);
  return r.json();
}

async function fetchStandings() {
  try {
    const url = `${API_BASE}/standings/now`;
    let data;
    try { data = await fetchJSON(url); }
    catch { data = await fetchJSON(`https://corsproxy.io/?${encodeURIComponent(url)}`); }
    const map = {};
    for (const t of data.standings ?? []) {
      const abbrev = t.teamAbbrev?.default ?? t.teamAbbrev ?? '';
      const w  = t.wins     ?? 0;
      const l  = t.losses   ?? 0;
      const ot = t.otLosses ?? 0;
      const gp = w + l + ot;
      if (abbrev) map[abbrev] = gp > 0 ? w / gp : 0.5;
    }
    console.log('[Standings]', map);
    return map;
  } catch (e) {
    console.warn('[Standings] Fetch failed:', e.message);
    return {};
  }
}

async function fetchNHL(season) {
  const url = `${API_BASE}/playoff-bracket/${season}`;
  try {
    return await fetchJSON(url);
  } catch {
    // CORS block on localhost — proxy not needed once hosted on GitHub Pages
    return await fetchJSON(`https://corsproxy.io/?${encodeURIComponent(url)}`);
  }
}

// ── NHL normalization ──────────────────────────────────────────────────────────

// API returns a flat `series` array; seriesAbbrev tells us the real round
const ABBREV_TO_ROUND = { R1: 1, R2: 2, CF: 3, SCF: 4 };

function normalizeNHL(raw) {
  const out = { rounds: {} };
  const allSeries = raw.series ?? [];

  for (const s of allSeries) {
    const rn = ABBREV_TO_ROUND[s.seriesAbbrev];
    if (!rn) continue;

    const t1 = s.topSeedTeam?.abbrev    ?? '';
    const t2 = s.bottomSeedTeam?.abbrev ?? '';
    if (!t1 || !t2) continue; // future rounds have no teams yet

    const w1       = s.topSeedWins    ?? 0;
    const w2       = s.bottomSeedWins ?? 0;
    const explicit = s.winningTeamAbbrev ?? s.winningTeam?.abbrev ?? null;
    const complete  = w1 === 4 || w2 === 4 || !!explicit;
    const winner    = explicit ?? (w1 === 4 ? t1 : w2 === 4 ? t2 : null);

    if (!out.rounds[rn]) out.rounds[rn] = [];
    out.rounds[rn].push({ roundNumber: rn, team1: t1, team2: t2,
      team1Wins: w1, team2Wins: w2, totalGames: w1 + w2, winner, isComplete: complete });
  }
  return out;
}

function getMatchupWins(series, matchup) {
  if (!series) return [0, 0];
  return series.team1 === matchup.team1
    ? [series.team1Wins, series.team2Wins]
    : [series.team2Wins, series.team1Wins];
}

function findSeries(roundNum, team1, team2) {
  return (G.nhl.rounds[roundNum] || []).find(s =>
    (s.team1 === team1 && s.team2 === team2) ||
    (s.team1 === team2 && s.team2 === team1)
  ) ?? null;
}

// ── Probability helpers ────────────────────────────────────────────────────────

function perGameProb(t1, t2) {
  const s1 = G.standings[t1] ?? 0.5;
  const s2 = G.standings[t2] ?? 0.5;
  return (s1 + s2) > 0 ? s1 / (s1 + s2) : 0.5;
}

function comb(n, k) {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  let r = 1;
  for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1);
  return r;
}

// P(team with w1 wins beats team with w2 wins to finish series), per-game win prob p
function seriesWinProb(w1, w2, p) {
  const n1 = 4 - w1, n2 = 4 - w2;
  if (n1 <= 0) return 1;
  if (n2 <= 0) return 0;
  let prob = 0;
  for (let k = 0; k < n2; k++)
    prob += comb(n1 + k - 1, k) * Math.pow(p, n1) * Math.pow(1 - p, k);
  return prob;
}

// P(team1 wins series AND series ends in exactly totalGames total games)
function seriesExactProb(w1, w2, p, totalGames) {
  const n1   = 4 - w1;
  const more = totalGames - w1 - w2;
  const k    = more - n1;
  if (more < n1 || k < 0 || k >= 4 - w2) return 0;
  return comb(more - 1, k) * Math.pow(p, n1) * Math.pow(1 - p, k);
}

function pct(p) { return Math.round(p * 100) + '%'; }

// ── Score computation ──────────────────────────────────────────────────────────

function computeScores() {
  const { config, picks } = G;
  const scores = {};
  for (const p of config.participants)
    scores[p] = { total: 0, byRound: { 1: 0, 2: 0, 3: 0, 4: 0 }, scBonus: 0, expected: 0 };

  for (let r = 1; r <= 4; r++) {
    const pts   = ROUND_PTS[r];
    const round = picks.rounds?.[r];
    if (!round) continue;
    const seriesList = round.series || [];
    for (let i = 0; i < seriesList.length; i++) {
      const matchup = seriesList[i];
      const series  = findSeries(r, matchup.team1, matchup.team2);
      for (const p of config.participants) {
        const pick = round.picks?.[p]?.[i];
        if (!pick) continue;
        if (series?.isComplete) {
          let earned = 0;
          if (pick.winner === series.winner)     earned += pts.w;
          if (pick.games  === series.totalGames) earned += pts.g;
          scores[p].byRound[r] += earned;
          scores[p].total      += earned;
        } else {
          const [mt1W, mt2W] = getMatchupWins(series, matchup);
          const pgp  = perGameProb(matchup.team1, matchup.team2);
          const isT1 = pick.winner === matchup.team1;
          const [a, b, q] = isT1 ? [mt1W, mt2W, pgp] : [mt2W, mt1W, 1 - pgp];
          scores[p].expected += seriesWinProb(a, b, q) * pts.w
                              + seriesExactProb(a, b, q, pick.games) * pts.g;
        }
      }
    }
  }

  // Stanley Cup bonus — winner of round 4 series
  const cupFinals = G.nhl.rounds[4]?.[0];
  if (cupFinals?.isComplete) {
    for (const p of config.participants) {
      if (picks.stanleyCupPick?.[p] === cupFinals.winner) {
        scores[p].scBonus = SC_BONUS;
        scores[p].total  += SC_BONUS;
      }
    }
  }

  for (const p of config.participants)
    scores[p].totalExpected = scores[p].total + scores[p].expected;

  return scores;
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function render() {
  const app = document.getElementById('app');
  app.innerHTML = '';
  app.appendChild(buildLeaderboard());
  for (let r = 1; r <= 4; r++) app.appendChild(buildRoundTab(r));
  setupTabs();
}

function buildLeaderboard() {
  const { config, picks, scores } = G;
  const section = el('section', { id: 'tab-leaderboard', class: 'tab-content active' });
  section.appendChild(el('h2', {}, 'Classement'));

  const ranked = [...config.participants].sort((a, b) => scores[b].totalExpected - scores[a].totalExpected);

  const wrap  = el('div', { class: 'lb-wrap' });
  const table = el('table', { class: 'lb' });

  const hRow = el('tr');
  ['#', 'Participant', 'R1', 'R2', 'FC', 'Finale', 'Choix Coupe', 'Total', 'Projeté']
    .forEach(h => hRow.appendChild(el('th', {}, h)));
  table.appendChild(el('thead')).appendChild(hRow);

  const tbody = el('tbody');
  ranked.forEach((p, i) => {
    const s    = scores[p];
    const rank = i + 1;
    const icon = String(rank);
    const row  = el('tr', { class: `rank-${rank}` });
    const cupPick = picks.stanleyCupPick?.[p];
    const cupTd   = el('td', { class: 'cup-pick-logo' });
    if (cupPick) cupTd.appendChild(logoImg(cupPick));
    else cupTd.textContent = '—';

    [
      el('td', {}, icon),
      el('td', { class: 'player-name' }, p),
      el('td', {}, s.byRound[1]),
      el('td', {}, s.byRound[2]),
      el('td', {}, s.byRound[3]),
      el('td', {}, s.byRound[4]),
      cupTd,
      el('td', { class: 'total-pts' }, s.total),
      el('td', { class: 'projected-pts' }, s.expected > 0 ? s.totalExpected.toFixed(1) : s.total),
    ].forEach(c => row.appendChild(c));
    tbody.appendChild(row);
  });

  table.appendChild(tbody);
  wrap.appendChild(table);
  section.appendChild(wrap);
  return section;
}

function buildRoundTab(roundNum) {
  const { config, picks } = G;
  const section  = el('section', { id: `tab-round-${roundNum}`, class: 'tab-content' });
  section.appendChild(el('h2', {}, ROUND_NAMES[roundNum]));

  const round      = picks.rounds?.[roundNum];
  const seriesList = round?.series || [];
  if (!seriesList.length) {
    section.appendChild(el('p', { class: 'empty-msg' }, 'Les choix de cette ronde n\'ont pas encore été entrés.'));
    return section;
  }

  seriesList.forEach((matchup, i) => section.appendChild(buildMatchupCard(matchup, roundNum, i)));
  return section;
}

function buildMatchupCard(matchup, roundNum, matchupIndex) {
  const { config, picks } = G;
  const round  = picks.rounds?.[roundNum];
  const series = findSeries(roundNum, matchup.team1, matchup.team2);
  const pts    = ROUND_PTS[roundNum];
  const done   = series?.isComplete ?? false;

  const card = el('div', { class: 'matchup-card' });
  const hdr  = el('div', { class: 'matchup-header' });
  hdr.appendChild(statusBadge(series, matchup));
  card.appendChild(hdr);

  const [mt1W, mt2W] = getMatchupWins(series, matchup);
  const pgp = perGameProb(matchup.team1, matchup.team2);

  const rows = config.participants.map(name => {
    const pick = round?.picks?.[name]?.[matchupIndex];
    let wOk = null, gOk = null, total = 0, pWin = null, pPerf = null, expPts = null;
    if (pick) {
      if (done) {
        wOk   = pick.winner === series.winner;
        gOk   = pick.games  === series.totalGames;
        total = (wOk ? pts.w : 0) + (gOk ? pts.g : 0);
      } else {
        const isT1 = pick.winner === matchup.team1;
        const [a, b, q] = isT1 ? [mt1W, mt2W, pgp] : [mt2W, mt1W, 1 - pgp];
        pWin   = seriesWinProb(a, b, q);
        pPerf  = seriesExactProb(a, b, q, pick.games);
        expPts = pWin * pts.w + pPerf * pts.g;
      }
    }
    return { name, pick, wOk, gOk, total, pWin, pPerf, expPts };
  }).sort((a, b) => done ? b.total - a.total : (b.expPts ?? -1) - (a.expPts ?? -1));

  const wrap  = el('div', { class: 'picks-wrap' });
  const table = el('table', { class: 'picks' });
  const hRow  = el('tr');
  const baseHeaders = done
    ? ['Participant', 'Vainqueur', 'Matchs']
    : ['Participant', 'Vainqueur', 'Matchs', 'P(vict.)', 'P(parfait)'];
  baseHeaders.forEach(h => hRow.appendChild(el('th', {}, h)));
  const thProj = el('th');
  const spP = el('span'); spP.style.color = 'var(--gold)';   spP.textContent = 'Projeté';
  const spR = el('span'); spR.style.color = 'var(--accent)'; spR.textContent = 'Réalisé';
  thProj.appendChild(spP);
  thProj.appendChild(document.createTextNode('/'));
  thProj.appendChild(spR);
  hRow.appendChild(thProj);
  table.appendChild(el('thead')).appendChild(hRow);

  const tbody = el('tbody');
  for (const { name, pick, wOk, gOk, total, pWin, pPerf, expPts } of rows) {
    const row = el('tr');
    row.appendChild(el('td', {}, name));
    if (!pick) {
      const cols = done ? 3 : 5;
      for (let i = 0; i < cols; i++) row.appendChild(el('td', { class: 'c-pending' }, '—'));
    } else if (done) {
      const wtd = el('td', { class: wOk === null ? '' : wOk ? 'c-ok' : 'c-wrong' });
      wtd.appendChild(logoImg(pick.winner));
      row.appendChild(wtd);
      row.appendChild(el('td', { class: gOk === null ? '' : gOk ? 'c-ok' : 'c-wrong' }, pick.games));
      row.appendChild(el('td', { class: 'total-pts' }, total));
    } else {
      const wtd = el('td');
      wtd.appendChild(logoImg(pick.winner));
      row.appendChild(wtd);
      row.appendChild(el('td', {}, pick.games));
      row.appendChild(el('td', { class: 'c-prob' }, pct(pWin)));
      row.appendChild(el('td', { class: 'c-prob' }, pct(pPerf)));
      row.appendChild(el('td', { class: 'projected-pts' }, expPts.toFixed(1)));
    }
    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  card.appendChild(wrap);
  return card;
}

function statusBadge(series, matchup) {
  const badge = document.createElement('span');

  if (!series || (!series.isComplete && series.team1Wins === 0 && series.team2Wins === 0)) {
    badge.className = 'series-badge badge-upcoming';
    badge.appendChild(logoImg(matchup.team1));
    badge.appendChild(document.createTextNode(' 0–0 '));
    badge.appendChild(logoImg(matchup.team2));
  } else if (series.isComplete) {
    badge.className = 'series-badge badge-final';
    badge.appendChild(logoImg(series.winner));
    badge.appendChild(document.createTextNode(` en ${series.totalGames} matchs`));
  } else {
    const w1 = series.team1 === matchup.team1 ? series.team1Wins : series.team2Wins;
    const w2 = series.team1 === matchup.team1 ? series.team2Wins : series.team1Wins;
    badge.className = 'series-badge badge-live';
    badge.appendChild(logoImg(matchup.team1));
    badge.appendChild(document.createTextNode(` ${w1}–${w2} `));
    badge.appendChild(logoImg(matchup.team2));
  }
  return badge;
}

function logoImg(abbrev) {
  const img = document.createElement('img');
  img.src       = `${LOGO_BASE}/${abbrev}_light.svg`;
  img.alt       = abbrev;
  img.className = 'team-logo';
  img.onerror   = () => { img.style.display = 'none'; };
  return img;
}

// ── Tab wiring ─────────────────────────────────────────────────────────────────

function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const t = btn.dataset.tab;
      const id = t === 'leaderboard' ? 'tab-leaderboard' : `tab-round-${t}`;
      document.getElementById(id)?.classList.add('active');
    });
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function el(tag, attrs = {}, text = null) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text !== null) node.textContent = String(text);
  return node;
}

function setLoading(on) {
  const node = document.getElementById('loading');
  if (on && !node) {
    const d = el('div', { id: 'loading' }, 'Chargement des données…');
    document.getElementById('app').prepend(d);
  } else if (!on && node) {
    node.remove();
  }
}

function showError(msg) {
  document.querySelector('.error-banner')?.remove();
  const banner = el('div', { class: 'error-banner' }, '⚠ ' + msg);
  document.getElementById('app').prepend(banner);
}

// Refresh live data every 5 minutes
setInterval(init, 5 * 60 * 1000);

init();
