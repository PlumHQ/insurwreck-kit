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

# A normal, non-root user with passwordless sudo, like a laptop account.
RUN useradd -m -s /bin/bash leader \
 && echo "leader ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/leader

USER leader
WORKDIR /home/leader
ENV SHELL=/bin/bash
ENV HOME=/home/leader

CMD ["/bin/bash", "-l"]
