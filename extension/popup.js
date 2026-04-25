const SERVER = 'http://localhost:3333';

const app = document.getElementById('app');
const dot = document.getElementById('dot');

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showMsg(icon, title, subtitle = '', code = '') {
  app.innerHTML = `
    <div class="msg">
      <div class="msg-icon">${icon}</div>
      <div class="msg-text">
        <strong>${title}</strong>
        ${subtitle}
        ${code ? `<br><code>${esc(code)}</code>` : ''}
      </div>
    </div>
  `;
}

function showSpinner(text) {
  app.innerHTML = `
    <div class="msg">
      <div class="msg-text" style="display:flex;align-items:center;justify-content:center;gap:8px;color:#666;">
        <span class="spinner"></span>${esc(text)}
      </div>
    </div>
  `;
}

function showDownloadUI(url, title) {
  app.innerHTML = `
    <div class="content">
      <div class="video-title">${esc(title)}</div>
      <label class="toggle-row">
        <span class="toggle-label" id="toggle-label">Jen toto video</span>
        <label class="toggle">
          <input type="checkbox" id="playlist-toggle">
          <div class="toggle-track"></div>
          <div class="toggle-thumb"></div>
        </label>
      </label>
      <div class="buttons">
        <button class="btn btn-mp4" id="btn-mp4">↓ MP4</button>
        <button class="btn btn-mp3" id="btn-mp3">♪ MP3</button>
      </div>
      <div id="progress-area"></div>
      <div class="status" id="status"></div>
    </div>
  `;

  const toggle = document.getElementById('playlist-toggle');
  const label  = document.getElementById('toggle-label');
  toggle.addEventListener('change', () => {
    label.textContent = toggle.checked ? 'Celý playlist' : 'Jen toto video';
  });

  document.getElementById('btn-mp4').addEventListener('click', () => startDownload(url, 'mp4', title));
  document.getElementById('btn-mp3').addEventListener('click', () => startDownload(url, 'mp3', title));
}

// ── Progress bar helpers ─────────────────────────────────────────────────────

function showProgressBar() {
  document.getElementById('progress-area').innerHTML = `
    <div class="progress-wrap">
      <div class="progress-fill indeterminate" id="prog-fill"></div>
    </div>
    <div class="progress-meta">
      <span id="prog-left">Připojuji…</span>
      <span id="prog-right"></span>
    </div>
  `;
}

function updateProgressBar(pct, speed, eta) {
  const fill = document.getElementById('prog-fill');
  const left = document.getElementById('prog-left');
  const right = document.getElementById('prog-right');
  if (!fill) return;

  fill.classList.remove('indeterminate');
  fill.style.width = pct + '%';
  left.textContent = pct.toFixed(1) + '%  ·  ' + speed;
  right.textContent = 'ETA ' + eta;
}

function updateProgressStatus(text) {
  const left = document.getElementById('prog-left');
  const right = document.getElementById('prog-right');
  const fill  = document.getElementById('prog-fill');
  if (!left) return;

  // Indeterminate bar for non-percentage phases (merging, converting)
  if (fill) {
    fill.classList.add('indeterminate');
    fill.style.width = '';
  }
  left.textContent = text;
  if (right) right.textContent = '';
}

function clearProgressBar() {
  document.getElementById('progress-area').innerHTML = '';
}

// ── Download flow ────────────────────────────────────────────────────────────

async function startDownload(url, format, title) {
  const btnMp4   = document.getElementById('btn-mp4');
  const btnMp3   = document.getElementById('btn-mp3');
  const statusEl = document.getElementById('status');
  const playlist = document.getElementById('playlist-toggle').checked;

  btnMp4.disabled = true;
  btnMp3.disabled = true;
  statusEl.className = 'status';
  statusEl.textContent = '';

  showProgressBar();

  // ── 1. POST /download → get job_id ──────────────────────────────────────
  let jobId;
  try {
    const res = await fetch(`${SERVER}/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, format, playlist }),
    });
    const data = await res.json();

    if (!data.job_id) {
      clearProgressBar();
      statusEl.className = 'status error';
      statusEl.textContent = '✗ ' + (data.error || 'Nepodařilo se spustit stahování');
      btnMp4.disabled = false;
      btnMp3.disabled = false;
      return;
    }
    jobId = data.job_id;
  } catch {
    clearProgressBar();
    statusEl.className = 'status error';
    statusEl.textContent = '✗ Chyba připojení k serveru';
    btnMp4.disabled = false;
    btnMp3.disabled = false;
    return;
  }

  // ── 2. Stream progress via EventSource ──────────────────────────────────
  const es = new EventSource(`${SERVER}/progress/${jobId}`);

  es.onmessage = (e) => {
    let event;
    try { event = JSON.parse(e.data); } catch { return; }

    if (event.type === 'progress') {
      updateProgressBar(event.pct, event.speed, event.eta);

    } else if (event.type === 'status') {
      updateProgressStatus(event.text);

    } else if (event.type === 'done') {
      es.close();
      clearProgressBar();
      statusEl.className = 'status success';
      statusEl.textContent = '✓ ' + (event.filename || 'Uloženo do ~/Downloads');

      if (format === 'mp3' && event.filename) {
        const trimBtn = document.createElement('button');
        trimBtn.className = 'btn btn-mp3';
        trimBtn.style.cssText = 'margin-top: 10px; width: 100%;';
        trimBtn.textContent = '✂ Trimovat audio';
        trimBtn.addEventListener('click', () => {
          const p = new URLSearchParams({ file: event.filename, title: title || '' });
          chrome.tabs.create({ url: chrome.runtime.getURL('trimmer.html') + '?' + p });
        });
        statusEl.insertAdjacentElement('afterend', trimBtn);
      }

    } else if (event.type === 'error') {
      es.close();
      clearProgressBar();
      statusEl.className = 'status error';
      statusEl.textContent = '✗ ' + (event.error || 'Neznámá chyba');
      btnMp4.disabled = false;
      btnMp3.disabled = false;
    }
  };

  es.onerror = () => {
    // Only treat as error if we haven't already received a done/error event
    const statusText = statusEl.textContent;
    if (!statusText.startsWith('✓') && !statusText.startsWith('✗')) {
      es.close();
      clearProgressBar();
      statusEl.className = 'status error';
      statusEl.textContent = '✗ Spojení se serverem přerušeno';
      btnMp4.disabled = false;
      btnMp3.disabled = false;
    }
  };
}

// ── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  showSpinner('Připojování…');

  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    showMsg('⚠️', 'Chyba rozšíření', 'Nepodařilo se přečíst aktivní záložku.');
    return;
  }

  if (!tab || !tab.url || !/youtube\.com\/watch/.test(tab.url)) {
    dot.className = 'dot';
    showMsg('📺', 'Otevři YouTube video', 'Funguje jen na stránkách s videem.', 'youtube.com/watch?v=…');
    return;
  }

  try {
    const res  = await fetch(`${SERVER}/ping`, { signal: AbortSignal.timeout(3000) });
    const data = await res.json();

    if (!data.ok) {
      dot.className = 'dot err';
      showMsg('⚠️', 'yt-dlp nenalezeno', 'Nainstaluj ho a restartuj server:', 'brew install yt-dlp');
      return;
    }
    dot.className = 'dot ok';
  } catch {
    dot.className = 'dot err';
    showMsg('🔴', 'Server neběží — spusť start.sh', '', './start.sh');
    return;
  }

  const rawTitle = tab.title || '';
  const title    = rawTitle.replace(/\s[–\-]\s*YouTube\s*$/, '').trim() || 'Neznámé video';

  showDownloadUI(tab.url, title);
}

init();
