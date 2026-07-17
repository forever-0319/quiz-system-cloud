const Crypto = (() => {
  function b64ToBytes(b64){
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function importPbkdf2Key(password, salt){
    const enc = new TextEncoder();
    const baseKey = await crypto.subtle.importKey(
      'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      {name:'PBKDF2', salt, iterations:100000, hash:'SHA-256'},
      baseKey,
      {name:'AES-GCM', length:256},
      false,
      ['decrypt']
    );
  }

  async function decrypt(encObj, password){
    if(!encObj || encObj.v !== 1) throw new Error('不支持的加密格式');
    if(encObj.algo !== 'AES-GCM') throw new Error('不支持的加密算法');
    const salt = b64ToBytes(encObj.salt);
    const iv = b64ToBytes(encObj.iv);
    const tag = b64ToBytes(encObj.tag);
    const data = b64ToBytes(encObj.data);

    const ciphertext = new Uint8Array(data.length + tag.length);
    ciphertext.set(data, 0);
    ciphertext.set(tag, data.length);

    const key = await importPbkdf2Key(password, salt);
    try {
      const plain = await crypto.subtle.decrypt(
        {name:'AES-GCM', iv, tagLength:128},
        key,
        ciphertext
      );
      return JSON.parse(new TextDecoder().decode(plain));
    } catch(e){
      throw new Error('密码错误或数据损坏');
    }
  }

  async function loadEncryptedBank(url, password){
    const resp = await fetch(url);
    if(!resp.ok) throw new Error('无法加载加密题库（HTTP ' + resp.status + '）');
    const encObj = await resp.json();
    const bank = await decrypt(encObj, password);
    if(!bank.modules || !bank.questions) throw new Error('加密数据格式错误');
    bank.questions.forEach((q,i)=>{
      q.id = q.id || ('q_' + (i+1));
    });
    return bank;
  }

  return { decrypt, loadEncryptedBank };
})();