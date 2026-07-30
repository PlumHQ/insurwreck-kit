# A deliberately bare machine: no node, no npm, no git, no build tools.
# Closest reproduction of a leadership laptop that has never seen a terminal.
# The point is to prove the one-paste command survives an empty box.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# Only what a factory image genuinely has. Resist adding anything here — every
# package added is a failure the rehearsal stops catching.
RUN apt-get update -qq \
 && apt-get install -y -qq --no-install-recommends ca-certificates curl sudo \
 && rm -rf /var/lib/apt/lists/*

# A normal, non-root user whose sudo needs a PASSWORD - which is what WSL2 and a
# real laptop account both give you. The previous NOPASSWD:ALL was convenient and
# wrong: it hid a step that ran `sudo apt-get ... >/dev/null 2>&1`, where the
# password prompt went to /dev/null and the whole script appeared to freeze. Any
# step that needs root must detect that and skip, not block.
RUN useradd -m -s /bin/bash leader \
 && usermod -aG sudo leader

USER leader
WORKDIR /home/leader
ENV SHELL=/bin/bash
ENV HOME=/home/leader

CMD ["/bin/bash", "-l"]
