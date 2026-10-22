Output "assets/images/pi-background-dark.gif"

Source "scripts/demo/style-dark.tape"
Set Height 900

Hide
Type "cd $DEMO_HOME/stats && clear && exec $PI_PREFIX env HOME=$DEMO_HOME pi $PI_FLAGS 2>/dev/null"
Enter
Sleep 4s
Show

Sleep 1s
Type@20ms "Train the model with train.py and tell me the final loss."
Sleep 500ms
Enter
# pi puts the training in the background by itself; the jobs line shows the progress bar until it exits
Wait+Screen@120s /exited 0/
Sleep 10s
