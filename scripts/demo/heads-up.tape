Output "assets/images/pi-heads-up-dark.gif"

Source "scripts/demo/style-dark.tape"
Set Height 980

Hide
Type "cd $DEMO_HOME/stats && clear && exec $PI_PREFIX env HOME=$DEMO_HOME pi $PI_FLAGS 2>/dev/null"
Enter
Sleep 4s
Show

Sleep 1s
Type@20ms "Rename spread() to value_range() in stats.py and test_stats.py, then run the tests."
Sleep 500ms
Enter
Wait+Screen@180s /heads-up:/
Sleep 6s
