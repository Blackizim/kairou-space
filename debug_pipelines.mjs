import { spawn } from 'node:child_process';

async function testPipelines() {
  console.log('Testing /api/extract/start with SSE for movie 533535...');
  const res = await fetch('http://127.0.0.1:3001/api/extract/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      target: '533535',
      title: 'Deadpool & Wolverine'
    })
  });
  console.log('Status:', res.status);
  const data = await res.json();
  console.log('Initial Response:', JSON.stringify(data, null, 2));

  if (!data.done && data.jobId) {
    console.log(`Listening to SSE stream /api/extract/stream/${data.jobId} for 6 seconds...`);
    const sseRes = await fetch(`http://127.0.0.1:3001/api/extract/stream/${data.jobId}`);
    const reader = sseRes.body.getReader();
    const decoder = new TextDecoder();
    const timeout = setTimeout(() => {
      reader.cancel();
      console.log('SSE timeout reached');
    }, 6000);

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value);
        console.log('SSE Event:', text.trim());
      }
    } catch (e) {
      // stream closed
    } finally {
      clearTimeout(timeout);
    }
  }
}

testPipelines();
