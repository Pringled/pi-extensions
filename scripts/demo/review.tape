Output "assets/images/pi-browser-review-dark.gif"

Source "scripts/demo/style-dark.tape"
Set Height 980

# review/setup.sh puts a change on a branch; review/open stands in for the browser and leaves two comments
Hide
Type "R=$PWD && cd $DEMO_HOME/stats && sh $R/scripts/demo/review/setup.sh && clear && PATH=$R/scripts/demo/review:$PATH exec $PI_PREFIX env HOME=$DEMO_HOME pi $PI_FLAGS 2>/dev/null"
Enter
Sleep 4s
Show

Sleep 1s
Type@40ms "/review"
Sleep 500ms
Enter
Wait+Screen@20s /Reviewing in the browser/
# The browser half (comment, Send to Pi) is spliced in here by review/splice.sh
Wait+Screen@30s /review comments/
# Pi works through the comment; it's done when pi-next-prompt's suggestion appears in the input, right above its border
Wait+Screen@120s /❯ +\S.*\n─+/
Sleep 4s
