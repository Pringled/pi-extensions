Output "assets/images/pi-polish-dark.gif"

Source "scripts/demo/style-dark.tape"
Set Height 980

Hide
Type "cd $DEMO_HOME/stats && clear && exec $PI_PREFIX env HOME=$DEMO_HOME pi $PI_FLAGS 2>/dev/null"
Enter
Sleep 4s
Show

Sleep 1s
Type@20ms "test_stats.py fails. Read stats.py and test_stats.py, run python3 -m unittest, fix the bug and run the tests again."
Sleep 500ms
Enter
Wait+Screen@120s /pass/
Sleep 5s
Sleep 2s
