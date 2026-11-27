Output "assets/images/pi-subagent-dark.gif"

Source "scripts/demo/style-dark.tape"
Set Height 760

# click.py lets the tape click: ctrl+g, some text and ctrl+g again clicks that text on screen
Hide
Type "cd $DEMO_HOME/stats && clear && exec $CLICK $PI_PREFIX env HOME=$DEMO_HOME pi $PI_FLAGS 2>/dev/null"
Enter
Sleep 5s
Show

Sleep 1s
Type@60ms "/agent rev"
Sleep 600ms
Tab
Sleep 400ms
Enter
# The agent runs in the background; clicking its line shows what it's doing, and clicking the title closes it
Wait+Screen@20s /⏵ agent review/
Sleep 2500ms
Ctrl+G
Type "⏵ agent review"
Ctrl+G
Sleep 3500ms
Ctrl+G
Type "● agent review"
Ctrl+G
Wait+Screen@120s /agent review · done/
Sleep 8s
