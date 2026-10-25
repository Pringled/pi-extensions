#!/bin/sh
# Puts a small change on a branch in the demo project, as if Pi had just made it
set -e
git branch -m main
git switch -qc add-median
cat >> stats.py <<'PY'


def median(values):
    """Return the middle value of values."""
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2
PY
git -c user.name=demo -c user.email=demo@example.com commit -qam "Add median"
python3 - <<'PY'
s = open("test_stats.py").read()
s = s.replace("from stats import mean, spread", "from stats import mean, median, spread")
s = s.replace("        self.assertEqual(spread([3, 9, 1]), 8)\n", "        self.assertEqual(spread([3, 9, 1]), 8)\n\n    def test_median(self):\n        self.assertEqual(median([3, 1, 2]), 2)\n")
open("test_stats.py", "w").write(s)
PY
