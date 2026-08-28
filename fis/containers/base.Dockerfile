# The operator runtime.
#
# Everything an evidentiary operator can touch is pinned here, and the digest of
# this image is recorded in every recipe step that ran inside it. That is what
# makes "re-run the recipe" a meaningful instruction years later.
FROM python:3.12-slim-bookworm

# ffmpeg is used for decoding only in evidentiary paths, never for encoding: a
# lossy encoder's output is not reproducible and has no place in a class E chain.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ffmpeg libgl1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/fis

COPY worker/pyproject.toml /opt/fis/pyproject.toml
COPY worker/src /opt/fis/src

RUN pip install --no-cache-dir --no-compile . \
 && python -c "import cv2, numpy, scipy, skimage, av; print('runtime ok')"

# The registry is dumped at build time and its digest becomes an image label, so
# a recipe naming this image also names exactly which operator definitions were
# inside it.
RUN python -m fis.operators.registry > /opt/fis/registry.json \
 && python -m fis.operators.registry --digest-only > /opt/fis/registry.digest \
 && cat /opt/fis/registry.digest

COPY containers/entrypoint.sh /usr/local/bin/fis-entrypoint
RUN chmod +x /usr/local/bin/fis-entrypoint

ENV PYTHONPATH=/opt/fis/src
ENTRYPOINT ["/usr/local/bin/fis-entrypoint"]
CMD ["python", "-m", "fis.cli", "--help"]
