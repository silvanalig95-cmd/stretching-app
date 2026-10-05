# Build from the repository root:   docker build -f deploy/Dockerfile -t unfurl .
# The image carries a ready copy of the app. If UNFURL_REPO_URL is set it then follows that git branch and
# updates itself (no rebuild needed); if not, it simply runs what is baked in.
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates openssh-client \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --create-home --home-dir /home/unfurl unfurl \
    && mkdir -p /srv/unfurl /data && chown unfurl:unfurl /srv/unfurl /data
ARG BUILD=docker
COPY --chown=unfurl:unfurl serve.py index.html favicon.svg /opt/unfurl-seed/
COPY --chown=unfurl:unfurl css /opt/unfurl-seed/css
COPY --chown=unfurl:unfurl js /opt/unfurl-seed/js
COPY --chown=unfurl:unfurl data /opt/unfurl-seed/data
COPY --chown=unfurl:unfurl deploy /opt/unfurl-seed/deploy
RUN echo "$BUILD" > /opt/unfurl-seed/BUILD && chmod +x /opt/unfurl-seed/deploy/*.sh
ENV UNFURL_HOME=/srv/unfurl UNFURL_DATA=/data UNFURL_SEED=/opt/unfurl-seed UNFURL_HOST=0.0.0.0 UNFURL_PORT=8765
USER unfurl
VOLUME ["/srv/unfurl", "/data"]
EXPOSE 8765
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python3 -c "import urllib.request,os; urllib.request.build_opener(urllib.request.ProxyHandler({})).open('http://127.0.0.1:%s/healthz' % os.environ.get('UNFURL_PORT','8765'), timeout=4)"
ENTRYPOINT ["/opt/unfurl-seed/deploy/run.sh"]
