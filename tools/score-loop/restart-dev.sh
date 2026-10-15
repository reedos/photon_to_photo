#!/bin/sh
# restarts the r5 dev server on 47804 (the vite config ignores **/.claude/** for watching)
for pid in $(netstat -ano | grep ':47804 ' | grep LISTENING | awk '{print $5}' | sort -u); do taskkill //PID $pid //F >/dev/null 2>&1; done
sleep 1
nohup npx vite --host 127.0.0.1 --port 47804 --strictPort > /tmp/vite47804.log 2>&1 &
sleep 5
cat /tmp/vite47804.log
