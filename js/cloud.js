const Cloud = (() => {
  let supabase = null;
  let connected = false;
  const listeners = new Map();
  const channels = new Map();

  async function init(){
    try {
      if(typeof window.supabase === 'undefined' || !window.supabase.createClient){
        console.warn('Supabase SDK 未加载');
        updateStatus('error', '❌ Supabase SDK 未加载，请检查网络');
        return false;
      }
      supabase = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey, {
        auth: { persistSession: false }
      });

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Supabase 连接超时（5秒）')), 5000);
      });
      const queryPromise = supabase.from('matches').select('id').limit(1);

      const { error } = await Promise.race([queryPromise, timeoutPromise]);
      if(error) throw error;
      connected = true;
      updateStatus('connected', '☁️ 云端已连接');
      console.log('Supabase 已连接');
      return true;
    } catch(err){
      connected = false;
      console.warn('Supabase 未连接:', err.message);
      updateStatus('error', `⚠️ 云端连接失败（${err.message || '未知错误'}），将使用本地模式`);
      return false;
    }
  }

  function updateStatus(type, text){
    const el = document.getElementById('cloudStatus');
    if(!el) return;
    el.className = 'cloud-status ' + type;
    el.textContent = text;
  }

  function isConnected(){ return connected; }

  function uid(){
    return 'j_' + Date.now().toString(36) + Math.random().toString(36).slice(2,8);
  }

  function getJudgeId(){
    let id = localStorage.getItem('cloud_judge_id');
    if(!id){
      id = uid();
      localStorage.setItem('cloud_judge_id', id);
    }
    return id;
  }

  async function saveBank(name, encryptedData, password){
    if(!connected) return null;
    const ownerId = getJudgeId();
    const { data, error } = await supabase.from('banks')
      .insert({ owner_id: ownerId, name, encrypted_data: encryptedData })
      .select()
      .single();
    if(error) throw error;
    return data;
  }

  async function listBanks(ownerId){
    if(!connected) return [];
    const { data, error } = await supabase.from('banks')
      .select('*')
      .eq('owner_id', ownerId)
      .order('created_at', {ascending:false});
    if(error) throw error;
    return data || [];
  }

  async function getBank(id){
    if(!connected) return null;
    const { data, error } = await supabase.from('banks')
      .select('*')
      .eq('id', id)
      .single();
    if(error) throw error;
    return data;
  }

  async function deleteBank(id){
    const { error } = await supabase.from('banks').delete().eq('id', id);
    if(error) throw error;
    return true;
  }

  async function createMatch(bankId, roomId, totalMinutes){
    if(!connected) return null;
    const judgeId = getJudgeId();
    const { data, error } = await supabase.from('matches')
      .insert({ bank_id: bankId, judge_id: judgeId, room_id: roomId, total_minutes: totalMinutes, status: 'pending' })
      .select()
      .single();
    if(error) throw error;
    return data;
  }

  async function updateMatch(id, updates){
    const { data, error } = await supabase.from('matches')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if(error) throw error;
    return data;
  }

  async function getMatchByRoom(roomId){
    const { data, error } = await supabase.from('matches')
      .select('*')
      .eq('room_id', roomId)
      .single();
    if(error) return null;
    return data;
  }

  async function getMatch(id){
    const { data, error } = await supabase.from('matches')
      .select('*')
      .eq('id', id)
      .single();
    if(error) return null;
    return data;
  }

  async function addInviteCodes(matchId, codes){
    if(!connected) return null;
    const rows = codes.map(code => ({ match_id: matchId, code }));
    const { data, error } = await supabase.from('invite_codes').insert(rows).select();
    if(error) throw error;
    return data;
  }

  async function listInviteCodes(matchId){
    const { data, error } = await supabase.from('invite_codes')
      .select('*')
      .eq('match_id', matchId)
      .order('code', {ascending:true});
    if(error) throw error;
    return data || [];
  }

  async function markCodeUsed(matchId, code, playerName){
    const { error } = await supabase.from('invite_codes')
      .update({ used: true, player_name: playerName, used_at: new Date().toISOString() })
      .eq('match_id', matchId)
      .eq('code', code);
    if(error) throw error;
    return true;
  }

  async function upsertProgress(matchId, playerName, inviteCode, progress){
    const { data, error } = await supabase.from('player_progress')
      .upsert({
        match_id: matchId,
        player_name: playerName,
        invite_code: inviteCode,
        unlocked_modules: progress.unlockedModules || [],
        unlocked_questions: progress.unlockedQuestions || [],
        started_at: progress.startedAt ? new Date(progress.startedAt).toISOString() : null,
        expires_at: progress.expiresAt ? new Date(progress.expiresAt).toISOString() : null,
        finished_at: progress.finished ? new Date().toISOString() : null,
        updated_at: new Date().toISOString()
      }, { onConflict: 'match_id,player_name,invite_code' });
    if(error) throw error;
    return data;
  }

  async function getProgress(matchId, playerName, inviteCode){
    const { data, error } = await supabase.from('player_progress')
      .select('*')
      .eq('match_id', matchId)
      .eq('player_name', playerName)
      .eq('invite_code', inviteCode)
      .single();
    if(error) return null;
    return data;
  }

  async function listMatchProgress(matchId){
    const { data, error } = await supabase.from('player_progress')
      .select('*')
      .eq('match_id', matchId);
    if(error) throw error;
    return data || [];
  }

  async function upsertAnswer(matchId, playerName, inviteCode, qid, ans){
    const { data, error } = await supabase.from('answers').upsert({
      match_id: matchId,
      player_name: playerName,
      invite_code: inviteCode,
      question_id: qid,
      state: ans.state,
      value: ans.value,
      is_correct: ans.isCorrect !== undefined ? ans.isCorrect : null,
      submitted_at: ans.submittedAt ? new Date(ans.submittedAt).toISOString() : null,
      updated_at: new Date().toISOString()
    }, { onConflict: 'match_id,player_name,invite_code,question_id' });
    if(error) throw error;
    return data;
  }

  async function listAnswers(matchId, playerName, inviteCode){
    const { data, error } = await supabase.from('answers')
      .select('*')
      .eq('match_id', matchId)
      .eq('player_name', playerName)
      .eq('invite_code', inviteCode);
    if(error) return [];
    return data || [];
  }

  async function listAllMatchAnswers(matchId){
    const { data, error } = await supabase.from('answers')
      .select('*')
      .eq('match_id', matchId);
    if(error) return [];
    return data || [];
  }

  async function upsertResult(matchId, playerName, inviteCode, result){
    const { error } = await supabase.from('match_results').upsert({
      match_id: matchId,
      player_name: playerName,
      invite_code: inviteCode,
      total_score: result.score,
      correct_count: result.correctCount,
      wrong_count: result.wrongCount,
      total_questions: result.total,
      duration: result.duration,
      finished_at: result.finishedAt ? new Date(result.finishedAt).toISOString() : new Date().toISOString()
    }, { onConflict: 'match_id,player_name,invite_code' });
    if(error) throw error;
    return true;
  }

  async function listResults(matchId){
    const { data, error } = await supabase.from('match_results')
      .select('*')
      .eq('match_id', matchId);
    if(error) return [];
    return data || [];
  }

  function subscribeMatch(matchId, onUpdate){
    if(!connected) return () => {};
    const key = 'match:' + matchId;
    if(channels.has(key)) return () => {};
    const channel = supabase.channel(key)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'answers', filter: `match_id=eq.${matchId}` },
        payload => onUpdate({type:'answer', payload}))
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'player_progress', filter: `match_id=eq.${matchId}` },
        payload => onUpdate({type:'progress', payload}))
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'match_results', filter: `match_id=eq.${matchId}` },
        payload => onUpdate({type:'result', payload}))
      .subscribe();
    channels.set(key, channel);
    return () => {
      channel.unsubscribe();
      channels.delete(key);
    };
  }

  return {
    init, isConnected, updateStatus,
    getJudgeId,
    saveBank, listBanks, getBank, deleteBank,
    createMatch, updateMatch, getMatch, getMatchByRoom,
    addInviteCodes, listInviteCodes, markCodeUsed,
    upsertProgress, getProgress, listMatchProgress,
    upsertAnswer, listAnswers, listAllMatchAnswers,
    upsertResult, listResults,
    subscribeMatch
  };
})();