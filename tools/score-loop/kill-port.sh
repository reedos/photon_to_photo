#!/bin/sh
# kills whatever listens on the port given as $1 (used to stop the r5 baseline server)
for pid in $(netstat -ano | grep ":$1 " | grep LISTENING | awk '{print $5}' | sort -u); do taskkill //PID $pid //F >/dev/null 2>&1; done
