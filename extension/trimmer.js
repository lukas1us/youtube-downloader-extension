const SERVER = 'http://localhost:3333';

const urlParams  = new URLSearchParams(window.location.search);
const filename   = urlParams.get('file');
const title      = urlParams.get('title') || '';

const inpStart       = document.getElementById('inp-start');
const inpEnd         = document.getElementById('inp-end');
const btnPlayPause   = document.getElementById('btn-play-pause');
const btnPlayRegion  = document.getElementById('btn-play-region');
const btnSave        = document.getElementById('btn-save');
const statusEl       = document.getElementById('status');
const loadingOverlay = document.getElementById('loading-overlay');
const videoTitle     = document.getElementById('video-title');

videoTitle.textContent = title;

if (!filename) {
  loadingOverlay.innerHTML = '⚠ Žádný soubor nebyl zadán v URL.';
} else {
  var ws = WaveSurfer.create({
    container: '#waveform',
    waveColor: '#3a3a5c',
    progressColor: '#cc3333',
    cursorColor: '#666',
    cursorWidth: 1,
    height: 100,
    responsive: true,
    normalize: true,
    plugins: [
      WaveSurfer.regions.create({
        dragSelection: false,
        regions: [],
      }),
    ],
  });

  var region = null;
  var syncingFromCode = false;

  ws.load(SERVER + '/file?name=' + encodeURIComponent(filename));

  ws.on('ready', function () {
    loadingOverlay.style.display = 'none';

    var dur = ws.getDuration();
    inpStart.max   = dur.toFixed(2);
    inpEnd.max     = dur.toFixed(2);
    inpStart.value = (0).toFixed(2);
    inpEnd.value   = dur.toFixed(2);

    region = ws.addRegion({
      start:  0,
      end:    dur,
      color:  'rgba(255,165,0,0.3)',
      drag:   true,
      resize: true,
    });

    btnPlayPause.disabled  = false;
    btnPlayRegion.disabled = false;
    btnSave.disabled       = false;
  });

  ws.on('error', function (err) {
    loadingOverlay.innerHTML = '⚠ Chyba při načítání souboru: ' + err;
    console.error(err);
  });

  // Region → inputs (live while dragging/resizing)
  ws.on('region-updated', function (r) {
    if (syncingFromCode) return;
    inpStart.value = r.start.toFixed(2);
    inpEnd.value   = r.end.toFixed(2);
  });

  // Inputs → region (on blur / Enter)
  function applyInputsToRegion() {
    if (!region) return;
    var s = parseFloat(inpStart.value);
    var e = parseFloat(inpEnd.value);
    if (isNaN(s) || isNaN(e) || s < 0 || e <= s) return;
    syncingFromCode = true;
    region.update({ start: s, end: e });
    syncingFromCode = false;
  }
  inpStart.addEventListener('change', applyInputsToRegion);
  inpEnd.addEventListener('change', applyInputsToRegion);

  // Playback button labels
  ws.on('play',   function () { btnPlayPause.textContent = '⏸ Pause'; });
  ws.on('pause',  function () { btnPlayPause.textContent = '▶ Play'; });
  ws.on('finish', function () { btnPlayPause.textContent = '▶ Play'; });

  btnPlayPause.addEventListener('click', function () {
    ws.playPause();
  });

  btnPlayRegion.addEventListener('click', function () {
    if (!region) return;
    ws.play(region.start, region.end);
  });

  btnSave.addEventListener('click', async function () {
    if (!region) return;

    btnSave.disabled = true;
    statusEl.className = 'status loading';
    statusEl.textContent = 'Ukládám…';

    try {
      var res = await fetch(SERVER + '/trim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: filename,
          start: parseFloat(region.start.toFixed(2)),
          end:   parseFloat(region.end.toFixed(2)),
        }),
      });
      var data = await res.json();

      if (data.ok) {
        statusEl.className = 'status success';
        statusEl.textContent = '✓ Uloženo: ' + data.filename;
      } else {
        statusEl.className = 'status error';
        statusEl.textContent = '✗ ' + (data.error || 'Neznámá chyba');
        btnSave.disabled = false;
      }
    } catch (_) {
      statusEl.className = 'status error';
      statusEl.textContent = '✗ Chyba připojení k serveru';
      btnSave.disabled = false;
    }
  });
}
