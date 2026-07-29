/* Thin client for the Worship Team Roster Worker API.
 *
 * Exposes `window.RosterAPI`. The device token is kept in localStorage and sent
 * as a Bearer credential on every authenticated call. All methods return
 * promises and throw an Error (with a friendly `.message`) on failure.
 */
(function () {
  'use strict';

  const CFG = window.ROSTER_CONFIG || {};
  const BASE = (CFG.apiBase || '').replace(/\/+$/, '');
  const TOKEN_KEY = 'worship-roster-token';
  const TEAM_KEY = 'worship-roster-team';

  function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }
  function setSession(token, team) {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    if (team) localStorage.setItem(TEAM_KEY, JSON.stringify(team));
  }
  function clearSession() { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(TEAM_KEY); }
  function team() { try { return JSON.parse(localStorage.getItem(TEAM_KEY) || 'null'); } catch (_) { return null; } }

  async function req(method, path, body, auth) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth !== false) {
      const t = getToken();
      if (t) headers['Authorization'] = 'Bearer ' + t;
    }
    let res;
    try {
      res = await fetch(BASE + path, {
        method, headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        mode: 'cors',
      });
    } catch (_) {
      throw new Error('Network error — check your connection.');
    }
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) {
      const msg = (data && data.error) || ('Request failed (' + res.status + ')');
      const e = new Error(msg); e.status = res.status; throw e;
    }
    return data;
  }

  window.RosterAPI = {
    configured() { return !!BASE; },
    hasSession() { return !!getToken(); },
    team,
    clearSession,

    async createTeam(teamName, leaderName) {
      const d = await req('POST', '/api/teams', { teamName, leaderName }, false);
      setSession(d.deviceToken, { teamId: d.teamId, teamName: d.teamName, inviteCode: d.inviteCode, role: d.role });
      return d;
    },
    async joinTeam(inviteCode, name) {
      const d = await req('POST', '/api/teams/join', { inviteCode, name }, false);
      setSession(d.deviceToken, { teamId: d.teamId, teamName: d.teamName, role: d.role });
      return d;
    },

    getState() { return req('GET', '/api/state'); },
    setAssignment(date, positionId, memberId) { return req('PUT', '/api/assignments', { date, positionId, memberId }); },
    updateMember(id, fields) { return req('PUT', '/api/members/' + encodeURIComponent(id), fields); },
    vote(month, typeId, date) { return req('POST', '/api/votes', { month, typeId, date }); },
    lock(month, typeId) { return req('POST', '/api/practices/lock', { month, typeId }); },
    newVote(month, typeId) { return req('POST', '/api/practices/new-vote', { month, typeId }); },
    addSong(month, title, key, link) { return req('POST', '/api/songs', { month, title, key, link }); },
    editSong(id, fields) { return req('PUT', '/api/songs/' + encodeURIComponent(id), fields); },
    deleteSong(id) { return req('DELETE', '/api/songs/' + encodeURIComponent(id)); },

    addLibrarySong(fields) { return req('POST', '/api/library', fields); },
    updateLibrarySong(id, fields) { return req('PUT', '/api/library/' + encodeURIComponent(id), fields); },
    deleteLibrarySong(id) { return req('DELETE', '/api/library/' + encodeURIComponent(id)); },

    addDevotional(fields) { return req('POST', '/api/devotionals', fields); },
    updateDevotional(id, fields) { return req('PUT', '/api/devotionals/' + encodeURIComponent(id), fields); },
    deleteDevotional(id) { return req('DELETE', '/api/devotionals/' + encodeURIComponent(id)); },

    logActivity(kind, minutes) { return req('POST', '/api/log', { kind, minutes }); },
    setFlag(key, on) { return req('POST', '/api/flags', { key, on }); },

    // Upload a chord PDF (raw bytes) and fetch it back as a blob URL for viewing.
    async uploadSongPdf(id, file) {
      const t = getToken();
      let res;
      try {
        res = await fetch(BASE + '/api/songs/' + encodeURIComponent(id) + '/pdf?name=' + encodeURIComponent(file.name), {
          method: 'POST', mode: 'cors',
          headers: { 'Authorization': 'Bearer ' + t, 'Content-Type': 'application/pdf' },
          body: file,
        });
      } catch (_) { throw new Error('Network error — check your connection.'); }
      if (!res.ok) { let d = null; try { d = await res.json(); } catch (_) {} throw new Error((d && d.error) || ('Upload failed (' + res.status + ')')); }
      return true;
    },
    async songPdfBlobUrl(id) {
      const t = getToken();
      const res = await fetch(BASE + '/api/songs/' + encodeURIComponent(id) + '/pdf', {
        mode: 'cors', headers: { 'Authorization': 'Bearer ' + t },
      });
      if (!res.ok) throw new Error('Could not open the PDF (' + res.status + ').');
      return URL.createObjectURL(await res.blob());
    },
    subscribePush(subscription) { return req('POST', '/api/push/subscribe', { subscription }); },
  };
})();
