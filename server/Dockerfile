FROM python:3.12-slim

# ffmpeg is required by yt-dlp for merging video+audio and MP3 conversion
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install yt-dlp via pip (keeps it updatable with `docker compose build --no-cache`)
RUN pip install --no-cache-dir yt-dlp

COPY main.py .

EXPOSE 3333
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "3333"]
