async function testTarget(name, target, extra = {}) {
  console.log(`\n========================================`);
  console.log(`TESTANDO: ${name} (target: ${target})`);
  console.log(`========================================`);
  const t0 = Date.now();
  try {
    const res = await fetch('http://127.0.0.1:3001/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target, ...extra })
    });
    const elapsed = Date.now() - t0;
    console.log(`HTTP Status: ${res.status} (${elapsed}ms)`);
    if (!res.ok) {
      console.log(`Erro HTTP:`, await res.text());
      return;
    }
    const data = await res.json();
    console.log(`Streams encontrados: ${data.streams?.length || 0}`);
    console.log(`Legendas encontradas: ${data.subtitles?.length || 0}`);
    if (data.streams?.length > 0) {
      for (let i = 0; i < Math.min(data.streams.length, 5); i++) {
        const s = data.streams[i];
        console.log(`  [${i + 1}] ${s.label} | ${s.quality} | Áudio: ${s.audio} (${s.isPtBr ? 'PT-BR' : 'LEG'}) | Codec: ${s.codec} | Formato: ${s.format} | 4K: ${s.is4k}`);
        // Test first stream URL
        if (i === 0) {
          const streamUrl = `http://127.0.0.1:3001${s.streamUrl}`;
          const tStream0 = Date.now();
          try {
            const streamRes = await fetch(streamUrl, {
              headers: { Range: 'bytes=0-1000' }
            });
            const streamElapsed = Date.now() - tStream0;
            const ct = streamRes.headers.get('content-type');
            console.log(`      -> Teste de Playback Stream #1: HTTP ${streamRes.status} (${streamElapsed}ms) - Content-Type: ${ct}`);
          } catch (err) {
            console.log(`      -> Teste de Playback Stream #1 FALHOU:`, err.message);
          }
        }
      }
    } else {
      console.log('  ⚠️ Nenhuma stream retornada!');
    }
  } catch (err) {
    console.error(`Erro ao testar ${name}:`, err.message);
  }
}

async function run() {
  // 1. Popular Movie (Deadpool & Wolverine)
  await testTarget('Filme - Deadpool & Wolverine', '533535', { title: 'Deadpool & Wolverine' });

  // 2. Kids Movie (Divertida Mente 2)
  await testTarget('Filme Infantil - Divertida Mente 2', '1022789', { title: 'Divertida Mente 2' });

  // 3. Series (The Last of Us S01E01)
  await testTarget('Série - The Last of Us S01E01', '100088/1/1', { title: 'The Last of Us' });

  // 4. Anime (Demon Slayer S01E01)
  await testTarget('Anime - Demon Slayer S01E01', '85937/1/1', { title: 'Demon Slayer: Kimetsu no Yaiba', isAnime: true });
}

run();
