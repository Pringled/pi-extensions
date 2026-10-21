Output "assets/images/pi-background-dark.gif"

Source "scripts/demo/style-dark.tape"
Set Height 900

Hide
Type "cd $DEMO_HOME/stats && clear && exec $PI_PREFIX env HOME=$DEMO_HOME pi $PI_FLAGS 2>/dev/null"
Enter
Sleep 4s
Show

Sleep 1s
Type@20ms "Run train.py with python3 in the background. Tell me the loss as soon as epoch 3 is done, and again when training finishes."
Sleep 500ms
Enter
Wait+Screen@120s /saved model/
Wait+Screen@60s /0\.156/
Sleep 6s
