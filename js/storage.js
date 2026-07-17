const Storage = (() => {
  const KEY_BANK = 'exam_bank_v2';
  const KEY_MATCH = 'exam_match_v2';
  const KEY_JUDGE = 'exam_judge_v2';
  const KEY_PLAYER = 'exam_player_v2';
  const KEY_STATS = 'exam_stats_v2';
  const KEY_ARCHIVES = 'exam_archives_v2';

  const get = (k, d) => {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }
    catch(e){ return d; }
  };
  const set = (k, v) => {
    try { localStorage.setItem(k, JSON.stringify(v)); }
    catch(e){ console.error('Storage.set failed', e); }
  };

  return {
    saveBank(bank){ set(KEY_BANK, bank); },
    getBank(){ return get(KEY_BANK, null); },
    clearBank(){ localStorage.removeItem(KEY_BANK); },

    saveJudge(j){ set(KEY_JUDGE, j); },
    getJudge(){ return get(KEY_JUDGE, null); },
    hasJudge(){ return !!this.getJudge(); },
    clearJudge(){ localStorage.removeItem(KEY_JUDGE); },

    saveMatch(m){ set(KEY_MATCH, m); },
    getMatch(){ return get(KEY_MATCH, null); },
    clearMatch(){ localStorage.removeItem(KEY_MATCH); },

    savePlayer(p){ set(KEY_PLAYER, p); },
    getPlayer(){ return get(KEY_PLAYER, null); },
    clearPlayer(){ localStorage.removeItem(KEY_PLAYER); },

    saveProgress(matchId, p){ set('exam_progress_' + matchId, p); },
    getProgress(matchId){ return get('exam_progress_' + matchId, null); },
    clearProgress(matchId){ localStorage.removeItem('exam_progress_' + matchId); },

    saveResult(matchId, r){ set('exam_result_' + matchId, r); },
    getResult(matchId){ return get('exam_result_' + matchId, null); },

    getStats(){ return get(KEY_STATS, []); },
    addStat(r){ const s = this.getStats(); s.unshift(r); set(KEY_STATS, s); },
    clearStats(){ set(KEY_STATS, []); },

    getArchives(){ return get(KEY_ARCHIVES, []); },
    getArchive(matchId){ return this.getArchives().find(a => a.matchId === matchId); },
    addArchive(archive){
      const arr = this.getArchives();
      arr.unshift(archive);
      set(KEY_ARCHIVES, arr);
    },
    updateArchive(matchId, updater){
      const arr = this.getArchives();
      const idx = arr.findIndex(a => a.matchId === matchId);
      if(idx >= 0){
        arr[idx] = updater(arr[idx]);
        set(KEY_ARCHIVES, arr);
      }
    },
    deleteArchive(matchId){
      const arr = this.getArchives().filter(a => a.matchId !== matchId);
      set(KEY_ARCHIVES, arr);
    },
    clearArchives(){ set(KEY_ARCHIVES, []); },

    clearAll(){
      [KEY_BANK, KEY_MATCH, KEY_JUDGE, KEY_PLAYER, KEY_STATS, KEY_ARCHIVES].forEach(k => localStorage.removeItem(k));
      Object.keys(localStorage).filter(k => k.startsWith('exam_progress_') || k.startsWith('exam_result_')).forEach(k => localStorage.removeItem(k));
    }
  };
})();