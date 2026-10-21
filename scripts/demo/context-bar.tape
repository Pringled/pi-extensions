Output "assets/images/pi-context-bar-dark.gif"

Source "scripts/demo/style-dark.tape"
Set Height 400

Hide
Type "cd $DEMO_HOME/stats && clear && exec $PI_PREFIX env HOME=$DEMO_HOME pi $PI_FLAGS 2>/dev/null"
Enter
Sleep 4s
Show

Type "Say hi in five words."
Enter
Wait+Screen@90s /[1-9][.0-9]*k\/1/
Sleep 5s
