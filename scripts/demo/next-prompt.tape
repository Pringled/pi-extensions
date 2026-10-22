Output "assets/images/pi-next-prompt-dark.gif"

Source "scripts/demo/style-dark.tape"
Set Height 980

Hide
Type "cd $DEMO_HOME/stats && clear && exec $PI_PREFIX env HOME=$DEMO_HOME pi $PI_FLAGS 2>/dev/null"
Enter
Sleep 4s
Show

Sleep 1s
Type@20ms "test_stats.py fails. Read stats.py and test_stats.py and tell me what the bug is, but don't fix it yet."
Sleep 500ms
Enter
# The suggestion is grey text right after the cursor in the empty input
Wait+Screen@120s /❯  \S/
Sleep 3s
Tab
Sleep 2s
Enter
Wait+Screen@120s /pass/
Wait+Screen@60s /❯  \S/
Sleep 4s
