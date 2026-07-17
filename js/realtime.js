const Realtime = (() => {
  const listeners = new Map();
  let unsub = null;
  let currentMatchId = null;

  function init(){
    if(typeof BroadcastChannel !== 'undefined'){
      try {
        const localChannel = new BroadcastChannel('exam_system_v2');
        localChannel.onmessage = (e) => {
          const { type, data } = e.data || {};
          if(!type) return;
          emit(type, data);
        };
      } catch(err){
        console.warn('BroadcastChannel disabled:', err);
      }
    }
    if(window.Cloud && window.Cloud.isConnected && window.Cloud.isConnected()){
      subscribeMatch(currentMatchId);
    }
    return true;
  }

  function setMatch(matchId){
    currentMatchId = matchId;
    if(window.Cloud && window.Cloud.isConnected && window.Cloud.isConnected()){
      subscribeMatch(matchId);
    }
  }

  function subscribeMatch(matchId){
    if(!matchId || !window.Cloud) return;
    if(unsub){ unsub(); unsub = null; }
    unsub = window.Cloud.subscribeMatch(matchId, msg => {
      if(msg.type === 'answer') emit('cloud:answer', msg.payload);
      else if(msg.type === 'progress') emit('cloud:progress', msg.payload);
      else if(msg.type === 'result') emit('cloud:result', msg.payload);
    });
  }

  function emit(type, data){
    const handlers = listeners.get(type) || [];
    handlers.forEach(h => {
      try { h(data); } catch(err){ console.error(err); }
    });
    if(typeof BroadcastChannel !== 'undefined'){
      try {
        const ch = new BroadcastChannel('exam_system_v2');
        ch.postMessage({ type, data });
        ch.close();
      } catch(err){}
    }
  }

  function on(type, handler){
    if(!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(handler);
    return () => {
      const arr = listeners.get(type) || [];
      const idx = arr.indexOf(handler);
      if(idx >= 0) arr.splice(idx, 1);
    };
  }

  function close(){
    if(unsub){ unsub(); unsub = null; }
    listeners.clear();
  }

  return { init, emit, on, close, setMatch };
})();