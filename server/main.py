import asyncio
import json
import os
import re
import shutil
import uuid
from pathlib import Path

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Range", "Accept-Ranges"],
)

# Output dirs — override via env vars when running in Docker
DIR_VIDEO = os.environ.get("DOWNLOAD_DIR_VIDEO", str(Path.home() / "Downloads"))
DIR_AUDIO = os.environ.get("DOWNLOAD_DIR_AUDIO", os.path.expanduser("~/Documents/Music/ytb-downloader"))

YTDLP_CANDIDATES = [
    "yt-dlp",
    "/usr/local/bin/yt-dlp",
    "/opt/homebrew/bin/yt-dlp",
    os.path.expanduser("~/.local/bin/yt-dlp"),
]

# job_id → asyncio.Queue of SSE event dicts (None = sentinel / stream end)
jobs: dict[str, asyncio.Queue] = {}


def find_ytdlp() -> str | None:
    for path in YTDLP_CANDIDATES:
        if shutil.which(path):
            return path
        if path.startswith("/") and os.path.isfile(path) and os.access(path, os.X_OK):
            return path
    return None


# ── Line parser ──────────────────────────────────────────────────────────────

_PROGRESS_RE = re.compile(
    r'\[download\]\s+(\d+\.?\d*)%\s+of\s+~?(\S+)\s+at\s+(\S+)\s+ETA\s+(\S+)'
)
_DEST_RE    = re.compile(r'\[download\] Destination: (.+)')
_MERGE_RE   = re.compile(r'Merging formats into "(.+)"')
_AUDIO_RE   = re.compile(r'\[ExtractAudio\] Destination: (.+)')


def _parse_line(line: str, state: dict) -> dict | None:
    """Return an SSE event dict for interesting yt-dlp output lines, or None."""

    m = _PROGRESS_RE.search(line)
    if m:
        pct   = float(m.group(1))
        speed = m.group(3)
        eta   = m.group(4)
        return {"type": "progress", "pct": pct, "speed": speed, "eta": eta}

    m = _DEST_RE.search(line)
    if m:
        state["filename"] = os.path.basename(m.group(1).strip())
        return None  # don't surface individual segment destinations

    m = _MERGE_RE.search(line)
    if m:
        state["filename"] = os.path.basename(m.group(1).strip().strip('"'))
        return {"type": "status", "text": "Slučuji formáty…"}

    m = _AUDIO_RE.search(line)
    if m:
        state["filename"] = os.path.basename(m.group(1).strip())
        return {"type": "status", "text": "Převádím na MP3…"}

    return None


# ── Background download task ─────────────────────────────────────────────────

async def _run_download(ytdlp: str, cmd: list[str], queue: asyncio.Queue) -> None:
    state: dict = {"filename": ""}
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        assert proc.stdout is not None

        async for raw in proc.stdout:
            line = raw.decode(errors="replace").rstrip()
            event = _parse_line(line, state)
            if event is not None:
                await queue.put(event)

        await proc.wait()

        if proc.returncode == 0:
            await queue.put({"type": "done", "filename": state["filename"]})
        else:
            await queue.put({"type": "error", "error": f"yt-dlp exited with code {proc.returncode}"})

    except Exception as exc:
        await queue.put({"type": "error", "error": str(exc)})
    finally:
        await queue.put(None)  # sentinel — close the SSE stream


# ── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/ping")
def ping():
    ytdlp = find_ytdlp()
    return {
        "ok": ytdlp is not None,
        "ytdlp": ytdlp,
        "download_dir_video": DIR_VIDEO,
        "download_dir_audio": DIR_AUDIO,
    }


class DownloadRequest(BaseModel):
    url: str
    format: str       # "mp4" | "mp3"
    playlist: bool = False


@app.post("/download")
async def download(req: DownloadRequest):
    ytdlp = find_ytdlp()
    if not ytdlp:
        return {"job_id": None, "error": "yt-dlp not found — run: brew install yt-dlp"}

    if req.format == "mp3":
        output_dir = DIR_AUDIO
    else:
        output_dir = DIR_VIDEO

    os.makedirs(output_dir, exist_ok=True)
    output_tpl = os.path.join(output_dir, "%(title)s.%(ext)s")

    playlist_flag = [] if req.playlist else ["--no-playlist"]

    if req.format == "mp3":
        cmd = [
            ytdlp, "--newline", *playlist_flag,
            "-x", "--audio-format", "mp3", "--audio-quality", "0",
            "-o", output_tpl,
            req.url,
        ]
    else:
        cmd = [
            ytdlp, "--newline", *playlist_flag,
            "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
            "--merge-output-format", "mp4",
            "-o", output_tpl,
            req.url,
        ]

    job_id = uuid.uuid4().hex[:12]
    queue: asyncio.Queue = asyncio.Queue()
    jobs[job_id] = queue

    asyncio.create_task(_run_download(ytdlp, cmd, queue))

    return {"job_id": job_id}


@app.get("/progress/{job_id}")
async def progress(job_id: str, request: Request):
    queue = jobs.get(job_id)
    if queue is None:
        return Response(status_code=404, content="Job not found")

    async def generate():
        try:
            while True:
                # 30-second heartbeat keep-alive so the connection stays open
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=30)
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
                    continue

                if event is None:   # sentinel — download finished or failed
                    break

                yield f"data: {json.dumps(event)}\n\n"

                # After a terminal event, drain and stop
                if event.get("type") in ("done", "error"):
                    break
        finally:
            jobs.pop(job_id, None)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/file")
async def get_file(name: str):
    audio_dir = Path(DIR_AUDIO).resolve()
    filepath = (audio_dir / name).resolve()
    if not str(filepath).startswith(str(audio_dir) + os.sep) and filepath != audio_dir:
        return Response(status_code=400, content="Invalid filename")
    if not filepath.exists() or not filepath.is_file():
        return Response(status_code=404, content="File not found")
    return FileResponse(str(filepath), media_type="audio/mpeg")


class TrimRequest(BaseModel):
    filename: str
    start: float
    end: float


@app.post("/trim")
async def trim_audio(req: TrimRequest):
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return {"ok": False, "error": "ffmpeg není dostupné — v Docker obrazu je zahrnuté, na macOS: brew install ffmpeg"}

    audio_dir = Path(DIR_AUDIO).resolve()
    input_path = (audio_dir / req.filename).resolve()

    if not str(input_path).startswith(str(audio_dir) + os.sep):
        return {"ok": False, "error": "Neplatný název souboru"}

    if not input_path.exists() or not input_path.is_file():
        return {"ok": False, "error": f"Soubor neexistuje: {req.filename}"}

    start_int = round(req.start)
    end_int   = round(req.end)
    output_name = f"{input_path.stem}_trim_{start_int}s-{end_int}s.mp3"
    output_path = audio_dir / output_name

    cmd = [
        ffmpeg, "-y",
        "-i", str(input_path),
        "-ss", str(req.start),
        "-to", str(req.end),
        "-c", "copy",
        str(output_path),
    ]

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        await proc.communicate()

        if proc.returncode == 0:
            return {"ok": True, "filename": output_name}
        else:
            return {"ok": False, "error": f"ffmpeg selhalo s kódem {proc.returncode}"}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
