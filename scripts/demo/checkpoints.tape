Output "assets/images/pi-checkpoints-dark.gif"

Source "scripts/demo/style-dark.tape"
Set Height 980

Hide
Type "cd $DEMO_HOME/stats && clear && exec $PI_PREFIX env HOME=$DEMO_HOME pi $PI_FLAGS 2>/dev/null"
Enter
Sleep 4s
Show

Sleep 1s
Type@20ms "Add a median function to stats.py and a test for it in test_stats.py. Don't run anything."
Sleep 500ms
Enter
Wait+Screen@120s /test_median/
Sleep 8s

Type "/tree"
Sleep 500ms
Enter
Sleep 1500ms
Ctrl+U
Sleep 1500ms
Enter
Sleep 1s
Enter
Wait+Screen@10s /Restore/
Sleep 2500ms
Enter
Sleep 1500ms
Ctrl+C
Type "!git status"
Sleep 500ms
Enter
Wait+Screen@10s /working tree clean/
Sleep 4s
