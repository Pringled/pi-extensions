# Runs a command and passes the terminal through, so a tape can click: VHS has no mouse, so typing ctrl+g, some
# text and ctrl+g again clicks where that text shows on screen. Run with: uv run --with pyte python click.py <command>
import fcntl, os, pty, select, signal, struct, sys, termios, tty

import pyte

def size():
    rows, cols, *_ = struct.unpack("HHHH", fcntl.ioctl(sys.stdin, termios.TIOCGWINSZ, b"\0" * 8))
    return rows, cols

rows, cols = size()
screen = pyte.Screen(cols, rows)
stream = pyte.ByteStream(screen)
pid, fd = pty.fork()
if pid == 0:
    os.execvp(sys.argv[1], sys.argv[1:])

def resize(*_):
    rows, cols = size()
    screen.resize(rows, cols)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))

resize()
signal.signal(signal.SIGWINCH, resize)
tty.setraw(sys.stdin)
target = None
while True:
    try:
        ready, _, _ = select.select([sys.stdin, fd], [], [])
    except InterruptedError:
        continue
    if fd in ready:
        try:
            data = os.read(fd, 65536)
        except OSError:
            break
        stream.feed(data)
        os.write(sys.stdout.fileno(), data)
    if sys.stdin in ready:
        for byte in os.read(sys.stdin.fileno(), 1024):
            if byte == 7:
                if target is not None:
                    text = target.decode()
                    found = [(y, line.find(text)) for y, line in enumerate(screen.display) if text in line]
                    if found:
                        y, x = found[-1]
                        os.write(fd, b"\x1b[<0;%d;%dM\x1b[<0;%d;%dm" % (x + 2, y + 1, x + 2, y + 1))
                target = None if target is not None else b""
            elif target is not None:
                target += bytes([byte])
            else:
                os.write(fd, bytes([byte]))
